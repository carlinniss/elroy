import { hasRedisStorage, redisCommand, redisPipeline } from '@/lib/redis-rest';

import type { TriviaCategory } from '@/lib/cannabis-trivia';

export type TriviaLeader = {
  username: string;
  score: number;
};

export type TriviaLeaders = {
  cannabis: TriviaLeader | null;
  freaky: TriviaLeader | null;
  storage: 'redis' | 'memory';
};

const SCORE_KEY: Record<TriviaCategory, string> = {
  cannabis: 'elroy:trivia:scores:cannabis',
  freaky: 'elroy:trivia:scores:freaky',
};

const DISPLAY_NAMES_KEY = 'elroy:trivia:display-names';

type MemoryScores = Record<TriviaCategory, Map<string, { score: number; username: string }>>;

const globalStore = globalThis as typeof globalThis & { __elroyTriviaScores?: MemoryScores };

function getMemoryScores(): MemoryScores {
  if (!globalStore.__elroyTriviaScores) {
    globalStore.__elroyTriviaScores = {
      cannabis: new Map(),
      freaky: new Map(),
    };
  }
  return globalStore.__elroyTriviaScores;
}

function normalizeLogin(username: string) {
  return username.trim().toLowerCase();
}

function getMemoryLeader(category: TriviaCategory): TriviaLeader | null {
  const board = getMemoryScores()[category];
  let best: TriviaLeader | null = null;
  for (const entry of board.values()) {
    if (!best || entry.score > best.score) {
      best = { username: entry.username, score: entry.score };
    }
  }
  return best;
}

function incrementMemoryScore(username: string, category: TriviaCategory): number {
  const login = normalizeLogin(username);
  const board = getMemoryScores()[category];
  const current = board.get(login) ?? { score: 0, username };
  const next = { score: current.score + 1, username };
  board.set(login, next);
  return next.score;
}

async function getRedisDisplayName(login: string): Promise<string | null> {
  const name = await redisCommand(['HGET', DISPLAY_NAMES_KEY, login]);
  return typeof name === 'string' && name.length > 0 ? name : null;
}

async function getRedisLeader(category: TriviaCategory): Promise<TriviaLeader | null> {
  const raw = await redisCommand(['ZREVRANGE', SCORE_KEY[category], '0', '0', 'WITHSCORES']);
  if (!Array.isArray(raw) || raw.length < 2) return null;

  const login = String(raw[0]);
  const score = Number.parseInt(String(raw[1]), 10);
  if (!login || !Number.isFinite(score) || score <= 0) return null;

  const displayName = await getRedisDisplayName(login);
  return { username: displayName ?? login, score };
}

export function getTriviaScoreStorageMode(): 'redis' | 'memory' {
  return hasRedisStorage() ? 'redis' : 'memory';
}

export async function incrementTriviaWin(
  username: string,
  category: TriviaCategory,
): Promise<number> {
  const login = normalizeLogin(username);
  if (!login) return 0;

  if (hasRedisStorage()) {
    try {
      const results = await redisPipeline([
        ['ZINCRBY', SCORE_KEY[category], '1', login],
        ['HSET', DISPLAY_NAMES_KEY, login, username.trim()],
      ]);
      const score = Number.parseInt(String(results?.[0] ?? '0'), 10);
      return Number.isFinite(score) ? score : incrementMemoryScore(username, category);
    } catch (error) {
      console.error('Redis trivia score write failed, using memory fallback', error);
    }
  }

  return incrementMemoryScore(username, category);
}

export async function getTriviaLeaders(): Promise<TriviaLeaders> {
  const storage = getTriviaScoreStorageMode();

  if (hasRedisStorage()) {
    try {
      const [cannabis, freaky] = await Promise.all([
        getRedisLeader('cannabis'),
        getRedisLeader('freaky'),
      ]);
      return { cannabis, freaky, storage };
    } catch (error) {
      console.error('Redis trivia leader read failed, using memory fallback', error);
    }
  }

  return {
    cannabis: getMemoryLeader('cannabis'),
    freaky: getMemoryLeader('freaky'),
    storage: 'memory',
  };
}

export function buildTriviaLeaderRoastPrompt(leaders: TriviaLeaders): string | null {
  const lines: string[] = [];
  if (leaders.cannabis) {
    lines.push(
      `Cannabis trivia leader: ${leaders.cannabis.username} with ${leaders.cannabis.score} win${leaders.cannabis.score === 1 ? '' : 's'}`,
    );
  }
  if (leaders.freaky) {
    lines.push(
      `Freaky sex trivia leader: ${leaders.freaky.username} with ${leaders.freaky.score} win${leaders.freaky.score === 1 ? '' : 's'}`,
    );
  }
  if (!lines.length) return null;

  return `Before a new trivia round, shout out and clown the current trivia leaderboard in Twitch chat. ${lines.join('. ')}. Roast them in Elroy OG style — 2 short funny sentences max, playful crusty humor, @ them by username.`;
}
