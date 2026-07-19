import { getGeminiModelId } from '@/lib/gemini-model';
import { isControlAuthorized } from '@/lib/control-auth';

export const dynamic = 'force-dynamic';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

function audioModelId() {
  return (
    process.env.GOOGLE_GENERATIVE_AI_AUDIO_MODEL?.trim()
    || process.env.GEMINI_AUDIO_MODEL?.trim()
    || getGeminiModelId()
  );
}

function cleanTranscript(text: string) {
  return text
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'GOOGLE_GENERATIVE_AI_API_KEY missing' }, { status: 500 });
    }

    const form = await request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof File)) {
      return Response.json({ error: 'Missing audio file' }, { status: 400 });
    }

    const bytes = Buffer.from(await audio.arrayBuffer());
    if (bytes.length < 1000) {
      return Response.json({ text: '' });
    }

    const mimeType = audio.type || 'audio/webm';
    const model = audioModelId();
    const response = await fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            {
              text: [
                'Transcribe only intelligible host speech from this Twitch broadcast audio.',
                'Ignore music, sound effects, game audio, TTS, and chat alert sounds.',
                'If there is no clear host speech, return an empty string.',
                'Return plain transcript text only. No labels, punctuation commentary, or explanations.',
              ].join(' '),
            },
            {
              inline_data: {
                mime_type: mimeType,
                data: bytes.toString('base64'),
              },
            },
          ],
        }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 120,
        },
      }),
    });

    const data = await response.json().catch(() => ({})) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      return Response.json({
        error: data.error?.message || `Gemini audio transcription failed (${response.status})`,
      }, { status: response.status });
    }

    const raw = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join(' ') || '';
    const text = cleanTranscript(raw);
    if (/^(none|no speech|no clear speech|silence|empty)$/i.test(text)) {
      return Response.json({ text: '' });
    }
    return Response.json({ text });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Studio transcription failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
