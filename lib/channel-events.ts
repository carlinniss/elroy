import { hasRedisStorage, redisCommand, redisPipeline } from '@/lib/redis-rest';

export type ChannelEventType =
  | 'raid'
  | 'follow'
  | 'subscribe'
  | 'subscription_gift'
  | 'subscription_message'
  | 'cheer'
  | 'channel_update'
  | 'poll_end';

export type ChannelEventRecord = {
  id: string;
  type: ChannelEventType;
  receivedAt: number;
  payload: Record<string, unknown>;
};

const LIST_KEY = 'elroy:channel-events';
const SEEN_KEY_PREFIX = 'elroy:channel-event-seen:';
const MAX = 120;
const TTL_SECONDS = 86_400;
const LOOKBACK_BUFFER_MS = 15_000;

type Store = {
  events: ChannelEventRecord[];
  seenIds: Set<string>;
};

const globalStore = globalThis as typeof globalThis & { __elroyChannelEvents?: Store };

function getMemoryStore(): Store {
  if (!globalStore.__elroyChannelEvents) {
    globalStore.__elroyChannelEvents = { events: [], seenIds: new Set() };
  }
  return globalStore.__elroyChannelEvents;
}

function recordInMemory(record: ChannelEventRecord): boolean {
  const store = getMemoryStore();
  if (store.seenIds.has(record.id)) return false;
  store.seenIds.add(record.id);
  store.events.push(record);
  if (store.events.length > MAX) {
    const removed = store.events.splice(0, store.events.length - MAX);
    for (const event of removed) store.seenIds.delete(event.id);
  }
  return true;
}

function getFromMemorySince(sinceMs: number): ChannelEventRecord[] {
  return getMemoryStore().events.filter((event) => event.receivedAt > sinceMs);
}

async function recordInRedis(record: ChannelEventRecord): Promise<boolean> {
  const seenKey = `${SEEN_KEY_PREFIX}${record.id}`;
  const payload = JSON.stringify(record);

  const inserted = await redisCommand(['SET', seenKey, '1', 'EX', TTL_SECONDS, 'NX']);
  if (inserted !== 'OK') return false;

  const results = await redisPipeline([
    ['LPUSH', LIST_KEY, payload],
    ['LTRIM', LIST_KEY, '0', MAX - 1],
    ['EXPIRE', LIST_KEY, TTL_SECONDS],
  ]);

  if (!results) return recordInMemory(record);
  return true;
}

async function listFromRedis(): Promise<ChannelEventRecord[]> {
  const raw = await redisCommand(['LRANGE', LIST_KEY, '0', MAX - 1]);
  if (!Array.isArray(raw)) return [];

  const records: ChannelEventRecord[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    try {
      records.push(JSON.parse(entry) as ChannelEventRecord);
    } catch {
      /* ignore */
    }
  }
  return records;
}

export async function recordChannelEvent(
  id: string,
  type: ChannelEventType,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const record: ChannelEventRecord = {
    id,
    type,
    payload,
    receivedAt: Date.now(),
  };

  if (hasRedisStorage()) {
    try {
      return await recordInRedis(record);
    } catch (error) {
      console.error('Redis channel event write failed, using memory fallback', error);
    }
  }

  return recordInMemory(record);
}

export async function getChannelEventsSince(sinceMs: number): Promise<ChannelEventRecord[]> {
  const sinceWithBuffer = Math.max(0, sinceMs - LOOKBACK_BUFFER_MS);

  if (hasRedisStorage()) {
    try {
      const records = await listFromRedis();
      return records
        .filter((event) => event.receivedAt > sinceWithBuffer)
        .sort((a, b) => a.receivedAt - b.receivedAt);
    } catch (error) {
      console.error('Redis channel event read failed, using memory fallback', error);
    }
  }

  return getFromMemorySince(sinceWithBuffer).sort((a, b) => a.receivedAt - b.receivedAt);
}
