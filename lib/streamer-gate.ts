import type { StudioSnapshot } from '@/lib/studio-state';

export type StudioGateState = Pick<
  StudioSnapshot,
  | 'listening'
  | 'listenerAlive'
  | 'streamerSpeaking'
  | 'lastSpeechAt'
  | 'recentHostSpeech'
  | 'latestHostMention'
  | 'settings'
>;

export type StreamerGateTiming = {
  extraTailMs?: number;
};

export function isStudioGateActive(state: StudioGateState): boolean {
  return state.listening && state.listenerAlive;
}

function effectiveSilenceTailMs(state: StudioGateState, opts: StreamerGateTiming = {}) {
  return state.settings.silenceTailMs + Math.max(0, opts.extraTailMs ?? 0);
}

export function isStreamerBlockingVoice(
  state: StudioGateState,
  now = Date.now(),
  opts: StreamerGateTiming = {},
): boolean {
  if (!isStudioGateActive(state)) return false;
  if (state.streamerSpeaking) return true;
  const tail = effectiveSilenceTailMs(state, opts);
  return state.lastSpeechAt > 0 && now - state.lastSpeechAt < tail;
}

export function describeStreamerGate(
  state: StudioGateState,
  now = Date.now(),
  opts: StreamerGateTiming = {},
): string | null {
  if (!isStudioGateActive(state)) {
    if (state.listening && !state.listenerAlive) return 'studio listener offline';
    return null;
  }
  if (state.streamerSpeaking) return 'streamer talking - voice held';
  const tail = effectiveSilenceTailMs(state, opts);
  if (state.lastSpeechAt > 0 && now - state.lastSpeechAt < tail) {
    const waitSec = Math.max(1, Math.ceil((tail - (now - state.lastSpeechAt)) / 1000));
    return `mic tail - voice in ~${waitSec}s`;
  }
  return null;
}

export async function waitForStreamerSilence(
  getState: () => StudioGateState,
  opts: { maxWaitMs?: number; pollMs?: number; extraTailMs?: number } = {},
): Promise<'clear' | 'timeout'> {
  const maxWaitMs = opts.maxWaitMs ?? 30_000;
  const pollMs = opts.pollMs ?? 100;
  const start = Date.now();

  while (isStreamerBlockingVoice(getState(), Date.now(), { extraTailMs: opts.extraTailMs })) {
    if (Date.now() - start >= maxWaitMs) return 'timeout';
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, pollMs);
    });
  }
  return 'clear';
}
