type RedisResult = { result?: unknown; error?: string };

function getRedisRestConfig() {
  const url = process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

export function hasRedisStorage() {
  return getRedisRestConfig() !== null;
}

export async function redisCommand(command: unknown[]): Promise<unknown | null> {
  const config = getRedisRestConfig();
  if (!config) return null;

  const res = await fetch(config.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}` },
    body: JSON.stringify(command),
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Redis ${res.status}: ${body}`);
  }

  const data = (await res.json()) as RedisResult;
  if (data.error) throw new Error(data.error);
  return data.result ?? null;
}

export async function redisPipeline(commands: unknown[][]): Promise<unknown[] | null> {
  const config = getRedisRestConfig();
  if (!config) return null;

  const res = await fetch(config.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}` },
    body: JSON.stringify(commands),
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Redis pipeline ${res.status}: ${body}`);
  }

  const data = (await res.json()) as unknown;
  if (Array.isArray(data)) {
    return data.map((entry) => (entry as RedisResult).result);
  }
  return null;
}
