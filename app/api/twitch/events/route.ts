import { isControlAuthorized } from '@/lib/control-auth';
import { getChannelEventsSince } from '@/lib/channel-events';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sinceParam = new URL(request.url).searchParams.get('since');
  const sinceMs = sinceParam ? Number.parseInt(sinceParam, 10) : Date.now() - 120_000;
  const events = await getChannelEventsSince(Number.isFinite(sinceMs) ? sinceMs : Date.now() - 120_000);
  return Response.json({ events, serverTime: Date.now() });
}
