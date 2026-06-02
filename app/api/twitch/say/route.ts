import { isControlAuthorized } from '@/lib/control-auth';
import tmi from 'tmi.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_TWITCH_CHAT_CHARS = 500;

function normalizeToken(token: string) {
  const trimmed = token.trim();
  return trimmed.startsWith('oauth:') ? trimmed : `oauth:${trimmed}`;
}

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

    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL?.trim();
    const username = process.env.TWITCH_BOT_USERNAME?.trim() || channel;
    const token = process.env.TWITCH_BOT_OAUTH_TOKEN?.trim() || process.env.TWITCH_OAUTH_TOKEN?.trim();
    if (!channel || !username || !token) {
      return Response.json({ error: 'Twitch chat credentials missing' }, { status: 503 });
    }

    const client = new tmi.Client({
      identity: {
        username,
        password: normalizeToken(token),
      },
      channels: [channel],
    });

    try {
      await client.connect();
      await client.say(channel, message.slice(0, MAX_TWITCH_CHAT_CHARS));
    } finally {
      try {
        await client.disconnect();
      } catch {
        /* ignore disconnect failures */
      }
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Twitch chat send failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
