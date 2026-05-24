import fs from 'fs/promises';
import path from 'path';
import { hasRedisStorage, redisCommand } from '@/lib/redis-rest';
import { getElroySfx } from '@/lib/elroy-sfx';

const SFX_DIR = path.join(process.cwd(), 'public', 'sounds', 'elroy');
const redisKey = (id: string) => `elroy:sfx:v2:${id}`;
const BUNDLED_EXTENSIONS = ['.wav', '.mp3', '.ogg'] as const;

export type SfxCacheSource = 'file' | 'redis' | 'generated';

export type CachedSfx = {
  audio: Buffer;
  contentType: string;
  source: SfxCacheSource;
};

function contentTypeForExtension(ext: string): string {
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  return 'audio/mpeg';
}

async function readBundledSfx(id: string): Promise<CachedSfx | null> {
  for (const ext of BUNDLED_EXTENSIONS) {
    try {
      const audio = await fs.readFile(path.join(SFX_DIR, `${id}${ext}`));
      return { audio, contentType: contentTypeForExtension(ext), source: 'file' };
    } catch {
    }
  }
  return null;
}

export async function readCachedSfx(id: string): Promise<CachedSfx | null> {
  const definition = getElroySfx(id);
  if (definition?.bundled) {
    return readBundledSfx(id);
  }

  const bundled = await readBundledSfx(id);
  if (bundled) return bundled;

  if (hasRedisStorage()) {
    try {
      const encoded = await redisCommand(['GET', redisKey(id)]);
      if (typeof encoded === 'string' && encoded.length > 0) {
        return {
          audio: Buffer.from(encoded, 'base64'),
          contentType: 'audio/mpeg',
          source: 'redis',
        };
      }
    } catch (error) {
      console.warn(`SFX redis read failed (${id})`, error);
    }
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
