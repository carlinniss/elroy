import { getControlSecret } from '@/lib/control-auth';

export const dynamic = 'force-dynamic';

/** Public: whether overlay auth is required (does not reveal the secret). */
export async function GET() {
  return Response.json({ configured: Boolean(getControlSecret()) });
}
