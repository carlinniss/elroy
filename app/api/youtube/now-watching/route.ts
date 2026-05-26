import { youtubeConfigured } from '@/lib/youtube';
import { getCurrentYouTubeVideo } from '@/lib/youtube-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!youtubeConfigured()) {
      return Response.json({ configured: false, watching: false, video: null });
    }

    const video = await getCurrentYouTubeVideo();
    return Response.json({
      configured: true,
      watching: Boolean(video),
      video,
    }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Now watching failed';
    return Response.json({ configured: true, watching: false, video: null, error: message }, { status: 500 });
  }
}
