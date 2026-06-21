export const MAX_TWITCH_CHAT_CHARS = 480;
export const MAX_VOICE_REPLY_CHARS = 480;

/** Fix Gemini hallucinations — Twitch mods have swords, not wrenches. */
export function sanitizeElroyModLore(text: string): string {
  return text
    .replace(/\bwrench[-\s]?wielding mods?\b/gi, (match) => (
      /\bmods\b/i.test(match) ? 'sword-wielding mods' : 'sword-wielding mod'
    ))
    .replace(/\bmods?\s+with\s+wrenches\b/gi, (match) => (
      /\bmods\b/i.test(match) ? 'mods with swords' : 'mod with a sword'
    ))
    .replace(/\bwielding\s+wrenches\b/gi, 'wielding swords')
    .replace(/\bwielding\s+a\s+wrench\b/gi, 'wielding a sword')
    .replace(/\btheir\s+wrenches\b/gi, 'their swords')
    .replace(/\btheir\s+wrench\b/gi, 'their sword');
}

export function clampReplyLength(text: string, maxChars: number): string {
  const cleaned = sanitizeElroyModLore(text).replace(/\s+/g, ' ').trim();
  if (!cleaned) return '...';
  if (cleaned.length <= maxChars) return cleaned;

  const clipped = cleaned.slice(0, maxChars);
  const lastSentenceBreak = Math.max(
    clipped.lastIndexOf('. '),
    clipped.lastIndexOf('! '),
    clipped.lastIndexOf('? '),
  );
  const lastWordBreak = clipped.lastIndexOf(' ');
  const breakAt = lastSentenceBreak >= Math.floor(maxChars * 0.55)
    ? lastSentenceBreak + 1
    : lastWordBreak;

  const safe = (breakAt > 0 ? clipped.slice(0, breakAt) : clipped)
    .trim()
    .replace(/[.,;:!?-]+$/, '')
    .trim();

  return `${safe}…`;
}

export function formatChatReplyBody(text: string, username?: string): string {
  const maxBodyChars = username
    ? Math.max(80, MAX_TWITCH_CHAT_CHARS - (`@${username} `.length))
    : MAX_TWITCH_CHAT_CHARS;
  return clampReplyLength(text, maxBodyChars);
}

export function mapBrainErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('prepayment credits are depleted') || (lower.includes('insufficient') && lower.includes('credit'))) {
    return 'Brain stall — Google AI credits look depleted. Top up in AI Studio.';
  }
  if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('429')) {
    return 'Brain stall — Gemini quota/rate limit hit. Give it a minute or check AI Studio billing.';
  }
  if (lower.includes('api key') || lower.includes('key missing') || lower.includes('unauthorized')) {
    return 'Brain stall — GOOGLE_GENERATIVE_AI_API_KEY looks wrong or missing in Vercel.';
  }

  return 'Brain stall — Gemini request failed. Check Vercel logs / AI Studio billing.';
}
