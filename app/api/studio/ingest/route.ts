import { ingestStudio } from '@/lib/studio-state';
import { isControlAuthorized } from '@/lib/control-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      listening?: boolean;
      inputSource?: 'broadcast';
      streamerSpeaking?: boolean;
      lastSpeechAt?: number;
      hostTranscript?: string;
    };

    const snapshot = await ingestStudio({
      listening: typeof body.listening === 'boolean' ? body.listening : undefined,
      inputSource: body.inputSource === 'broadcast'
        ? body.inputSource
        : undefined,
      streamerSpeaking: typeof body.streamerSpeaking === 'boolean'
        ? body.streamerSpeaking
        : undefined,
      lastSpeechAt: typeof body.lastSpeechAt === 'number' ? body.lastSpeechAt : undefined,
      hostTranscript: typeof body.hostTranscript === 'string' ? body.hostTranscript : undefined,
    });

    return Response.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Studio ingest failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
