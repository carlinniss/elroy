import type { TriviaCategory } from '@/lib/cannabis-trivia';
import { incrementTriviaWin } from '@/lib/trivia-scores';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { username?: string; category?: TriviaCategory };
    const username = body.username?.trim();
    const category = body.category;

    if (!username || (category !== 'cannabis' && category !== 'freaky')) {
      return Response.json({ error: 'username and category required' }, { status: 400 });
    }

    const score = await incrementTriviaWin(username, category);
    return Response.json({ ok: true, username, category, score });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Score update failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
