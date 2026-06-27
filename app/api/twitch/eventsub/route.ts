import { getEventSubSecret, isEventSubTimestampFresh, verifyEventSubSignature } from '@/lib/eventsub';
import { recordChannelEvent } from '@/lib/channel-events';
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

  if (!isEventSubTimestampFresh(timestamp)) {
    return new Response('Stale EventSub message', { status: 403 });
  }

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

    if (subType === 'channel.raid' && event) {
      const raid = event as {
        from_broadcaster_user_login?: string;
        from_broadcaster_user_name?: string;
        viewers?: number;
      };
      await recordChannelEvent(messageId, 'raid', {
        login: raid.from_broadcaster_user_login ?? '',
        displayName: raid.from_broadcaster_user_name ?? raid.from_broadcaster_user_login ?? '',
        viewers: raid.viewers ?? 0,
      });
    }

    if (subType === 'channel.follow' && event) {
      const follow = event as { user_id?: string; user_login?: string; followed_at?: string };
      await recordChannelEvent(messageId, 'follow', {
        user_id: follow.user_id ?? '',
        user_login: follow.user_login ?? '',
        followed_at: follow.followed_at ?? '',
      });
    }

    if (subType === 'channel.subscribe' && event) {
      const sub = event as {
        user_id?: string;
        user_login?: string;
        user_name?: string;
        tier?: string;
        is_gift?: boolean;
        cumulative_months?: number;
        streak_months?: number;
      };
      await recordChannelEvent(messageId, 'subscribe', {
        user_id: sub.user_id ?? '',
        user_login: sub.user_login ?? '',
        user_name: sub.user_name ?? sub.user_login ?? '',
        tier: sub.tier ?? '1000',
        is_gift: Boolean(sub.is_gift),
        cumulative_months: sub.cumulative_months ?? 1,
        streak_months: sub.streak_months ?? 0,
      });
    }

    if (subType === 'channel.subscription.gift' && event) {
      const gift = event as {
        user_id?: string;
        user_login?: string;
        user_name?: string;
        total?: number;
        tier?: string;
        cumulative_total?: number;
      };
      await recordChannelEvent(messageId, 'subscription_gift', {
        user_id: gift.user_id ?? '',
        user_login: gift.user_login ?? '',
        user_name: gift.user_name ?? gift.user_login ?? '',
        total: gift.total ?? 1,
        tier: gift.tier ?? '1000',
        cumulative_total: gift.cumulative_total ?? gift.total ?? 1,
      });
    }

    if (subType === 'channel.subscription.message' && event) {
      const message = event as {
        user_id?: string;
        user_login?: string;
        user_name?: string;
        cumulative_months?: number;
        streak_months?: number;
        message?: { text?: string };
        tier?: string;
      };
      await recordChannelEvent(messageId, 'subscription_message', {
        user_id: message.user_id ?? '',
        user_login: message.user_login ?? '',
        user_name: message.user_name ?? message.user_login ?? '',
        cumulative_months: message.cumulative_months ?? 1,
        streak_months: message.streak_months ?? 0,
        tier: message.tier ?? '1000',
        text: message.message?.text ?? '',
      });
    }

    if (subType === 'channel.cheer' && event) {
      const cheer = event as {
        user_id?: string;
        user_login?: string;
        user_name?: string;
        bits?: number;
        message?: string;
      };
      await recordChannelEvent(messageId, 'cheer', {
        user_id: cheer.user_id ?? '',
        user_login: cheer.user_login ?? '',
        user_name: cheer.user_name ?? cheer.user_login ?? '',
        bits: cheer.bits ?? 0,
        message: cheer.message ?? '',
      });
    }

    if (subType === 'channel.update' && event) {
      const update = event as { title?: string; category_name?: string; category_id?: string };
      await recordChannelEvent(messageId, 'channel_update', {
        title: update.title ?? '',
        game_name: update.category_name ?? '',
        game_id: update.category_id ?? '',
      });
    }

    if (subType === 'channel.poll.end' && event) {
      const poll = event as {
        id?: string;
        title?: string;
        winning_choice?: { title?: string; votes?: number };
        choices?: Array<{ title?: string; votes?: number }>;
      };
      await recordChannelEvent(messageId, 'poll_end', {
        poll_id: poll.id ?? '',
        title: poll.title ?? '',
        winner: poll.winning_choice?.title ?? '',
        winner_votes: poll.winning_choice?.votes ?? 0,
        choices: poll.choices ?? [],
      });
    }

    return new Response(null, { status: 204 });
  }

  return new Response(null, { status: 204 });
}
