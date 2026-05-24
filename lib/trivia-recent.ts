import { hasRedisStorage, redisCommand, redisPipeline } from '@/lib/redis-rest';

const RECENT_KEY = 'elroy:trivia:recent-questions';
const MAX_RECENT = 40;

const globalStore = globalThis as typeof globalThis & { __elroyRecentTrivia?: string[] };

function getMemoryRecent(): string[] {
  if (!globalStore.__elroyRecentTrivia) {
    globalStore.__elroyRecentTrivia = [];
  }
  return globalStore.__elroyRecentTrivia;
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
  }

  return false;
}

export async function getRecentTriviaQuestions(): Promise<string[]> {
  if (hasRedisStorage()) {
    try {
      const raw = await redisCommand(['LRANGE', RECENT_KEY, '0', MAX_RECENT - 1]);
      if (Array.isArray(raw)) {
        return raw.map(String).filter(Boolean);
      }
    } catch (error) {
      console.error('Redis trivia recent read failed', error);
    }
  }

  return [...getMemoryRecent()];
}

export async function recordTriviaQuestion(question: string): Promise<void> {
  const trimmed = question.trim();
  if (!trimmed) return;

  if (hasRedisStorage()) {
    try {
      await redisPipeline([
        ['LREM', RECENT_KEY, '0', trimmed],
        ['LPUSH', RECENT_KEY, trimmed],
        ['LTRIM', RECENT_KEY, '0', MAX_RECENT - 1],
      ]);
      return;
    } catch (error) {
      console.error('Redis trivia recent write failed', error);
    }
  }

  const memory = getMemoryRecent().filter((q) => q !== trimmed);
  memory.unshift(trimmed);
  globalStore.__elroyRecentTrivia = memory.slice(0, MAX_RECENT);
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
