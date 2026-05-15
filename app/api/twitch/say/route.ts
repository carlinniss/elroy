import tmi from "tmi.js";
import { requireOverlayAuth } from "@/lib/overlayAuth";

export async function POST(req: Request) {
  const unauthorized = requireOverlayAuth(req);
  if (unauthorized) return unauthorized;

  try {
    const { message } = await req.json();
    const channel = process.env.TWITCH_CHANNEL || process.env.NEXT_PUBLIC_TWITCH_CHANNEL;
    const username = process.env.TWITCH_BOT_USERNAME || channel;
    const password = process.env.TWITCH_OAUTH_TOKEN;

    if (typeof message !== "string" || !message.trim()) {
      return new Response("Message required", { status: 400 });
    }

    if (!channel || !username || !password) {
      return new Response("Twitch credentials missing", { status: 500 });
    }

    const client = new tmi.Client({
      identity: { username, password },
      channels: [channel],
    });

    try {
      await client.connect();
      await client.say(channel, message.slice(0, 500));
    } finally {
      await client.disconnect().catch(() => {});
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("TWITCH SAY ERROR:", error);
    return new Response("Twitch send failed", { status: 500 });
  }
}
