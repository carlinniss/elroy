import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { requireOverlayAuth } from "@/lib/overlayAuth";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

export async function GET(req: Request) {
  const authError = requireOverlayAuth(req);
  if (authError) return authError;

  try {
    const sub = await client.user.subscription.get();
    return Response.json({ remaining: sub.characterLimit - sub.characterCount });
  } catch (error) {
    return new Response("Stats failed", { status: 500 });
  }
}