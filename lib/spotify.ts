import crypto from 'crypto';
import { getControlSecret } from '@/lib/control-auth';
import { hasRedisStorage, redisCommand } from '@/lib/redis-rest';

const TOKEN_KEY = 'elroy:spotify:tokens';
const SPOTIFY_ACCOUNTS = 'https://accounts.spotify.com';
const SPOTIFY_API = 'https://api.spotify.com/v1';

const SCOPES = ['user-read-currently-playing', 'user-read-playback-state'].join(' ');

export type SpotifyTrackSnapshot = {
  id: string;
  name: string;
  artists: string[];
  album: string;
  releaseYear: string | null;
  durationMs: number;
  isPlaying: boolean;
  progressMs: number | null;
  trackUrl: string | null;
};

export type SpotifyConnectionIssue =
  | 'not_configured'
  | 'not_connected'
  | 'auth_expired'
  | 'api_error';

export type SpotifyNowPlayingSnapshot = {
  connected: boolean;
  playing: boolean;
  track: SpotifyTrackSnapshot | null;
  reason?: SpotifyConnectionIssue;
};

type TokenBundle = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type SpotifyArtist = { name?: string };
type SpotifyAlbum = { name?: string; release_date?: string };
type SpotifyTrack = {
  id?: string;
  name?: string;
  duration_ms?: number;
  artists?: SpotifyArtist[];
  album?: SpotifyAlbum;
  external_urls?: { spotify?: string };
};
type SpotifyPlayback = {
  is_playing?: boolean;
  progress_ms?: number;
  item?: SpotifyTrack | null;
};

const globalStore = globalThis as typeof globalThis & {
  __elroySpotifyTokens?: TokenBundle | null;
};

function memoryTokens(): TokenBundle | null {
  return globalStore.__elroySpotifyTokens ?? null;
}

function setMemoryTokens(tokens: TokenBundle | null) {
  globalStore.__elroySpotifyTokens = tokens;
}

export function getSpotifyRedirectUri() {
  const explicit = process.env.SPOTIFY_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}/api/spotify/callback`;
  return 'https://elroy-zeta.vercel.app/api/spotify/callback';
}

export function spotifyConfigured() {
  return Boolean(
    process.env.SPOTIFY_CLIENT_ID?.trim()
    && process.env.SPOTIFY_CLIENT_SECRET?.trim(),
  );
}

export function buildSpotifyOAuthState() {
  const secret = getControlSecret();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update('elroy-spotify-v1').digest('hex');
}

export function verifySpotifyOAuthState(state: string | null) {
  const expected = buildSpotifyOAuthState();
  if (!expected || !state) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function buildSpotifyAuthorizeUrl() {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  if (!clientId) throw new Error('SPOTIFY_CLIENT_ID missing');

  const state = buildSpotifyOAuthState();
  if (!state) throw new Error('ELROY_CONTROL_SECRET required for Spotify OAuth');

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: getSpotifyRedirectUri(),
    scope: SCOPES,
    state,
    show_dialog: 'true',
  });

  return `${SPOTIFY_ACCOUNTS}/authorize?${params.toString()}`;
}

async function readTokens(): Promise<TokenBundle | null> {
  if (hasRedisStorage()) {
    try {
      const raw = await redisCommand(['GET', TOKEN_KEY]);
      if (typeof raw === 'string' && raw) {
        return JSON.parse(raw) as TokenBundle;
      }
    } catch (error) {
      console.error('Redis Spotify token read failed', error);
    }
    return null;
  }
  return memoryTokens();
}

async function writeTokens(tokens: TokenBundle | null) {
  if (hasRedisStorage()) {
    try {
      if (!tokens) {
        await redisCommand(['DEL', TOKEN_KEY]);
        return;
      }
      await redisCommand(['SET', TOKEN_KEY, JSON.stringify(tokens)]);
    } catch (error) {
      console.error('Redis Spotify token write failed', error);
    }
    return;
  }
  setMemoryTokens(tokens);
}

async function exchangeToken(body: URLSearchParams) {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error('Spotify client credentials missing');
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = await res.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Spotify token ${res.status}`);
  }

  return data;
}

export async function exchangeSpotifyAuthCode(code: string) {
  const data = await exchangeToken(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getSpotifyRedirectUri(),
  }));

  const expiresIn = data.expires_in ?? 3600;
  const bundle: TokenBundle = {
    accessToken: data.access_token!,
    refreshToken: data.refresh_token || '',
    expiresAt: Date.now() + expiresIn * 1000 - 60_000,
  };

  if (!bundle.refreshToken) {
    const existing = await readTokens();
    if (existing?.refreshToken) bundle.refreshToken = existing.refreshToken;
  }

  await writeTokens(bundle);
  return bundle;
}

async function refreshSpotifyAccessToken(refreshToken: string) {
  const data = await exchangeToken(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }));

  const expiresIn = data.expires_in ?? 3600;
  const bundle: TokenBundle = {
    accessToken: data.access_token!,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + expiresIn * 1000 - 60_000,
  };

  await writeTokens(bundle);
  return bundle.accessToken;
}

async function getAccessToken(): Promise<string | null> {
  const tokens = await readTokens();
  if (!tokens?.refreshToken) return null;

  if (tokens.expiresAt > Date.now() && tokens.accessToken) {
    return tokens.accessToken;
  }

  try {
    return await refreshSpotifyAccessToken(tokens.refreshToken);
  } catch (error) {
    console.error('Spotify token refresh failed', error);
    return null;
  }
}

function parseTrack(item: SpotifyTrack, playback: SpotifyPlayback): SpotifyTrackSnapshot | null {
  if (!item.id || !item.name) return null;

  const releaseDate = item.album?.release_date?.trim() || '';
  const releaseYear = releaseDate.length >= 4 ? releaseDate.slice(0, 4) : null;

  return {
    id: item.id,
    name: item.name,
    artists: (item.artists ?? []).map((artist) => artist.name).filter(Boolean) as string[],
    album: item.album?.name?.trim() || 'Unknown album',
    releaseYear,
    durationMs: item.duration_ms ?? 0,
    isPlaying: playback.is_playing !== false,
    progressMs: typeof playback.progress_ms === 'number' ? playback.progress_ms : null,
    trackUrl: item.external_urls?.spotify ?? null,
  };
}

export async function getSpotifyConnectionStatus() {
  if (!spotifyConfigured()) {
    return { configured: false, connected: false as const };
  }

  const tokens = await readTokens();
  return {
    configured: true,
    connected: Boolean(tokens?.refreshToken),
    expiresAt: tokens?.expiresAt ?? null,
  };
}

export async function disconnectSpotify() {
  await writeTokens(null);
}

export async function fetchSpotifyNowPlaying(): Promise<SpotifyNowPlayingSnapshot> {
  if (!spotifyConfigured()) {
    return { connected: false, playing: false, track: null, reason: 'not_configured' };
  }

  const tokens = await readTokens();
  if (!tokens?.refreshToken) {
    return { connected: false, playing: false, track: null, reason: 'not_connected' };
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    await writeTokens(null);
    return { connected: false, playing: false, track: null, reason: 'auth_expired' };
  }

  const res = await fetch(`${SPOTIFY_API}/me/player/currently-playing`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

  if (res.status === 204) {
    return { connected: true, playing: false, track: null };
  }

  if (res.status === 401) {
    await writeTokens(null);
    return { connected: false, playing: false, track: null, reason: 'auth_expired' };
  }

  if (!res.ok) {
    console.warn('Spotify now playing failed', res.status);
    return { connected: true, playing: false, track: null, reason: 'api_error' };
  }

  const playback = await res.json() as SpotifyPlayback;
  const track = playback.item ? parseTrack(playback.item, playback) : null;
  if (!track) {
    return { connected: true, playing: false, track: null };
  }

  return {
    connected: true,
    playing: track.isPlaying,
    track,
  };
}
