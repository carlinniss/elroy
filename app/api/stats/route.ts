import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { requireOverlayAuth } from "@/lib/overlayAuth";

export async function GET(req: Request) {
  const unauthorized = requireOverlayAuth(req);
  if (unauthorized) return unauthorized;

  try {
    const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
    const sub = await client.user.subscription.get();
    return Response.json({ remaining: sub.characterLimit - sub.characterCount });
  } catch (error) {
    return new Response("Stats failed", { status: 500 });
  }
}