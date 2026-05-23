import { getPowerUpRedemptionsSince } from '@/lib/powerup-redemptions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const sinceParam = new URL(request.url).searchParams.get('since');
  const parsed = sinceParam ? Number(sinceParam) : Date.now() - 60_000;
  const since = Number.isFinite(parsed) ? parsed : Date.now() - 60_000;
  return Response.json({
    redemptions: getPowerUpRedemptionsSince(since),
    serverTime: Date.now(),
  });
}
