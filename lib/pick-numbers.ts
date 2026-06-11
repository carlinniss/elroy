import {
  deductBetChips,
  getPlayerChips,
  MIN_BET,
  normalizeLogin,
  parseBetAmount,
  settlePlayerChips,
} from '@/lib/blackjack';
import { hasRedisStorage, redisCommand } from '@/lib/redis-rest';

export const BETTING_MS = 60_000;
export const MAX_BETS_PER_PLAYER = 5;

const TABLE_KEYS = {
  pick3: 'elroy:pick3:table',
  pick4: 'elroy:pick4:table',
} as const;

const LOCK_KEYS = {
  pick3: 'elroy:pick3:lock',
  pick4: 'elroy:pick4:lock',
} as const;

const TABLE_LOCK_MS = 3_000;
const TABLE_LOCK_ATTEMPTS = 24;

export type PickGame = keyof typeof TABLE_KEYS;

export type PickBetType = 'straight' | 'box' | 'combo' | 'front' | 'mid' | 'back';

export type PickBet = {
  login: string;
  displayName: string;
  type: PickBetType;
  digits: string;
  amount: number;
  /** Chips charged (combo costs 2x amount). */
  cost: number;
};

export type PickTable = {
  state: 'idle' | 'betting';
  roundId: string;
  bets: PickBet[];
  phaseEndsAt: number;
  lastDraw?: string;
};

export type PickActionRequest = {
  action: 'open' | 'bet' | 'tick' | 'status' | 'stop';
  game: PickGame;
  username: string;
  displayName?: string;
  betType?: string;
  digits?: string;
  betInput?: string;
  isMod?: boolean;
};

export type PickActionResult = {
  ok: boolean;
  messages: string[];
  error?: string;
};

type MemoryStore = {
  pick3: PickTable | null;
  pick4: PickTable | null;
};

const globalStore = globalThis as typeof globalThis & { __elroyPickNumbers?: MemoryStore };

function mem(): MemoryStore {
  if (!globalStore.__elroyPickNumbers) {
    globalStore.__elroyPickNumbers = { pick3: null, pick4: null };
  }
  return globalStore.__elroyPickNumbers;
}

function idleTable(): PickTable {
  return { state: 'idle', roundId: '', bets: [], phaseEndsAt: 0 };
}

function newRoundId(game: PickGame) {
  return `${game}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function gameEmoji(game: PickGame): string {
  return game === 'pick3' ? '🔢' : '🔣';
}

function gameLabel(game: PickGame): string {
  return game === 'pick3' ? 'Pick 3' : 'Pick 4';
}

function digitLength(game: PickGame): number {
  return game === 'pick3' ? 3 : 4;
}

async function loadTable(game: PickGame): Promise<PickTable> {
  if (hasRedisStorage()) {
    try {
      const raw = await redisCommand(['GET', TABLE_KEYS[game]]);
      if (typeof raw === 'string' && raw.length > 0) {
        const parsed = JSON.parse(raw) as PickTable;
        if (parsed?.state === 'idle' || parsed?.state === 'betting') return parsed;
      }
    } catch (error) {
      console.error(`Redis ${game} table read failed`, error);
    }
  }
  return mem()[game] ?? idleTable();
}

async function saveTable(game: PickGame, table: PickTable) {
  if (hasRedisStorage()) {
    try {
      await redisCommand(['SET', TABLE_KEYS[game], JSON.stringify(table)]);
    } catch (error) {
      console.error(`Redis ${game} table write failed`, error);
    }
  }
  mem()[game] = table;
}

async function withTableMutation(
  game: PickGame,
  fn: (table: PickTable) => Promise<{ table: PickTable; result: PickActionResult }>,
): Promise<PickActionResult> {
  const lockKey = LOCK_KEYS[game];

  for (let attempt = 0; attempt < TABLE_LOCK_ATTEMPTS; attempt += 1) {
    if (hasRedisStorage()) {
      try {
        const acquired = await redisCommand([
          'SET', lockKey, '1', 'PX', String(TABLE_LOCK_MS), 'NX',
        ]);
        if (acquired !== 'OK' && acquired !== true) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          continue;
        }
      } catch {
        /* try anyway */
      }
    }

    try {
      const table = await loadTable(game);
      const { table: next, result } = await fn(table);
      await saveTable(game, next);
      return result;
    } finally {
      if (hasRedisStorage()) {
        try {
          await redisCommand(['DEL', lockKey]);
        } catch {
          /* ignore */
        }
      }
    }
  }

  return { ok: false, messages: [`${gameEmoji(game)} ${gameLabel(game)} busy — try again.`], error: 'locked' };
}

function sortedDigits(digits: string): string {
  return [...digits].sort().join('');
}

function digitCounts(digits: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const d of digits) counts[d] = (counts[d] ?? 0) + 1;
  return counts;
}

function pick3BoxKind(digits: string): '6way' | '3way' | 'triple' {
  const uniq = Object.keys(digitCounts(digits)).length;
  if (uniq === 1) return 'triple';
  if (uniq === 2) return '3way';
  return '6way';
}

function pick4BoxKind(digits: string): '24way' | '12way' | '6way' | '4way' | 'quad' {
  const counts = Object.values(digitCounts(digits)).sort((a, b) => b - a);
  if (counts[0] === 4) return 'quad';
  if (counts[0] === 3) return '4way';
  if (counts[0] === 2 && counts[1] === 2) return '6way';
  if (counts[0] === 2) return '12way';
  return '24way';
}

const PICK3_STRAIGHT_MULT = 60;
const PICK3_BOX_MULT = { '6way': 10, '3way': 20, triple: 60 } as const;
const PICK3_PAIR_MULT = 30;

const PICK4_STRAIGHT_MULT = 200;
const PICK4_BOX_MULT = { '24way': 10, '12way': 20, '6way': 40, '4way': 80, quad: 200 } as const;
const PICK4_PAIR_MULT = 40;

function straightWins(betDigits: string, draw: string): boolean {
  return betDigits === draw;
}

function boxWins(betDigits: string, draw: string): boolean {
  return betDigits.length === draw.length && sortedDigits(betDigits) === sortedDigits(draw);
}

function pairWins(betDigits: string, draw: string, slot: 'front' | 'mid' | 'back'): boolean {
  if (betDigits.length !== 2) return false;
  if (slot === 'front') return draw.slice(0, 2) === betDigits;
  if (slot === 'back') return draw.slice(-2) === betDigits;
  if (draw.length !== 4) return false;
  return draw.slice(1, 3) === betDigits;
}

function boxMultiplier(game: PickGame, digits: string): number {
  if (game === 'pick3') return PICK3_BOX_MULT[pick3BoxKind(digits)];
  return PICK4_BOX_MULT[pick4BoxKind(digits)];
}

function straightMultiplier(game: PickGame): number {
  return game === 'pick3' ? PICK3_STRAIGHT_MULT : PICK4_STRAIGHT_MULT;
}

function pairMultiplier(game: PickGame): number {
  return game === 'pick3' ? PICK3_PAIR_MULT : PICK4_PAIR_MULT;
}

export function parsePickBetType(
  raw: string,
  game: PickGame,
): { ok: true; type: PickBetType } | { ok: false; error: string } {
  const token = raw.trim().toLowerCase();
  const aliases: Record<string, PickBetType> = {
    straight: 'straight',
    s: 'straight',
    st: 'straight',
    box: 'box',
    b: 'box',
    combo: 'combo',
    c: 'combo',
    sb: 'combo',
    straightbox: 'combo',
    front: 'front',
    fp: 'front',
    frontpair: 'front',
    back: 'back',
    bp: 'back',
    backpair: 'back',
    mid: 'mid',
    mp: 'mid',
    midpair: 'mid',
  };

  const type = aliases[token];
  if (!type) {
    return { ok: false, error: 'Use straight, box, combo, front, or back (pick4: mid too).' };
  }
  if (type === 'mid' && game === 'pick3') {
    return { ok: false, error: 'Mid pair is Pick 4 only — use front or back for Pick 3.' };
  }
  return { ok: true, type };
}

export function parsePickDigits(
  game: PickGame,
  type: PickBetType,
  raw: string,
): { ok: true; digits: string } | { ok: false; error: string } {
  const digits = raw.trim();
  if (!/^\d+$/.test(digits)) {
    return { ok: false, error: 'Numbers only — no spaces or letters.' };
  }

  const fullLen = digitLength(game);
  if (type === 'front' || type === 'back' || type === 'mid') {
    if (digits.length !== 2) {
      return { ok: false, error: `${type} pair needs exactly 2 digits.` };
    }
    return { ok: true, digits };
  }

  if (digits.length !== fullLen) {
    return { ok: false, error: `${gameLabel(game)} needs exactly ${fullLen} digits.` };
  }
  return { ok: true, digits };
}

function betCost(type: PickBetType, amount: number): number {
  return type === 'combo' ? amount * 2 : amount;
}

function betLabel(bet: PickBet): string {
  const typeLabels: Record<PickBetType, string> = {
    straight: 'straight',
    box: 'box',
    combo: 'combo',
    front: 'front pair',
    mid: 'mid pair',
    back: 'back pair',
  };
  return `${typeLabels[bet.type]} ${bet.digits}`;
}

function evaluateBet(
  game: PickGame,
  bet: PickBet,
  draw: string,
): { won: boolean; payout: number; detail: string } {
  const { type, digits, amount } = bet;

  if (type === 'straight') {
    const won = straightWins(digits, draw);
    const mult = straightMultiplier(game);
    return {
      won,
      payout: won ? amount * mult : 0,
      detail: won ? `straight ${digits} (${mult}x)` : `straight ${digits}`,
    };
  }

  if (type === 'box') {
    const won = boxWins(digits, draw);
    const mult = boxMultiplier(game, digits);
    return {
      won,
      payout: won ? amount * mult : 0,
      detail: won ? `box ${digits} (${mult}x)` : `box ${digits}`,
    };
  }

  if (type === 'combo') {
    const straightHit = straightWins(digits, draw);
    const boxHit = boxWins(digits, draw);
    const straightMult = straightMultiplier(game);
    const boxMult = boxMultiplier(game, digits);
    if (straightHit) {
      return {
        won: true,
        payout: amount * straightMult,
        detail: `combo straight hit ${digits} (${straightMult}x)`,
      };
    }
    if (boxHit) {
      return {
        won: true,
        payout: amount * boxMult,
        detail: `combo box hit ${digits} (${boxMult}x)`,
      };
    }
    return { won: false, payout: 0, detail: `combo ${digits}` };
  }

  if (type === 'front' || type === 'mid' || type === 'back') {
    const won = pairWins(digits, draw, type);
    const mult = pairMultiplier(game);
    const pairName = type === 'mid' ? 'mid pair' : `${type} pair`;
    return {
      won,
      payout: won ? amount * mult : 0,
      detail: won ? `${pairName} ${digits} (${mult}x)` : `${pairName} ${digits}`,
    };
  }

  return { won: false, payout: 0, detail: betLabel(bet) };
}

export function tableStatusMessage(game: PickGame, table: PickTable): string {
  const emoji = gameEmoji(game);
  const label = gameLabel(game);
  if (table.state === 'idle') {
    const cmd = game === 'pick3' ? '!pick3' : '!pick4';
    const betCmd = game === 'pick3' ? '!p3bet' : '!p4bet';
    return `${emoji} ${label} idle — ${cmd} to open. Bets: ${betCmd} straight/box/combo/front/back <num> <amt>`;
  }
  const secs = Math.max(0, Math.ceil((table.phaseEndsAt - Date.now()) / 1000));
  const betCmd = game === 'pick3' ? '!p3bet' : '!p4bet';
  const bettors = table.bets.length
    ? table.bets.map((b) => `@${b.displayName} (${betLabel(b)} ${b.cost})`).join(', ')
    : 'no bets yet';
  const pairHint = game === 'pick4' ? '/mid' : '';
  return `${emoji} ${label} betting (${secs}s): ${bettors} — ${betCmd} straight/box/combo/front${pairHint}/back <num> <amt>`;
}

function drawNumber(game: PickGame): string {
  const max = game === 'pick3' ? 1000 : 10000;
  return String(Math.floor(Math.random() * max)).padStart(digitLength(game), '0');
}

async function settleBets(
  game: PickGame,
  table: PickTable,
): Promise<{ table: PickTable; messages: string[] }> {
  const draw = drawNumber(game);
  const emoji = gameEmoji(game);
  const label = gameLabel(game);
  const messages: string[] = [`${emoji} ${label} draw: ${draw.split('').join('-')}!`];

  if (!table.bets.length) {
    messages.push(`${emoji} Nobody bet — ${game === 'pick3' ? '!pick3' : '!pick4'} to play again.`);
    return { table: { ...idleTable(), lastDraw: draw }, messages };
  }

  for (const bet of table.bets) {
    const current = await getPlayerChips(bet.login);
    const result = evaluateBet(game, bet, draw);
    if (result.won) {
      const next = current + result.payout;
      const settled = await settlePlayerChips(bet.login, bet.displayName, next);
      const profit = result.payout - bet.cost;
      messages.push(
        `🎉 @${bet.displayName} wins ${result.detail} (+${profit}) — ${settled.chips} chips`,
      );
      if (settled.debtMessage) messages.push(settled.debtMessage);
    } else {
      messages.push(
        `💨 @${bet.displayName} loses ${bet.cost} on ${result.detail} — ${current} chips`,
      );
    }
  }

  messages.push(`${emoji} Round over — ${game === 'pick3' ? '!pick3' : '!pick4'} for the next draw.`);
  return { table: { ...idleTable(), lastDraw: draw }, messages };
}

async function advancePhase(
  game: PickGame,
  table: PickTable,
): Promise<{ table: PickTable; messages: string[] }> {
  if (table.state === 'betting' && Date.now() >= table.phaseEndsAt) {
    return settleBets(game, table);
  }
  return { table, messages: [] };
}

function openCommand(game: PickGame): string {
  return game === 'pick3' ? '!pick3' : '!pick4';
}

function betCommand(game: PickGame): string {
  return game === 'pick3' ? '!p3bet' : '!p4bet';
}

export async function handlePickAction(req: PickActionRequest): Promise<PickActionResult> {
  const game = req.game === 'pick4' ? 'pick4' : 'pick3';
  const login = normalizeLogin(req.username);
  const displayName = req.displayName?.trim() || req.username;
  if (!login) {
    return { ok: false, messages: [], error: 'invalid user' };
  }

  const emoji = gameEmoji(game);
  const label = gameLabel(game);

  if (req.action === 'tick') {
    return withTableMutation(game, async (table) => {
      const advanced = await advancePhase(game, table);
      return { table: advanced.table, result: { ok: true, messages: advanced.messages } };
    });
  }

  if (req.action === 'status') {
    const table = await loadTable(game);
    return { ok: true, messages: [tableStatusMessage(game, table)] };
  }

  if (req.action === 'stop') {
    if (!req.isMod) {
      return { ok: false, messages: [], error: 'mods only' };
    }
    return withTableMutation(game, async (table) => {
      if (table.state === 'betting' && table.bets.length) {
        const messages: string[] = [`${emoji} ${label} cancelled by mod — refunding bets.`];
        for (const bet of table.bets) {
          const chips = await getPlayerChips(bet.login);
          const refunded = chips + bet.cost;
          await settlePlayerChips(bet.login, bet.displayName, refunded);
          messages.push(`${emoji} @${bet.displayName} refunded ${bet.cost} chips.`);
        }
        return { table: idleTable(), result: { ok: true, messages } };
      }
      return { table: idleTable(), result: { ok: true, messages: [`${emoji} ${label} cleared.`] } };
    });
  }

  if (req.action === 'open') {
    return withTableMutation(game, async (table) => {
      const messages: string[] = [];

      if (table.state === 'idle') {
        const bettingSecs = Math.ceil(BETTING_MS / 1000);
        const pairHint = game === 'pick4' ? ', mid' : '';
        table = {
          state: 'betting',
          roundId: newRoundId(game),
          bets: [],
          phaseEndsAt: Date.now() + BETTING_MS,
        };
        messages.push(
          `${emoji} ${label.toUpperCase()} OPEN! ${bettingSecs}s — ${betCommand(game)} straight/box/combo/front${pairHint}/back <num> <amt> (min ${MIN_BET}, combo = 2x).`,
        );
        return { table, result: { ok: true, messages } };
      }

      messages.push(tableStatusMessage(game, table));
      return { table, result: { ok: true, messages } };
    });
  }

  if (req.action === 'bet') {
    const parsedType = parsePickBetType(req.betType ?? '', game);
    if (!parsedType.ok) {
      return { ok: false, messages: [`${emoji} ${parsedType.error}`], error: 'invalid type' };
    }

    const parsedDigits = parsePickDigits(game, parsedType.type, req.digits ?? '');
    if (!parsedDigits.ok) {
      return { ok: false, messages: [`${emoji} ${parsedDigits.error}`], error: 'invalid digits' };
    }

    return withTableMutation(game, async (table) => {
      if (table.state !== 'betting') {
        return {
          table,
          result: {
            ok: false,
            messages: [
              table.state === 'idle'
                ? `${emoji} ${openCommand(game)} first to open betting.`
                : tableStatusMessage(game, table),
            ],
            error: 'not betting',
          },
        };
      }

      const playerBets = table.bets.filter((bet) => bet.login === login);
      if (playerBets.length >= MAX_BETS_PER_PLAYER) {
        return {
          table,
          result: {
            ok: false,
            messages: [`@${displayName} max ${MAX_BETS_PER_PLAYER} bets per round.`],
            error: 'bet limit',
          },
        };
      }

      const duplicate = playerBets.some(
        (bet) => bet.type === parsedType.type && bet.digits === parsedDigits.digits,
      );
      if (duplicate) {
        return {
          table,
          result: {
            ok: false,
            messages: [`@${displayName} you already have that exact bet this round.`],
            error: 'duplicate bet',
          },
        };
      }

      const chips = await getPlayerChips(login);
      const parsedAmount = parseBetAmount(req.betInput ?? '', chips);
      if (!parsedAmount.ok) {
        return {
          table,
          result: { ok: false, messages: [`${emoji} ${parsedAmount.error}`], error: 'invalid bet' },
        };
      }

      const amount = parsedAmount.amount;
      const cost = betCost(parsedType.type, amount);
      if (cost > chips) {
        return {
          table,
          result: {
            ok: false,
            messages: [`@${displayName} combo costs ${cost} chips — you only have ${chips}.`],
            error: 'insufficient chips',
          },
        };
      }

      const remaining = await deductBetChips(login, displayName, cost);
      const bet: PickBet = {
        login,
        displayName,
        type: parsedType.type,
        digits: parsedDigits.digits,
        amount,
        cost,
      };

      table = { ...table, bets: [...table.bets, bet] };
      const labelText = betLabel(bet);
      const costNote = parsedType.type === 'combo' ? ` (${cost} total)` : '';
      const allInNote = cost === chips ? ' (all-in)' : '';
      return {
        table,
        result: {
          ok: true,
          messages: [
            `${emoji} @${displayName} bets ${amount} on ${labelText}${costNote}${allInNote} (${remaining} left).`,
          ],
        },
      };
    });
  }

  return { ok: false, messages: [], error: 'unknown action' };
}

/** Advance both pick games — used by overlay tick. */
export async function tickAllPickGames(): Promise<PickActionResult> {
  const messages: string[] = [];
  for (const game of ['pick3', 'pick4'] as const) {
    const result = await handlePickAction({
      action: 'tick',
      game,
      username: 'elroy',
      displayName: 'Elroy',
    });
    if (result.messages.length) messages.push(...result.messages);
  }
  return { ok: true, messages };
}
