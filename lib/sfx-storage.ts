import fs from 'fs/promises';
import path from 'path';
import { hasRedisStorage, redisCommand } from '@/lib/redis-rest';

const SFX_DIR = path.join(process.cwd(), 'public', 'sounds', 'elroy');
const redisKey = (id: string) => `elroy:sfx:${id}`;

export type SfxCacheSource = 'file' | 'redis' | 'generated';

export async function readCachedSfx(id: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(SFX_DIR, `${id}.mp3`));
  } catch {
  }

  if (!hasRedisStorage()) return null;

  try {
    const encoded = await redisCommand(['GET', redisKey(id)]);
    if (typeof encoded === 'string' && encoded.length > 0) {
      return Buffer.from(encoded, 'base64');
    }
  } catch (error) {
    console.warn(`SFX redis read failed (${id})`, error);
  }

  return null;
}

export async function writeCachedSfx(id: string, audio: Buffer): Promise<SfxCacheSource[]> {
  const saved: SfxCacheSource[] = [];

  if (process.env.NODE_ENV !== 'production') {
    try {
      await fs.mkdir(SFX_DIR, { recursive: true });
      await fs.writeFile(path.join(SFX_DIR, `${id}.mp3`), audio);
      saved.push('file');
    } catch (error) {
      console.warn(`SFX file write failed (${id})`, error);
    }
  }

  if (hasRedisStorage()) {
    try {
      await redisCommand(['SET', redisKey(id), audio.toString('base64')]);
      saved.push('redis');
    } catch (error) {
      console.warn(`SFX redis write failed (${id})`, error);
    }
  }

  return saved;
}
