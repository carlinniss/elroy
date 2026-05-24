import { formatBlackjackLeaderboard, getBlackjackLeaders } from '@/lib/blackjack';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const leaders = await getBlackjackLeaders();
    return Response.json({
      leaders,
      message: formatBlackjackLeaderboard(leaders),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Leader lookup failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
