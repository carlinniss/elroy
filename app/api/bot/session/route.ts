import {
  claimBotSession,
  heartbeatBotSession,
  releaseBotSession,
} from '@/lib/bot-session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; instanceId?: string };
    const instanceId = body.instanceId?.trim();
    const action = body.action?.trim();

    if (!instanceId) {
      return Response.json({ error: 'instanceId required' }, { status: 400 });
    }

    if (action === 'claim') {
      const result = await claimBotSession(instanceId);
      if (result === 'claimed') return Response.json({ ok: true, instanceId });
      if (result === 'blocked') {
        return Response.json(
          { error: 'Another Elroy instance is already running.' },
          { status: 409 },
        );
      }
      return Response.json({ error: 'Session unavailable' }, { status: 503 });
    }

    if (action === 'heartbeat') {
      const result = await heartbeatBotSession(instanceId);
      if (result === 'ok') return Response.json({ ok: true });
      if (result === 'lost') {
        return Response.json({ error: 'Session lost to another instance.' }, { status: 409 });
      }
      return Response.json({ error: 'Session unavailable' }, { status: 503 });
    }

    if (action === 'release') {
      await releaseBotSession(instanceId);
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Session request failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
