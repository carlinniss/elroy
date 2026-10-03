import { describe, it, expect } from 'vitest';
import { planSongRequestTick } from '@/lib/song-requests';
const t = (id: string, name: string, progress = 0, dur = 200000) => ({ id, name, artists: ['X'], album: '', releaseYear: null, durationMs: dur, isPlaying: true, progressMs: progress, trackUrl: null });
const req = { id: 'r', trackId: 'p', uri: 'spotify:track:p', name: 'Req', artists: 'Y', durationMs: 1, requestedBy: 'u', requestedByDisplay: 'U', requestedAt: 0 };
describe('lost request', () => {
  it('pushes with fromTrackId and flags verify when skipped past', () => {
    const s0 = { enabled: true, queue: [req], pushed: null, playing: null, lastRequestAt: {} } as never;
    const a = planSongRequestTick(s0, { playing: true, track: t('a', 'A', 190000) }, 1000);
    expect(a.push?.id).toBe('r');
    expect(a.state.pushed?.fromTrackId).toBe('a');
    expect(a.verifyPushed).toBe(false);
    const b = planSongRequestTick(a.state, { playing: true, track: t('c', 'C') }, 5000);
    expect(b.verifyPushed).toBe(true);
    const c = planSongRequestTick(a.state, { playing: true, track: t('p', 'Req') }, 5000);
    expect(c.state.playing?.id).toBe('r');
  });
});
