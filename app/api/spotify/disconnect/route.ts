import { isControlAuthorized } from '@/lib/control-auth';
import { disconnectSpotify } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await disconnectSpotify();
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Disconnect failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
