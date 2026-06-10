import type { TriviaCategory } from '@/lib/cannabis-trivia';
import { hasRedisStorage, redisCommand } from '@/lib/redis-rest';

const PROFILE_KEY_PREFIX = 'elroy:user-memory:';
const MAX_NOTES = 10;
const MAX_RECENT_TO_ELROY = 4;

export type UserMemoryProfile = {
  login: string;
  displayName: string;
  firstSeenAt: number;
  lastSeenAt: number;
  mentionCount: number;
  followedAt?: string;
  triviaWins: { cannabis: number; freaky: number; music90s: number };
  notes: string[];
  recentToElroy: string[];
};

export type UserMemoryEvent =
  | { type: 'mention'; message?: string }
  | { type: 'trivia_win'; category: TriviaCategory; totalWins: number }
  | { type: 'sub'; tier?: string; months?: number; streakMonths?: number; isGift?: boolean }
  | { type: 'bits'; amount?: number }
  | { type: 'follow'; followedAt?: string }
  | { type: 'note'; text: string };

const globalStore = globalThis as typeof globalThis & {
  __elroyUserMemory?: Map<string, UserMemoryProfile>;
};

function memoryStore() {
  if (!globalStore.__elroyUserMemory) {
    globalStore.__elroyUserMemory = new Map();
  }
  return globalStore.__elroyUserMemory;
}

export function normalizeUserLogin(username: string) {
  return username.trim().toLowerCase();
}

function profileKey(login: string) {
  return `${PROFILE_KEY_PREFIX}${login}`;
}

function emptyProfile(login: string, displayName: string): UserMemoryProfile {
  const now = Date.now();
  return {
    login,
    displayName: displayName.trim() || login,
    firstSeenAt: now,
    lastSeenAt: now,
    mentionCount: 0,
    triviaWins: { cannabis: 0, freaky: 0, music90s: 0 },
    notes: [],
    recentToElroy: [],
  };
}

function pushUniqueNote(notes: string[], note: string) {
  const trimmed = note.trim();
  if (!trimmed) return notes;
  const next = notes.filter((entry) => entry !== trimmed);
  next.unshift(trimmed);
  return next.slice(0, MAX_NOTES);
}

function pushRecentMessage(recent: string[], message: string) {
  const trimmed = message.trim().slice(0, 160);
  if (!trimmed) return recent;
  const next = recent.filter((entry) => entry !== trimmed);
  next.unshift(trimmed);
  return next.slice(0, MAX_RECENT_TO_ELROY);
}

function formatFollowTenureFromIso(followedAt: string) {
  const ms = Date.now() - new Date(followedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'recently';
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return 'less than a day';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'}`;
}

function applyEvent(profile: UserMemoryProfile, event: UserMemoryEvent): UserMemoryProfile {
  const now = Date.now();
  const next: UserMemoryProfile = {
    ...profile,
    lastSeenAt: now,
  };

  switch (event.type) {
    case 'mention':
      next.mentionCount += 1;
      if (event.message) {
        next.recentToElroy = pushRecentMessage(next.recentToElroy, event.message);
        next.notes = pushUniqueNote(
          next.notes,
          `Mentioned me in chat: "${event.message.slice(0, 100)}"`,
        );
      }
      break;
    case 'trivia_win':
      next.triviaWins = {
        ...next.triviaWins,
        [event.category]: Math.max(next.triviaWins[event.category] ?? 0, event.totalWins),
      };
      next.notes = pushUniqueNote(
        next.notes,
        `Won ${event.category} trivia (${event.totalWins} win${event.totalWins === 1 ? '' : 's'} in that category)`,
      );
      break;
    case 'sub': {
      const tierLabel = event.tier === '3000' ? 'Tier 3' : event.tier === '2000' ? 'Tier 2' : 'sub';
      const monthLine = event.months && event.months > 1 ? `${event.months}-month ` : '';
      const streakLine = event.streakMonths && event.streakMonths > 1 ? ` (${event.streakMonths} streak)` : '';
      const giftLine = event.isGift ? ' (gift sub)' : '';
      next.notes = pushUniqueNote(next.notes, `Supported with a ${monthLine}${tierLabel}${giftLine}${streakLine}.`);
      break;
    }
    case 'bits':
      next.notes = pushUniqueNote(
        next.notes,
        event.amount && event.amount > 0
          ? `Dropped ${event.amount} bits on the stream.`
          : 'Cheered with bits.',
      );
      break;
    case 'follow':
      if (event.followedAt) next.followedAt = event.followedAt;
      next.notes = pushUniqueNote(
        next.notes,
        event.followedAt
          ? `Followed the channel (${formatFollowTenureFromIso(event.followedAt)}).`
          : 'Followed the channel.',
      );
      break;
    case 'note':
      next.notes = pushUniqueNote(next.notes, event.text);
      break;
    default:
      break;
  }

  return next;
}

async function loadProfile(login: string): Promise<UserMemoryProfile | null> {
  if (hasRedisStorage()) {
    try {
      const raw = await redisCommand(['GET', profileKey(login)]);
      if (!raw || typeof raw !== 'string') return null;
      return JSON.parse(raw) as UserMemoryProfile;
    } catch (error) {
      console.error('Redis user memory read failed', error);
    }
  }

  return memoryStore().get(login) ?? null;
}

async function saveProfile(profile: UserMemoryProfile): Promise<void> {
  const payload = JSON.stringify(profile);

  if (hasRedisStorage()) {
    try {
      await redisCommand(['SET', profileKey(profile.login), payload]);
      return;
    } catch (error) {
      console.error('Redis user memory write failed', error);
    }
  }

  memoryStore().set(profile.login, profile);
}

export async function recordUserMemory(
  username: string,
  displayName: string | undefined,
  event: UserMemoryEvent,
): Promise<UserMemoryProfile | null> {
  const login = normalizeUserLogin(username);
  if (!login) return null;

  const name = displayName?.trim() || username.trim() || login;
  const existing = await loadProfile(login);
  const base = existing ?? emptyProfile(login, name);
  base.displayName = name;
  const updated = applyEvent(base, event);
  await saveProfile(updated);
  return updated;
}

export async function getUserMemoryProfile(username: string): Promise<UserMemoryProfile | null> {
  const login = normalizeUserLogin(username);
  if (!login) return null;
  return loadProfile(login);
}

export function profileHasMemory(profile: UserMemoryProfile | null): boolean {
  if (!profile) return false;
  if (profile.mentionCount > 0) return true;
  if ((profile.triviaWins.cannabis ?? 0) > 0 || (profile.triviaWins.freaky ?? 0) > 0 || (profile.triviaWins.music90s ?? 0) > 0) return true;
  if (profile.notes.length > 0) return true;
  if (profile.recentToElroy.length > 0) return true;
  return false;
}

export function formatProfileFacts(profile: UserMemoryProfile): string {
  const lines: string[] = [
    `- Display name: ${profile.displayName}`,
    `- First seen in chat: ${new Date(profile.firstSeenAt).toISOString()}`,
    `- Last seen in chat: ${new Date(profile.lastSeenAt).toISOString()}`,
    `- Times they engaged me directly: ${profile.mentionCount}`,
    `- Trivia wins logged: cannabis ${profile.triviaWins.cannabis ?? 0}, freaky ${profile.triviaWins.freaky ?? 0}, music90s ${profile.triviaWins.music90s ?? 0}`,
  ];

  if (profile.followedAt) {
    lines.push(`- Twitch follow: since ${profile.followedAt} (${formatFollowTenureFromIso(profile.followedAt)} ago)`);
  }

  if (profile.recentToElroy.length) {
    lines.push('- Recent things they said to me:');
    for (const message of profile.recentToElroy) {
      lines.push(`  - "${message}"`);
    }
  }

  if (profile.notes.length) {
    lines.push('- Notes:');
    for (const note of profile.notes) {
      lines.push(`  - ${note}`);
    }
  }

  return lines.join('\n');
}

export function buildAboutMePrompt(profile: UserMemoryProfile, followTenure?: string): string {
  const followLine = followTenure
    ? `\nIf relevant, you may mention they've been following for about ${followTenure}.`
    : profile.followedAt
      ? `\nIf relevant, mention how long they've been following based on the facts below.`
      : '';
  return `A viewer named ${profile.displayName} (login: ${profile.login}) just used !aboutme in Twitch chat.

Here is everything you currently know about them. Only reference facts from this list — do not invent details:
${formatProfileFacts(profile)}${followLine}

Tell them what you remember in your Elroy OG voice — direct, crusty, playful, like you've been watching them in chat. If the file is thin, be honest you're still learning them but mention what you do have. Chat-only reply, 3-4 sentences, under 480 characters.`;
}

export function buildAboutMeUnknownPrompt(username: string, followTenure?: string): string {
  const followLine = followTenure
    ? ` They have been following for about ${followTenure}, so mention that even though your file is thin.`
    : '';
  return `A viewer named ${username} used !aboutme but you have almost no file on them yet.${followLine}

Tell them honestly you are still learning them — they should mention you, win trivia, sub, or run it up in chat so you can build a profile. Elroy OG voice, playful, 2-3 sentences, under 320 characters.`;
}
