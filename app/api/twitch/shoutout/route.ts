import { isControlAuthorized } from '@/lib/control-auth';
import { sendShoutout } from '@/lib/twitch-mod';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as { login?: string };
    const login = body.login?.trim().replace(/^@/, '').toLowerCase();
    if (!login) {
      return Response.json({ error: 'login required' }, { status: 400 });
    }

    await sendShoutout(login);
    return Response.json({ ok: true, login });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Shoutout failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
