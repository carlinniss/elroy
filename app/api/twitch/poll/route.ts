import { isControlAuthorized } from '@/lib/control-auth';
import { createChannelPoll } from '@/lib/twitch-mod';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      title?: string;
      choices?: string[];
      duration?: number;
    };
    const title = body.title?.trim();
    const choices = Array.isArray(body.choices) ? body.choices : [];
    if (!title) {
      return Response.json({ error: 'title required' }, { status: 400 });
    }

    const poll = await createChannelPoll(title, choices, body.duration ?? 60);
    return Response.json({ ok: true, poll });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Poll failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
