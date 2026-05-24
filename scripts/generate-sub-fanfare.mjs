import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_RATE = 44100;

/** Opening phrase of La Cucaracha — the part novelty car horns play. */
const MELODY = [
  { freq: 523.25, duration: 0.22 }, // C5
  { freq: 523.25, duration: 0.22 }, // C5
  { freq: 523.25, duration: 0.22 }, // C5
  { freq: 349.23, duration: 0.28 }, // F4
  { freq: 329.63, duration: 0.18 }, // E4
  { freq: 349.23, duration: 0.18 }, // F4
  { freq: 392.0, duration: 0.38 }, // G4
  { freq: 392.0, duration: 0.18 }, // G4
  { freq: 349.23, duration: 0.18 }, // F4
  { freq: 329.63, duration: 0.18 }, // E4
  { freq: 349.23, duration: 0.18 }, // F4
  { freq: 392.0, duration: 0.45 }, // G4 (hold)
];

const GAP = 0.06;

function hornSample(phase, freq) {
  const f1 = freq;
  const f2 = freq * 1.25;
  const raw =
    0.45 * Math.sin(phase * f1) +
    0.35 * Math.sin(phase * f2) +
    0.12 * Math.sin(phase * f1 * 2) +
    0.08 * Math.sin(phase * f1 * 3);
  return Math.tanh(raw * 2.2);
}

function envelope(t, duration) {
  const attack = 0.012;
  const release = Math.min(0.08, duration * 0.35);
  if (t < attack) return t / attack;
  if (t > duration - release) return Math.max(0, (duration - t) / release);
  return 1;
}

function renderMelody() {
  const totalDuration =
    MELODY.reduce((sum, note) => sum + note.duration, 0) + GAP * (MELODY.length - 1) + 0.15;
  const samples = new Float32Array(Math.ceil(totalDuration * SAMPLE_RATE));
  let offsetSeconds = 0;

  for (const note of MELODY) {
    const start = Math.floor(offsetSeconds * SAMPLE_RATE);
    const noteSamples = Math.floor(note.duration * SAMPLE_RATE);

    for (let i = 0; i < noteSamples; i += 1) {
      const t = i / SAMPLE_RATE;
      const env = envelope(t, note.duration);
      const phase = t;
      const idx = start + i;
      if (idx < samples.length) {
        samples[idx] += hornSample(phase, note.freq) * env * 0.85;
      }
    }

    offsetSeconds += note.duration + GAP;
  }

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
