import { describe, expect, it } from 'vitest';
import {
  emptySongRequestState,
  formatQueueMessage,
  handleSongRequestAction,
  parseSpotifyTrackRef,
  planSongRequestTick,
  resolveRequesterTier,
  TIER_LIMITS,
  type SongRequest,
} from '@/lib/song-requests';

const req = (n: number, by = 'alice'): SongRequest => ({
  id: `r${n}`, trackId: `track${n}`, uri: `spotify:track:track${n}`, name: `Song ${n}`, artists: 'Artist',
  durationMs: 200_000, requestedBy: by, requestedByDisplay: by, requestedAt: n,
});

const playing = (id: string, progressMs: number, durationMs = 200_000) => ({
  playing: true,
  track: { id, name: id, artists: [], album: '', releaseYear: null, durationMs, isPlaying: true, progressMs, trackUrl: null },
});

describe('song request helpers', () => {
  it('reads Spotify links and URIs', () => {
    expect(parseSpotifyTrackRef('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x')).toBe('4uLU6hMCjMI75M1A2tKUQC');
    expect(parseSpotifyTrackRef('https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC')).toBe('4uLU6hMCjMI75M1A2tKUQC');
    expect(parseSpotifyTrackRef('spotify:track:4uLU6hMCjMI75M1A2tKUQC')).toBe('4uLU6hMCjMI75M1A2tKUQC');
    expect(parseSpotifyTrackRef('nuthin but a g thang')).toBeNull();
  });

  it('ranks requesters: mods > VIPs/subs > regular followers > new viewers', () => {
    const now = Date.parse('2026-09-30T00:00:00Z');
    expect(resolveRequesterTier('mod', null, now)).toBe('mod');
    expect(resolveRequesterTier('vip', null, now)).toBe('vip');
    expect(resolveRequesterTier('viewer', '2026-01-01T00:00:00Z', now)).toBe('regular');
    expect(resolveRequesterTier('viewer', '2026-09-29T12:00:00Z', now)).toBe('new');
    expect(resolveRequesterTier('viewer', null, now)).toBe('new');
    expect(TIER_LIMITS.mod.maxPending).toBeGreaterThan(TIER_LIMITS.regular.maxPending);
    expect(TIER_LIMITS.new.maxPending).toBe(1);
    expect(TIER_LIMITS.new.cooldownMs).toBeGreaterThan(TIER_LIMITS.regular.cooldownMs);
  });

  it('hands the next request to Spotify only near the end of the current song', () => {
    const state = { ...emptySongRequestState(), queue: [req(1), req(2)] };
    expect(planSongRequestTick(state, playing('x', 100_000)).push).toBeNull();
    const plan = planSongRequestTick(state, playing('x', 180_000), 1000);
    expect(plan.push?.id).toBe('r1');
    expect(plan.state.pushed?.id).toBe('r1');
    expect(plan.state.queue.map((r) => r.id)).toEqual(['r2']);
    // Only one locked-in song at a time.
    expect(planSongRequestTick(plan.state, playing('x', 190_000), 2000).push).toBeNull();
  });

  it('announces a request when it starts playing', () => {
    const state = { ...emptySongRequestState(), pushed: { ...req(1, 'bob'), pushedAt: 0 } };
    const plan = planSongRequestTick(state, playing('track1', 1_000), 1000);
    expect(plan.state.playing?.id).toBe('r1');
    expect(plan.state.pushed).toBeNull();
    expect(plan.messages[0]).toContain("@bob's request");
  });

  it('does nothing while paused', () => {
    const state = { ...emptySongRequestState(), queue: [req(1)] };
    expect(planSongRequestTick(state, { playing: false, track: null }).push).toBeNull();
  });

  it('lists the line with the locked-in song first', () => {
    const state = { ...emptySongRequestState(), pushed: { ...req(9, 'zed'), pushedAt: 0 }, queue: [req(1), req(2, 'bob')] };
    const message = formatQueueMessage(state);
    expect(message).toContain('🔒 Song 9');
    expect(message).toContain('1. Song 1');
    expect(message).toContain('2. Song 2');
    expect(formatQueueMessage(emptySongRequestState())).toContain('empty');
  });
});

describe('song request mod tools', () => {
  it('only lets mods remove, clear and toggle', async () => {
    expect((await handleSongRequestAction({ action: 'clear', username: 'viewer', isMod: false })).messages).toEqual([]);
    expect((await handleSongRequestAction({ action: 'toggle', username: 'viewer', isMod: false, enabled: false })).messages).toEqual([]);
    const off = await handleSongRequestAction({ action: 'toggle', username: 'mod', isMod: true, enabled: false });
    expect(off.messages[0]).toContain('OFF');
    const blocked = await handleSongRequestAction({ action: 'request', username: 'viewer', role: 'viewer', query: 'anything' });
    expect(blocked.messages[0]).toContain('off');
    await handleSongRequestAction({ action: 'toggle', username: 'mod', isMod: true, enabled: true });
    const missing = await handleSongRequestAction({ action: 'remove', username: 'mod', isMod: true, target: '3' });
    expect(missing.messages[0]).toContain('no #3');
  });
});
