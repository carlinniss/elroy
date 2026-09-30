/**
 * Per-day log of every song that played on stream (requests and your own music).
 * Recorded server-side from the listener's 5s tick, so it works even if OBS reloads.
 * Stored in Redis for 60 days; download with scripts/songs.sh.
 */
import { hasRedisStorage, redisPipeline, redisCommand } from '@/lib/redis-rest';
import type { SpotifyNowPlayingSnapshot } from '@/lib/spotify';
import { transcriptDate } from '@/lib/transcript';

const KEY_PREFIX = 'elroy:songs:';
const LAST_KEY = 'elroy:songs:last';
const TTL_SECONDS = 60 * 24 * 60 * 60;
const memory = new Map<string, string[]>();
let memoryLast = '';

function clock(at: Date) {
  const tz = process.env.ELROY_TIMEZONE?.trim() || 'America/New_York';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(at);
  } catch {
    return at.toISOString().slice(11, 16);
  }
}

export function formatSongLine(
  at: Date,
  track: { name: string; artists: string[]; trackUrl: string | null },
  requestedBy: string | null,
): string {
  const who = requestedBy ? ` (requested by @${requestedBy.replace(/^@/, '')})` : '';
  const link = track.trackUrl ? ` ${track.trackUrl}` : '';
  return `[${clock(at)}] ${track.name} — ${track.artists.join(', ')}${who}${link}`;
}

/** Logs the track once when it changes. Safe to call every few seconds from several places. */
export async function recordSongPlay(snapshot: SpotifyNowPlayingSnapshot, requestedBy: string | null): Promise<void> {
  const track = snapshot.track;
  if (!snapshot.connected || !snapshot.playing || !track?.id) return;
  const now = new Date();
  const line = formatSongLine(now, track, requestedBy);
  const key = `${KEY_PREFIX}${transcriptDate(now)}`;
  try {
    if (hasRedisStorage()) {
      // Atomic swap: only the caller that sees a different previous id writes the line.
      const previous = await redisCommand(['SET', LAST_KEY, track.id, 'EX', '43200', 'GET']);
      if (previous === track.id) return;
      await redisPipeline([['RPUSH', key, line], ['EXPIRE', key, String(TTL_SECONDS)]]);
      return;
    }
  } catch (error) {
    console.warn('Song history write failed', error);
    return;
  }
  if (memoryLast === track.id) return;
  memoryLast = track.id;
  memory.set(key, [...(memory.get(key) ?? []), line]);
}

export async function readSongHistory(date = transcriptDate()): Promise<string[]> {
  const key = `${KEY_PREFIX}${date}`;
  if (hasRedisStorage()) {
    const lines = await redisCommand(['LRANGE', key, '0', '-1']);
    return Array.isArray(lines) ? lines.map(String) : [];
  }
  return memory.get(key) ?? [];
}
