import tmi from "tmi.js";
import { requireOverlayControl } from "@/lib/overlayAuth";

const normalizeChannel = (channel: string) => channel.replace(/^#/, "");

export async function POST(req: Request) {
  const authError = requireOverlayControl(req);
  if (authError) return authError;

  try {
    const { message } = await req.json();
    if (typeof message !== "string" || !message.trim()) {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    const channel = process.env.TWITCH_CHANNEL || process.env.NEXT_PUBLIC_TWITCH_CHANNEL;
    const username = process.env.TWITCH_BOT_USERNAME || channel;
    const password = process.env.TWITCH_OAUTH_TOKEN;

    if (!channel || !username || !password) {
      return Response.json({ error: "Twitch chat credentials are not configured" }, { status: 500 });
    }

    const normalizedChannel = normalizeChannel(channel);
    const client = new tmi.Client({
      identity: {
        username: normalizeChannel(username),
        password,
      },
      channels: [normalizedChannel],
    });

    await client.connect();
    try {
      await client.say(normalizedChannel, message);
    } finally {
      await client.disconnect().catch(() => undefined);
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("TWITCH SAY ERROR:", error);
    return Response.json({ error: "Unable to send Twitch message" }, { status: 500 });
  }
}
