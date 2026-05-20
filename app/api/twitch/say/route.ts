import tmi from "tmi.js";
import { requireOverlayAuth } from "@/lib/overlayAuth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const authError = requireOverlayAuth(req);
  if (authError) return authError;

  try {
    const { message } = await req.json();
    const trimmedMessage = typeof message === "string" ? message.trim() : "";
    if (!trimmedMessage) {
      return new Response("Message is required", { status: 400 });
    }

    if (trimmedMessage.length > 500) {
      return new Response("Message exceeds Twitch chat limit", { status: 400 });
    }

    const channel = process.env.TWITCH_CHANNEL || process.env.NEXT_PUBLIC_TWITCH_CHANNEL;
    const username = process.env.TWITCH_BOT_USERNAME || channel;
    const password = process.env.TWITCH_OAUTH_TOKEN;

    if (!channel || !username || !password) {
      console.error("Twitch chat credentials are not configured");
      return new Response("Twitch chat credentials are not configured", { status: 500 });
    }

    const client = new tmi.Client({
      identity: { username, password },
      channels: [channel],
    });

    try {
      await client.connect();
      await client.say(channel, trimmedMessage);
      return Response.json({ ok: true });
    } finally {
      client.disconnect().catch((error) => console.warn("Twitch disconnect failed", error));
    }
  } catch (error) {
    console.error("TWITCH SAY ERROR:", error);
    return new Response("Twitch say failed", { status: 500 });
  }
}
