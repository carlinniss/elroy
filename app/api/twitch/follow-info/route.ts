import { isControlAuthorized } from '@/lib/control-auth';
import { getFollowInfo } from '@/lib/twitch-mod';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const username = new URL(request.url).searchParams.get('username')?.trim();
  if (!username) {
    return Response.json({ error: 'username required' }, { status: 400 });
  }

  try {
    const follow = await getFollowInfo(username);
    if (!follow) {
      return Response.json({ following: false });
    }
    return Response.json({ following: true, ...follow });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Follow lookup failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
