import { hasRedisStorage, redisCommand, redisPipeline } from '@/lib/redis-rest';

import type { TriviaCategory } from '@/lib/cannabis-trivia';

export type TriviaLeader = {
  username: string;
  score: number;
};

export const TRIVIA_LEADERBOARD_SIZE = 3;

export type TriviaLeaders = {
  cannabis: TriviaLeader[];
  freaky: TriviaLeader[];
  music90s: TriviaLeader[];
  storage: 'redis' | 'memory';
};

const SCORE_KEY: Record<TriviaCategory, string> = {
  cannabis: 'elroy:trivia:scores:cannabis',
  freaky: 'elroy:trivia:scores:freaky',
  music90s: 'elroy:trivia:scores:music90s',
};

const DISPLAY_NAMES_KEY = 'elroy:trivia:display-names';

/** Leftover from deploy smoke tests — excluded from leaderboards and cleaned from Redis. */
const SANDBOX_LOGINS = new Set(['testuser']);

type MemoryScores = Record<TriviaCategory, Map<string, { score: number; username: string }>>;

const globalStore = globalThis as typeof globalThis & { __elroyTriviaScores?: MemoryScores };

function getMemoryScores(): MemoryScores {
  if (!globalStore.__elroyTriviaScores) {
    globalStore.__elroyTriviaScores = {
      cannabis: new Map(),
      freaky: new Map(),
      music90s: new Map(),
    };
  }
  return globalStore.__elroyTriviaScores;
}

function normalizeLogin(username: string) {
  return username.trim().toLowerCase();
}

function getMemoryLeaders(category: TriviaCategory, limit = TRIVIA_LEADERBOARD_SIZE): TriviaLeader[] {
  const board = getMemoryScores()[category];
  return [...board.entries()]
    .filter(([login]) => !SANDBOX_LOGINS.has(login))
    .map(([, entry]) => ({ username: entry.username, score: entry.score }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function incrementMemoryScore(username: string, category: TriviaCategory, points: number): number {
  const login = normalizeLogin(username);
  const board = getMemoryScores()[category];
  const current = board.get(login) ?? { score: 0, username };
  const next = { score: current.score + points, username };
  board.set(login, next);
  return next.score;
}

async function getRedisDisplayName(login: string): Promise<string | null> {
  const name = await redisCommand(['HGET', DISPLAY_NAMES_KEY, login]);
  return typeof name === 'string' && name.length > 0 ? name : null;
}

async function getRedisLeaders(
  category: TriviaCategory,
  limit = TRIVIA_LEADERBOARD_SIZE,
): Promise<TriviaLeader[]> {
  const rows = await redisCommand(['ZREVRANGE', SCORE_KEY[category], '0', String(limit * 3), 'WITHSCORES']);
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const leaders: TriviaLeader[] = [];
  for (let i = 0; i < rows.length; i += 2) {
    const login = String(rows[i] ?? '');
    if (!login || SANDBOX_LOGINS.has(login.toLowerCase())) continue;

    const score = Number.parseFloat(String(rows[i + 1] ?? ''));
    if (!Number.isFinite(score) || score <= 0) continue;

    const displayName = await getRedisDisplayName(login);
    leaders.push({ username: displayName ?? login, score });
    if (leaders.length >= limit) break;
  }

  return leaders;
}

export async function removeTriviaPlayer(username: string): Promise<boolean> {
  const login = normalizeLogin(username);
  if (!login) return false;

  if (hasRedisStorage()) {
    try {
      await redisPipeline([
        ['ZREM', SCORE_KEY.cannabis, login],
        ['ZREM', SCORE_KEY.freaky, login],
        ['ZREM', SCORE_KEY.music90s, login],
        ['HDEL', DISPLAY_NAMES_KEY, login],
      ]);
      return true;
    } catch (error) {
      console.error('Redis trivia score delete failed', error);
      return false;
    }
  }

  getMemoryScores().cannabis.delete(login);
  getMemoryScores().freaky.delete(login);
  getMemoryScores().music90s.delete(login);
  return true;
}

async function cleanupSandboxScores() {
  await Promise.all([...SANDBOX_LOGINS].map((login) => removeTriviaPlayer(login)));
}

export function getTriviaScoreStorageMode(): 'redis' | 'memory' {
  return hasRedisStorage() ? 'redis' : 'memory';
}

export async function incrementTriviaWin(
  username: string,
  category: TriviaCategory,
  points = 1,
): Promise<number> {
  const login = normalizeLogin(username);
  if (!login) return 0;
  const safePoints = Math.max(1, Math.floor(points));

  if (hasRedisStorage()) {
    try {
      const scoreRaw = await redisCommand(['ZINCRBY', SCORE_KEY[category], String(safePoints), login]);
      const score = Number.parseFloat(String(scoreRaw ?? ''));
      if (!Number.isFinite(score) || score <= 0) {
        return incrementMemoryScore(username, category, safePoints);
      }
      await redisCommand(['HSET', DISPLAY_NAMES_KEY, login, username.trim()]);
      return score;
    } catch (error) {
      console.error('Redis trivia score write failed, using memory fallback', error);
    }
  }

  return incrementMemoryScore(username, category, safePoints);
}

export async function getTriviaLeaders(): Promise<TriviaLeaders> {
  const storage = getTriviaScoreStorageMode();

  if (hasRedisStorage()) {
    try {
      await cleanupSandboxScores();
      const [cannabis, freaky, music90s] = await Promise.all([
        getRedisLeaders('cannabis'),
        getRedisLeaders('freaky'),
        getRedisLeaders('music90s'),
      ]);
      return { cannabis, freaky, music90s, storage };
    } catch (error) {
      console.error('Redis trivia leader read failed, using memory fallback', error);
    }
  }

  return {
    cannabis: getMemoryLeaders('cannabis'),
    freaky: getMemoryLeaders('freaky'),
    music90s: getMemoryLeaders('music90s'),
    storage: 'memory',
  };
}

function formatLeaderList(leaders: TriviaLeader[]): string {
  return leaders
    .map((entry, index) => `${index + 1}. ${entry.username} (${entry.score})`)
    .join(', ');
}

export function buildTriviaLeaderRoastPrompt(leaders: TriviaLeaders): string | null {
  const lines: string[] = [];
  if (leaders.cannabis.length) {
    lines.push(`Cannabis trivia top 3: ${formatLeaderList(leaders.cannabis)}`);
  }
  if (leaders.freaky.length) {
    lines.push(`Freaky sex trivia top 3: ${formatLeaderList(leaders.freaky)}`);
  }
  if (leaders.music90s.length) {
    lines.push(`90s music trivia top 3: ${formatLeaderList(leaders.music90s)}`);
  }
  if (!lines.length) return null;

  return `Before a new trivia round, shout out and clown the current trivia leaderboard in Twitch chat. ${lines.join('. ')}. Roast the top players in Elroy OG style — playful crusty humor, @ them by username. Take a few sentences and really sell the bit.`;
}

export function formatTriviaLeaderboardChatMessage(leaders: TriviaLeaders): string {
  const parts: string[] = [];
  if (leaders.cannabis.length) {
    parts.push(`🌿 ${formatLeaderList(leaders.cannabis)}`);
  }
  if (leaders.freaky.length) {
    parts.push(`🔥 ${formatLeaderList(leaders.freaky)}`);
  }
  if (leaders.music90s.length) {
    parts.push(`🎵 ${formatLeaderList(leaders.music90s)}`);
  }
  if (!parts.length) {
    return '🏆 No trivia wins yet — first correct answer during trivia wins!';
  }
  return `🏆 Trivia top 3: ${parts.join(' | ')}`;
}
