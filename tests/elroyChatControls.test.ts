import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SHUT_UP_DURATION_MS,
  canRespondToElroyAt,
  getNextSilencedUntil,
  isShutUpCommand,
} from '../app/elroyChatControls';

test('detects only Elroy-addressed shut-up messages', () => {
  assert.equal(isShutUpCommand('elroy shut up'), true);
  assert.equal(isShutUpCommand('ELROY can you not'), true);
  assert.equal(isShutUpCommand('everyone shut up'), false);
  assert.equal(isShutUpCommand('elroy is talking'), false);
});

test('does not extend an active silence window', () => {
  const now = 1_000;
  const existingExpiry = now + 120_000;

  assert.equal(getNextSilencedUntil(now, existingExpiry), existingExpiry);
});

test('starts a new silence window only after the previous one expires', () => {
  const now = 1_000;
  const previousExpiry = now - 1;

  assert.equal(getNextSilencedUntil(now, previousExpiry), now + SHUT_UP_DURATION_MS);
});

test('checks Elroy response cooldowns against the supplied clock', () => {
  const now = 100_000;

  assert.equal(canRespondToElroyAt(now, 60_000, 45_000), false);
  assert.equal(canRespondToElroyAt(now, 55_000, 45_000), true);
});
