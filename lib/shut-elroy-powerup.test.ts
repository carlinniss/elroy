import assert from 'node:assert/strict';
import { isShutElroyPowerUpRedemption } from './shut-elroy-powerup.ts';

assert.equal(
  isShutElroyPowerUpRedemption(
    'anything',
    { 'custom-reward-id': 'reward-1' },
    'reward-1',
  ),
  true,
  'known Shut Elroy reward id should trigger full mute',
);

assert.equal(
  isShutElroyPowerUpRedemption(
    'Shut Elroy Up',
    { 'custom-reward-id': 'other-reward' },
    'reward-1',
  ),
  false,
  'mismatched custom reward must not spoof the known Shut Elroy reward',
);

assert.equal(
  isShutElroyPowerUpRedemption(
    'I redeemed Shut Elroy Up',
    { 'msg-id': 'highlighted-message' },
    'reward-1',
  ),
  false,
  'highlighted chat text must not spoof the known Shut Elroy reward',
);

assert.equal(
  isShutElroyPowerUpRedemption(
    'I redeemed Shut Elroy Up power-up',
    {},
  ),
  false,
  'plain chat text must not trigger a full mute',
);

assert.equal(
  isShutElroyPowerUpRedemption(
    'Shut Elroy Up',
    { 'msg-param-powerup-id': 'powerup-1' },
  ),
  true,
  'Twitch power-up tags can trigger before the reward id lookup completes',
);
