import { getBuildId, getBuildLabel } from '@/lib/build-version';

export const dynamic = 'force-dynamic';

export async function GET() {
  const buildId = getBuildId();
  return Response.json(
    { buildId, label: getBuildLabel(buildId) },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}
