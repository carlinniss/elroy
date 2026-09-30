/**
 * Chat song requests on Spotify (!sr).
 *
 * Spotify's API can add to the queue but can't remove from it, so Elroy keeps his own request
 * line and hands Spotify ONE song at a time, ~25s before the current track ends. Until a song is
 * handed over, mods can list and remove it. The handed-over song is "locked in" — !skip it when it plays.
 *
 * Request limits scale with standing in the channel: mods > VIPs > subs > regular followers > new viewers.
 */
import { hasRedisStorage, redisCommand } from '@/lib/redis-rest';
import { fetchSpotifyNowPlaying, spotifyUserFetch, type SpotifyNowPlayingSnapshot } from '@/lib/spotify';
import { getFollowInfo } from '@/lib/twitch-mod';

const STATE_KEY = 'elroy:sr:state';
export const MAX_QUEUE = 20;
export const MAX_DURATION_MS = 7 * 60_000;
export const PUSH_WHEN_REMAINING_MS = 25_000;
const STALE_PUSH_MS = 20 * 60_000;
/** Followers of at least this long count as regulars. */
const REGULAR_FOLLOW_MS = 3 * 24 * 60 * 60_000;

export type RequesterRole = 'mod' | 'vip' | 'sub' | 'viewer';
export type RequesterTier = 'mod' | 'vip' | 'sub' | 'regular' | 'new';

/** Pending requests allowed at once, and time between requests, per tier. */
export const TIER_LIMITS: Record<RequesterTier, { maxPending: number; cooldownMs: number; label: string }> = {
  mod: { maxPending: 5, cooldownMs: 0, label: 'mod' },
  vip: { maxPending: 3, cooldownMs: 60_000, label: 'VIP' },
  sub: { maxPending: 3, cooldownMs: 2 * 60_000, label: 'sub' },
  regular: { maxPending: 2, cooldownMs: 3 * 60_000, label: 'regular' },
  new: { maxPending: 1, cooldownMs: 10 * 60_000, label: 'new viewer' },
};

export type SongRequest = {
  id: string;
  trackId: string;
  uri: string;
  name: string;
  artists: string;
  durationMs: number;
  releaseYear?: string;
  requestedBy: string;
  requestedByDisplay: string;
  requestedAt: number;
};

export type SongRequestState = {
  enabled: boolean;
  queue: SongRequest[];
  /** Handed to Spotify's queue; can no longer be removed, only skipped once it plays. */
  pushed: (SongRequest & { pushedAt: number }) | null;
  playing: SongRequest | null;
  lastRequestAt: Record<string, number>;
  /** Last request whose handoff failed and was already reported — never re-announce it. */
  lastPushErrorId?: string;
  /** Don't retry a failed handoff before this time. */
  pushRetryAt?: number;
};

export type SongRequestAction =
  | { action: 'request'; username: string; displayName?: string; role: RequesterRole; query: string }
  | { action: 'list'; username: string }
  | { action: 'wrongsong'; username: string; displayName?: string }
  | { action: 'remove'; username: string; isMod: boolean; target: string }
  | { action: 'skip'; username: string; isMod: boolean }
  | { action: 'clear'; username: string; isMod: boolean }
  | { action: 'toggle'; username: string; isMod: boolean; enabled: boolean };

export type SongRequestResult = { ok: boolean; messages: string[] };

// ── state ────────────────────────────────────────────────────────────────────
const globalStore = globalThis as typeof globalThis & { __elroySongRequests?: SongRequestState };

export function emptySongRequestState(): SongRequestState {
  return { enabled: true, queue: [], pushed: null, playing: null, lastRequestAt: {} };
}

async function loadState(): Promise<SongRequestState> {
  if (hasRedisStorage()) {
    try {
      const raw = await redisCommand(['GET', STATE_KEY]);
      if (typeof raw === 'string' && raw) return { ...emptySongRequestState(), ...JSON.parse(raw) };
    } catch (error) {
      console.error('Song request state read failed', error);
    }
    return emptySongRequestState();
  }
  return globalStore.__elroySongRequests ?? emptySongRequestState();
}

async function saveState(state: SongRequestState) {
  // Keep the cooldown map from growing forever.
  const cutoff = Date.now() - 60 * 60_000;
  state.lastRequestAt = Object.fromEntries(Object.entries(state.lastRequestAt).filter(([, at]) => at > cutoff));
  if (hasRedisStorage()) {
    try {
      await redisCommand(['SET', STATE_KEY, JSON.stringify(state)]);
      return;
    } catch (error) {
      console.error('Song request state write failed', error);
    }
  }
  globalStore.__elroySongRequests = state;
}

// ── pure helpers (unit-tested) ──────────────────────────────────────────────
const TRACK_LINK = /(?:open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/;

export function parseSpotifyTrackRef(query: string): string | null {
  return query.match(TRACK_LINK)?.[1] ?? null;
}

export function resolveRequesterTier(role: RequesterRole, followedAt: string | null, now = Date.now()): RequesterTier {
  if (role === 'mod' || role === 'vip' || role === 'sub') return role;
  if (!followedAt) return 'new';
  const followedMs = Date.parse(followedAt);
  return Number.isFinite(followedMs) && now - followedMs >= REGULAR_FOLLOW_MS ? 'regular' : 'new';
}

function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

export function pendingFor(state: SongRequestState, login: string) {
  return state.queue.filter((req) => req.requestedBy === login).length;
}

export function formatQueueMessage(state: SongRequestState, max = 5): string {
  const lines: string[] = [];
  if (state.pushed) lines.push(`🔒 ${state.pushed.name} — ${state.pushed.artists} (@${state.pushed.requestedByDisplay})`);
  state.queue.slice(0, max).forEach((req, index) => {
    lines.push(`${index + 1}. ${req.name} — ${req.artists} (@${req.requestedByDisplay})`);
  });
  if (!lines.length) return `🎵 Request line is empty${state.enabled ? ' — !sr <song> to add one.' : ' (requests are off).'}`;
  const more = state.queue.length > max ? ` · +${state.queue.length - max} more` : '';
  let message = `🎵 Up next: ${lines.join(' · ')}${more}`;
  if (message.length > 480) message = `${message.slice(0, 477)}…`;
  return message;
}

/**
 * Decide what to do on a now-playing poll. Pure: returns the next state, an optional track to hand
 * to Spotify, and chat lines.
 */
export function planSongRequestTick(
  state: SongRequestState,
  snapshot: Pick<SpotifyNowPlayingSnapshot, 'playing' | 'track'>,
  now = Date.now(),
): { state: SongRequestState; push: SongRequest | null; messages: string[] } {
  const next: SongRequestState = { ...state, queue: [...state.queue] };
  const messages: string[] = [];
  const current = snapshot.track;

  if (next.pushed && current?.id === next.pushed.trackId) {
    const { pushedAt: _pushedAt, ...req } = next.pushed;
    next.playing = req;
    next.pushed = null;
    messages.push(`🎶 Now playing @${req.requestedByDisplay}'s request: ${req.name} — ${req.artists}`);
  } else if (next.playing && current && current.id !== next.playing.trackId) {
    next.playing = null;
  }

  if (next.pushed && now - next.pushed.pushedAt > STALE_PUSH_MS) next.pushed = null;

  let push: SongRequest | null = null;
  if ((next.pushRetryAt ?? 0) > now) return { state: next, push: null, messages };
  if (!next.pushed && next.queue.length && snapshot.playing && current && current.durationMs > 0) {
    const remaining = current.durationMs - (current.progressMs ?? 0);
    if (remaining <= PUSH_WHEN_REMAINING_MS) {
      push = next.queue.shift()!;
      next.pushed = { ...push, pushedAt: now };
    }
  }
  return { state: next, push, messages };
}

// ── Spotify calls ────────────────────────────────────────────────────────────
type SpotifyApiTrack = {
  id?: string;
  uri?: string;
  name?: string;
  duration_ms?: number;
  is_playable?: boolean;
  artists?: Array<{ name?: string }>;
  album?: { release_date?: string };
};

async function findTrack(query: string): Promise<SpotifyApiTrack | null | 'not_connected' | { status: number }> {
  const id = parseSpotifyTrackRef(query);
  const lookup = async (market: boolean) => {
    const suffix = market ? '&market=from_token' : '';
    return id
      ? spotifyUserFetch(`/tracks/${id}${market ? '?market=from_token' : ''}`)
      : spotifyUserFetch(`/search?q=${encodeURIComponent(query)}&type=track&limit=1${suffix}`);
  };
  // Plain lookup first: market=from_token needs the user-read-private scope, and tokens from
  // before that scope was added get "403 Insufficient client scope".
  let res = await lookup(false);
  if (!res) return 'not_connected';
  if (!res.ok && (res.status === 400 || res.status === 403)) res = await lookup(true) ?? res;
  if (!res.ok) {
    console.warn('Spotify track lookup failed', res.status, await res.text().catch(() => ''));
    return { status: res.status };
  }
  const data = await res.json() as SpotifyApiTrack & { tracks?: { items?: SpotifyApiTrack[] } };
  return id ? data : data.tracks?.items?.[0] ?? null;
}

function spotifyErrorLine(status: number) {
  if (status === 404) return 'no active Spotify device — start playing music first.';
  if (status === 403) return 'Spotify blocked it — the account must be added under User Management in the Spotify developer app, have Premium for queueing, and be reconnected in /control.';
  if (status === 401) return 'Spotify link expired — reconnect it in /control.';
  return `Spotify error ${status}.`;
}

// ── actions ──────────────────────────────────────────────────────────────────
export async function handleSongRequestAction(req: SongRequestAction): Promise<SongRequestResult> {
  const login = req.username.trim().toLowerCase();
  const state = await loadState();

  if (req.action === 'list') {
    return { ok: true, messages: [formatQueueMessage(state)] };
  }

  if (req.action === 'toggle') {
    if (!req.isMod) return { ok: false, messages: [] };
    state.enabled = req.enabled;
    await saveState(state);
    return { ok: true, messages: [req.enabled ? '🎵 Song requests are ON — !sr <song or Spotify link>' : '🎵 Song requests are OFF.'] };
  }

  if (req.action === 'clear') {
    if (!req.isMod) return { ok: false, messages: [] };
    const count = state.queue.length;
    state.queue = [];
    await saveState(state);
    return { ok: true, messages: [`🧹 Cleared ${count} request${count === 1 ? '' : 's'}.`] };
  }

  if (req.action === 'skip') {
    if (!req.isMod) return { ok: false, messages: [] };
    const res = await spotifyUserFetch('/me/player/next', { method: 'POST' });
    if (!res) return { ok: false, messages: [`@${req.username} Spotify isn't connected.`] };
    if (!res.ok) return { ok: false, messages: [`@${req.username} skip failed — ${spotifyErrorLine(res.status)}`] };
    return { ok: true, messages: ['⏭️ Skipped.'] };
  }

  if (req.action === 'remove') {
    if (!req.isMod) return { ok: false, messages: [] };
    const target = req.target.trim().replace(/^@/, '').toLowerCase();
    if (!target) return { ok: false, messages: [`@${req.username} use !srremove <number> or !srremove @user`] };
    const position = Number.parseInt(target, 10);
    if (Number.isFinite(position) && String(position) === target) {
      const removed = state.queue.splice(position - 1, 1)[0];
      if (!removed) return { ok: false, messages: [`@${req.username} there's no #${position} in line (see !queue).`] };
      await saveState(state);
      return { ok: true, messages: [`🗑️ Removed ${removed.name} — ${removed.artists} (@${removed.requestedByDisplay}).`] };
    }
    const before = state.queue.length;
    state.queue = state.queue.filter((item) => item.requestedBy !== target);
    const removed = before - state.queue.length;
    const lockedNote = state.pushed?.requestedBy === target ? ' Their next song is already locked in — !skip it when it plays.' : '';
    if (!removed) return { ok: false, messages: [`@${req.username} @${target} has nothing waiting.${lockedNote}`] };
    await saveState(state);
    return { ok: true, messages: [`🗑️ Removed ${removed} request${removed === 1 ? '' : 's'} from @${target}.${lockedNote}`] };
  }

  if (req.action === 'wrongsong') {
    const index = state.queue.map((item) => item.requestedBy).lastIndexOf(login);
    if (index < 0) {
      const locked = state.pushed?.requestedBy === login ? ' Your song is already locked in as next up.' : '';
      return { ok: false, messages: [`@${req.displayName || req.username} you have nothing waiting.${locked}`] };
    }
    const [removed] = state.queue.splice(index, 1);
    await saveState(state);
    return { ok: true, messages: [`↩️ @${removed.requestedByDisplay} removed ${removed.name}.`] };
  }

  // ── request ──
  const display = req.displayName?.trim() || req.username;
  const query = req.query.trim();
  if (!query) return { ok: false, messages: [`@${display} use !sr <song name> or a Spotify track link.`] };
  if (!state.enabled && req.role !== 'mod') return { ok: false, messages: [`@${display} song requests are off right now.`] };
  if (state.queue.length >= MAX_QUEUE && req.role !== 'mod') {
    return { ok: false, messages: [`@${display} the request line is full (${MAX_QUEUE}) — try again in a bit.`] };
  }

  const follow = req.role === 'viewer' ? await getFollowInfo(login).catch(() => null) : null;
  const tier = resolveRequesterTier(req.role, follow?.followed_at ?? null);
  const limits = TIER_LIMITS[tier];

  if (pendingFor(state, login) >= limits.maxPending) {
    return { ok: false, messages: [`@${display} you've got ${limits.maxPending} song${limits.maxPending === 1 ? '' : 's'} waiting already (${limits.label} limit) — let one play first.`] };
  }
  const waitMs = limits.cooldownMs - (Date.now() - (state.lastRequestAt[login] ?? 0));
  if (waitMs > 0) {
    const hint = tier === 'new' ? ' Follow the channel to request more often.' : '';
    return { ok: false, messages: [`@${display} next request in ${formatDuration(waitMs)}.${hint}`] };
  }

  const track = await findTrack(query);
  if (track === 'not_connected') return { ok: false, messages: [`@${display} Spotify isn't connected — the streamer can link it in /control.`] };
  if (track && 'status' in track) return { ok: false, messages: [`@${display} Spotify said no — ${spotifyErrorLine(track.status)}`] };
  if (!track?.id || !track.uri || !track.name) return { ok: false, messages: [`@${display} couldn't find that on Spotify.`] };
  if (track.is_playable === false) return { ok: false, messages: [`@${display} that track isn't playable here.`] };
  if ((track.duration_ms ?? 0) > MAX_DURATION_MS && req.role !== 'mod') {
    return { ok: false, messages: [`@${display} that one's ${formatDuration(track.duration_ms ?? 0)} — max is ${MAX_DURATION_MS / 60_000} minutes.`] };
  }
  if (state.queue.some((item) => item.trackId === track.id) || state.pushed?.trackId === track.id) {
    return { ok: false, messages: [`@${display} ${track.name} is already in line.`] };
  }

  const artists = (track.artists ?? []).map((artist) => artist.name).filter(Boolean).join(', ') || 'Unknown artist';
  state.queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    trackId: track.id,
    uri: track.uri,
    name: track.name,
    artists,
    durationMs: track.duration_ms ?? 0,
    releaseYear: track.album?.release_date?.slice(0, 4) || undefined,
    requestedBy: login,
    requestedByDisplay: display,
    requestedAt: Date.now(),
  });
  state.lastRequestAt[login] = Date.now();
  await saveState(state);
  const position = state.queue.length + (state.pushed ? 1 : 0);
  return { ok: true, messages: [`🎶 @${display} added ${track.name} — ${artists} (#${position} in line).`] };
}

/** Called on every now-playing poll: announce requests as they start, hand the next one to Spotify. */
export async function advanceSongRequests(snapshot?: SpotifyNowPlayingSnapshot): Promise<{
  messages: string[];
  requestedBy: string | null;
  /** Set when a request was just handed to Spotify — Elroy introduces it before it comes on. */
  intro: SongRequest | null;
}> {
  const state = await loadState();
  if (!state.queue.length && !state.pushed && !state.playing) return { messages: [], requestedBy: null, intro: null };
  const now = snapshot ?? await fetchSpotifyNowPlaying();
  const plan = planSongRequestTick(state, now);
  const messages = [...plan.messages];
  let intro: SongRequest | null = null;

  if (plan.push) {
    const res = await spotifyUserFetch(`/me/player/queue?uri=${encodeURIComponent(plan.push.uri)}`, { method: 'POST' });
    if (!res || !res.ok) {
      // Put it back at the front; try again next poll (or tell chat why it can't work).
      plan.state.queue.unshift(plan.push);
      plan.state.pushed = null;
      plan.state.pushRetryAt = Date.now() + 60_000;
      const status = res?.status ?? 0;
      console.warn('Spotify queue handoff failed', status, res ? await res.text().catch(() => '') : 'no token');
      // Say it in chat once per song, not every poll.
      if (status !== 404 && plan.state.lastPushErrorId !== plan.push.id) {
        plan.state.lastPushErrorId = plan.push.id;
        messages.push(`⚠️ Couldn't queue ${plan.push.name}: ${spotifyErrorLine(status)}`);
      }
    } else {
      plan.state.pushRetryAt = undefined;
      intro = plan.push;
    }
  }
  await saveState(plan.state);
  return { messages, requestedBy: plan.state.playing?.requestedByDisplay ?? null, intro };
}
