import { handlePickAction, type PickActionRequest } from '@/lib/pick-numbers';
import { isControlAuthorized } from '@/lib/control-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ ok: false, messages: [], error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as PickActionRequest;
    const result = await handlePickAction(body);
    if (!result.ok && !result.messages.length) {
      return Response.json(result, { status: 400 });
    }
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Pick numbers action failed';
    return Response.json({ ok: false, messages: [], error: message }, { status: 500 });
  }
}
