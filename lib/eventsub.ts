import crypto from 'crypto';
import {
  fetchShutElroyPowerUpId,
  getBroadcasterId,
  getBroadcasterTwitchCredentials,
  normalizeToken,
  twitchGet,
} from '@/lib/twitch';

const TWITCH_API = 'https://api.twitch.tv/helix';
const HMAC_PREFIX = 'sha256=';

export function getEventSubSecret() {
  return process.env.TWITCH_EVENTSUB_SECRET?.trim() || '';
}

export function getEventSubCallbackUrl() {
  const explicit = process.env.TWITCH_EVENTSUB_CALLBACK?.trim();
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}/api/twitch/eventsub`;
  return 'https://elroy-zeta.vercel.app/api/twitch/eventsub';
}

export function verifyEventSubSignature(
  messageId: string,
  timestamp: string,
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!secret || !signature.startsWith(HMAC_PREFIX)) return false;
  const message = messageId + timestamp + rawBody;
  const expected = HMAC_PREFIX + crypto.createHmac('sha256', secret).update(message).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function twitchPost(path: string, token: string, clientId: string, body: unknown) {
  const res = await fetch(`${TWITCH_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${normalizeToken(token)}`,
      'Client-Id': clientId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
  }
  return { ok: res.ok, status: res.status, data, text };
}

export type EnsureSubscriptionResult = {
  ok: boolean;
  status: 'created' | 'exists' | 'error';
  message?: string;
  subscription_id?: string;
  callback?: string;
  reward_id?: string;
};

export async function ensureShutElroyRedemptionSubscription(): Promise<EnsureSubscriptionResult> {
  const secret = getEventSubSecret();
  if (secret.length < 10) {
    return {
      ok: false,
      status: 'error',
      message: 'Set TWITCH_EVENTSUB_SECRET (10–100 chars) on Vercel for redemption webhooks.',
    };
  }

  const creds = await getBroadcasterTwitchCredentials();
  if (!creds) {
    return { ok: false, status: 'error', message: 'TWITCH_OAUTH_TOKEN is not set on the server.' };
  }
  if (!creds.scopes.includes('bits:read')) {
    return { ok: false, status: 'error', message: 'Broadcaster token needs bits:read for power-up redemptions.' };
  }

  const lookup = await fetchShutElroyPowerUpId();
  if (!lookup.shut_elroy_powerup_id) {
    return { ok: false, status: 'error', message: lookup.error || 'Shut Elroy power-up not found.' };
  }

  const broadcasterId = await getBroadcasterId(creds.channel, creds.token, creds.clientId);
  if (!broadcasterId) {
    return { ok: false, status: 'error', message: 'Broadcaster ID lookup failed.' };
  }

  const callback = getEventSubCallbackUrl();
  const rewardId = lookup.shut_elroy_powerup_id;

  try {
    const existing = await twitchGet(
      `/eventsub/subscriptions?type=channel.custom_power_up_redemption.add&user_id=${broadcasterId}`,
      creds.token,
      creds.clientId,
    );
    const subs = existing.data ?? [];
    const match = subs.find((s: {
      id?: string;
      transport?: { callback?: string };
      condition?: { reward_id?: string };
      status?: string;
    }) =>
      s.transport?.callback === callback
      && s.condition?.reward_id === rewardId
      && s.status === 'enabled',
    );
    if (match?.id) {
      return {
        ok: true,
        status: 'exists',
        subscription_id: match.id,
        callback,
        reward_id: rewardId,
      };
    }
  } catch {
    // Fall through and try to create.
  }

  const result = await twitchPost('/eventsub/subscriptions', creds.token, creds.clientId, {
    type: 'channel.custom_power_up_redemption.add',
    version: 'beta',
    condition: {
      broadcaster_user_id: broadcasterId,
      reward_id: rewardId,
    },
    transport: {
      method: 'webhook',
      callback,
      secret,
    },
  });

  if (result.ok) {
    const subId = (result.data as { data?: Array<{ id: string }> })?.data?.[0]?.id;
    return {
      ok: true,
      status: 'created',
      subscription_id: subId,
      callback,
      reward_id: rewardId,
    };
  }

  if (result.status === 409) {
    return { ok: true, status: 'exists', callback, reward_id: rewardId };
  }

  return {
    ok: false,
    status: 'error',
    message: result.text || `EventSub subscription failed (${result.status}).`,
  };
}
