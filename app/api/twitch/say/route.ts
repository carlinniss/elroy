import tmi from "tmi.js";
import { requireOverlayAuth } from "@/lib/overlayAuth";

export async function POST(req: Request) {
  const unauthorized = requireOverlayAuth(req);
  if (unauthorized) return unauthorized;

  try {
    const { message } = await req.json();
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL;
    const normalizedChannel = channel?.replace(/^#/, "");
    const username = (process.env.TWITCH_BOT_USERNAME || normalizedChannel)?.replace(/^#/, "");
    const password = process.env.TWITCH_OAUTH_TOKEN;

    if (!channel || !username || !password) {
      return new Response(JSON.stringify({ error: "Twitch credentials are not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (typeof message !== "string" || !message.trim()) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const client = new tmi.Client({
      identity: { username, password },
      channels: [channel],
    });

    await client.connect();
    try {
      await client.say(channel, message.trim());
    } finally {
      await client.disconnect().catch(() => undefined);
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("TWITCH SAY ERROR:", error);
    return new Response(JSON.stringify({ error: "Twitch send failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
