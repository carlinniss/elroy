import { isControlAuthorized } from '@/lib/control-auth';
import { clearCurrentYouTubeVideo } from '@/lib/youtube-store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await clearCurrentYouTubeVideo();
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Clear failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
