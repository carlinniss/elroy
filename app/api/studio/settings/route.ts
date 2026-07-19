import { updateStudioSettings } from '@/lib/studio-state';
import { isControlAuthorized } from '@/lib/control-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      silenceTailMs?: number;
      energyThreshold?: number;
      minSpeechMs?: number;
      ingestStaleMs?: number;
    };

    const snapshot = await updateStudioSettings(body);
    return Response.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Studio settings failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
