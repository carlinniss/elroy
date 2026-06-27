import assert from 'node:assert/strict';
import { isControlAuthorized } from './control-auth.ts';

const originalSecret = process.env.ELROY_CONTROL_SECRET;

try {
  delete process.env.ELROY_CONTROL_SECRET;
  assert.equal(
    isControlAuthorized(new Request('https://example.test/api/twitch/ban')),
    false,
    'protected routes must fail closed when ELROY_CONTROL_SECRET is missing',
  );

  process.env.ELROY_CONTROL_SECRET = ' test-secret ';
  assert.equal(
    isControlAuthorized(new Request('https://example.test/api/twitch/ban', {
      headers: { Authorization: 'Bearer test-secret' },
    })),
    true,
    'bearer token should authorize',
  );
  assert.equal(
    isControlAuthorized(new Request('https://example.test/api/twitch/ban', {
      headers: { 'x-elroy-control-secret': 'test-secret' },
    })),
    true,
    'control secret header should authorize',
  );
  assert.equal(
    isControlAuthorized(new Request('https://example.test/api/twitch/ban', {
      headers: { Authorization: 'Bearer wrong-secret' },
    })),
    false,
    'wrong bearer token should not authorize',
  );
} finally {
  if (originalSecret === undefined) {
    delete process.env.ELROY_CONTROL_SECRET;
  } else {
    process.env.ELROY_CONTROL_SECRET = originalSecret;
  }
}
