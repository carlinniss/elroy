import { isControlAuthorized } from '@/lib/control-auth';
import { getPowerUpRedemptionsSince, getRedemptionStorageMode } from '@/lib/powerup-redemptions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sinceParam = new URL(request.url).searchParams.get('since');
  const parsed = sinceParam ? Number(sinceParam) : Date.now() - 60_000;
  const since = Number.isFinite(parsed) ? parsed : Date.now() - 60_000;
  const storage = getRedemptionStorageMode();

  return Response.json({
    redemptions: await getPowerUpRedemptionsSince(since),
    serverTime: Date.now(),
    storage,
    warning: storage === 'memory'
      ? 'Redemptions use in-memory storage — add Vercel KV / Upstash Redis on Vercel or redemptions may be missed.'
      : undefined,
  });
}
