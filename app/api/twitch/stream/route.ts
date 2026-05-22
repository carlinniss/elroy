import {
  getAppAccessToken,
  getBroadcasterId,
  getBroadcasterLogin,
  getTwitchCredentials,
  normalizeToken,
  twitchGet,
} from '@/lib/twitch';

export async function GET() {
  try {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const broadcasterLogin = getBroadcasterLogin();
    if (!clientId || !broadcasterLogin) {
      return Response.json({
        status: 'unknown',
        is_live: false,
        viewer_count: null,
        error: 'Missing TWITCH_CLIENT_ID or broadcaster channel login.',
      }, { status: 503 });
    }

    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    let token: string | null = null;

    if (clientSecret) {
      token = await getAppAccessToken(clientId, clientSecret);
    } else {
      const creds = getTwitchCredentials();
      if (creds?.token) token = normalizeToken(creds.token);
    }

    if (!token) {
      return Response.json({
        status: 'unknown',
        is_live: false,
        viewer_count: null,
        error: 'Missing TWITCH_CLIENT_SECRET or OAuth token for stream lookup.',
      }, { status: 503 });
    }

    const broadcasterId = await getBroadcasterId(broadcasterLogin, token, clientId);
    if (!broadcasterId) {
      return Response.json({
        status: 'unknown',
        is_live: false,
        viewer_count: null,
        error: `Broadcaster not found for login: ${broadcasterLogin}`,
      }, { status: 404 });
    }

    const streams = await twitchGet(`/streams?user_id=${broadcasterId}`, token, clientId);
    const stream = streams.data?.[0];
    if (!stream) {
      return Response.json({ status: 'offline', is_live: false, viewer_count: 0 });
    }

    return Response.json({
      status: 'live',
      is_live: true,
      viewer_count: stream.viewer_count ?? 0,
      title: stream.title ?? '',
      broadcaster_login: broadcasterLogin,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Stream fetch failed';
    console.error('STREAM ERROR:', message);
    return Response.json({
      status: 'unknown',
      is_live: false,
      viewer_count: null,
      error: message,
    }, { status: 500 });
  }
}
