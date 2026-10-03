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
const SKIP_DEBOUNCE_MS = 8_000;
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
  /** Already brought back once after an accidental skip. */
  recovered?: boolean;
};

export type SongRequestState = {
  enabled: boolean;
  queue: SongRequest[];
  /** Handed to Spotify's queue; can no longer be removed, only skipped once it plays. */
  pushed: (SongRequest & { pushedAt: number; /** Track that was playing when we handed it off. */ fromTrackId?: string; /** When that track was due to end. */ fromEndsAt?: number }) | null;
  playing: SongRequest | null;
  lastRequestAt: Record<string, number>;
  /** Last request whose handoff failed and was already reported — never re-announce it. */
  lastPushErrorId?: string;
  /** Don't retry a failed handoff before this time. */
  pushRetryAt?: number;
  /** Last !skip — a second !skip within a few seconds is ignored (two mods skipping the same song). */
  lastSkipAt?: number;
  /**
   * Chat lines + intro produced by a server-side tick, waiting for the overlay to post/speak them.
   * The listener container ticks every few seconds; the overlay collects these on its next poll.
   */
  outbox?: { messages: string[]; intro: SongRequest | null };
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
  const status = state.enabled ? 'Requests ON' : 'Requests OFF';
  if (!lines.length) return `🎵 ${status} · line is empty${state.enabled ? ' — !sr <song> to add one.' : '.'}`;
  const more = state.queue.length > max ? ` · +${state.queue.length - max} more` : '';
  let message = `🎵 ${status} · Up next: ${lines.join(' · ')}${more}`;
  if (message.length > 480) message = `${message.slice(0, 477)}…`;
  return message;
}

/**
 * Decide what to do on a now-playing poll. Pure: returns the next state, an optional track to hand
 * to Spotify, and chat lines.
 */
function looseTrackKey(name: string, artist: string) {
  const clean = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s-\s.*$/, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  return `${clean(name)}|${clean(artist)}`;
}

/** Same song? Spotify can play a relinked copy with a different id, so fall back to title + lead artist. */
export function isSameTrack(req: Pick<SongRequest, 'trackId' | 'name' | 'artists'>, current: { id: string; name: string; artists: string[] } | null | undefined) {
  if (!current) return false;
  if (current.id === req.trackId) return true;
  const reqArtist = req.artists.split(',')[0] ?? '';
  return looseTrackKey(req.name, reqArtist) === looseTrackKey(current.name, current.artists[0] ?? '');
}

export function planSongRequestTick(
  state: SongRequestState,
  snapshot: Pick<SpotifyNowPlayingSnapshot, 'playing' | 'track'>,
  now = Date.now(),
): { state: SongRequestState; push: SongRequest | null; messages: string[]; verifyPushed: boolean } {
  const next: SongRequestState = { ...state, queue: [...state.queue] };
  const messages: string[] = [];
  const current = snapshot.track;

  if (next.pushed && isSameTrack(next.pushed, current)) {
    const { pushedAt: _pushedAt, fromTrackId: _from, fromEndsAt: _ends, ...req } = next.pushed;
    next.playing = req;
    next.pushed = null;
    messages.push(`🎶 Now playing @${req.requestedByDisplay}'s request: ${req.name} — ${req.artists}`);
  } else if (next.playing && current && !isSameTrack(next.playing, current)) {
    next.playing = null;
  }

  if (next.pushed && now - next.pushed.pushedAt > STALE_PUSH_MS) next.pushed = null;
  // The song moved on but we never saw the request play (double skip, or it was skipped between
  // polls). Ask Spotify's queue whether it's still coming instead of stalling the line.
  const verifyPushed = Boolean(
    next.pushed && current && next.pushed.fromTrackId
    && current.id !== next.pushed.fromTrackId && !isSameTrack(next.pushed, current),
  );

  let push: SongRequest | null = null;
  if ((next.pushRetryAt ?? 0) > now) return { state: next, push: null, messages, verifyPushed };
  if (!next.pushed && next.queue.length && snapshot.playing && current && current.durationMs > 0) {
    const remaining = current.durationMs - (current.progressMs ?? 0);
    if (remaining <= PUSH_WHEN_REMAINING_MS) {
      push = next.queue.shift()!;
      next.pushed = { ...push, pushedAt: now, fromTrackId: current.id, fromEndsAt: now + remaining };
    }
  }
  return { state: next, push, messages, verifyPushed };
}

// ── Spotify calls ────────────────────────────────────────────────────────────
type SpotifyApiTrack = {
  id?: string;
  uri?: string;
  name?: string;
  duration_ms?: number;
  is_playable?: boolean;
  explicit?: boolean;
  artists?: Array<{ name?: string }>;
  album?: { release_date?: string };
};

// ── matching ─────────────────────────────────────────────────────────────────
function normalizeForMatch(text: string) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s-\s.*$/, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "blind by korn", "korn - blind", "blind - korn" → title/artist hints. */
export function parseRequestQuery(query: string): { title: string; artist?: string } {
  const trimmed = query.trim().replace(/^["']|["']$/g, '');
  const by = trimmed.match(/^(.+?)\s+by\s+(.+)$/i);
  if (by) return { title: by[1]!.trim(), artist: by[2]!.trim() };
  const dash = trimmed.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) return { title: dash[2]!.trim(), artist: dash[1]!.trim() };
  return { title: trimmed };
}

const JUNK_VERSION = /\b(karaoke|instrumental|tribute|cover|8[- ]?bit|lullaby|made famous|originally performed|in the style of|backing track|piano version|music box)\b/i;
const ALT_VERSION = /\b(remix|live|acoustic|sped up|slowed|reverb|nightcore|demo|edit|version|remaster(ed)?|mix)\b/i;

type MatchCandidate = { name?: string; artists?: Array<{ name?: string }>; explicit?: boolean };

/** Score a search result against what the viewer typed. Higher is better. */
export function scoreTrackMatch(query: string, track: MatchCandidate, rank: number): number {
  const q = normalizeForMatch(query);
  const qWords = q.split(' ').filter(Boolean);
  const title = normalizeForMatch(track.name ?? '');
  const artists = (track.artists ?? []).map((a) => normalizeForMatch(a.name ?? '')).join(' ');
  // Coverage uses the full title (with "- Live", "(Remix)" etc.) so asked-for versions count.
  const fullTitle = (track.name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const haystack = `${fullTitle} ${artists}`;
  const { title: wantTitle, artist: wantArtist } = parseRequestQuery(query);
  const wantTitleN = normalizeForMatch(wantTitle);

  let score = 0;
  // Every word they typed should be in the title or artist.
  const covered = qWords.filter((w) => haystack.split(' ').includes(w)).length;
  score += qWords.length ? (covered / qWords.length) * 60 : 0;
  // Exact title match beats "title appears somewhere".
  if (title === wantTitleN) score += 35;
  else if (wantArtist && title.includes(wantTitleN)) score += 15;
  else if (!wantArtist && q.includes(title) && title.length >= 3) score += 25;
  if (wantArtist && artists.includes(normalizeForMatch(wantArtist))) score += 30;
  // Prefer the real recording over karaoke/tribute versions, and originals over remixes —
  // unless that's what they asked for.
  if (JUNK_VERSION.test(track.name ?? '') && !JUNK_VERSION.test(query)) score -= 60;
  if (ALT_VERSION.test(track.name ?? '') && !ALT_VERSION.test(query)) score -= 12;
  if (track.explicit) score += 2; // originals are usually the explicit cut
  score -= rank * 1.5; // Spotify's own ranking breaks ties
  return score;
}

export function pickBestTrack<T extends MatchCandidate>(query: string, tracks: T[]): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  tracks.forEach((track, rank) => {
    const score = scoreTrackMatch(query, track, rank);
    if (score > bestScore) { best = track; bestScore = score; }
  });
  return best;
}

async function searchTracks(q: string, market: boolean) {
  return spotifyUserFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=10${market ? '&market=from_token' : ''}`);
}

async function findTrack(query: string): Promise<SpotifyApiTrack | null | 'not_connected' | { status: number }> {
  const id = parseSpotifyTrackRef(query);
  if (id) {
    let res = await spotifyUserFetch(`/tracks/${id}`);
    if (!res) return 'not_connected';
    if (!res.ok && (res.status === 400 || res.status === 403)) res = await spotifyUserFetch(`/tracks/${id}?market=from_token`) ?? res;
    if (!res.ok) {
      console.warn('Spotify track lookup failed', res.status, await res.text().catch(() => ''));
      return { status: res.status };
    }
    return await res.json() as SpotifyApiTrack;
  }

  // "title by artist" gets a precise field search first; plain text as the fallback.
  const { title, artist } = parseRequestQuery(query);
  const searches = artist ? [`track:${title} artist:${artist}`, query] : [query];
  const found: SpotifyApiTrack[] = [];
  for (const q of searches) {
    let res = await searchTracks(q, false);
    if (!res) return 'not_connected';
    if (!res.ok && (res.status === 400 || res.status === 403)) res = await searchTracks(q, true) ?? res;
    if (!res.ok) {
      console.warn('Spotify track lookup failed', res.status, await res.text().catch(() => ''));
      if (found.length) break;
      return { status: res.status };
    }
    const data = await res.json() as { tracks?: { items?: SpotifyApiTrack[] } };
    found.push(...(data.tracks?.items ?? []));
    if (found.length >= 5) break;
  }
  const unique = found.filter((t, i) => t.id && found.findIndex((o) => o.id === t.id) === i);
  return pickBestTrack(query, unique);
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
    if (Date.now() - (state.lastSkipAt ?? 0) < SKIP_DEBOUNCE_MS) {
      return { ok: false, messages: [`@${req.username} already skipped — give it a sec.`] };
    }
    state.lastSkipAt = Date.now();
    await saveState(state);
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
  if (!query) {
    return { ok: false, messages: [state.enabled
      ? `🎵 Song requests are ON — @${display} use !sr <song name> or a Spotify track link.`
      : `🎵 Song requests are OFF right now (${state.queue.length} still in line).`] };
  }
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
  return { ok: true, messages: [`🎶 @${display} added ${track.name} — ${artists} (#${position} in line). Wrong one? !wrongsong, then try "song by artist" or a Spotify link.`] };
}

/** Called on every now-playing poll: announce requests as they start, hand the next one to Spotify. */
/** For the now-playing card's "requests on/off" tag. */
export async function songRequestsEnabled(): Promise<boolean> {
  return (await loadState()).enabled;
}

export async function advanceSongRequests(
  snapshot?: SpotifyNowPlayingSnapshot,
  opts: { deliver?: boolean } = { deliver: true },
): Promise<{
  messages: string[];
  requestedBy: string | null;
  /** Set when a request was just handed to Spotify — Elroy introduces it before it comes on. */
  intro: SongRequest | null;
}> {
  const state = await loadState();
  const pendingOutbox = state.outbox;
  if (!state.queue.length && !state.pushed && !state.playing) {
    if (opts.deliver && pendingOutbox && (pendingOutbox.messages.length || pendingOutbox.intro)) {
      state.outbox = undefined;
      await saveState(state);
      return { messages: pendingOutbox.messages, requestedBy: null, intro: pendingOutbox.intro };
    }
    return { messages: [], requestedBy: null, intro: null };
  }
  const now = snapshot ?? await fetchSpotifyNowPlaying();
  if (!now.connected) return { messages: [], requestedBy: null, intro: null };
  const plan = planSongRequestTick(state, now);
  const messages = [...(pendingOutbox?.messages ?? []), ...plan.messages];
  let intro: SongRequest | null = pendingOutbox?.intro ?? null;

  if (plan.verifyPushed && plan.state.pushed) {
    const lost = plan.state.pushed;
    const res = await spotifyUserFetch('/me/player/queue');
    if (res?.ok) {
      const data = await res.json().catch(() => ({})) as { queue?: Array<{ id?: string; name?: string; artists?: Array<{ name?: string }> }> };
      const stillQueued = (data.queue ?? []).some((item) => isSameTrack(lost, {
        id: item.id ?? '',
        name: item.name ?? '',
        artists: (item.artists ?? []).map((a) => a.name ?? ''),
      }));
      if (stillQueued) {
        // Someone played something else first — it's still coming. Check again after this song.
        plan.state.pushed = { ...lost, fromTrackId: now.track?.id };
      } else if (!lost.recovered && !(lost.fromEndsAt && (plan.state.lastSkipAt ?? 0) > lost.fromEndsAt - 2_000)) {
        // (A mod's !skip that landed after the previous song had already ended was aimed at the
        // request itself — that one stays skipped.)
        // Spotify jumped past it (double skip, or skipped before we saw it). Put it back on now:
        // queue it and skip to it, so the background playlist/album carries on afterwards.
        const queued = await spotifyUserFetch(`/me/player/queue?uri=${encodeURIComponent(lost.uri)}`, { method: 'POST' });
        const jumped = queued?.ok ? await spotifyUserFetch('/me/player/next', { method: 'POST' }) : null;
        if (jumped?.ok) {
          plan.state.pushed = { ...lost, recovered: true, pushedAt: Date.now(), fromTrackId: undefined };
          messages.push(`↩️ @${lost.requestedByDisplay}'s request got skipped by accident — running it back: ${lost.name}`);
        } else {
          plan.state.pushed = null;
          messages.push(`⏭️ Couldn't bring back @${lost.requestedByDisplay}'s request (${lost.name}) — moving on.`);
        }
      } else {
        plan.state.pushed = null;
        messages.push(`⏭️ @${lost.requestedByDisplay}'s request (${lost.name}) got skipped — moving on to the next one.`);
      }
    }
  }

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
  const requestedBy = plan.state.playing?.requestedByDisplay ?? null;
  if (opts.deliver) {
    plan.state.outbox = undefined;
    await saveState(plan.state);
    return { messages, requestedBy, intro };
  }
  // Server-side tick: nobody to post to — park everything for the overlay's next poll.
  plan.state.outbox = { messages, intro };
  await saveState(plan.state);
  return { messages: [], requestedBy, intro: null };
}
