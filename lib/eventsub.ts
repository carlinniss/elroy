import crypto from 'crypto';
import {
  fetchShutElroyPowerUpId,
  getAppAccessToken,
  getBroadcasterId,
  getBroadcasterTwitchCredentials,
  normalizeToken,
  resolveEventSubAppCredentials,
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

function formatTwitchError(text: string, status: number) {
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string };
    if (parsed.message) return parsed.message;
    if (parsed.error) return parsed.error;
  } catch {
  }
  return text || `EventSub subscription failed (${status}).`;
}

export type EnsureSubscriptionResult = {
  ok: boolean;
  status: 'created' | 'exists' | 'partial' | 'error';
  message?: string;
  subscription_id?: string;
  callback?: string;
  reward_id?: string;
  hint?: string;
  subscriptions?: Array<{ type: string; status: 'created' | 'exists' | 'error'; message?: string }>;
};

type ExistingSub = {
  id?: string;
  type?: string;
  transport?: { callback?: string };
  condition?: { reward_id?: string; broadcaster_user_id?: string };
  status?: string;
};

async function ensureEventSubSubscription(
  appToken: string,
  clientId: string,
  callback: string,
  secret: string,
  type: string,
  version: string,
  condition: Record<string, string>,
  existingSubs: ExistingSub[],
): Promise<{ type: string; status: 'created' | 'exists' | 'error'; message?: string; id?: string }> {
  const match = existingSubs.find((s) =>
    s.type === type
    && s.transport?.callback === callback
    && s.status === 'enabled'
    && Object.entries(condition).every(([key, value]) => s.condition?.[key as keyof typeof s.condition] === value),
  );

  if (match?.id) {
    return { type, status: 'exists', id: match.id };
  }

  const result = await twitchPost('/eventsub/subscriptions', appToken, clientId, {
    type,
    version,
    condition,
    transport: {
      method: 'webhook',
      callback,
      secret,
    },
  });

  if (result.ok || result.status === 409) {
    const subId = (result.data as { data?: Array<{ id: string }> })?.data?.[0]?.id;
    return { type, status: result.status === 409 ? 'exists' : 'created', id: subId };
  }

  return { type, status: 'error', message: formatTwitchError(result.text, result.status) };
}

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

  const appCredsResult = await resolveEventSubAppCredentials();
  if ('error' in appCredsResult) {
    return {
      ok: false,
      status: 'error',
      message: appCredsResult.error,
      hint: appCredsResult.hint,
    };
  }
  const appCreds = appCredsResult;

  if (creds.clientId !== appCreds.clientId) {
    return {
      ok: false,
      status: 'error',
      message: 'TWITCH_OAUTH_TOKEN is for a different Twitch app than TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET.',
      hint: `Token app: ${creds.clientId}. Regenerate dtldabs token for your dev app with bits:read.`,
    };
  }

  let appToken: string;
  try {
    appToken = await getAppAccessToken(appCreds.clientId, appCreds.clientSecret);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'App access token failed';
    return { ok: false, status: 'error', message };
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

  let existingSubs: ExistingSub[] = [];
  try {
    const existing = await twitchGet(
      `/eventsub/subscriptions?user_id=${broadcasterId}`,
      appToken,
      appCreds.clientId,
    );
    existingSubs = existing.data ?? [];
  } catch {
    // Continue and attempt to create subscriptions.
  }

  const subscriptions = await Promise.all([
    ensureEventSubSubscription(
      appToken,
      appCreds.clientId,
      callback,
      secret,
      'channel.custom_power_up_redemption.add',
      'beta',
      { broadcaster_user_id: broadcasterId, reward_id: rewardId },
      existingSubs,
    ),
    ensureEventSubSubscription(
      appToken,
      appCreds.clientId,
      callback,
      secret,
      'channel.bits.use',
      '1',
      { broadcaster_user_id: broadcasterId },
      existingSubs,
    ),
  ]);

  const errors = subscriptions.filter((s) => s.status === 'error');
  if (errors.length === subscriptions.length) {
    return {
      ok: false,
      status: 'error',
      message: errors[0]?.message || 'EventSub subscription failed.',
      callback,
      reward_id: rewardId,
      subscriptions,
    };
  }

  const created = subscriptions.some((s) => s.status === 'created');
  const allExist = subscriptions.every((s) => s.status === 'exists');

  return {
    ok: true,
    status: created ? 'created' : allExist ? 'exists' : 'partial',
    callback,
    reward_id: rewardId,
    subscriptions,
    message: errors.length
      ? `Some subscriptions failed: ${errors.map((e) => `${e.type}: ${e.message}`).join('; ')}`
      : undefined,
  };
}
