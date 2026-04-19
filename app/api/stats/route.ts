import { ElevenLabsClient } from "elevenlabs";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

export async function GET() {
  try {
    const sub = await client.user.getSubscription();
    return Response.json({ remaining: sub.character_limit - sub.character_count });
  } catch (error) {
    return new Response("Stats failed", { status: 500 });
  }
}