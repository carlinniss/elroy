import { getEventSubSecret, verifyEventSubSignature } from '@/lib/eventsub';
import { fetchShutElroyPowerUpId, SHUT_ELROY_POWERUP_TITLE } from '@/lib/twitch';
import { recordShutElroyRedemption } from '@/lib/powerup-redemptions';

export const dynamic = 'force-dynamic';

type CustomPowerUpRedemptionEvent = {
  id: string;
  user_login: string;
  user_name: string;
  custom_power_up?: { id?: string; title?: string };
  redeemed_at: string;
};

type BitsUseEvent = {
  user_id: string;
  user_login: string;
  user_name: string;
  bits: number;
  type?: string;
  custom_power_up?: { title?: string; reward_id?: string };
  message?: { text?: string };
};

async function handleShutElroyRedemption(
  messageId: string,
  source: 'custom_power_up' | 'bits_use',
  input: {
    userLogin: string;
    userName: string;
    rewardId: string;
    rewardTitle: string;
    redeemedAt: string;
    redemptionId?: string;
  },
) {
  const lookup = await fetchShutElroyPowerUpId();
  const shutElroyId = lookup.shut_elroy_powerup_id;

  if (input.rewardId && shutElroyId && input.rewardId !== shutElroyId) {
    return;
  }

  if (!input.rewardId && input.rewardTitle && !SHUT_ELROY_POWERUP_TITLE.test(input.rewardTitle)) {
    return;
  }

  await recordShutElroyRedemption(
    {
      id: input.redemptionId || `${source}:${messageId}`,
      userLogin: input.userLogin,
      userName: input.userName,
      rewardId: input.rewardId || shutElroyId || '',
      rewardTitle: input.rewardTitle,
      redeemedAt: input.redeemedAt,
      source,
    },
    shutElroyId,
  );
}

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
    event?: CustomPowerUpRedemptionEvent | BitsUseEvent;
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
    const event = payload.event;

    if (subType === 'channel.custom_power_up_redemption.add' && event && 'id' in event) {
      const redemption = event as CustomPowerUpRedemptionEvent;
      await handleShutElroyRedemption(messageId, 'custom_power_up', {
        redemptionId: redemption.id,
        userLogin: redemption.user_login,
        userName: redemption.user_name,
        rewardId: redemption.custom_power_up?.id ?? '',
        rewardTitle: redemption.custom_power_up?.title ?? '',
        redeemedAt: redemption.redeemed_at,
      });
    }

    if (subType === 'channel.bits.use' && event && 'user_login' in event) {
      const bitsEvent = event as BitsUseEvent;
      const custom = bitsEvent.custom_power_up;
      if (custom?.reward_id || (custom?.title && SHUT_ELROY_POWERUP_TITLE.test(custom.title))) {
        await handleShutElroyRedemption(messageId, 'bits_use', {
          redemptionId: `bits-use:${messageId}`,
          userLogin: bitsEvent.user_login,
          userName: bitsEvent.user_name,
          rewardId: custom.reward_id ?? '',
          rewardTitle: custom.title ?? '',
          redeemedAt: new Date().toISOString(),
        });
      }
    }

    return new Response(null, { status: 204 });
  }

  return new Response(null, { status: 204 });
}
