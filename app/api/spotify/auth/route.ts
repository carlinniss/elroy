import { isControlAuthorized } from '@/lib/control-auth';
import { buildSpotifyAuthorizeUrl, spotifyConfigured } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!spotifyConfigured()) {
    return new Response('Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in Vercel.', { status: 503 });
  }

  const url = new URL(request.url);
  const secretParam = url.searchParams.get('secret')?.trim();
  const authorized = isControlAuthorized(request)
    || (secretParam && secretParam === process.env.ELROY_CONTROL_SECRET?.trim());

  if (!authorized) {
    return new Response('Unauthorized — use your control secret (?secret=...) or Authorization header.', { status: 401 });
  }

  try {
    const authorizeUrl = buildSpotifyAuthorizeUrl();
    return Response.redirect(authorizeUrl, 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Spotify auth failed';
    return new Response(message, { status: 500 });
  }
}
