import { handleBlackjackAction, type BjActionRequest } from '@/lib/blackjack';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BjActionRequest;
    const result = await handleBlackjackAction(body);
    if (!result.ok && !result.messages.length) {
      return Response.json(result, { status: 400 });
    }
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Blackjack action failed';
    return Response.json({ ok: false, messages: [], error: message }, { status: 500 });
  }
}
