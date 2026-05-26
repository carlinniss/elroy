import type { SpotifyTrackSnapshot } from '@/lib/spotify';

export function buildSpotifyTrackPrompt(track: SpotifyTrackSnapshot): string {
  const artists = track.artists.length ? track.artists.join(', ') : 'Unknown artist';
  const year = track.releaseYear ? ` (${track.releaseYear})` : '';
  const album = track.album ? ` — album: ${track.album}${year}` : '';

  return `Now playing on the streamer's Spotify:
- Track: "${track.name}"
- Artist(s): ${artists}${album}

You're Elroy, the OG cannabis-culture Twitch host. React to this song in ONE chat message for the whole room (not @ anyone):
1. Drop one fun fact, trivia nugget, or cultural tie-in about the song or artist (plausible, no long lyric quotes).
2. Rate how good it is to smoke cannabis to on a 1–10 "OG" scale (one short line).
3. Rate how good it is for sex / seductive mood on a 1–10 scale — playful and cheeky, not graphic (one short line).
4. End with one hot take: related song suggestion, strain vibe, or era call-out.

Keep it stream-safe, funny, and specific to THIS track.`;
}
