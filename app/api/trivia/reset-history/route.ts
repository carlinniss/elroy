import { resetTriviaQuestionHistory } from '@/lib/trivia-recent';

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request) {
  const secret = process.env.TRIVIA_ADMIN_SECRET?.trim();
  if (!secret) return false;

  const auth = request.headers.get('authorization')?.trim();
  if (auth === `Bearer ${secret}`) return true;

  return request.headers.get('x-trivia-admin-secret')?.trim() === secret;
}

/** Admin-only: wipes permanent trivia dedup. Normal bot restarts never call this. */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const ok = await resetTriviaQuestionHistory();
    if (!ok) {
      return Response.json({ error: 'Trivia history reset failed' }, { status: 503 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trivia history reset failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
