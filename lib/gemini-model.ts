import { google } from '@ai-sdk/google';

/** Default: Flash-Lite — free-tier eligible and ~4× cheaper than 2.5 Flash on paid billing. */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';

export function getGeminiModelId(): string {
  return (
    process.env.GOOGLE_GENERATIVE_AI_MODEL?.trim()
    || process.env.GEMINI_MODEL?.trim()
    || DEFAULT_GEMINI_MODEL
  );
}

export function getGeminiModel() {
  return google(getGeminiModelId());
}
