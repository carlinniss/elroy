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
