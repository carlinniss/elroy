import tmi from "tmi.js";
import { requireOverlayAuth } from "@/lib/overlayAuth";

const TWITCH_MESSAGE_LIMIT = 500;

export async function POST(req: Request) {
  const authError = requireOverlayAuth(req);
  if (authError) return authError;

  try {
    const { message } = await req.json();
    const channel = process.env.TWITCH_CHANNEL || process.env.NEXT_PUBLIC_TWITCH_CHANNEL;
    const username = process.env.TWITCH_BOT_USERNAME || channel;
    const password = process.env.TWITCH_OAUTH_TOKEN;

    if (!channel || !username || !password) {
      return Response.json({ error: "Twitch chat is not configured" }, { status: 500 });
    }

    if (typeof message !== "string" || message.length === 0 || message.length > TWITCH_MESSAGE_LIMIT) {
      return Response.json({ error: "Invalid chat message" }, { status: 400 });
    }

    const client = new tmi.Client({
      identity: { username, password },
      channels: [channel],
    });

    try {
      await client.connect();
      await client.say(channel, message);
    } finally {
      await client.disconnect().catch(() => {});
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("TWITCH SAY ERROR:", error);
    return Response.json({ error: "Failed to send chat message" }, { status: 500 });
  }
}
