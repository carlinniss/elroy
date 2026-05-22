import { getBroadcasterId, getTwitchCredentials, normalizeToken, twitchGet } from '@/lib/twitch';

export async function GET() {
  try {
    const creds = getTwitchCredentials();
    if (!creds) {
      return Response.json(
        { followers: [], error: 'Missing TWITCH_CLIENT_ID, channel, or OAuth token.' },
        { status: 503 },
      );
    }

    const { channel, token, clientId } = creds;
    const broadcasterId = await getBroadcasterId(channel, token, clientId);
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
