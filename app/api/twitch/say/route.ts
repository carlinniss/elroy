import { requireOverlayControl } from '@/lib/overlayAuth';
import { sendTwitchChatMessage } from '@/lib/twitch-chat';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const unauthorized = requireOverlayControl(request);
  if (unauthorized) return unauthorized;

  try {
    const { message } = await request.json();
    if (typeof message !== 'string' || !message.trim()) {
      return Response.json({ error: 'Message is required.' }, { status: 400 });
    }

    await sendTwitchChatMessage(message);
    return Response.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to send Twitch chat message.';
    console.error('TWITCH SAY ERROR:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
