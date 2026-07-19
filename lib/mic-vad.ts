/** RMS level from time-domain audio samples (0–~0.5 typical for speech). */
export function computeMicRms(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  if (!buffer.length) return 0;
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const sample = buffer[i] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / buffer.length);
}

export type MicVadState = {
  speaking: boolean;
  lastSpeechAt: number;
  level: number;
  hotSince: number;
};

export type MicVadStepInput = {
  rms: number;
  threshold: number;
  minSpeechMs: number;
  now?: number;
  prev: MicVadState;
};

/** Hysteresis VAD with minimum speech duration before flipping to "speaking". */
export function stepMicVad(input: MicVadStepInput): MicVadState {
  const now = input.now ?? Date.now();
  const { rms, threshold, minSpeechMs, prev } = input;
  const hot = rms >= threshold;

  if (hot) {
    const hotSince = prev.hotSince || now;
    if (!prev.speaking && now - hotSince >= minSpeechMs) {
      return { speaking: true, lastSpeechAt: now, level: rms, hotSince };
    }
    if (prev.speaking) {
      return { speaking: true, lastSpeechAt: now, level: rms, hotSince };
    }
    return { speaking: false, lastSpeechAt: prev.lastSpeechAt, level: rms, hotSince };
  }

  const stoppedAt = prev.speaking ? now : prev.lastSpeechAt;
  return {
    speaking: false,
    lastSpeechAt: stoppedAt,
    level: rms,
    hotSince: 0,
  };
}

export const INITIAL_MIC_VAD_STATE: MicVadState = {
  speaking: false,
  lastSpeechAt: 0,
  level: 0,
  hotSince: 0,
};
