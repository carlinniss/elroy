import {
  fetchStreamViaDecapi,
  fetchStreamViaHelix,
  getBroadcasterLogin,
} from '@/lib/twitch';

export async function GET() {
  const broadcasterLogin = getBroadcasterLogin();
  if (!broadcasterLogin) {
    return Response.json({
      status: 'unknown',
      is_live: false,
      viewer_count: null,
      error: 'Set NEXT_PUBLIC_TWITCH_CHANNEL or TWITCH_BROADCASTER_LOGIN to your stream username.',
    }, { status: 503 });
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  try {
    if (clientId && clientSecret) {
      const result = await fetchStreamViaHelix(broadcasterLogin, clientId, clientSecret);
      return Response.json({
        ...result,
        is_live: result.status === 'live',
        broadcaster_login: broadcasterLogin,
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Helix stream fetch failed';
    console.warn('Helix stream lookup failed, trying public fallback:', message);
  }

  try {
    const result = await fetchStreamViaDecapi(broadcasterLogin);
    return Response.json({
      ...result,
      is_live: result.status === 'live',
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
      broadcaster_login: broadcasterLogin,
    }, { status: 500 });
  }
}
