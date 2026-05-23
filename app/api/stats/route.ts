import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { requireOverlayControl } from "@/lib/overlayAuth";

export async function GET(req: Request) {
  const unauthorized = requireOverlayControl(req);
  if (unauthorized) return unauthorized;

  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return Response.json({ error: "ELEVENLABS_API_KEY is not configured." }, { status: 503 });

    const client = new ElevenLabsClient({ apiKey });
    const sub = await client.user.subscription.get();
    return Response.json({ remaining: sub.characterLimit - sub.characterCount });
  } catch (error) {
    return new Response("Stats failed", { status: 500 });
  }
}