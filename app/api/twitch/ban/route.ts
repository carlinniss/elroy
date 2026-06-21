import { isControlAuthorized } from '@/lib/control-auth';
import { banUserFromChannel } from '@/lib/twitch-mod';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as { login?: string; userId?: string; reason?: string };
    const login = body.login?.trim().replace(/^@/, '').toLowerCase();
    if (!login) {
      return Response.json({ error: 'login required' }, { status: 400 });
    }

    const result = await banUserFromChannel(login, {
      userId: body.userId?.trim(),
      reason: body.reason?.trim(),
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ban failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
