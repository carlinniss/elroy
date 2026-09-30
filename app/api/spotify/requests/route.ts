import { isControlAuthorized } from '@/lib/control-auth';
import { handleSongRequestAction, type SongRequestAction } from '@/lib/song-requests';

export const dynamic = 'force-dynamic';

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
