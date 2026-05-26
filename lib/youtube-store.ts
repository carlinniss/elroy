import { hasRedisStorage, redisCommand } from '@/lib/redis-rest';
import { fetchYouTubeVideo, type YouTubeVideoSnapshot } from '@/lib/youtube';

const CURRENT_KEY = 'elroy:youtube:current';

const globalStore = globalThis as typeof globalThis & {
  __elroyYouTubeCurrent?: YouTubeVideoSnapshot | null;
};

function memoryCurrent(): YouTubeVideoSnapshot | null {
  return globalStore.__elroyYouTubeCurrent ?? null;
}

function setMemoryCurrent(video: YouTubeVideoSnapshot | null) {
  globalStore.__elroyYouTubeCurrent = video;
}

export async function getCurrentYouTubeVideo(): Promise<YouTubeVideoSnapshot | null> {
  if (hasRedisStorage()) {
    try {
      const raw = await redisCommand(['GET', CURRENT_KEY]);
      if (typeof raw === 'string' && raw) {
        return JSON.parse(raw) as YouTubeVideoSnapshot;
      }
    } catch (error) {
      console.error('Redis YouTube read failed', error);
    }
    return null;
  }
  return memoryCurrent();
}

export async function setCurrentYouTubeVideo(videoId: string): Promise<YouTubeVideoSnapshot> {
  const snapshot = await fetchYouTubeVideo(videoId);

  if (hasRedisStorage()) {
    try {
      await redisCommand(['SET', CURRENT_KEY, JSON.stringify(snapshot)]);
    } catch (error) {
      console.error('Redis YouTube write failed', error);
    }
  } else {
    setMemoryCurrent(snapshot);
  }

  return snapshot;
}

export async function clearCurrentYouTubeVideo() {
  if (hasRedisStorage()) {
    try {
      await redisCommand(['DEL', CURRENT_KEY]);
    } catch (error) {
      console.error('Redis YouTube clear failed', error);
    }
    return;
  }
  setMemoryCurrent(null);
}
