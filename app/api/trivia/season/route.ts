import { formatTriviaSeasonChatMessage, getTriviaSeasonLeaders } from '@/lib/trivia-scores';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { seasonId, leaders } = await getTriviaSeasonLeaders();
    return Response.json({ seasonId, leaders, message: formatTriviaSeasonChatMessage(seasonId, leaders) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Season lookup failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
