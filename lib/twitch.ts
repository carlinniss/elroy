const TWITCH_API = 'https://api.twitch.tv/helix';

let appTokenCache: { token: string; expiresAt: number } | null = null;

export function normalizeToken(token: string) {
  return token.replace(/^oauth:/i, '');
}

/** Stream/broadcaster lookups — use streamer's login, not the bot account. */
export function getBroadcasterLogin() {
  const login = process.env.TWITCH_BROADCASTER_LOGIN || process.env.NEXT_PUBLIC_TWITCH_CHANNEL;
  return login?.replace(/^#/, '').toLowerCase();
}

export function getTwitchCredentials() {
  const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL?.replace(/^#/, '').toLowerCase();
  const token = process.env.TWITCH_OAUTH_TOKEN || process.env.NEXT_PUBLIC_TWITCH_OAUTH_TOKEN;
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!channel || !token || !clientId) return null;
  return { channel, token, clientId };
}

export async function getAppAccessToken(clientId: string, clientSecret: string) {
  if (appTokenCache && Date.now() < appTokenCache.expiresAt - 60_000) {
    return appTokenCache.token;
  }
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`App token ${res.status}: ${body}`);
  }
  const data = await res.json();
  appTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return appTokenCache.token;
}

export async function twitchGet(path: string, token: string, clientId: string) {
  const res = await fetch(`${TWITCH_API}${path}`, {
    headers: {
      Authorization: `Bearer ${normalizeToken(token)}`,
      'Client-Id': clientId,
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twitch API ${res.status}: ${body}`);
  }
  return res.json();
}

export async function getBroadcasterId(channel: string, token: string, clientId: string) {
  const users = await twitchGet(`/users?login=${encodeURIComponent(channel)}`, token, clientId);
  return users.data?.[0]?.id as string | undefined;
}

export type StreamStatusResult = {
  status: 'live' | 'offline';
  viewer_count: number | null;
  source: 'twitch' | 'decapi';
  title?: string;
};

/** Helix live check — only needs Client ID + Secret (no user OAuth). */
export async function fetchStreamViaHelix(
  login: string,
  clientId: string,
  clientSecret: string,
): Promise<StreamStatusResult> {
  const token = await getAppAccessToken(clientId, clientSecret);
  const broadcasterId = await getBroadcasterId(login, token, clientId);
  if (!broadcasterId) {
    throw new Error(`Broadcaster not found: ${login}`);
  }
  const streams = await twitchGet(`/streams?user_id=${broadcasterId}`, token, clientId);
  const stream = streams.data?.[0];
  if (!stream) {
    return { status: 'offline', viewer_count: 0, source: 'twitch' };
  }
  return {
    status: 'live',
    viewer_count: stream.viewer_count ?? 0,
    source: 'twitch',
    title: stream.title ?? '',
  };
}

/** Public fallback — no Client ID or OAuth (third-party DecAPI). */
export async function fetchStreamViaDecapi(login: string): Promise<StreamStatusResult> {
  const [uptimeRes, viewersRes] = await Promise.all([
    fetch(`https://decapi.me/twitch/uptime/${encodeURIComponent(login)}`, { cache: 'no-store' }),
    fetch(`https://decapi.me/twitch/viewercount/${encodeURIComponent(login)}`, { cache: 'no-store' }),
  ]);
  const uptime = (await uptimeRes.text()).trim().toLowerCase();
  const viewersRaw = (await viewersRes.text()).trim();

  const isLive =
    uptime.includes('is live') &&
    !uptime.includes('is offline') &&
    !uptime.includes('not found');

  let viewer_count: number | null = null;
  const parsed = Number.parseInt(viewersRaw, 10);
  if (Number.isFinite(parsed) && parsed >= 0) viewer_count = parsed;

  return {
    status: isLive ? 'live' : 'offline',
    viewer_count: isLive ? viewer_count : 0,
    source: 'decapi',
  };
}
