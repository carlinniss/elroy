import { isControlAuthorized } from '@/lib/control-auth';
import { ensureChannelLifecycleSubscriptions, ensureShutElroyRedemptionSubscription } from '@/lib/eventsub';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [powerUp, lifecycle] = await Promise.all([
    ensureShutElroyRedemptionSubscription(),
    ensureChannelLifecycleSubscriptions(),
  ]);

  const ok = powerUp.ok || lifecycle.ok;
  const status = ok ? 200 : 503;

  return Response.json({
    ok,
    power_up: powerUp,
    lifecycle,
  }, { status });
}
