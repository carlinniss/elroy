import type { TriviaCategory } from '@/lib/cannabis-trivia';
import { hasRedisStorage, redisCommand, redisPipeline } from '@/lib/redis-rest';

const MAX_RECENT = 50;

const globalStore = globalThis as typeof globalThis & {
  __elroyRecentTrivia?: Partial<Record<TriviaCategory, string[]>>;
};

function recentKey(category: TriviaCategory) {
  return `elroy:trivia:recent:${category}`;
}

function seenKey(category: TriviaCategory) {
  return `elroy:trivia:seen:${category}`;
}

function getMemoryRecent(category: TriviaCategory): string[] {
  if (!globalStore.__elroyRecentTrivia) {
    globalStore.__elroyRecentTrivia = { cannabis: [], freaky: [] };
  }
  if (!globalStore.__elroyRecentTrivia[category]) {
    globalStore.__elroyRecentTrivia[category] = [];
  }
  return globalStore.__elroyRecentTrivia[category]!;
}

export function normalizeTriviaQuestionText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isNearDuplicateTriviaQuestion(candidate: string, recent: string[]): boolean {
  const norm = normalizeTriviaQuestionText(candidate);
  if (!norm) return true;

  for (const existing of recent) {
    const existingNorm = normalizeTriviaQuestionText(existing);
    if (!existingNorm) continue;
    if (norm === existingNorm) return true;
    if (norm.length >= 18 && existingNorm.length >= 18 && (norm.includes(existingNorm) || existingNorm.includes(norm))) {
      return true;
    }
    if (questionSimilarity(norm, existingNorm) >= 0.55) return true;
  }

  return false;
}

function questionSimilarity(a: string, b: string): number {
  const aTokens = new Set(a.split(' ').filter((word) => word.length > 3));
  const bTokens = new Set(b.split(' ').filter((word) => word.length > 3));
  if (!aTokens.size || !bTokens.size) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }

  const union = aTokens.size + bTokens.size - intersection;
  return union ? intersection / union : 0;
}

export async function getRecentTriviaQuestions(category: TriviaCategory): Promise<string[]> {
  if (hasRedisStorage()) {
    try {
      const raw = await redisCommand(['LRANGE', recentKey(category), '0', MAX_RECENT - 1]);
      if (Array.isArray(raw)) {
        return raw.map(String).filter(Boolean);
      }
    } catch (error) {
      console.error('Redis trivia recent read failed', error);
    }
  }

  return [...getMemoryRecent(category)];
}

export async function hasSeenTriviaQuestion(question: string, category: TriviaCategory): Promise<boolean> {
  const fingerprint = normalizeTriviaQuestionText(question);
  if (!fingerprint) return true;

  if (hasRedisStorage()) {
    try {
      const seen = await redisCommand(['SISMEMBER', seenKey(category), fingerprint]);
      if (seen === 1) return true;
    } catch (error) {
      console.error('Redis trivia seen check failed', error);
    }
  }

  const recent = getMemoryRecent(category);
  return isNearDuplicateTriviaQuestion(question, recent);
}

export async function recordTriviaQuestion(question: string, category: TriviaCategory): Promise<void> {
  const trimmed = question.trim();
  if (!trimmed) return;
  const fingerprint = normalizeTriviaQuestionText(trimmed);

  if (hasRedisStorage()) {
    try {
      await redisPipeline([
        ['LREM', recentKey(category), '0', trimmed],
        ['LPUSH', recentKey(category), trimmed],
        ['LTRIM', recentKey(category), '0', MAX_RECENT - 1],
        ['SADD', seenKey(category), fingerprint],
      ]);
      return;
    } catch (error) {
      console.error('Redis trivia recent write failed', error);
    }
  }

  const memory = getMemoryRecent(category).filter((q) => q !== trimmed);
  memory.unshift(trimmed);
  globalStore.__elroyRecentTrivia![category] = memory.slice(0, MAX_RECENT);
}

export function mergeRecentTriviaQuestions(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const list of lists) {
    for (const question of list) {
      const trimmed = question.trim();
      if (!trimmed) continue;
      const key = normalizeTriviaQuestionText(trimmed);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(trimmed);
    }
  }

  return merged.slice(0, MAX_RECENT);
}
