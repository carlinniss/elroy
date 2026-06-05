import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export async function GET() {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (!apiKey) {
      return Response.json({ error: "ELEVENLABS_API_KEY missing" }, { status: 500 });
    }

    const client = new ElevenLabsClient({ apiKey });
    const sub = await client.user.subscription.get();
    return Response.json({ remaining: sub.characterLimit - sub.characterCount });
  } catch (error) {
    return new Response("Stats failed", { status: 500 });
  }
}