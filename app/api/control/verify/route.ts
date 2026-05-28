import { isControlAuthorized } from '@/lib/control-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
