import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { isEventSubTimestampFresh, verifyEventSubSignature } from './eventsub-signature.ts';

const now = Date.parse('2026-06-27T11:00:00.000Z');

assert.equal(
  isEventSubTimestampFresh('2026-06-27T10:55:00.000Z', now),
  true,
  'recent EventSub timestamps should be accepted',
);

assert.equal(
  isEventSubTimestampFresh('2026-06-27T10:49:59.999Z', now),
  false,
  'old EventSub timestamps should be rejected',
);

assert.equal(
  isEventSubTimestampFresh('not-a-date', now),
  false,
  'invalid EventSub timestamps should be rejected',
);

const messageId = 'event-message-1';
const timestamp = '2026-06-27T10:55:00.000Z';
const rawBody = '{"event":{"id":"redemption-1"}}';
const secret = 'eventsub-secret';
const signature = 'sha256=' + crypto
  .createHmac('sha256', secret)
  .update(messageId + timestamp + rawBody)
  .digest('hex');

assert.equal(
  verifyEventSubSignature(messageId, timestamp, rawBody, signature, secret),
  true,
  'matching EventSub signatures should verify',
);

assert.equal(
  verifyEventSubSignature(messageId, timestamp, rawBody, signature, 'wrong-secret'),
  false,
  'wrong EventSub secret should not verify',
);
