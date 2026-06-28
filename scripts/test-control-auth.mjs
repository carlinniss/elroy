import assert from 'node:assert/strict';
import { controlAuthHeaders, isControlAuthorized } from '../lib/control-auth.ts';

const originalSecret = process.env.ELROY_CONTROL_SECRET;

function request(headers = {}) {
  return new Request('https://example.test/api/chat', { headers });
}

try {
  delete process.env.ELROY_CONTROL_SECRET;
  assert.equal(isControlAuthorized(request()), false, 'missing secret must fail closed');
  assert.equal(
    isControlAuthorized(request({ Authorization: 'Bearer anything' })),
    false,
    'missing secret must reject bearer headers',
  );

  process.env.ELROY_CONTROL_SECRET = '  s3cr3t  ';
  assert.equal(isControlAuthorized(request()), false, 'configured secret requires credentials');
  assert.equal(
    isControlAuthorized(request({ Authorization: 'Bearer wrong' })),
    false,
    'wrong bearer secret is rejected',
  );
  assert.equal(
    isControlAuthorized(request({ Authorization: 'Bearer s3cr3t' })),
    true,
    'matching bearer secret is accepted',
  );
  assert.equal(
    isControlAuthorized(request({ 'x-elroy-control-secret': 's3cr3t' })),
    true,
    'matching control-secret header is accepted',
  );

  assert.deepEqual(
    controlAuthHeaders(' s3cr3t ', { 'Content-Type': 'application/json' }),
    {
      Authorization: 'Bearer s3cr3t',
      'Content-Type': 'application/json',
      'x-elroy-control-secret': 's3cr3t',
    },
    'client helper trims and sends both accepted auth headers',
  );
} finally {
  if (originalSecret === undefined) {
    delete process.env.ELROY_CONTROL_SECRET;
  } else {
    process.env.ELROY_CONTROL_SECRET = originalSecret;
  }
}
