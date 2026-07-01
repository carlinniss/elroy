import assert from 'node:assert/strict';
import { isOffensiveUsername } from '../lib/offensive-username.ts';

const benignNames = [
  'Benazir',
  'Retardant',
  'GasJack',
  'GasJockey',
  'Dick Johnson',
  'CoonSlayer',
  'KillAllJoy',
  'IHateJazz',
  'Faggios',
  'Chinkapin',
];

const offensiveNames = [
  'n1gg3rTroll',
  'white_power88',
  'kill_all_jews',
  'IHateJews',
  'GasJew',
  'HitlerDidNothing',
  'faggotlord',
  'nazi',
];

for (const name of benignNames) {
  assert.equal(isOffensiveUsername(name), false, `${name} should not trigger an automatic ban`);
}

for (const name of offensiveNames) {
  assert.equal(isOffensiveUsername(name), true, `${name} should still trigger moderation`);
}

console.log('offensive username moderation tests passed');
