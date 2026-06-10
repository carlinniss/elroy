import { isControlAuthorized } from '@/lib/control-auth';
import { getChannelMetadata } from '@/lib/twitch-mod';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const metadata = await getChannelMetadata();
    if (!metadata) {
      return Response.json({ error: 'Channel metadata unavailable.' }, { status: 503 });
    }
    return Response.json(metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Channel metadata failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
