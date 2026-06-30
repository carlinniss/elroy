import assert from 'node:assert/strict';
import { isControlAuthorized } from '../lib/control-auth.ts';

function request(headers: HeadersInit = {}) {
  return new Request('https://example.test/api/protected', { headers });
}

const originalSecret = process.env.ELROY_CONTROL_SECRET;

try {
  delete process.env.ELROY_CONTROL_SECRET;
  assert.equal(isControlAuthorized(request()), false, 'missing secret must fail closed');

  process.env.ELROY_CONTROL_SECRET = '   ';
  assert.equal(isControlAuthorized(request()), false, 'blank secret must fail closed');

  process.env.ELROY_CONTROL_SECRET = 'super-secret';
  assert.equal(isControlAuthorized(request()), false, 'missing credentials must be unauthorized');
  assert.equal(
    isControlAuthorized(request({ Authorization: 'Bearer super-secret' })),
    true,
    'matching bearer token must be authorized',
  );
  assert.equal(
    isControlAuthorized(request({ 'x-elroy-control-secret': 'super-secret' })),
    true,
    'matching control-secret header must be authorized',
  );
  assert.equal(
    isControlAuthorized(request({ Authorization: 'Bearer wrong-secret' })),
    false,
    'wrong bearer token must be unauthorized',
  );
} finally {
  if (originalSecret === undefined) {
    delete process.env.ELROY_CONTROL_SECRET;
  } else {
    process.env.ELROY_CONTROL_SECRET = originalSecret;
  }
}
