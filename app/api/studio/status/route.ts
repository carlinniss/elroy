import { getStudioSnapshot } from '@/lib/studio-state';
import { isControlAuthorized } from '@/lib/control-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const snapshot = await getStudioSnapshot();
    return Response.json(snapshot, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Studio status failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
