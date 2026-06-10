import { isControlAuthorized } from '@/lib/control-auth';
import { getModTwitchCredentials, sendChatAnnouncement } from '@/lib/twitch-mod';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      message?: string;
      color?: 'primary' | 'blue' | 'green' | 'orange' | 'purple';
    };
    const message = body.message?.trim();
    if (!message) {
      return Response.json({ error: 'message required' }, { status: 400 });
    }

    await sendChatAnnouncement(message, body.color ?? 'primary');
    const creds = await getModTwitchCredentials();
    return Response.json({ ok: true, sender_login: creds?.moderatorLogin ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Announcement failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
