import { isControlAuthorized } from '@/lib/control-auth';
import {
  ackPushDirective,
  addDirective,
  clearDirectives,
  consumeNextDirectives,
  listDirectives,
  removeDirective,
  type DirectiveKind,
} from '@/lib/live-directives';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const directives = await listDirectives();
    return Response.json(directives, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Read failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      action?: string;
      kind?: DirectiveKind;
      text?: string;
      id?: string;
      chatOnly?: boolean;
      forceVoice?: boolean;
    };

    if (body.action === 'consume-next') {
      const consumed = await consumeNextDirectives();
      return Response.json({ ok: true, consumed });
    }

    if (body.action === 'ack-push' && body.id) {
      await ackPushDirective(body.id);
      return Response.json({ ok: true });
    }

    if (!isControlAuthorized(request)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (body.action === 'add') {
      const kind = body.kind;
      const text = body.text?.trim();
      if (!kind || !text) {
        return Response.json({ error: 'kind and text required' }, { status: 400 });
      }
      if (kind !== 'sticky' && kind !== 'next' && kind !== 'push') {
        return Response.json({ error: 'invalid kind' }, { status: 400 });
      }

      const directive = await addDirective(kind, text, {
        chatOnly: body.chatOnly,
        forceVoice: body.forceVoice,
      });
      if (!directive) {
        return Response.json({ error: 'text required' }, { status: 400 });
      }
      return Response.json({ ok: true, directive });
    }

    if (body.action === 'clear') {
      await clearDirectives(body.kind);
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'unknown action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Write failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as { kind?: DirectiveKind; id?: string };
    if (!body.kind || !body.id) {
      return Response.json({ error: 'kind and id required' }, { status: 400 });
    }
    await removeDirective(body.kind, body.id);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Delete failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
