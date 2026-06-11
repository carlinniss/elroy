import {
  deductBetChips,
  getPlayerChips,
  MIN_BET,
  normalizeLogin,
  parseBetAmount,
  settlePlayerChips,
} from '@/lib/blackjack';
import { hasRedisStorage, redisCommand } from '@/lib/redis-rest';

export const BETTING_MS = 45_000;

const TABLE_KEY = 'elroy:roulette:table';
const TABLE_LOCK_KEY = 'elroy:roulette:lock';
const TABLE_LOCK_MS = 3_000;
const TABLE_LOCK_ATTEMPTS = 24;

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export type RouletteBetKind = 'red' | 'black' | 'green' | 'odd' | 'even' | 'number';

export type RouletteBet = {
  login: string;
  displayName: string;
  kind: RouletteBetKind;
  number?: number;
  amount: number;
};

export type RouletteTable = {
  state: 'idle' | 'betting';
  roundId: string;
  bets: RouletteBet[];
  phaseEndsAt: number;
  lastResult?: number;
};

export type RouletteActionRequest = {
  action: 'open' | 'bet' | 'tick' | 'status' | 'stop';
  username: string;
  displayName?: string;
  /** Raw !rbet args after the choice, e.g. "50" or "all". */
  betInput?: string;
  /** Parsed choice from !rbet, e.g. "red", "17". */
  choice?: string;
  isMod?: boolean;
};

export type RouletteActionResult = {
  ok: boolean;
  messages: string[];
  error?: string;
};

type MemoryStore = {
  table: RouletteTable | null;
};

const globalStore = globalThis as typeof globalThis & { __elroyRoulette?: MemoryStore };

function mem(): MemoryStore {
  if (!globalStore.__elroyRoulette) {
    globalStore.__elroyRoulette = { table: null };
  }
  return globalStore.__elroyRoulette;
}

function idleTable(): RouletteTable {
  return { state: 'idle', roundId: '', bets: [], phaseEndsAt: 0 };
}

function newRoundId() {
  return `roulette-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadTable(): Promise<RouletteTable> {
  if (hasRedisStorage()) {
    try {
      const raw = await redisCommand(['GET', TABLE_KEY]);
      if (typeof raw === 'string' && raw.length > 0) {
        const parsed = JSON.parse(raw) as RouletteTable;
        if (parsed?.state === 'idle' || parsed?.state === 'betting') return parsed;
      }
    } catch (error) {
      console.error('Redis roulette table read failed', error);
    }
  }
  return mem().table ?? idleTable();
}

async function saveTable(table: RouletteTable) {
  if (hasRedisStorage()) {
    try {
      await redisCommand(['SET', TABLE_KEY, JSON.stringify(table)]);
    } catch (error) {
      console.error('Redis roulette table write failed', error);
    }
  }
  mem().table = table;
}

async function withTableMutation(
  fn: (table: RouletteTable) => Promise<{ table: RouletteTable; result: RouletteActionResult }>,
): Promise<RouletteActionResult> {
  for (let attempt = 0; attempt < TABLE_LOCK_ATTEMPTS; attempt += 1) {
    if (hasRedisStorage()) {
      try {
        const acquired = await redisCommand([
          'SET', TABLE_LOCK_KEY, '1', 'PX', String(TABLE_LOCK_MS), 'NX',
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
      const table = await loadTable();
      const { table: next, result } = await fn(table);
      await saveTable(next);
      return result;
    } finally {
      if (hasRedisStorage()) {
        try {
          await redisCommand(['DEL', TABLE_LOCK_KEY]);
        } catch {
          /* ignore */
        }
      }
    }
  }

  return { ok: false, messages: ['🎡 Roulette busy — try again.'], error: 'locked' };
}

export function wheelColor(n: number): 'red' | 'black' | 'green' {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

export function formatSpinResult(n: number): string {
  const color = wheelColor(n);
  const emoji = color === 'green' ? '🟢' : color === 'red' ? '🔴' : '⚫';
  return `${emoji} ${n} ${color}`;
}

export function parseRouletteChoice(raw: string): { ok: true; kind: RouletteBetKind; number?: number } | { ok: false; error: string } {
  const choice = raw.trim().toLowerCase();
  if (choice === 'red' || choice === 'black' || choice === 'green' || choice === '0') {
    return { ok: true, kind: choice === '0' ? 'green' : choice as RouletteBetKind };
  }
  if (choice === 'odd' || choice === 'even') {
    return { ok: true, kind: choice };
  }
  const num = Number.parseInt(choice, 10);
  if (Number.isFinite(num) && num >= 1 && num <= 36) {
    return { ok: true, kind: 'number', number: num };
  }
  return {
    ok: false,
    error: 'Pick red, black, green/0, odd, even, or a number 1–36.',
  };
}

function betLabel(bet: RouletteBet): string {
  if (bet.kind === 'number' && bet.number !== undefined) return String(bet.number);
  return bet.kind;
}

function payoutMultiplier(bet: RouletteBet): number {
  return bet.kind === 'number' ? 36 : 2;
}

function betWins(bet: RouletteBet, result: number): boolean {
  const color = wheelColor(result);
  switch (bet.kind) {
    case 'red':
      return color === 'red';
    case 'black':
      return color === 'black';
    case 'green':
      return result === 0;
    case 'odd':
      return result !== 0 && result % 2 === 1;
    case 'even':
      return result !== 0 && result % 2 === 0;
    case 'number':
      return result === bet.number;
    default:
      return false;
  }
}

export function tableStatusMessage(table: RouletteTable): string {
  if (table.state === 'idle') {
    return '🎡 Roulette idle — !roulette to open betting.';
  }
  const secs = Math.max(0, Math.ceil((table.phaseEndsAt - Date.now()) / 1000));
  const bettors = table.bets.length
    ? table.bets.map((b) => `@${b.displayName} (${betLabel(b)} ${b.amount})`).join(', ')
    : 'no bets yet';
  return `🎡 Roulette betting (${secs}s): ${bettors} — !rbet red/black/odd/even/0-36 <amount>`;
}

function spinWheel(): number {
  return Math.floor(Math.random() * 37);
}

async function settleBets(table: RouletteTable): Promise<{ table: RouletteTable; messages: string[] }> {
  const result = spinWheel();
  const messages: string[] = [`🎡 Wheel lands on ${formatSpinResult(result)}!`];

  if (!table.bets.length) {
    messages.push('🎡 Nobody bet — !roulette to spin again.');
    return { table: { ...idleTable(), lastResult: result }, messages };
  }

  for (const bet of table.bets) {
    const current = await getPlayerChips(bet.login);
    if (betWins(bet, result)) {
      const payout = bet.amount * payoutMultiplier(bet);
      const next = current + payout;
      const settled = await settlePlayerChips(bet.login, bet.displayName, next);
      const profit = payout - bet.amount;
      messages.push(`🎉 @${bet.displayName} wins on ${betLabel(bet)} (+${profit}) — ${settled.chips} chips`);
      if (settled.debtMessage) messages.push(settled.debtMessage);
    } else {
      messages.push(`💨 @${bet.displayName} loses ${bet.amount} on ${betLabel(bet)} — ${current} chips`);
    }
  }

  messages.push('🎡 Round over — !roulette for the next spin.');
  return { table: { ...idleTable(), lastResult: result }, messages };
}

async function advancePhase(table: RouletteTable): Promise<{ table: RouletteTable; messages: string[] }> {
  if (table.state === 'betting' && Date.now() >= table.phaseEndsAt) {
    return settleBets(table);
  }
  return { table, messages: [] };
}

export async function handleRouletteAction(req: RouletteActionRequest): Promise<RouletteActionResult> {
  const login = normalizeLogin(req.username);
  const displayName = req.displayName?.trim() || req.username;
  if (!login) {
    return { ok: false, messages: [], error: 'invalid user' };
  }

  if (req.action === 'tick') {
    return withTableMutation(async (table) => {
      const advanced = await advancePhase(table);
      return { table: advanced.table, result: { ok: true, messages: advanced.messages } };
    });
  }

  if (req.action === 'status') {
    const table = await loadTable();
    return { ok: true, messages: [tableStatusMessage(table)] };
  }

  if (req.action === 'stop') {
    if (!req.isMod) {
      return { ok: false, messages: [], error: 'mods only' };
    }
    return withTableMutation(async (table) => {
      if (table.state === 'betting' && table.bets.length) {
        const messages: string[] = ['🎡 Roulette cancelled by mod — refunding bets.'];
        for (const bet of table.bets) {
          const chips = await getPlayerChips(bet.login);
          const refunded = chips + bet.amount;
          await settlePlayerChips(bet.login, bet.displayName, refunded);
          messages.push(`🎡 @${bet.displayName} refunded ${bet.amount} chips.`);
        }
        return { table: idleTable(), result: { ok: true, messages } };
      }
      return { table: idleTable(), result: { ok: true, messages: ['🎡 Roulette cleared.'] } };
    });
  }

  if (req.action === 'open') {
    return withTableMutation(async (table) => {
      const messages: string[] = [];

      if (table.state === 'idle') {
        const bettingSecs = Math.ceil(BETTING_MS / 1000);
        table = {
          state: 'betting',
          roundId: newRoundId(),
          bets: [],
          phaseEndsAt: Date.now() + BETTING_MS,
        };
        messages.push(
          `🎡 ROULETTE OPEN! ${bettingSecs}s to bet — !rbet red/black/odd/even/0-36 <amount> (min ${MIN_BET}).`,
        );
        return { table, result: { ok: true, messages } };
      }

      if (table.state === 'betting') {
        messages.push(tableStatusMessage(table));
        return { table, result: { ok: true, messages } };
      }

      return { table, result: { ok: true, messages: [tableStatusMessage(table)] } };
    });
  }

  if (req.action === 'bet') {
    const choiceRaw = req.choice?.trim() ?? '';
    const parsedChoice = parseRouletteChoice(choiceRaw);
    if (!parsedChoice.ok) {
      return { ok: false, messages: [`🎡 ${parsedChoice.error}`], error: 'invalid choice' };
    }

    return withTableMutation(async (table) => {
      if (table.state !== 'betting') {
        return {
          table,
          result: {
            ok: false,
            messages: [table.state === 'idle' ? '🎡 !roulette first to open betting.' : tableStatusMessage(table)],
            error: 'not betting',
          },
        };
      }

      if (table.bets.some((bet) => bet.login === login)) {
        return {
          table,
          result: {
            ok: false,
            messages: [`@${displayName} you already have a bet this round.`],
            error: 'already bet',
          },
        };
      }

      const chips = await getPlayerChips(login);
      const parsedAmount = parseBetAmount(req.betInput ?? '', chips);
      if (!parsedAmount.ok) {
        return {
          table,
          result: { ok: false, messages: [`🎡 ${parsedAmount.error}`], error: 'invalid bet' },
        };
      }

      const amount = parsedAmount.amount;
      const remaining = await deductBetChips(login, displayName, amount);
      const bet: RouletteBet = {
        login,
        displayName,
        kind: parsedChoice.kind,
        number: parsedChoice.number,
        amount,
      };

      table = { ...table, bets: [...table.bets, bet] };
      const label = betLabel(bet);
      const allInNote = amount === chips ? ' (all-in)' : '';
      return {
        table,
        result: {
          ok: true,
          messages: [`🎡 @${displayName} bets ${amount} on ${label}${allInNote} (${remaining} left).`],
        },
      };
    });
  }

  return { ok: false, messages: [], error: 'unknown action' };
}
