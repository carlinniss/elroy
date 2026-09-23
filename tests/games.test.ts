import { describe, expect, it } from 'vitest';
import { handValue, parseBetAmount, giveChips, getPlayerChips, STARTING_CHIPS } from '@/lib/blackjack';
import { evaluateBet, parsePickBetType, parsePickDigits } from '@/lib/pick-numbers';
import { parseRouletteChoice, wheelColor } from '@/lib/roulette';

describe('blackjack', () => {
  it('counts aces soft and hard', () => {
    expect(handValue([{ rank: 'A', suit: 's' }, { rank: 'K', suit: 'h' }])).toBe(21);
    expect(handValue([{ rank: 'A', suit: 's' }, { rank: 'A', suit: 'h' }, { rank: '9', suit: 'd' }])).toBe(21);
    expect(handValue([{ rank: 'K', suit: 's' }, { rank: 'Q', suit: 'h' }, { rank: '5', suit: 'd' }])).toBe(25);
  });

  it('parses bets', () => {
    expect(parseBetAmount('50', 100)).toEqual({ ok: true, amount: 50 });
    expect(parseBetAmount('all', 100)).toEqual({ ok: true, amount: 100 });
    expect(parseBetAmount('5', 100).ok).toBe(false);
    expect(parseBetAmount('500', 100).ok).toBe(false);
  });
});

describe('!give', () => {
  it('moves chips and enforces the rules', async () => {
    const ok = await giveChips('alice', 'Alice', '@bob', '50');
    expect(ok.ok).toBe(true);
    expect(await getPlayerChips('alice')).toBe(STARTING_CHIPS - 50);
    expect(await getPlayerChips('bob')).toBe(STARTING_CHIPS + 50);

    expect((await giveChips('alice', 'Alice', 'bob', '50')).error).toBe('cooldown');
    expect((await giveChips('carol', 'Carol', 'carol', '50')).error).toBe('self');
    expect((await giveChips('carol', 'Carol', 'bob', '5000')).error).toBe('amount');
    expect((await giveChips('carol', 'Carol', '', '50')).error).toBe('usage');
  });
});

describe('pick 3 / pick 4', () => {
  const bet = (type: 'straight' | 'box' | 'combo' | 'front' | 'back' | 'mid', digits: string, amount = 10) => ({
    login: 'x', displayName: 'x', type, digits, amount, cost: type === 'combo' ? amount * 2 : amount,
  });

  it('pays straight only on exact order', () => {
    expect(evaluateBet('pick3', bet('straight', '420'), '420').won).toBe(true);
    expect(evaluateBet('pick3', bet('straight', '420'), '024').won).toBe(false);
  });

  it('pays box in any order', () => {
    expect(evaluateBet('pick3', bet('box', '420'), '024').won).toBe(true);
    expect(evaluateBet('pick3', bet('box', '420'), '421').won).toBe(false);
  });

  it('combo prefers the straight payout', () => {
    const straight = evaluateBet('pick3', bet('combo', '123'), '123');
    const box = evaluateBet('pick3', bet('combo', '123'), '321');
    expect(straight.won && box.won).toBe(true);
    expect(straight.payout).toBeGreaterThan(box.payout);
  });

  it('pairs match their position', () => {
    expect(evaluateBet('pick4', bet('front', '12'), '1299').won).toBe(true);
    expect(evaluateBet('pick4', bet('mid', '23'), '9239').won).toBe(true);
    expect(evaluateBet('pick4', bet('back', '34'), '9934').won).toBe(true);
    expect(evaluateBet('pick4', bet('back', '34'), '3499').won).toBe(false);
  });

  it('validates input', () => {
    expect(parsePickBetType('mid', 'pick3').ok).toBe(false);
    expect(parsePickBetType('fp', 'pick3')).toEqual({ ok: true, type: 'front' });
    expect(parsePickDigits('pick3', 'straight', '12').ok).toBe(false);
    expect(parsePickDigits('pick4', 'straight', '1234').ok).toBe(true);
  });
});

describe('roulette', () => {
  it('colors the wheel correctly', () => {
    expect(wheelColor(0)).toBe('green');
    expect(wheelColor(1)).toBe('red');
    expect(wheelColor(2)).toBe('black');
  });

  it('parses choices', () => {
    expect(parseRouletteChoice('RED')).toEqual({ ok: true, kind: 'red' });
    expect(parseRouletteChoice('0')).toEqual({ ok: true, kind: 'green' });
    expect(parseRouletteChoice('17')).toEqual({ ok: true, kind: 'number', number: 17 });
    expect(parseRouletteChoice('37').ok).toBe(false);
  });
});
