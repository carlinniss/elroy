import { fetchSpotifyNowPlaying, getSpotifyConnectionStatus } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await getSpotifyConnectionStatus();
    if (!status.connected) {
      return Response.json({ ...status, playing: false, track: null });
    }

    const nowPlaying = await fetchSpotifyNowPlaying();
    return Response.json({
      ...status,
      playing: nowPlaying.playing,
      track: nowPlaying.track,
    }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Status failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
