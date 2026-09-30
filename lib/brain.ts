/**
 * Elroy's brain: Gemini first (free tier / cheap), OpenAI as automatic backup.
 *
 * When Gemini fails — daily free quota used up, rate limited, overloaded — the same prompt goes
 * to OpenAI (if OPENAI_API_KEY is set). After a quota error Gemini is skipped for a while so
 * every reply doesn't waste a round-trip on a request that will fail.
 */
import { generateText } from 'ai';
import { getGeminiModel } from '@/lib/gemini-model';

const OPENAI_CHAT_API = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const GEMINI_QUOTA_PAUSE_MS = 15 * 60_000;

const globalState = globalThis as typeof globalThis & { __elroyGeminiPausedUntil?: number };

export type BrainProvider = 'gemini' | 'openai';

function openAiModel() {
  return process.env.ELROY_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

function isQuotaError(message: string) {
  return /quota|resource_exhausted|rate limit|429|credits are depleted/i.test(message);
}

async function askOpenAi(system: string, prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  const res = await fetch(OPENAI_CHAT_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: openAiModel(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: 400,
    }),
  });
  const data = await res.json().catch(() => ({})) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string; code?: string };
  };
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${data.error?.code || ''} ${data.error?.message || ''}`.trim());
  }
  return data.choices?.[0]?.message?.content?.trim() || '';
}

export async function generateBrainText(opts: { system: string; prompt: string }): Promise<{ text: string; provider: BrainProvider }> {
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY?.trim());
  const hasGemini = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
  const geminiPaused = (globalState.__elroyGeminiPausedUntil ?? 0) > Date.now();

  if (hasGemini && !(geminiPaused && hasOpenAi)) {
    try {
      const { text } = await generateText({ model: getGeminiModel(), system: opts.system, prompt: opts.prompt });
      if (text?.trim()) return { text, provider: 'gemini' };
      throw new Error('Gemini returned an empty reply');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!hasOpenAi) throw error;
      if (isQuotaError(message)) {
        globalState.__elroyGeminiPausedUntil = Date.now() + GEMINI_QUOTA_PAUSE_MS;
        console.warn('Gemini quota hit — using OpenAI backup for the next 15 minutes.');
      } else {
        console.warn('Gemini failed, trying OpenAI backup:', message);
      }
    }
  }

  if (!hasOpenAi) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY missing');
  return { text: await askOpenAi(opts.system, opts.prompt), provider: 'openai' };
}
