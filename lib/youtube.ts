const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

export type YouTubeVideoSnapshot = {
  videoId: string;
  title: string;
  channelTitle: string;
  descriptionExcerpt: string;
  publishedAt: string;
  durationLabel: string;
  tags: string[];
  thumbnailUrl: string | null;
  videoUrl: string;
  setAt: number;
};

type YouTubeApiVideo = {
  id?: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    description?: string;
    publishedAt?: string;
    tags?: string[];
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
  };
  contentDetails?: { duration?: string };
};

export function youtubeConfigured() {
  return Boolean(process.env.YOUTUBE_API_KEY?.trim());
}

export function parseYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }

    if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
      const fromQuery = url.searchParams.get('v');
      if (fromQuery && /^[\w-]{11}$/.test(fromQuery)) return fromQuery;

      const embed = url.pathname.match(/\/embed\/([\w-]{11})/);
      if (embed) return embed[1];

      const shorts = url.pathname.match(/\/shorts\/([\w-]{11})/);
      if (shorts) return shorts[1];

      const live = url.pathname.match(/\/live\/([\w-]{11})/);
      if (live) return live[1];
    }
  } catch {
    return null;
  }

  return null;
}

function formatIsoDuration(iso?: string): string {
  if (!iso) return 'unknown length';
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return iso;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function excerptDescription(text: string, maxLen = 700): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, maxLen - 1).trim()}…`;
}

export async function fetchYouTubeVideo(videoId: string): Promise<YouTubeVideoSnapshot> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) throw new Error('YOUTUBE_API_KEY missing');

  const params = new URLSearchParams({
    part: 'snippet,contentDetails',
    id: videoId,
    key: apiKey,
  });

  const res = await fetch(`${YOUTUBE_API}/videos?${params}`, { cache: 'no-store' });
  const data = await res.json() as { items?: YouTubeApiVideo[]; error?: { message?: string } };

  if (!res.ok) {
    throw new Error(data.error?.message || `YouTube API ${res.status}`);
  }

  const item = data.items?.[0];
  if (!item?.snippet?.title) {
    throw new Error('Video not found or unavailable');
  }

  const thumb = item.snippet.thumbnails?.medium?.url
    || item.snippet.thumbnails?.default?.url
    || null;

  return {
    videoId,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle || 'Unknown channel',
    descriptionExcerpt: excerptDescription(item.snippet.description || ''),
    publishedAt: item.snippet.publishedAt || 'unknown date',
    durationLabel: formatIsoDuration(item.contentDetails?.duration),
    tags: (item.snippet.tags ?? []).slice(0, 12),
    thumbnailUrl: thumb,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    setAt: Date.now(),
  };
}
