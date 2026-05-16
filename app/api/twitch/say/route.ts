import tmi from "tmi.js";
import { requireOverlayAuth } from "@/lib/overlayAuth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const authError = requireOverlayAuth(req);
  if (authError) return authError;

  try {
    const { message } = await req.json();
    const channel = process.env.TWITCH_CHANNEL || process.env.NEXT_PUBLIC_TWITCH_CHANNEL;
    const username = process.env.TWITCH_BOT_USERNAME || channel;
    const token = process.env.TWITCH_OAUTH_TOKEN;

    if (!channel || !username || !token) {
      return new Response("Twitch credentials are not configured", { status: 500 });
    }

    if (typeof message !== "string" || !message.trim()) {
      return new Response("Message is required", { status: 400 });
    }

    const client = new tmi.Client({
      identity: { username, password: token },
      channels: [channel],
    });

    try {
      await client.connect();
      await client.say(channel, message.slice(0, 500));
    } finally {
      void client.disconnect().catch(() => undefined);
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("TWITCH SAY ERROR:", error);
    return new Response("Twitch send failed", { status: 500 });
  }
}
