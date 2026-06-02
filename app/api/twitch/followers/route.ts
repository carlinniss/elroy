import { getBroadcasterId, getBroadcasterLogin, getBroadcasterTwitchCredentials, getUserTwitchCredentials, twitchGet } from '@/lib/twitch';

export async function GET() {
  try {
    const creds = await getBroadcasterTwitchCredentials() ?? await getUserTwitchCredentials();
    const broadcasterLogin = getBroadcasterLogin();
    if (!creds || !broadcasterLogin) {
      return Response.json(
        {
          followers: [],
          error: 'Set TWITCH_OAUTH_TOKEN with broadcaster/mod credentials.',
        },
        { status: 503 },
      );
    }

    if (!creds.scopes.includes('moderator:read:followers')) {
      return Response.json({
        followers: [],
        error: 'Token is missing moderator:read:followers scope.',
        token_login: creds.login,
        token_source: creds.tokenSource,
        scopes: creds.scopes,
        hint: 'Regenerate TWITCH_OAUTH_TOKEN with moderator:read:followers.',
      }, { status: 403 });
    }

    const { token, clientId, userId: moderatorId } = creds;
    const broadcasterId = await getBroadcasterId(broadcasterLogin, token, clientId);
    if (!broadcasterId) {
      return Response.json({ followers: [], error: 'Channel not found.' }, { status: 404 });
    }

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

    return Response.json({ followers, token_client_id: clientId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Follower fetch failed';
    console.error('FOLLOWERS ERROR:', message);
    return Response.json({ followers: [], error: message }, { status: 500 });
  }
}
