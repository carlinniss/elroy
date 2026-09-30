/**
 * Per-day stream transcript: what the host says (mic transcripts) and everything Elroy posts.
 * Stored in Redis (kept 60 days) so it survives restarts; download with scripts/transcript.sh.
 */
import { hasRedisStorage, redisPipeline, redisCommand } from '@/lib/redis-rest';
import { getStreamerDisplayName } from '@/lib/streamer-name';

const KEY_PREFIX = 'elroy:transcript:';
const TTL_SECONDS = 60 * 24 * 60 * 60;
const memory = new Map<string, string[]>();

function timeZone() {
  return process.env.ELROY_TIMEZONE?.trim() || 'America/New_York';
}

/** "2026-09-29" in the channel's timezone. */
export function transcriptDate(at = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function clock(at: Date) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(), hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(at);
  } catch {
    return at.toISOString().slice(11, 19);
  }
}

export async function appendTranscript(speaker: 'host' | 'elroy', text: string): Promise<void> {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return;
  const now = new Date();
  const who = speaker === 'host' ? getStreamerDisplayName() : 'Elroy';
  const line = `[${clock(now)}] ${who}: ${clean}`;
  const key = `${KEY_PREFIX}${transcriptDate(now)}`;
  try {
    if (hasRedisStorage()) {
      await redisPipeline([['RPUSH', key, line], ['EXPIRE', key, String(TTL_SECONDS)]]);
      return;
    }
  } catch (error) {
    console.warn('Transcript write failed', error);
  }
  memory.set(key, [...(memory.get(key) ?? []), line]);
}

export async function readTranscript(date = transcriptDate()): Promise<string[]> {
  const key = `${KEY_PREFIX}${date}`;
  if (hasRedisStorage()) {
    const lines = await redisCommand(['LRANGE', key, '0', '-1']);
    return Array.isArray(lines) ? lines.map(String) : [];
  }
  return memory.get(key) ?? [];
}
