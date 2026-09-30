import { isControlAuthorized } from '@/lib/control-auth';
import { fetchSpotifyNowPlaying } from '@/lib/spotify';
import { advanceSongRequests } from '@/lib/song-requests';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const snapshot = await fetchSpotifyNowPlaying();
    // The overlay polls this every ~10s while live — that's the song-request clock too.
    const requests = snapshot.connected
      ? await advanceSongRequests(snapshot).catch((error) => {
        console.warn('Song request tick failed', error);
        return { messages: [], requestedBy: null, intro: null };
      })
      : { messages: [], requestedBy: null, intro: null };
    return Response.json({ ...snapshot, requestMessages: requests.messages, requestedBy: requests.requestedBy, requestIntro: requests.intro }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Now playing failed';
    return Response.json({ connected: false, playing: false, track: null, error: message }, { status: 500 });
  }
}
