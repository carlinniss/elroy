import { isControlAuthorized } from '@/lib/control-auth';
import { createLiveClip } from '@/lib/twitch-mod';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clip = await createLiveClip();
    return Response.json({ ok: true, ...clip });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Clip failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
