import { isControlAuthorized } from '@/lib/control-auth';
import { readSongHistory } from '@/lib/song-history';
import { transcriptDate } from '@/lib/transcript';

export const dynamic = 'force-dynamic';

/** Plain-text list of songs played on a day: /api/songs?date=2026-09-29 (defaults to today). */
export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const requested = new URL(request.url).searchParams.get('date')?.trim();
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : transcriptDate();
  const lines = await readSongHistory(date);
  const body = lines.length
    ? `Songs played on stream — ${date} (${lines.length})\n\n${lines.join('\n')}\n`
    : `No songs logged for ${date}.\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
