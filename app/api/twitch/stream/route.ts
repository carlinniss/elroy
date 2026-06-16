import {
  fetchStreamViaDecapi,
  fetchStreamViaHelix,
  getBroadcasterLogin,
} from '@/lib/twitch';

export const dynamic = 'force-dynamic';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
};

export async function GET() {
  const broadcasterLogin = getBroadcasterLogin();
  if (!broadcasterLogin) {
    return Response.json({
      status: 'unknown',
      is_live: false,
      viewer_count: null,
      error: 'Set NEXT_PUBLIC_TWITCH_CHANNEL or TWITCH_BROADCASTER_LOGIN to your stream username.',
    }, { status: 503, headers: NO_CACHE_HEADERS });
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
        game_name: result.game_name ?? '',
        game_id: result.game_id ?? '',
        started_at: result.started_at ?? '',
      }, { headers: NO_CACHE_HEADERS });
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
    }, { headers: NO_CACHE_HEADERS });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Stream fetch failed';
    console.error('STREAM ERROR:', message);
    return Response.json({
      status: 'unknown',
      is_live: false,
      viewer_count: null,
      error: message,
      broadcaster_login: broadcasterLogin,
    }, { status: 500, headers: NO_CACHE_HEADERS });
  }
}
