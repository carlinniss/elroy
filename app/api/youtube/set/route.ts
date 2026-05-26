import { isControlAuthorized } from '@/lib/control-auth';
import { parseYouTubeVideoId, youtubeConfigured } from '@/lib/youtube';
import { setCurrentYouTubeVideo } from '@/lib/youtube-store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!youtubeConfigured()) {
    return Response.json({ error: 'YOUTUBE_API_KEY not configured' }, { status: 503 });
  }

  try {
    const body = await request.json() as { url?: string; videoId?: string };
    const raw = body.videoId?.trim() || body.url?.trim() || '';
    const videoId = parseYouTubeVideoId(raw);
    if (!videoId) {
      return Response.json({ error: 'Invalid YouTube URL or video ID' }, { status: 400 });
    }

    const video = await setCurrentYouTubeVideo(videoId);
    return Response.json({ ok: true, video });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Set failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
