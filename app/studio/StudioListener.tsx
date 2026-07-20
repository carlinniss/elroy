'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioSnapshot } from '@/lib/studio-state';
import { computeMicRms, INITIAL_MIC_VAD_STATE, stepMicVad } from '@/lib/mic-vad';

const SECRET_STORAGE_KEY = 'elroy-control-secret';
const INGEST_MS = 250;
const ANALYSIS_MS = 80;
const SETTINGS_POLL_MS = 5000;
const TRANSCRIPT_CHUNK_MS = 5000;
const TRANSCRIPT_TIMEOUT_MS = 25_000;
const TRANSCRIPT_TEMPORARY_BACKOFF_MS = 60_000;

function isTemporaryTranscriptionError(message: string, status: number) {
  const lower = message.toLowerCase();
  if (
    lower.includes('billing')
    || lower.includes('payment')
    || lower.includes('credits')
    || lower.includes('quota exceeded')
    || lower.includes('insufficient_quota')
  ) {
    return false;
  }
  return (
    status === 429
    || status === 503
    || lower.includes('temporarily busy')
    || lower.includes('high demand')
    || lower.includes('overloaded')
    || lower.includes('try again')
    || lower.includes('quota/rate limit')
  );
}

function authHeaders(secret: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${secret}`,
  };
}

type AuthState = 'checking' | 'authorized' | 'missing' | 'unauthorized';

type DisplayCaptureMediaDevices = MediaDevices & {
  getDisplayMedia?: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
};

type BroadcastCaptureOptions = DisplayMediaStreamOptions & {
  selfBrowserSurface?: 'include' | 'exclude';
  systemAudio?: 'include' | 'exclude';
  windowAudio?: 'exclude' | 'window' | 'system';
  surfaceSwitching?: 'include' | 'exclude';
};

export function StudioListener({ initialSecret }: { initialSecret?: string }) {
  const [secret, setSecret] = useState('');
  const [savedSecret, setSavedSecret] = useState('');
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState('Enter your control secret to start.');
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [hostTranscript, setHostTranscript] = useState('');
  const [hostTranscriptAt, setHostTranscriptAt] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptBackoffUntil, setTranscriptBackoffUntil] = useState(0);
  const [error, setError] = useState('');

  const settingsRef = useRef({
    energyThreshold: 0.025,
    minSpeechMs: 200,
    silenceTailMs: 1500,
  });
  const vadRef = useRef(INITIAL_MIC_VAD_STATE);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const bufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const analysisTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ingestTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcribingRef = useRef(false);
  const transcriptBackoffUntilRef = useRef(0);

  const verifySecret = useCallback(async (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed) return false;
    try {
      const res = await fetch('/api/control/verify', {
        headers: { Authorization: `Bearer ${trimmed}` },
        cache: 'no-store',
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fromUrl = initialSecret?.trim();
      const stored = sessionStorage.getItem(SECRET_STORAGE_KEY)?.trim();
      const resolved = fromUrl || stored || '';
      if (!resolved) {
        if (!cancelled) setAuthState('missing');
        return;
      }
      const ok = await verifySecret(resolved);
      if (cancelled) return;
      if (!ok) {
        sessionStorage.removeItem(SECRET_STORAGE_KEY);
        setAuthState('unauthorized');
        setStatus('Wrong control secret.');
        return;
      }
      sessionStorage.setItem(SECRET_STORAGE_KEY, resolved);
      setSecret(resolved);
      setSavedSecret(resolved);
      setAuthState('authorized');
      setStatus('Authorized — share the Twitch tab or system audio to start listening.');
    })();
    return () => { cancelled = true; };
  }, [initialSecret, verifySecret]);

  const refreshSettings = useCallback(async () => {
    if (!savedSecret) return;
    try {
      const res = await fetch(`/api/studio/status?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${savedSecret}` },
      });
      if (!res.ok) return;
      const data = await res.json() as StudioSnapshot;
      settingsRef.current = {
        energyThreshold: data.settings.energyThreshold,
        minSpeechMs: data.settings.minSpeechMs,
        silenceTailMs: data.settings.silenceTailMs,
      };
      setSnapshot(data);
    } catch {
      /* ignore */
    }
  }, [savedSecret]);

  useEffect(() => {
    if (authState !== 'authorized') return;
    void refreshSettings();
    const timer = setInterval(() => { void refreshSettings(); }, SETTINGS_POLL_MS);
    return () => clearInterval(timer);
  }, [authState, refreshSettings]);

  const postIngest = useCallback(async (payload: {
    listening: boolean;
    inputSource: 'broadcast';
    streamerSpeaking: boolean;
    lastSpeechAt: number;
    hostTranscript?: string;
  }) => {
    if (!savedSecret) return;
    try {
      const res = await fetch('/api/studio/ingest', {
        method: 'POST',
        headers: authHeaders(savedSecret),
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSnapshot(await res.json() as StudioSnapshot);
      }
    } catch {
      /* ignore transient network errors */
    }
  }, [savedSecret]);

  const transcribeBroadcastChunk = useCallback(async (blob: Blob) => {
    if (!savedSecret || blob.size < 1000) return;
    if (transcribingRef.current) return;
    if (Date.now() < transcriptBackoffUntilRef.current) return;

    transcribingRef.current = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRANSCRIPT_TIMEOUT_MS);
    try {
      setTranscribing(true);
      const form = new FormData();
      form.set('audio', blob, 'broadcast.webm');
      const res = await fetch('/api/studio/transcribe', {
        method: 'POST',
        headers: { Authorization: `Bearer ${savedSecret}` },
        body: form,
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({})) as { text?: string; error?: string };
      if (!res.ok) {
        const message = data.error || 'Broadcast transcription failed';
        if (isTemporaryTranscriptionError(message, res.status)) {
          const retryAt = Date.now() + TRANSCRIPT_TEMPORARY_BACKOFF_MS;
          transcriptBackoffUntilRef.current = retryAt;
          setTranscriptBackoffUntil(retryAt);
          setError('');
          setStatus('Studio is still listening — transcription is busy, retrying automatically in ~60s.');
          return;
        }
        setError(message);
        return;
      }
      transcriptBackoffUntilRef.current = 0;
      setTranscriptBackoffUntil(0);
      const text = data.text?.replace(/\s+/g, ' ').trim();
      if (!text) return;
      setError('');
      setHostTranscript(text);
      setHostTranscriptAt(Date.now());
      await postIngest({
        listening: true,
        inputSource: 'broadcast',
        streamerSpeaking: vadRef.current.speaking,
        lastSpeechAt: vadRef.current.lastSpeechAt,
        hostTranscript: text,
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === 'AbortError';
      const retryAt = Date.now() + 15_000;
      transcriptBackoffUntilRef.current = retryAt;
      setTranscriptBackoffUntil(retryAt);
      setStatus(timedOut
        ? 'Studio is still listening — transcription timed out, retrying shortly.'
        : 'Studio is still listening — transcription upload hiccup, retrying shortly.');
      console.warn('Broadcast transcription failed', error);
    } finally {
      clearTimeout(timeoutId);
      transcribingRef.current = false;
      setTranscribing(false);
    }
  }, [postIngest, savedSecret]);

  const stopListening = useCallback(() => {
    if (analysisTimerRef.current) {
      clearInterval(analysisTimerRef.current);
      analysisTimerRef.current = null;
    }
    if (ingestTimerRef.current) {
      clearInterval(ingestTimerRef.current);
      ingestTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    analyserRef.current = null;
    bufferRef.current = null;
    vadRef.current = INITIAL_MIC_VAD_STATE;
    setListening(false);
    setSpeaking(false);
    setLevel(0);
    setTranscribing(false);
    setHostTranscriptAt(0);
    transcribingRef.current = false;
    transcriptBackoffUntilRef.current = 0;
    setTranscriptBackoffUntil(0);
    void postIngest({
      listening: false,
      inputSource: 'broadcast',
      streamerSpeaking: false,
      lastSpeechAt: 0,
    });
    setStatus('Stopped — Elroy will not gate voice on host audio.');
  }, [postIngest]);

  const getBroadcastStream = useCallback(async () => {
    const mediaDevices = navigator.mediaDevices as DisplayCaptureMediaDevices;
    if (!mediaDevices.getDisplayMedia) {
      throw new Error('Broadcast audio capture is not supported in this browser.');
    }

    const captureOptions: BroadcastCaptureOptions = {
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      selfBrowserSurface: 'exclude',
      systemAudio: 'include',
      windowAudio: 'system',
      surfaceSwitching: 'include',
    };

    const stream = await mediaDevices.getDisplayMedia(captureOptions);

    if (stream.getAudioTracks().length > 0) return stream;
    stream.getTracks().forEach((track) => track.stop());
    const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
    throw new Error(isFirefox
      ? 'No broadcast audio was shared. Firefox usually shares display video without tab/window audio here. Use Chrome or Edge and pick a tab with "Share tab audio", or feed Studio system audio through an OBS/virtual-audio setup.'
      : 'No broadcast audio was shared. Pick a browser tab and enable "Share tab audio", or choose Entire screen with system audio. Window capture often does not include audio.');
  }, []);

  const startListening = useCallback(async () => {
    if (!savedSecret) return;
    setError('');
    try {
      const stream = await getBroadcastStream();
      streamRef.current = stream;

      const ctx = new AudioContext();
      await ctx.resume();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;
      bufferRef.current = new Float32Array(analyser.fftSize);

      if (typeof MediaRecorder === 'undefined') {
        throw new Error('Broadcast transcription is not supported in this browser.');
      }
      const audioTracks = stream.getAudioTracks();
      const transcriptStream = new MediaStream(audioTracks);
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(transcriptStream, { mimeType });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          void transcribeBroadcastChunk(event.data);
        }
      };
      recorder.onerror = () => {
        setError('Broadcast transcription recorder failed');
      };
      mediaRecorderRef.current = recorder;
      recorder.start(TRANSCRIPT_CHUNK_MS);

      vadRef.current = INITIAL_MIC_VAD_STATE;
      setListening(true);
      setStatus('Listening to broadcast audio — Elroy waits until the host is quiet before voice.');

      analysisTimerRef.current = setInterval(() => {
        const node = analyserRef.current;
        const buffer = bufferRef.current;
        if (!node || !buffer) return;

        const rms = computeMicRms(node, buffer);
        const settings = settingsRef.current;
        const next = stepMicVad({
          rms,
          threshold: settings.energyThreshold,
          minSpeechMs: settings.minSpeechMs,
          prev: vadRef.current,
        });
        vadRef.current = next;
        setLevel(rms);
        setSpeaking(next.speaking);
      }, ANALYSIS_MS);

      ingestTimerRef.current = setInterval(() => {
        const vad = vadRef.current;
        void postIngest({
          listening: true,
          inputSource: 'broadcast',
          streamerSpeaking: vad.speaking,
          lastSpeechAt: vad.lastSpeechAt,
        });
      }, INGEST_MS);

      void postIngest({
        listening: true,
        inputSource: 'broadcast',
        streamerSpeaking: false,
        lastSpeechAt: 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Broadcast audio access denied');
      stopListening();
    }
  }, [getBroadcastStream, postIngest, savedSecret, stopListening, transcribeBroadcastChunk]);

  useEffect(() => () => { stopListening(); }, [stopListening]);

  const saveSecret = async () => {
    const trimmed = secret.trim();
    if (!trimmed) return;
    const ok = await verifySecret(trimmed);
    if (!ok) {
      setStatus('Wrong control secret.');
      setAuthState('unauthorized');
      return;
    }
    sessionStorage.setItem(SECRET_STORAGE_KEY, trimmed);
    setSavedSecret(trimmed);
    setAuthState('authorized');
    setStatus('Secret saved.');
  };

  const levelPct = Math.min(100, Math.round((level / 0.15) * 100));
  const thresholdPct = Math.min(100, Math.round((settingsRef.current.energyThreshold / 0.15) * 100));
  const transcriptPaused = transcriptBackoffUntil > Date.now();
  const transcriptLabel = transcribing ? 'listening' : transcriptPaused ? 'retrying soon' : 'idle';
  const lastHeardLabel = hostTranscriptAt
    ? new Date(hostTranscriptAt).toLocaleTimeString()
    : '';

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Elroy Studio</h1>
        <p style={{ margin: '8px 0 0', color: '#c4b5fd', lineHeight: 1.45 }}>
          Broadcast listener — tells the overlay when the host is talking so Elroy does not talk over them.
        </p>
      </header>

      {authState === 'missing' || authState === 'unauthorized' ? (
        <section style={panelStyle}>
          <h2 style={headingStyle}>Control secret</h2>
          <p style={hintStyle}>Same secret as <code style={codeStyle}>/control</code> and OBS embed.</p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Control secret"
              style={inputStyle}
            />
            <button type="button" onClick={() => { void saveSecret(); }} style={buttonStyle}>Save</button>
          </div>
          {authState === 'unauthorized' ? (
            <p style={{ ...hintStyle, color: '#fca5a5' }}>{status}</p>
          ) : null}
        </section>
      ) : null}

      {authState === 'authorized' ? (
        <>
          <section style={panelStyle}>
            <h2 style={headingStyle}>Twitch broadcast audio</h2>
            <p style={hintStyle}>
              Click start, then share the Twitch stream tab with audio enabled, or share your entire screen with system
              audio. Chrome or Edge work best; Firefox may share video without broadcast audio. Elroy uses that audio
              to wait until the host is quiet before speaking.
            </p>

            <div style={meterTrackStyle}>
              <div style={{ ...meterFillStyle, width: `${levelPct}%` }} />
              <div style={{ ...meterThresholdStyle, left: `${thresholdPct}%` }} />
            </div>
            <p style={hintStyle}>
              Level: {level.toFixed(3)}
              {' · '}
              Threshold: {settingsRef.current.energyThreshold.toFixed(3)}
              {' · '}
              Source: {listening ? 'broadcast' : 'not listening'}
              {' · '}
              Transcript: {transcriptLabel}
              {' · '}
              {speaking ? (
                <span style={{ color: '#86efac', fontWeight: 600 }}>Host audio detected</span>
              ) : (
                <span style={{ color: '#94a3b8' }}>Quiet</span>
              )}
            </p>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {!listening ? (
                <button type="button" onClick={() => { void startListening(); }} style={primaryButtonStyle}>
                  Start listening
                </button>
              ) : (
                <button type="button" onClick={stopListening} style={dangerButtonStyle}>
                  Stop listening
                </button>
              )}
            </div>
            {error ? <p style={{ ...hintStyle, color: '#fca5a5', marginBottom: 0 }}>{error}</p> : null}
            <p style={{ ...hintStyle, marginBottom: 0 }}>{status}</p>
            {hostTranscript ? (
              <p style={{ ...hintStyle, marginTop: '12px', marginBottom: 0 }}>
                Last heard{lastHeardLabel ? ` (${lastHeardLabel})` : ''}: <strong>{hostTranscript}</strong>
              </p>
            ) : null}
          </section>

          <section style={panelStyle}>
            <h2 style={headingStyle}>Overlay sync</h2>
            <ul style={listStyle}>
              <li>
                Listener:{' '}
                {snapshot?.listenerAlive ? (
                  <strong style={{ color: '#86efac' }}>live</strong>
                ) : snapshot?.listening ? (
                  <strong style={{ color: '#fcd34d' }}>stale — restart listening</strong>
                ) : (
                  <strong style={{ color: '#94a3b8' }}>off</strong>
                )}
              </li>
              <li>Source: broadcast audio</li>
              <li>Last host line: {snapshot?.recentHostSpeech?.at(-1)?.text ?? '—'}</li>
              <li>Silence tail: {snapshot?.settings.silenceTailMs ?? '—'}ms after you stop</li>
              <li>Adjust tail &amp; sensitivity in Control Panel → Studio</li>
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  padding: '24px 20px 48px',
  maxWidth: '640px',
  margin: '0 auto',
  color: '#f8fafc',
  fontFamily: 'system-ui, sans-serif',
  background: 'linear-gradient(180deg, #0f0a1a 0%, #1a1030 100%)',
};

const headerStyle: React.CSSProperties = { marginBottom: '20px' };
const panelStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '14px',
  padding: '18px',
  marginBottom: '16px',
};
const headingStyle: React.CSSProperties = { margin: '0 0 10px', fontSize: '1.1rem' };
const hintStyle: React.CSSProperties = { margin: '0 0 12px', color: '#cbd5e1', fontSize: '14px', lineHeight: 1.5 };
const codeStyle: React.CSSProperties = { color: '#fde68a' };
const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: '200px',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(0,0,0,0.35)',
  color: '#fff',
};
const buttonStyle: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.1)',
  color: '#fff',
  cursor: 'pointer',
};
const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#9146FF',
  borderColor: '#b794f6',
  fontWeight: 600,
};
const dangerButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  borderColor: 'rgba(252, 165, 165, 0.55)',
  color: '#fecaca',
};
const meterTrackStyle: React.CSSProperties = {
  position: 'relative',
  height: '12px',
  borderRadius: '6px',
  background: 'rgba(0,0,0,0.4)',
  overflow: 'hidden',
  marginBottom: '8px',
};
const meterFillStyle: React.CSSProperties = {
  height: '100%',
  background: 'linear-gradient(90deg, #22c55e, #eab308)',
  transition: 'width 80ms linear',
};
const meterThresholdStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  width: '2px',
  background: '#fca5a5',
  transform: 'translateX(-1px)',
};
const listStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '20px',
  color: '#cbd5e1',
  lineHeight: 1.6,
};
