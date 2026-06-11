import { handleRouletteAction, type RouletteActionRequest } from '@/lib/roulette';
import { isControlAuthorized } from '@/lib/control-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ ok: false, messages: [], error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as RouletteActionRequest;
    const result = await handleRouletteAction(body);
    if (!result.ok && !result.messages.length) {
      return Response.json(result, { status: 400 });
    }
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Roulette action failed';
    return Response.json({ ok: false, messages: [], error: message }, { status: 500 });
  }
}
