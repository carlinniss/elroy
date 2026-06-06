import { isControlAuthorized } from '@/lib/control-auth';
import { sendTwitchChatMessage } from '@/lib/twitch-chat';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as { message?: string };
    const message = body.message?.trim();
    if (!message) {
      return Response.json({ error: 'message required' }, { status: 400 });
    }

    await sendTwitchChatMessage(message.slice(0, 500));
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Twitch send failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
