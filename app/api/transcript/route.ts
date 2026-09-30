import { isControlAuthorized } from '@/lib/control-auth';
import { readTranscript, transcriptDate } from '@/lib/transcript';

export const dynamic = 'force-dynamic';

/** Plain-text transcript for a day: /api/transcript?date=2026-09-29 (defaults to today). */
export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const requested = new URL(request.url).searchParams.get('date')?.trim();
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : transcriptDate();
  const lines = await readTranscript(date);
  const body = lines.length ? `Elroy stream transcript — ${date}\n\n${lines.join('\n')}\n` : `No transcript for ${date}.\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
