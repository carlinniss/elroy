import { getTriviaLeaders } from '@/lib/trivia-scores';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const leaders = await getTriviaLeaders();
    return Response.json(leaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Leader lookup failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
