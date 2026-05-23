import { hasRedisStorage, redisCommand, redisPipeline } from '@/lib/redis-rest';

export type PowerUpRedemptionRecord = {
  id: string;
  userLogin: string;
  userName: string;
  rewardId: string;
  rewardTitle: string;
  redeemedAt: string;
  receivedAt: number;
  source: 'custom_power_up' | 'bits_use';
};

const LIST_KEY = 'elroy:powerup-redemptions';
const SEEN_KEY_PREFIX = 'elroy:powerup-seen:';
const MAX = 100;
const TTL_SECONDS = 86_400;
const LOOKBACK_BUFFER_MS = 15_000;

type Store = {
  redemptions: PowerUpRedemptionRecord[];
  seenIds: Set<string>;
};

const globalStore = globalThis as typeof globalThis & { __elroyPowerUpRedemptions?: Store };

function getMemoryStore(): Store {
  if (!globalStore.__elroyPowerUpRedemptions) {
    globalStore.__elroyPowerUpRedemptions = { redemptions: [], seenIds: new Set() };
  }
  return globalStore.__elroyPowerUpRedemptions;
}

function recordInMemory(record: PowerUpRedemptionRecord): boolean {
  const store = getMemoryStore();
  if (store.seenIds.has(record.id)) return false;
  store.seenIds.add(record.id);
  store.redemptions.push(record);
  if (store.redemptions.length > MAX) {
    const removed = store.redemptions.splice(0, store.redemptions.length - MAX);
    for (const r of removed) store.seenIds.delete(r.id);
  }
  return true;
}

function getFromMemorySince(sinceMs: number): PowerUpRedemptionRecord[] {
  return getMemoryStore().redemptions.filter((r) => r.receivedAt > sinceMs);
}

async function recordInRedis(record: PowerUpRedemptionRecord): Promise<boolean> {
  const seenKey = `${SEEN_KEY_PREFIX}${record.id}`;
  const payload = JSON.stringify(record);

  const results = await redisPipeline([
    ['SET', seenKey, '1', 'EX', TTL_SECONDS, 'NX'],
    ['LPUSH', LIST_KEY, payload],
    ['LTRIM', LIST_KEY, '0', MAX - 1],
    ['EXPIRE', LIST_KEY, TTL_SECONDS],
  ]);

  if (!results) return recordInMemory(record);
  return results[0] === 'OK';
}

async function listFromRedis(): Promise<PowerUpRedemptionRecord[]> {
  const raw = await redisCommand(['LRANGE', LIST_KEY, '0', MAX - 1]);
  if (!Array.isArray(raw)) return [];

  const records: PowerUpRedemptionRecord[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    try {
      records.push(JSON.parse(entry) as PowerUpRedemptionRecord);
    } catch {
    }
  }
  return records;
}

export function getRedemptionStorageMode(): 'redis' | 'memory' {
  return hasRedisStorage() ? 'redis' : 'memory';
}

export async function recordPowerUpRedemption(record: PowerUpRedemptionRecord): Promise<boolean> {
  if (hasRedisStorage()) {
    try {
      return await recordInRedis(record);
    } catch (error) {
      console.error('Redis redemption write failed, using memory fallback', error);
    }
  }
  return recordInMemory(record);
}

export async function getPowerUpRedemptionsSince(sinceMs: number): Promise<PowerUpRedemptionRecord[]> {
  const sinceWithBuffer = Math.max(0, sinceMs - LOOKBACK_BUFFER_MS);

  if (hasRedisStorage()) {
    try {
      const records = await listFromRedis();
      return records.filter((r) => r.receivedAt > sinceWithBuffer);
    } catch (error) {
      console.error('Redis redemption read failed, using memory fallback', error);
    }
  }

  return getFromMemorySince(sinceWithBuffer);
}

export type ShutElroyRedemptionInput = {
  id: string;
  userLogin: string;
  userName: string;
  rewardId: string;
  rewardTitle: string;
  redeemedAt: string;
  source: PowerUpRedemptionRecord['source'];
};

export async function recordShutElroyRedemption(
  input: ShutElroyRedemptionInput,
  shutElroyPowerUpId: string | null,
): Promise<boolean> {
  if (shutElroyPowerUpId && input.rewardId && input.rewardId !== shutElroyPowerUpId) {
    return false;
  }

  const record: PowerUpRedemptionRecord = {
    ...input,
    receivedAt: Date.now(),
  };

  const recorded = await recordPowerUpRedemption(record);
  if (recorded) {
    console.info('Shut Elroy redemption recorded', {
      id: record.id,
      user: record.userLogin,
      rewardId: record.rewardId,
      source: record.source,
      storage: getRedemptionStorageMode(),
    });
  }
  return recorded;
}
