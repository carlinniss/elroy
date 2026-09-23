import { isControlAuthorized } from '@/lib/control-auth';
import { resolveElroyRewards } from '@/lib/channel-rewards';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json(await resolveElroyRewards());
}
