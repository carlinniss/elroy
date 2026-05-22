const TWITCH_API = 'https://api.twitch.tv/helix';

export function normalizeToken(token: string) {
  return token.replace(/^oauth:/i, '');
}

export function getTwitchCredentials() {
  const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL?.replace(/^#/, '').toLowerCase();
  const token = process.env.TWITCH_OAUTH_TOKEN || process.env.NEXT_PUBLIC_TWITCH_OAUTH_TOKEN;
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!channel || !token || !clientId) return null;
  return { channel, token, clientId };
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
