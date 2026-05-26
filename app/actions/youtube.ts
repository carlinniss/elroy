'use server';

import { parseYouTubeVideoId, youtubeConfigured } from '@/lib/youtube';
import { clearCurrentYouTubeVideo, setCurrentYouTubeVideo } from '@/lib/youtube-store';

export async function setYouTubeWatchingFromBot(input: string) {
  if (!youtubeConfigured()) {
    throw new Error('YOUTUBE_API_KEY not configured');
  }
  const videoId = parseYouTubeVideoId(input);
  if (!videoId) {
    throw new Error('Invalid YouTube URL or video ID');
  }
  return setCurrentYouTubeVideo(videoId);
}

export async function clearYouTubeWatchingFromBot() {
  await clearCurrentYouTubeVideo();
}
