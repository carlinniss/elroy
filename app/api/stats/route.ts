import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { requireOverlayControl } from "@/lib/overlayAuth";

export async function GET(req: Request) {
  const authError = requireOverlayControl(req);
  if (authError) return authError;

  try {
    const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
    const sub = await client.user.subscription.get();
    return Response.json({ remaining: sub.characterLimit - sub.characterCount });
  } catch (error) {
    return new Response("Stats failed", { status: 500 });
  }
}