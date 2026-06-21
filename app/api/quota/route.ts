import { isControlAuthorized } from '@/lib/control-auth';

function voiceBlockFromSubscription(data: Record<string, unknown>) {
  const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : '';
  if (!status || status === 'active') {
    return { voiceBlocked: false as const };
  }
  if (status === 'past_due') {
    return {
      voiceBlocked: true as const,
      voiceBlockReason: 'Subscription past due — complete payment at elevenlabs.io (characters remain but TTS is blocked)',
    };
  }
  return {
    voiceBlocked: true as const,
    voiceBlockReason: `ElevenLabs subscription ${status} — voice blocked until billing is resolved`,
  };
}

export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
      method: 'GET',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! },
    });

    if (!res.ok) throw new Error('API Refused');

    const data = await res.json() as Record<string, unknown>;
    const remaining = Number(data.character_limit) - Number(data.character_count);
    const block = voiceBlockFromSubscription(data);

    return Response.json({
      remaining,
      resetDate: new Date(Number(data.next_character_count_reset_unix) * 1000).toLocaleDateString(),
      subscriptionStatus: typeof data.status === 'string' ? data.status : 'unknown',
      tier: typeof data.tier === 'string' ? data.tier : undefined,
      ...block,
    }, { headers: { 'Content-Type': 'application/json' } });
  } catch {
    return Response.json({ remaining: 0, error: true }, {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}