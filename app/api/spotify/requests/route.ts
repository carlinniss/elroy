import { isControlAuthorized } from '@/lib/control-auth';
import { advanceSongRequests, handleSongRequestAction, type SongRequestAction } from '@/lib/song-requests';

export const dynamic = 'force-dynamic';

/** Background handoff check (called every few seconds by the listener container). Cheap when the line is empty. */
export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await advanceSongRequests(undefined, { deliver: false });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Song request tick failed';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ ok: false, messages: [], error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json() as SongRequestAction;
    return Response.json(await handleSongRequestAction(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Song request failed';
    return Response.json({ ok: false, messages: [], error: message }, { status: 500 });
  }
}
