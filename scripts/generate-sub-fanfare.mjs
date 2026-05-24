import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_RATE = 44100;

/** Iconic La Cucaracha hook — one octave lower for a tubby air-horn register. */
const MELODY = [
  { freq: 261.63, duration: 0.26 }, // C4
  { freq: 261.63, duration: 0.26 }, // C4
  { freq: 261.63, duration: 0.26 }, // C4
  { freq: 174.61, duration: 0.3 }, // F3
  { freq: 164.81, duration: 0.22 }, // E3
  { freq: 174.61, duration: 0.22 }, // F3
  { freq: 196.0, duration: 0.42 }, // G3
];

const GAP = 0.045;

function mulberry32(seed) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0xc0cac01a);

function hornEnvelope(t, duration) {
  const attack = 0.018;
  const release = Math.min(0.09, duration * 0.4);
  if (t < attack) return (t / attack) ** 0.6;
  if (t > duration - release) return Math.max(0, (duration - t) / release);
  return 1;
}

function sawHarmonics(phase, harmonics) {
  let sum = 0;
  for (let h = 1; h <= harmonics; h += 1) {
    sum += Math.sin(2 * Math.PI * phase * h) / h;
  }
  return sum;
}

function renderHornHonk(samples, startIdx, freq, duration) {
  const noteSamples = Math.floor(duration * SAMPLE_RATE);
  const detune = 1 + (rng() - 0.5) * 0.012;
  const secondaryRatio = 1.47 + (rng() - 0.5) * 0.03;
  let phasePrimary = rng();
  let phaseSecondary = rng();

  for (let i = 0; i < noteSamples; i += 1) {
    const t = i / SAMPLE_RATE;
    const scoop = t < 0.035 ? 0.86 + (t / 0.035) * 0.14 : 1;
    const wobble = 1 + Math.sin(t * 2 * Math.PI * 5.5) * 0.012;
    const f = freq * detune * scoop * wobble;
    const env = hornEnvelope(t, duration);
    const tremolo = 0.72 + 0.28 * Math.sin(t * 2 * Math.PI * 31);

    phasePrimary += f / SAMPLE_RATE;
    phaseSecondary += (f * secondaryRatio) / SAMPLE_RATE;

    const primary = sawHarmonics(phasePrimary, 7);
    const secondary = sawHarmonics(phaseSecondary, 5);
    const air = (rng() * 2 - 1) * 0.18 * Math.exp(-t * 10);
    const click = (rng() * 2 - 1) * 0.35 * Math.exp(-t * 90);

    const raw =
      primary * 0.52 +
      secondary * 0.34 +
      air +
      click;

    const idx = startIdx + i;
    if (idx < samples.length) {
      samples[idx] += Math.tanh(raw * 1.35) * env * tremolo * 0.78;
    }
  }
}

function applyReverb(samples) {
  const mix = new Float32Array(samples.length);
  const delays = [0.021, 0.031, 0.047, 0.061];
  const gains = [0.24, 0.18, 0.14, 0.1];

  for (let d = 0; d < delays.length; d += 1) {
    const offset = Math.floor(delays[d] * SAMPLE_RATE);
    for (let i = offset; i < samples.length; i += 1) {
      mix[i] += samples[i - offset] * gains[d];
    }
  }

  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = samples[i] * 0.84 + mix[i] * 0.38;
  }
}

function lowPass(samples, cutoffHz) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / SAMPLE_RATE;
  const alpha = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < samples.length; i += 1) {
    prev = prev + alpha * (samples[i] - prev);
    samples[i] = prev;
  }
}

function normalize(samples, peak = 0.92) {
  let max = 0;
  for (const sample of samples) {
    max = Math.max(max, Math.abs(sample));
  }
  if (max <= 0) return;
  const gain = peak / max;
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] *= gain;
  }
}

function renderMelody() {
  const totalDuration =
    MELODY.reduce((sum, note) => sum + note.duration, 0) + GAP * (MELODY.length - 1) + 0.2;
  const samples = new Float32Array(Math.ceil(totalDuration * SAMPLE_RATE));
  let offsetSeconds = 0;

  for (const note of MELODY) {
    const start = Math.floor(offsetSeconds * SAMPLE_RATE);
    renderHornHonk(samples, start, note.freq, note.duration);
    offsetSeconds += note.duration + GAP;
  }

  lowPass(samples, 2200);
  applyReverb(samples);
  normalize(samples);
  return samples;
}

function writeWav(filePath, samples) {
  const numSamples = samples.length;
  const buffer = Buffer.alloc(44 + numSamples * 2);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  for (let i = 0; i < numSamples; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

const outPath = path.join(__dirname, '..', 'public', 'sounds', 'elroy', 'sub_fanfare.wav');
writeWav(outPath, renderMelody());
console.log(`Wrote ${outPath}`);
