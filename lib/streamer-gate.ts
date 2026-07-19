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

export function isStudioGateActive(state: StudioGateState): boolean {
  return state.listening && state.listenerAlive;
}

export function isStreamerBlockingVoice(state: StudioGateState, now = Date.now()): boolean {
  if (!isStudioGateActive(state)) return false;
  if (state.streamerSpeaking) return true;
  const tail = state.settings.silenceTailMs;
  return state.lastSpeechAt > 0 && now - state.lastSpeechAt < tail;
}

export function describeStreamerGate(state: StudioGateState, now = Date.now()): string | null {
  if (!isStudioGateActive(state)) {
    if (state.listening && !state.listenerAlive) return 'studio listener offline';
    return null;
  }
  if (state.streamerSpeaking) return 'streamer talking — voice held';
  if (state.lastSpeechAt > 0 && now - state.lastSpeechAt < state.settings.silenceTailMs) {
    const waitSec = Math.max(1, Math.ceil((state.settings.silenceTailMs - (now - state.lastSpeechAt)) / 1000));
    return `mic tail — voice in ~${waitSec}s`;
  }
  return null;
}

export async function waitForStreamerSilence(
  getState: () => StudioGateState,
  opts: { maxWaitMs?: number; pollMs?: number } = {},
): Promise<'clear' | 'timeout'> {
  const maxWaitMs = opts.maxWaitMs ?? 30_000;
  const pollMs = opts.pollMs ?? 100;
  const start = Date.now();

  while (isStreamerBlockingVoice(getState())) {
    if (Date.now() - start >= maxWaitMs) return 'timeout';
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, pollMs);
    });
  }
  return 'clear';
}
