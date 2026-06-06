import { isControlAuthorized } from '@/lib/control-auth';
import { fetchSpotifyNowPlaying } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const snapshot = await fetchSpotifyNowPlaying();
    return Response.json(snapshot, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Now playing failed';
    return Response.json({ connected: false, playing: false, track: null, error: message }, { status: 500 });
  }
}
