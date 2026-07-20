import { isControlAuthorized } from '@/lib/control-auth';

export const dynamic = 'force-dynamic';

const OPENAI_TRANSCRIPTIONS_API = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 2 * 60_000;
const LONG_RATE_LIMIT_BACKOFF_MS = 10 * 60_000;

const globalState = globalThis as typeof globalThis & {
  __elroyOpenAiTranscription?: {
    cooldownUntil: number;
    consecutiveRateLimits: number;
  };
};

function transcriptionState() {
  globalState.__elroyOpenAiTranscription ??= {
    cooldownUntil: 0,
    consecutiveRateLimits: 0,
  };
  return globalState.__elroyOpenAiTranscription;
}

function openAiAudioModelId() {
  return (
    process.env.OPENAI_TRANSCRIPTION_MODEL?.trim()
    || 'gpt-4o-mini-transcribe-2025-12-15'
  );
}

function parseRetryAfterMs(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const retryAt = Date.parse(value);
  if (Number.isFinite(retryAt)) return Math.max(0, retryAt - Date.now());
  return null;
}

function isOpenAiRateLimit(status: number, code?: string, message = '') {
  const lowerCode = code?.toLowerCase() || '';
  const lower = message.toLowerCase();
  return (
    status === 429
    || lowerCode.includes('rate_limit')
    || lowerCode.includes('rate_limit_exceeded')
    || lower.includes('rate limit')
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

    const state = transcriptionState();
    const now = Date.now();
    if (state.cooldownUntil > now) {
      const retryAfterMs = state.cooldownUntil - now;
      return Response.json({
        text: '',
        warning: `OpenAI transcription cooling down after rate limits. Retrying in ~${Math.ceil(retryAfterMs / 60_000)}m.`,
        retryAfterMs,
      });
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
      const rateLimited = isOpenAiRateLimit(response.status, data.error?.code, providerMessage);
      console.error('OPENAI TRANSCRIPTION ERROR:', {
        status: response.status,
        code: data.error?.code,
        message: providerMessage,
        model: openAiAudioModelId(),
        rateLimited,
      });
      if (rateLimited) {
        state.consecutiveRateLimits += 1;
        const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
          ?? (state.consecutiveRateLimits >= 3 ? LONG_RATE_LIMIT_BACKOFF_MS : DEFAULT_RATE_LIMIT_BACKOFF_MS);
        state.cooldownUntil = Date.now() + retryAfterMs;
        return Response.json({
          text: '',
          warning: `OpenAI transcription rate-limited. Retrying in ~${Math.ceil(retryAfterMs / 60_000)}m.`,
          retryAfterMs,
        });
      }
      return Response.json({
        error: mapOpenAiTranscriptionError(providerMessage, response.status, data.error?.code),
      }, { status: response.status });
    }

    state.cooldownUntil = 0;
    state.consecutiveRateLimits = 0;

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
