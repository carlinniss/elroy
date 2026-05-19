import { requireOverlayAuth } from "@/lib/overlayAuth";

export async function POST(req: Request) {
  const authError = requireOverlayAuth(req);
  if (authError) return authError;

  try {
    const { text } = await req.json();
    const voiceId = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB";
    
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY! },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_flash_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    const audioBuffer = await response.arrayBuffer();
    return new Response(audioBuffer, { headers: { "Content-Type": "audio/mpeg" } });
  } catch (error) {
    return new Response("Speech Error", { status: 500 });
  }
}