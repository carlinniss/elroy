import { isControlAuthorized } from '@/lib/control-auth';

export const dynamic = 'force-dynamic';

const OPENAI_TRANSCRIPTIONS_API = 'https://api.openai.com/v1/audio/transcriptions';

function openAiAudioModelId() {
  return (
    process.env.OPENAI_TRANSCRIPTION_MODEL?.trim()
    || 'gpt-4o-mini-transcribe'
  );
}

function mapOpenAiTranscriptionError(message: string, status: number, code?: string) {
  const lower = message.toLowerCase();
  const lowerCode = code?.toLowerCase() || '';
  const detail = code ? ` OpenAI code: ${code}.` : '';
  if (lowerCode.includes('rate_limit') || lowerCode.includes('rate_limit_exceeded')) {
    return `OpenAI transcription rate limit hit.${detail} Studio is still listening and will retry shortly.`;
  }
  if (
    lowerCode.includes('insufficient_quota')
    || lower.includes('insufficient_quota')
    || lower.includes('billing')
    || lower.includes('payment')
    || lower.includes('credits')
    || lower.includes('quota exceeded')
  ) {
    return `OpenAI transcription quota/billing issue.${detail} If you just added credits, make sure this API key belongs to the funded project and redeploy Vercel.`;
  }
  if (status === 429 || lower.includes('rate limit')) {
    return `OpenAI transcription rate limit hit.${detail} Studio is still listening and will retry shortly.`;
  }
  if (status === 503 || lower.includes('overloaded') || lower.includes('temporarily unavailable')) {
    return `OpenAI transcription is temporarily busy.${detail} Studio is still listening and will retry shortly.`;
  }
  if (status === 401 || lower.includes('api key') || lower.includes('unauthorized')) {
    return `OPENAI_API_KEY looks wrong or missing in Vercel.${detail}`;
  }
  return `${message || `OpenAI transcription failed (${status})`}${detail}`;
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
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'OPENAI_API_KEY missing' }, { status: 500 });
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

    const upstreamForm = new FormData();
    upstreamForm.set('file', new Blob([bytes], { type: audio.type || 'audio/webm' }), 'broadcast.webm');
    upstreamForm.set('model', openAiAudioModelId());
    upstreamForm.set('language', 'en');
    upstreamForm.set('prompt', [
      'Transcribe only intelligible host speech from Twitch broadcast audio.',
      'Ignore music, sound effects, game audio, TTS, and chat alert sounds.',
      'If there is no clear host speech, return an empty string.',
    ].join(' '));

    const response = await fetch(OPENAI_TRANSCRIPTIONS_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstreamForm,
    });

    const data = await response.json().catch(() => ({})) as {
      text?: string;
      error?: { message?: string; code?: string };
    };
    if (!response.ok) {
      const providerMessage = data.error?.message || data.error?.code || `OpenAI transcription failed (${response.status})`;
      console.error('OPENAI TRANSCRIPTION ERROR:', {
        status: response.status,
        code: data.error?.code,
        message: providerMessage,
        model: openAiAudioModelId(),
      });
      return Response.json({
        error: mapOpenAiTranscriptionError(providerMessage, response.status, data.error?.code),
      }, { status: response.status });
    }

    const text = cleanTranscript(data.text || '');
    if (/^(none|no speech|no clear speech|silence|empty)$/i.test(text)) {
      return Response.json({ text: '' });
    }
    return Response.json({ text });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OpenAI transcription failed';
    console.error('STUDIO TRANSCRIPTION ERROR:', message);
    return Response.json({ error: mapOpenAiTranscriptionError(message, 500) }, { status: 500 });
  }
}
