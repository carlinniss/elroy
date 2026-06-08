import { isControlAuthorized } from '@/lib/control-auth';
import { inspectTwitchChatSend } from '@/lib/twitch';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const status = await inspectTwitchChatSend();
  return Response.json(status);
}
