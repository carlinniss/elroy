import { isControlAuthorized } from '@/lib/control-auth';
import { ensureShutElroyRedemptionSubscription } from '@/lib/eventsub';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await ensureShutElroyRedemptionSubscription();
  const status = result.ok ? 200 : result.status === 'error' && result.message?.includes('TWITCH_EVENTSUB_SECRET') ? 503 : 500;
  return Response.json(result, { status });
}
