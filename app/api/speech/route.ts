export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    const voiceId = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB";
    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      return new Response("Missing ElevenLabs API Key", { status: 500 });
    }

    // Direct API call - bypassing the buggy SDK
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text: text,
          model_id: "eleven_flash_v2_5", // The 2026 high-speed model
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error("ElevenLabs API Error:", errorData);
      return new Response(`ElevenLabs Error: ${response.statusText}`, { status: response.status });
    }

    const audioBuffer = await response.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error: any) {
    console.error("Speech Route Error:", error.message);
    return new Response("Internal Server Error", { status: 500 });
  }
}