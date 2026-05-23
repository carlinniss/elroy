import { getEventSubSecret, verifyEventSubSignature } from '@/lib/eventsub';
import { recordPowerUpRedemption } from '@/lib/powerup-redemptions';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = getEventSubSecret();
  if (!secret) {
    return new Response('EventSub secret not configured', { status: 503 });
  }

  const rawBody = await request.text();
  const messageId = request.headers.get('twitch-eventsub-message-id') ?? '';
  const timestamp = request.headers.get('twitch-eventsub-message-timestamp') ?? '';
  const signature = request.headers.get('twitch-eventsub-message-signature') ?? '';
  const messageType = request.headers.get('twitch-eventsub-message-type') ?? '';

  if (!verifyEventSubSignature(messageId, timestamp, rawBody, signature, secret)) {
    return new Response('Invalid signature', { status: 403 });
  }

  const payload = JSON.parse(rawBody) as {
    challenge?: string;
    event?: {
      id: string;
      user_login: string;
      user_name: string;
      custom_power_up?: { id?: string; title?: string };
      redeemed_at: string;
    };
  };

  if (messageType === 'webhook_callback_verification') {
    return new Response(payload.challenge ?? '', { status: 200 });
  }

  if (messageType === 'revocation') {
    console.warn('EventSub subscription revoked', payload);
    return new Response(null, { status: 204 });
  }

  if (messageType === 'notification') {
    const subType = request.headers.get('twitch-eventsub-subscription-type');
    if (subType === 'channel.custom_power_up_redemption.add' && payload.event) {
      const event = payload.event;
      recordPowerUpRedemption({
        id: event.id,
        userLogin: event.user_login,
        userName: event.user_name,
        rewardId: event.custom_power_up?.id ?? '',
        rewardTitle: event.custom_power_up?.title ?? '',
        redeemedAt: event.redeemed_at,
        receivedAt: Date.now(),
      });
    }
    return new Response(null, { status: 204 });
  }

  return new Response(null, { status: 204 });
}
