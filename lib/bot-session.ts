import { hasRedisStorage, redisCommand } from '@/lib/redis-rest';

const SESSION_KEY = 'elroy:bot:active-session';
const SESSION_TTL_SECONDS = 25;

export type BotSessionRecord = {
  instanceId: string;
  lastHeartbeat: number;
};

export function parseBotSessionRecord(raw: unknown): BotSessionRecord | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as BotSessionRecord;
    if (typeof parsed.instanceId === 'string' && typeof parsed.lastHeartbeat === 'number') {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export async function claimBotSession(instanceId: string): Promise<'claimed' | 'blocked' | 'unavailable'> {
  if (!instanceId) return 'unavailable';
  if (!hasRedisStorage()) return 'claimed';

  const payload = JSON.stringify({ instanceId, lastHeartbeat: Date.now() });

  try {
    const nx = await redisCommand(['SET', SESSION_KEY, payload, 'EX', SESSION_TTL_SECONDS, 'NX']);
    if (nx === 'OK') return 'claimed';

    const existing = parseBotSessionRecord(await redisCommand(['GET', SESSION_KEY]));
    if (!existing) return claimBotSession(instanceId);
    if (existing.instanceId === instanceId) {
      await redisCommand(['SET', SESSION_KEY, payload, 'EX', SESSION_TTL_SECONDS]);
      return 'claimed';
    }
    return 'blocked';
  } catch (error) {
    console.error('Bot session claim failed', error);
    return 'unavailable';
  }
}

export async function heartbeatBotSession(instanceId: string): Promise<'ok' | 'lost' | 'unavailable'> {
  if (!instanceId) return 'unavailable';
  if (!hasRedisStorage()) return 'ok';

  try {
    const existing = parseBotSessionRecord(await redisCommand(['GET', SESSION_KEY]));
    if (!existing) {
      return (await claimBotSession(instanceId)) === 'claimed' ? 'ok' : 'lost';
    }
    if (existing.instanceId !== instanceId) return 'lost';

    const payload = JSON.stringify({ instanceId, lastHeartbeat: Date.now() });
    await redisCommand(['SET', SESSION_KEY, payload, 'EX', SESSION_TTL_SECONDS]);
    return 'ok';
  } catch (error) {
    console.error('Bot session heartbeat failed', error);
    return 'unavailable';
  }
}

export async function isActiveBotSession(instanceId: string): Promise<boolean> {
  if (!instanceId) return false;
  if (!hasRedisStorage()) return true;

  try {
    const existing = parseBotSessionRecord(await redisCommand(['GET', SESSION_KEY]));
    return existing?.instanceId === instanceId;
  } catch (error) {
    console.error('Bot session verification failed', error);
    return false;
  }
}

export async function releaseBotSession(instanceId: string): Promise<void> {
  if (!instanceId || !hasRedisStorage()) return;

  try {
    const existing = parseBotSessionRecord(await redisCommand(['GET', SESSION_KEY]));
    if (existing?.instanceId === instanceId) {
      await redisCommand(['DEL', SESSION_KEY]);
    }
  } catch (error) {
    console.error('Bot session release failed', error);
  }
}
