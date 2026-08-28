import assert from 'node:assert/strict';
import { isOffensiveUsername } from '../lib/offensive-username.ts';

const innocentNames = [
  'Benazir',
  'denazification',
  'retardant',
  'GasJack',
  'Dick Johnson',
  'CoonSlayer',
  'IHateGarlic',
  'KillAllBugs',
];

for (const name of innocentNames) {
  assert.equal(isOffensiveUsername(name), false, `${name} should not trigger auto-ban moderation`);
}

const offensiveNames = [
  'n1gg3r',
  'white_power88',
  'heilHitler',
  'gasjewz',
  'nazi',
  'nazi-lover',
  'retard',
  'killallj',
  'ihaten',
];

for (const name of offensiveNames) {
  assert.equal(isOffensiveUsername(name), true, `${name} should trigger auto-ban moderation`);
}
