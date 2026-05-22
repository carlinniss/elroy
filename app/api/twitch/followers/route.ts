const TWITCH_API = 'https://api.twitch.tv/helix';

function normalizeToken(token: string) {
  return token.replace(/^oauth:/i, '');
}

async function twitchGet(path: string, token: string, clientId: string) {
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

export async function GET() {
  try {
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL?.replace(/^#/, '').toLowerCase();
    const token = process.env.TWITCH_OAUTH_TOKEN || process.env.NEXT_PUBLIC_TWITCH_OAUTH_TOKEN;
    const clientId = process.env.TWITCH_CLIENT_ID;

    if (!channel || !token || !clientId) {
      return Response.json(
        { followers: [], error: 'Missing TWITCH_CLIENT_ID, channel, or OAuth token.' },
        { status: 503 },
      );
    }

    const users = await twitchGet(`/users?login=${encodeURIComponent(channel)}`, token, clientId);
    const broadcasterId = users.data?.[0]?.id;
    if (!broadcasterId) {
      return Response.json({ followers: [], error: 'Channel not found.' }, { status: 404 });
    }

    const validate = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${normalizeToken(token)}` },
    });
    if (!validate.ok) {
      return Response.json({ followers: [], error: 'Invalid OAuth token.' }, { status: 401 });
    }
    const { user_id: moderatorId } = await validate.json();

    const followersData = await twitchGet(
      `/channels/followers?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}&first=10`,
      token,
      clientId,
    );

    const followers = (followersData.data ?? []).map((entry: { user_id: string; user_login: string; followed_at: string }) => ({
      user_id: entry.user_id,
      user_login: entry.user_login,
      followed_at: entry.followed_at,
    }));

    return Response.json({ followers });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Follower fetch failed';
    console.error('FOLLOWERS ERROR:', message);
    return Response.json({ followers: [], error: message }, { status: 500 });
  }
}
