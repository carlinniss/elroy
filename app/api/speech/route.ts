import { isControlAuthorized } from '@/lib/control-auth';

function elevenLabsErrorMessage(body: string, status: number) {
  try {
    const parsed = JSON.parse(body) as {
      detail?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed.detail === 'object' && parsed.detail?.message) {
      return parsed.detail.message;
    }
    if (typeof parsed.detail === 'string' && parsed.detail.trim()) {
      return parsed.detail;
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    /* ignore */
  }
  return body.trim() || `ElevenLabs TTS failed (${status})`;
}

export async function POST(req: Request) {
  if (!isControlAuthorized(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: 'ELEVENLABS_API_KEY is not set' }, { status: 503 });
  }

  try {
    const { text } = await req.json();
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) {
      return Response.json({ error: 'text required' }, { status: 400 });
    }

    const voiceId = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
      body: JSON.stringify({
        text: trimmed,
        model_id: 'eleven_flash_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      const message = elevenLabsErrorMessage(body, response.status);
      const status = response.status === 401 || response.status === 402
        ? response.status
        : 502;
      return Response.json({ error: message }, { status });
    }

    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const audioBuffer = await response.arrayBuffer();
    return new Response(audioBuffer, { headers: { 'Content-Type': contentType } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Speech Error';
    return Response.json({ error: message }, { status: 500 });
  }
}