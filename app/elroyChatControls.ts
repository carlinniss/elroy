export const SHUT_UP_DURATION_MS = 8 * 60 * 1000;
export const MENTION_COOLDOWN_MS = 45_000;
export const COMEBACK_COOLDOWN_MS = 3 * 60 * 1000;
export const COMEBACK_CHANCE = 0.22;

export const mentionsElroy = (text: string) => /\belroy\b/i.test(text);

export const isShutUpCommand = (text: string) => {
  const lower = text.toLowerCase();
  if (!mentionsElroy(lower)) return false;
  return /\b(shut\s*up|be\s*quiet|stfu|stop\s*talking|zip\s*it|can\s*you\s*not|go\s*away|leave\s*us\s*alone|silence|shush)\b/.test(lower);
};

export const isSilencedAt = (now: number, silencedUntil: number) => now < silencedUntil;

export const getNextSilencedUntil = (
  now: number,
  currentSilencedUntil: number,
  durationMs = SHUT_UP_DURATION_MS,
) => {
  if (isSilencedAt(now, currentSilencedUntil)) {
    return currentSilencedUntil;
  }

  return now + durationMs;
};

export const canRespondToElroyAt = (
  now: number,
  lastElroyResponseAt: number,
  cooldownMs: number,
) => now - lastElroyResponseAt >= cooldownMs;
