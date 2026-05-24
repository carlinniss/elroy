import { removeTriviaPlayer } from '@/lib/trivia-scores';

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request) {
  const secret = process.env.TRIVIA_ADMIN_SECRET?.trim();
  if (!secret) return false;

  const auth = request.headers.get('authorization')?.trim();
  if (auth === `Bearer ${secret}`) return true;

  return request.headers.get('x-trivia-admin-secret')?.trim() === secret;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as { username?: string };
    const username = body.username?.trim();
    if (!username) {
      return Response.json({ error: 'username required' }, { status: 400 });
    }

    const removed = await removeTriviaPlayer(username);
    return Response.json({ ok: true, username, removed });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Remove failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
