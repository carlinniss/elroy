import { recordUserMemory, type UserMemoryEvent } from '@/lib/user-memory';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      username?: string;
      displayName?: string;
      event?: UserMemoryEvent;
    };

    const username = body.username?.trim();
    if (!username || !body.event?.type) {
      return Response.json({ error: 'username and event required' }, { status: 400 });
    }

    const profile = await recordUserMemory(username, body.displayName, body.event);
    return Response.json({ ok: true, profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Remember failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
