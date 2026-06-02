import type { TriviaCategory } from '@/lib/cannabis-trivia';
import { isControlAuthorized } from '@/lib/control-auth';
import { incrementTriviaWin } from '@/lib/trivia-scores';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as { username?: string; category?: TriviaCategory; points?: number };
    const username = body.username?.trim();
    const category = body.category;
    const points = Math.max(1, Math.floor(Number(body.points) || 1));

    if (!username || (category !== 'cannabis' && category !== 'freaky' && category !== 'music90s')) {
      return Response.json({ error: 'username and category required' }, { status: 400 });
    }

    const score = await incrementTriviaWin(username, category, points);
    return Response.json({ ok: true, username, category, points, score });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Score update failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
