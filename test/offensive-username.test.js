import assert from 'node:assert/strict';
import test from 'node:test';

import { isOffensiveUsername } from '../lib/offensive-username.ts';

test('does not flag innocent names that contain ambiguous substrings', () => {
  for (const name of [
    'benazir',
    'nazionale',
    'retardant',
    'GasJack',
    'I Hate Jazz',
    'Dick Johnson',
    'CoonSlayer',
  ]) {
    assert.equal(isOffensiveUsername(name), false, name);
  }
});

test('continues flagging explicit high-confidence offensive names', () => {
  for (const name of [
    'n1gger123',
    'white_power_88',
    'gas_jew',
    'i_hate_gay_people',
    'kill-all-nigs',
    'heil_hitler',
  ]) {
    assert.equal(isOffensiveUsername(name), true, name);
  }
});
