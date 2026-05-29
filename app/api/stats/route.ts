import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return new Response("ELEVENLABS_API_KEY missing", { status: 500 });
  }

  try {
    const client = new ElevenLabsClient({ apiKey });
    const sub = await client.user.subscription.get();
    return Response.json({ remaining: sub.characterLimit - sub.characterCount });
  } catch (error) {
    return new Response("Stats failed", { status: 500 });
  }
}