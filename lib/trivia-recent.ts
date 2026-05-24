import { normalizeTriviaAnswer, type TriviaCategory } from '@/lib/cannabis-trivia';
import { hasRedisStorage, redisCommand, redisPipeline } from '@/lib/redis-rest';

const MAX_RECENT = 50;

const globalStore = globalThis as typeof globalThis & {
  __elroyRecentTrivia?: Partial<Record<TriviaCategory, string[]>>;
  __elroySeenAnswers?: Partial<Record<TriviaCategory, Set<string>>>;
};

function recentKey(category: TriviaCategory) {
  return `elroy:trivia:recent:${category}`;
}

function seenKey(category: TriviaCategory) {
  return `elroy:trivia:seen:${category}`;
}

function answerKey(category: TriviaCategory) {
  return `elroy:trivia:answers:${category}`;
}

function redisTruthy(value: unknown) {
  return value === 1 || value === true || value === '1';
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

function getMemoryAnswers(category: TriviaCategory): Set<string> {
  if (!globalStore.__elroySeenAnswers) {
    globalStore.__elroySeenAnswers = { cannabis: new Set(), freaky: new Set() };
  }
  if (!globalStore.__elroySeenAnswers[category]) {
    globalStore.__elroySeenAnswers[category] = new Set();
  }
  return globalStore.__elroySeenAnswers[category]!;
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

function normalizedAnswers(answers: string[]): string[] {
  return [...new Set(answers.map((answer) => normalizeTriviaAnswer(answer)).filter(Boolean))];
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
    if (questionSimilarity(norm, existingNorm) >= 0.45) return true;
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

export async function hasSeenTriviaAnswers(answers: string[], category: TriviaCategory): Promise<boolean> {
  const normalized = normalizedAnswers(answers);
  if (!normalized.length) return false;

  if (hasRedisStorage()) {
    try {
      for (const answer of normalized) {
        const seen = await redisCommand(['SISMEMBER', answerKey(category), answer]);
        if (redisTruthy(seen)) return true;
      }
      return false;
    } catch (error) {
      console.error('Redis trivia answer check failed', error);
    }
  }

  const memory = getMemoryAnswers(category);
  return normalized.some((answer) => memory.has(answer));
}

export async function hasSeenTriviaQuestion(question: string, category: TriviaCategory): Promise<boolean> {
  const fingerprint = normalizeTriviaQuestionText(question);
  if (!fingerprint) return true;

  if (hasRedisStorage()) {
    try {
      const seen = await redisCommand(['SISMEMBER', seenKey(category), fingerprint]);
      if (redisTruthy(seen)) return true;
    } catch (error) {
      console.error('Redis trivia seen check failed', error);
    }
  }

  return isNearDuplicateTriviaQuestion(question, getMemoryRecent(category));
}

/** Atomically claim a question + answers. Returns false if already used. */
export async function claimTriviaQuestion(
  question: string,
  category: TriviaCategory,
  answers: string[] = [],
): Promise<boolean> {
  const trimmed = question.trim();
  if (!trimmed) return false;

  const fingerprint = normalizeTriviaQuestionText(trimmed);
  const answerFingerprints = normalizedAnswers(answers);

  if (hasRedisStorage()) {
    try {
      const seen = await redisCommand(['SISMEMBER', seenKey(category), fingerprint]);
      if (redisTruthy(seen)) return false;
      if (await hasSeenTriviaAnswers(answers, category)) return false;

      const commands: unknown[][] = [['SADD', seenKey(category), fingerprint]];
      for (const answer of answerFingerprints) {
        commands.push(['SADD', answerKey(category), answer]);
      }

      const results = await redisPipeline(commands);
      if (!results || !redisTruthy(results[0])) return false;

      for (let i = 0; i < answerFingerprints.length; i += 1) {
        if (!redisTruthy(results[i + 1])) {
          await redisCommand(['SREM', seenKey(category), fingerprint]);
          return false;
        }
      }

      await redisPipeline([
        ['LREM', recentKey(category), '0', trimmed],
        ['LPUSH', recentKey(category), trimmed],
        ['LTRIM', recentKey(category), '0', MAX_RECENT - 1],
      ]);
      return true;
    } catch (error) {
      console.error('Redis trivia claim failed', error);
    }
  }

  if (getMemoryRecent(category).some((existing) => normalizeTriviaQuestionText(existing) === fingerprint)) {
    return false;
  }
  if (answerFingerprints.some((answer) => getMemoryAnswers(category).has(answer))) {
    return false;
  }

  getMemoryRecent(category).unshift(trimmed);
  globalStore.__elroyRecentTrivia![category] = getMemoryRecent(category).slice(0, MAX_RECENT);
  for (const answer of answerFingerprints) {
    getMemoryAnswers(category).add(answer);
  }
  return true;
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
