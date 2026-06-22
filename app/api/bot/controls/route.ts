import {
  ackBotControlCommands,
  getBotControls,
  queueBotControlCommand,
  updateBotControls,
  type BotControlsSettings,
} from '@/lib/bot-controls';
import { isControlAuthorized } from '@/lib/control-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const snapshot = await getBotControls();
    return Response.json(snapshot, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Controls lookup failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      settings?: BotControlsSettings;
      command?: 'disconnect';
      action?: 'ack';
      commandIds?: string[];
    };

    if (body.action === 'ack') {
      const snapshot = await ackBotControlCommands(
        Array.isArray(body.commandIds) ? body.commandIds.map(String) : [],
      );
      return Response.json(snapshot);
    }

    if (body.command === 'disconnect') {
      const snapshot = await queueBotControlCommand('disconnect');
      return Response.json(snapshot);
    }

    if (body.settings && typeof body.settings === 'object') {
      const snapshot = await updateBotControls(body.settings);
      return Response.json(snapshot);
    }

    return Response.json({ error: 'settings, command, or action required' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Controls update failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
