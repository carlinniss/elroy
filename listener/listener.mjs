#!/usr/bin/env node
/**
 * Elroy headless Studio listener — replaces keeping /studio open in a browser.
 *
 * Pulls broadcast audio with ffmpeg (from Twitch via streamlink, or straight from OBS over SRT),
 * runs the same energy VAD as the /studio page, and reports to Elroy's existing endpoints:
 *   POST /api/studio/ingest      — "host is talking / quiet" (on change + 1.5s heartbeat)
 *   POST /api/studio/transcribe  — 10s WAV chunks that had speech → host transcript
 *
 * No dependencies beyond Node 20+, ffmpeg and (for LISTEN_SOURCE=twitch) streamlink.
 */
import { spawn } from 'node:child_process';

const env = (name, fallback = '') => (process.env[name] ?? fallback).trim();

const ELROY_URL = env('ELROY_URL', 'http://app:3000').replace(/\/$/, '');
const SECRET = env('ELROY_CONTROL_SECRET');
const SOURCE = env('LISTEN_SOURCE', 'twitch');
const CHANNEL = env('NEXT_PUBLIC_TWITCH_CHANNEL').replace(/^#/, '').toLowerCase();
const STREAMLINK_ARGS = env('STREAMLINK_ARGS', '--twitch-low-latency --twitch-disable-ads');
const TRANSCRIBE = env('LISTEN_TRANSCRIBE', 'true') !== 'false';
/** Extra ffmpeg input options for non-Twitch sources, e.g. "-re" when testing with a file. */
const INPUT_ARGS = env('LISTEN_INPUT_ARGS').split(/\s+/).filter(Boolean);
const OFFLINE_RETRY_MS = Number(env('LISTEN_OFFLINE_RETRY_MS', '30000')) || 30_000;

const SAMPLE_RATE = 16_000;
const FRAME_MS = 80;
const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;
const FRAME_BYTES = FRAME_SAMPLES * 2;
const HEARTBEAT_MS = 1500;
/** Seconds of audio per transcript. Shorter = captions appear sooner, but more OpenAI requests. */
const CHUNK_MS = Math.min(15, Math.max(3, Number(env('LISTEN_CHUNK_SECONDS', '10')) || 10)) * 1000;
const SETTINGS_REFRESH_MS = 30_000;

const log = (...args) => console.log(new Date().toISOString(), ...args);

if (!SECRET) log('WARNING: ELROY_CONTROL_SECRET is empty — requests will be rejected if the app requires it.');
if (SOURCE === 'twitch' && !CHANNEL) {
  log('NEXT_PUBLIC_TWITCH_CHANNEL is required when LISTEN_SOURCE=twitch');
  process.exit(1);
}

const authHeaders = () => (SECRET ? { Authorization: `Bearer ${SECRET}` } : {});

let settings = { energyThreshold: 0.025, minSpeechMs: 200 };
async function refreshSettings() {
  try {
    const res = await fetch(`${ELROY_URL}/api/studio/status`, { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    if (data?.settings) settings = { ...settings, ...data.settings };
  } catch {
    /* keep last settings */
  }
}

async function postIngest(payload) {
  try {
    await fetch(`${ELROY_URL}/api/studio/ingest`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputSource: 'broadcast', ...payload }),
    });
  } catch (error) {
    log('ingest failed:', error.message);
  }
}

function wavFromPcm(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

let transcribing = false;
let transcribeBackoffUntil = 0;
/** OpenAI credit ran out: keep detecting the host's voice, retry transcripts every 30 min. */
const BILLING_BACKOFF_MS = 30 * 60_000;
let billingPaused = false;
async function transcribe(pcm, vad) {
  if (!TRANSCRIBE || transcribing || Date.now() < transcribeBackoffUntil) return;
  transcribing = true;
  try {
    const form = new FormData();
    form.set('audio', new Blob([wavFromPcm(pcm)], { type: 'audio/wav' }), 'broadcast.wav');
    const res = await fetch(`${ELROY_URL}/api/studio/transcribe`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
      signal: AbortSignal.timeout(25_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.billing) {
        if (!billingPaused) {
          log('OpenAI is out of credit — switching to voice detection only (Elroy still waits for you to finish talking). Retrying transcripts every 30 min.');
        }
        billingPaused = true;
        transcribeBackoffUntil = Date.now() + BILLING_BACKOFF_MS;
        return;
      }
      log('transcribe error:', data.error || res.status);
      transcribeBackoffUntil = Date.now() + 60_000;
      return;
    }
    if (billingPaused) {
      billingPaused = false;
      log('OpenAI credit is back — transcripts resumed.');
    }
    if (data.warning) {
      log('transcribe:', data.warning);
      transcribeBackoffUntil = Date.now() + Math.max(15_000, Number(data.retryAfterMs) || 60_000);
      return;
    }
    const text = String(data.text || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    log('host:', text);
    await postIngest({
      listening: true,
      streamerSpeaking: vad.speaking,
      lastSpeechAt: vad.lastSpeechAt,
      hostTranscript: text,
    });
  } catch (error) {
    log('transcribe failed:', error.message);
    transcribeBackoffUntil = Date.now() + 15_000;
  } finally {
    transcribing = false;
  }
}

/** Same hysteresis VAD as lib/mic-vad.ts. */
function stepVad(prev, rms, now) {
  const hot = rms >= settings.energyThreshold;
  if (hot) {
    const hotSince = prev.hotSince || now;
    if (prev.speaking || now - hotSince >= settings.minSpeechMs) {
      return { speaking: true, lastSpeechAt: now, hotSince };
    }
    return { speaking: false, lastSpeechAt: prev.lastSpeechAt, hotSince };
  }
  return { speaking: false, lastSpeechAt: prev.speaking ? now : prev.lastSpeechAt, hotSince: 0 };
}

function startPipeline() {
  const ffmpegOut = ['-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'];
  const ffmpegQuiet = ['-hide_banner', '-loglevel', 'error'];
  let streamlink = null;
  let ffmpeg;

  if (SOURCE === 'twitch') {
    streamlink = spawn('streamlink', [
      ...STREAMLINK_ARGS.split(/\s+/).filter(Boolean),
      '--stdout', `https://twitch.tv/${CHANNEL}`, 'audio_only,worst',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    streamlink.stderr.on('data', (chunk) => {
      const line = chunk.toString().trim();
      if (line && !/\[cli\]\[info\]/.test(line)) log('streamlink:', line);
    });
    ffmpeg = spawn('ffmpeg', [...ffmpegQuiet, '-i', 'pipe:0', ...ffmpegOut], { stdio: ['pipe', 'pipe', 'inherit'] });
    streamlink.stdout.pipe(ffmpeg.stdin);
    ffmpeg.stdin.on('error', () => {});
  } else {
    // Any ffmpeg input, e.g. srt://0.0.0.0:9000?mode=listener fed by an OBS custom output.
    ffmpeg = spawn('ffmpeg', [...ffmpegQuiet, ...INPUT_ARGS, '-i', SOURCE, ...ffmpegOut], { stdio: ['ignore', 'pipe', 'inherit'] });
  }

  return { ffmpeg, streamlink };
}

async function runOnce() {
  await refreshSettings();
  const { ffmpeg, streamlink } = startPipeline();
  log(`listening (${SOURCE === 'twitch' ? `twitch.tv/${CHANNEL}` : SOURCE})`);

  let vad = { speaking: false, lastSpeechAt: 0, hotSince: 0 };
  let pending = Buffer.alloc(0);
  let chunkFrames = [];
  let chunkStartedAt = Date.now();
  let chunkHadSpeech = false;
  let lastSentSpeaking = null;
  let lastSentAt = 0;
  let gotAudio = false;
  const settingsTimer = setInterval(refreshSettings, SETTINGS_REFRESH_MS);

  ffmpeg.stdout.on('data', (data) => {
    if (!gotAudio) {
      gotAudio = true;
      log('audio flowing');
    }
    pending = Buffer.concat([pending, data]);
    while (pending.length >= FRAME_BYTES) {
      const frame = pending.subarray(0, FRAME_BYTES);
      pending = pending.subarray(FRAME_BYTES);

      let sum = 0;
      for (let i = 0; i < FRAME_SAMPLES; i += 1) {
        const sample = frame.readInt16LE(i * 2) / 32768;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / FRAME_SAMPLES);
      const now = Date.now();
      vad = stepVad(vad, rms, now);
      if (rms >= settings.energyThreshold) chunkHadSpeech = true;

      if (vad.speaking !== lastSentSpeaking || now - lastSentAt >= HEARTBEAT_MS) {
        lastSentSpeaking = vad.speaking;
        lastSentAt = now;
        void postIngest({ listening: true, streamerSpeaking: vad.speaking, lastSpeechAt: vad.lastSpeechAt });
      }

      chunkFrames.push(Buffer.from(frame));
      if (now - chunkStartedAt >= CHUNK_MS) {
        if (chunkHadSpeech) void transcribe(Buffer.concat(chunkFrames), vad);
        chunkFrames = [];
        chunkStartedAt = now;
        chunkHadSpeech = false;
      }
    }
  });

  await new Promise((resolve) => {
    ffmpeg.on('close', resolve);
    streamlink?.on('close', () => ffmpeg.stdin?.end());
  });
  clearInterval(settingsTimer);
  streamlink?.kill('SIGTERM');
  await postIngest({ listening: false, streamerSpeaking: false, lastSpeechAt: vad.lastSpeechAt });
  return gotAudio;
}

// Song-request handoff clock. Runs on the server so requests reach Spotify on time even if the
// OBS overlay is slow or reloading. Only touches Spotify when requests are waiting.
const SONG_REQUEST_TICK_MS = 5_000;
setInterval(() => {
  fetch(`${ELROY_URL}/api/spotify/requests`, { headers: authHeaders(), signal: AbortSignal.timeout(8_000) })
    .catch(() => { /* app restarting — next tick */ });
}, SONG_REQUEST_TICK_MS);

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    stopping = true;
    await postIngest({ listening: false, streamerSpeaking: false });
    process.exit(0);
  });
}

while (!stopping) {
  const hadAudio = await runOnce();
  if (stopping) break;
  // Offline / stream ended: Twitch refuses the stream, so wait and check again.
  const waitMs = hadAudio ? 5_000 : OFFLINE_RETRY_MS;
  log(hadAudio ? 'stream ended — reconnecting shortly' : `no audio (offline?) — retrying in ${Math.round(waitMs / 1000)}s`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}
