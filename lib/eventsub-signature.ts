import crypto from 'crypto';

const HMAC_PREFIX = 'sha256=';
const MAX_EVENTSUB_MESSAGE_AGE_MS = 10 * 60 * 1000;

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

export function isEventSubTimestampFresh(timestamp: string, nowMs = Date.now()): boolean {
  const messageTime = Date.parse(timestamp);
  if (!Number.isFinite(messageTime)) return false;
  return Math.abs(nowMs - messageTime) <= MAX_EVENTSUB_MESSAGE_AGE_MS;
}
