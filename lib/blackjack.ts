import { hasRedisStorage, redisCommand, redisPipeline } from '@/lib/redis-rest';

export const STARTING_CHIPS = 1000;
export const MAX_SEATS = 5;
export const MIN_BET = 10;
/** @deprecated Table no longer caps bets below chip stack — use player chip count. */
export const MAX_BET = 200;
export const SEATING_MS = 45_000;
export const BETTING_MS = 30_000;
export const TURN_MS = 25_000;
/** Warn the active player once when this much time is left on their turn. */
export const TURN_NUDGE_REMAINING_MS = 12_000;
export const LEADERBOARD_SIZE = 3;
export const DARE_REWARD_CHIPS = 120;
export const DARE_COOLDOWN_MS = 20 * 60 * 1000;
const DARE_COMPLETE_MS = 2 * 60 * 1000;
const LOAN_AMOUNT = 400;
const LOAN_REPAY_AMOUNT = 600;

const TABLE_KEY = 'elroy:bj:table';
const CHIPS_KEY = 'elroy:bj:chips';
const PLAYED_KEY = 'elroy:bj:played';
const LEADERBOARD_KEY = 'elroy:bj:leaderboard';
const DISPLAY_NAMES_KEY = 'elroy:bj:display-names';
const DARE_LAST_KEY = 'elroy:bj:dare:last';
const DARE_PENDING_KEY = 'elroy:bj:dare:pending';
const LOAN_DEBT_KEY = 'elroy:bj:loan:debt';

const SANDBOX_LOGINS = new Set(['testuser']);

export type Suit = 's' | 'h' | 'd' | 'c';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type Card = { rank: Rank; suit: Suit };

export type SeatStatus = 'waiting_bet' | 'playing' | 'stood' | 'bust' | 'blackjack';

export type BjSeat = {
  login: string;
  displayName: string;
  bet: number;
  hand: Card[];
  status: SeatStatus;
  doubledDown?: boolean;
};

export type BjTableState =
  | 'idle'
  | 'seating'
  | 'betting'
  | 'player_turn'
  | 'dealer_turn'
  | 'settle';

export type BjTable = {
  state: BjTableState;
  roundId: string;
  seats: BjSeat[];
  dealerHand: Card[];
  deck: Card[];
  currentSeatIndex: number;
  phaseEndsAt: number;
  /** One reminder per turn to !hit or !stand before auto-stand. */
  turnNudged?: boolean;
};

const TABLE_LOCK_KEY = 'elroy:bj:lock';
const TABLE_LOCK_MS = 3_000;
const TABLE_LOCK_ATTEMPTS = 24;
const BETTING_EXTENSION_MS = 4_000;
const BETTING_EXTENSION_CUTOFF_MS = 10_000;

export type BjLeader = {
  username: string;
  chips: number;
};

export type BjActionRequest = {
  action:
    | 'open'
    | 'join'
    | 'bet'
    | 'hit'
    | 'stand'
    | 'double'
    | 'table'
    | 'chips'
    | 'dare'
    | 'dareComplete'
    | 'loan'
    | 'debt'
    | 'leaders'
    | 'tick'
    | 'stop';
  username: string;
  displayName?: string;
  amount?: number;
  /** Raw !bet argument (e.g. "100", "all") — preferred over amount. */
  betInput?: string;
  /** Chat line for dareComplete ritual verification. */
  message?: string;
  isMod?: boolean;
};

export type BjPendingDare = {
  phrase: string;
  emotes: string[];
  expiresAt: number;
};

export type BjActionResult = {
  ok: boolean;
  messages: string[];
  error?: string;
};

type MemoryStore = {
  table: BjTable | null;
  chips: Map<string, number>;
  played: Set<string>;
  displayNames: Map<string, string>;
  dareLastAt: Map<string, number>;
  darePending: Map<string, BjPendingDare>;
  loanDebt: Map<string, number>;
};

const globalStore = globalThis as typeof globalThis & { __elroyBlackjack?: MemoryStore };

function mem(): MemoryStore {
  if (!globalStore.__elroyBlackjack) {
    globalStore.__elroyBlackjack = {
      table: null,
      chips: new Map(),
      played: new Set(),
      displayNames: new Map(),
      dareLastAt: new Map(),
      darePending: new Map(),
      loanDebt: new Map(),
    };
  }
  return globalStore.__elroyBlackjack;
}

export function normalizeLogin(username: string) {
  return username.trim().toLowerCase();
}

/** Parse !bet amount — numeric or all/max for entire stack. */
export function parseBetAmount(
  input: string,
  chips: number,
): { ok: true; amount: number } | { ok: false; error: string } {
  const raw = input.trim().toLowerCase();
  if (raw === 'all' || raw === 'max') {
    if (chips < MIN_BET) {
      return { ok: false, error: `You need at least ${MIN_BET} chips to bet.` };
    }
    return { ok: true, amount: chips };
  }

  const amount = Math.floor(Number(raw));
  if (!Number.isFinite(amount) || amount < MIN_BET) {
    return { ok: false, error: `Bet must be at least ${MIN_BET} chips.` };
  }
  if (amount > chips) {
    return { ok: false, error: `You only have ${chips} chips.` };
  }
  return { ok: true, amount };
}

function betHelpText() {
  return `!bet ${MIN_BET}+ or !bet all`;
}

function idleTable(): BjTable {
  return {
    state: 'idle',
    roundId: '',
    seats: [],
    dealerHand: [],
    deck: [],
    currentSeatIndex: 0,
    phaseEndsAt: 0,
  };
}

function newRoundId() {
  return `bj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const SUITS: Suit[] = ['s', 'h', 'd', 'c'];
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_SYMBOL: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

export function formatCard(card: Card) {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}

export function formatHand(hand: Card[], hideHole = false) {
  if (!hand.length) return '—';
  if (hideHole && hand.length >= 2) {
    return `${formatCard(hand[0])} ?`;
  }
  return hand.map(formatCard).join(' ');
}

function newDeck(): Card[] {
  const deck: Card[] = [];
  for (let d = 0; d < 2; d += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ rank, suit });
      }
    }
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function drawCard(deck: Card[]): { card: Card; deck: Card[] } {
  const next = [...deck];
  const card = next.pop();
  if (!card) throw new Error('deck empty');
  return { card, deck: next };
}

export function handValue(hand: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.rank === 'A') {
      aces += 1;
      total += 11;
    } else if (['K', 'Q', 'J'].includes(card.rank)) {
      total += 10;
    } else {
      total += Number.parseInt(card.rank, 10);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function isNaturalBlackjack(hand: Card[]) {
  return hand.length === 2 && handValue(hand) === 21;
}

async function loadTable(): Promise<BjTable> {
  if (hasRedisStorage()) {
    try {
      const raw = await redisCommand(['GET', TABLE_KEY]);
      if (raw && typeof raw === 'string') {
        return JSON.parse(raw) as BjTable;
      }
    } catch (error) {
      console.error('Redis blackjack table read failed', error);
    }
  }
  return mem().table ?? idleTable();
}

async function saveTable(table: BjTable): Promise<void> {
  if (hasRedisStorage()) {
    try {
      await redisCommand(['SET', TABLE_KEY, JSON.stringify(table)]);
      return;
    } catch (error) {
      console.error('Redis blackjack table write failed', error);
    }
  }
  mem().table = table;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

let memoryTableLock: Promise<void> = Promise.resolve();

async function withMemoryTableMutation(
  fn: (table: BjTable) => Promise<{ table: BjTable; result: BjActionResult }>,
): Promise<BjActionResult> {
  const gate = memoryTableLock;
  let release!: () => void;
  memoryTableLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await gate;
  try {
    const table = await loadTable();
    const { table: nextTable, result } = await fn(table);
    mem().table = nextTable;
    return result;
  } finally {
    release();
  }
}

async function withTableMutation(
  fn: (table: BjTable) => Promise<{ table: BjTable; result: BjActionResult }>,
): Promise<BjActionResult> {
  if (!hasRedisStorage()) {
    return withMemoryTableMutation(fn);
  }

  for (let attempt = 0; attempt < TABLE_LOCK_ATTEMPTS; attempt += 1) {
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const acquired = await redisCommand(['SET', TABLE_LOCK_KEY, token, 'NX', 'PX', String(TABLE_LOCK_MS)]);
    if (acquired === 'OK') {
      try {
        const table = await loadTable();
        const { table: nextTable, result } = await fn(table);
        await saveTable(nextTable);
        return result;
      } finally {
        const current = await redisCommand(['GET', TABLE_LOCK_KEY]);
        if (current === token) {
          await redisCommand(['DEL', TABLE_LOCK_KEY]);
        }
      }
    }
    await sleep(35 + attempt * 10);
  }

  return { ok: false, messages: ['🃏 Table busy — try your command again.'], error: 'locked' };
}

async function getDisplayName(login: string): Promise<string> {
  if (hasRedisStorage()) {
    try {
      const name = await redisCommand(['HGET', DISPLAY_NAMES_KEY, login]);
      if (typeof name === 'string' && name.length > 0) return name;
    } catch {
      /* fallback */
    }
  }
  return mem().displayNames.get(login) ?? login;
}

async function setDisplayName(login: string, displayName: string) {
  const name = displayName.trim() || login;
  if (hasRedisStorage()) {
    try {
      await redisCommand(['HSET', DISPLAY_NAMES_KEY, login, name]);
      return;
    } catch {
      /* fallback */
    }
  }
  mem().displayNames.set(login, name);
}

export async function getPlayerChips(username: string): Promise<number> {
  const login = normalizeLogin(username);
  if (!login) return STARTING_CHIPS;

  if (hasRedisStorage()) {
    try {
      const raw = await redisCommand(['HGET', CHIPS_KEY, login]);
      if (raw !== null && raw !== undefined) {
        const chips = Number.parseInt(String(raw), 10);
        if (Number.isFinite(chips)) return chips;
      }
    } catch (error) {
      console.error('Redis blackjack chips read failed', error);
    }
  } else if (mem().chips.has(login)) {
    return mem().chips.get(login)!;
  }

  return STARTING_CHIPS;
}

async function setPlayerChips(login: string, chips: number, displayName?: string) {
  const value = Math.max(0, Math.floor(chips));
  if (displayName) await setDisplayName(login, displayName);

  if (hasRedisStorage()) {
    try {
      await redisCommand(['HSET', CHIPS_KEY, login, String(value)]);
    } catch (error) {
      console.error('Redis blackjack chips write failed', error);
    }
  }
  mem().chips.set(login, value);
}

async function getLoanDebt(login: string): Promise<number> {
  if (hasRedisStorage()) {
    try {
      const raw = await redisCommand(['HGET', LOAN_DEBT_KEY, login]);
      if (raw !== null && raw !== undefined) {
        const debt = Number.parseInt(String(raw), 10);
        if (Number.isFinite(debt) && debt > 0) return debt;
      }
    } catch {
      /* fallback */
    }
  }
  return mem().loanDebt.get(login) ?? 0;
}

async function setLoanDebt(login: string, debt: number) {
  const value = Math.max(0, Math.floor(debt));
  if (hasRedisStorage()) {
    try {
      if (value <= 0) {
        await redisCommand(['HDEL', LOAN_DEBT_KEY, login]);
      } else {
        await redisCommand(['HSET', LOAN_DEBT_KEY, login, String(value)]);
      }
    } catch {
      /* fallback */
    }
  }
  if (value <= 0) mem().loanDebt.delete(login);
  else mem().loanDebt.set(login, value);
}

async function getLastDareAt(login: string): Promise<number> {
  if (hasRedisStorage()) {
    try {
      const raw = await redisCommand(['HGET', DARE_LAST_KEY, login]);
      if (raw !== null && raw !== undefined) {
        const at = Number.parseInt(String(raw), 10);
        if (Number.isFinite(at) && at > 0) return at;
      }
    } catch {
      /* fallback */
    }
  }
  return mem().dareLastAt.get(login) ?? 0;
}

async function setLastDareAt(login: string, at: number) {
  const value = Math.max(0, Math.floor(at));
  if (hasRedisStorage()) {
    try {
      await redisCommand(['HSET', DARE_LAST_KEY, login, String(value)]);
    } catch {
      /* fallback */
    }
  }
  mem().dareLastAt.set(login, value);
}

async function playerHasPlayed(login: string): Promise<boolean> {
  if (hasRedisStorage()) {
    try {
      const member = await redisCommand(['SISMEMBER', PLAYED_KEY, login]);
      return member === 1 || member === true;
    } catch {
      /* fallback */
    }
  }
  return mem().played.has(login);
}

async function markPlayerPlayed(login: string, displayName: string, chips: number) {
  if (SANDBOX_LOGINS.has(login)) return;

  if (hasRedisStorage()) {
    try {
      await redisPipeline([
        ['SADD', PLAYED_KEY, login],
        ['HSET', DISPLAY_NAMES_KEY, login, displayName],
        ['ZADD', LEADERBOARD_KEY, String(chips), login],
      ]);
      return;
    } catch (error) {
      console.error('Redis blackjack played mark failed', error);
    }
  }

  mem().played.add(login);
  mem().displayNames.set(login, displayName);
}

async function syncLeaderboard(login: string, chips: number) {
  if (SANDBOX_LOGINS.has(login)) return;
  if (!(await playerHasPlayed(login))) return;

  if (hasRedisStorage()) {
    try {
      await redisCommand(['ZADD', LEADERBOARD_KEY, String(chips), login]);
      return;
    } catch (error) {
      console.error('Redis blackjack leaderboard sync failed', error);
    }
  }
}

export async function getBlackjackLeaders(limit = LEADERBOARD_SIZE): Promise<BjLeader[]> {
  const leaders: BjLeader[] = [];

  if (hasRedisStorage()) {
    try {
      const rows = await redisCommand(['ZREVRANGE', LEADERBOARD_KEY, '0', String(limit * 2), 'WITHSCORES']);
      if (Array.isArray(rows)) {
        for (let i = 0; i < rows.length; i += 2) {
          const login = String(rows[i]).toLowerCase();
          if (SANDBOX_LOGINS.has(login)) continue;
          const chips = Number.parseInt(String(rows[i + 1]), 10);
          if (!Number.isFinite(chips)) continue;
          const username = await getDisplayName(login);
          leaders.push({ username, chips });
          if (leaders.length >= limit) break;
        }
      }
      return leaders;
    } catch (error) {
      console.error('Redis blackjack leaderboard read failed', error);
    }
  }

  const entries: BjLeader[] = [];
  for (const login of mem().played) {
    if (SANDBOX_LOGINS.has(login)) continue;
    entries.push({
      username: mem().displayNames.get(login) ?? login,
      chips: mem().chips.get(login) ?? STARTING_CHIPS,
    });
  }
  entries.sort((a, b) => b.chips - a.chips);
  return entries.slice(0, limit);
}

export function formatBlackjackLeaderboard(leaders: BjLeader[]): string {
  if (!leaders.length) {
    return '🃏 No blackjack high rollers yet — play a hand at the table to rank!';
  }
  const parts = leaders.map((entry, index) => `${index + 1}. ${entry.username} (${entry.chips})`);
  return `🃏 Blackjack high rollers: ${parts.join(' | ')}`;
}

/** Twitch-style emotes used in dare rituals (typed in chat, case-insensitive). */
export const EMBARRASSING_EMOTES = [
  'LUL', 'KEKW', 'OMEGALUL', 'monkaS', 'monkaW', 'PepeLaugh', 'Sadge', 'Copium',
  'EZ', 'Clown', 'WeirdChamp', 'FailFish', 'catSigh', 'PepeHands', 'FeelsBadMan',
  'Pepega', 'PogChamp', 'BibleThump', 'DansGame', 'ResidentSleeper', 'haHAA',
];

type DareTemplate = {
  phrase: string;
  emoteCount: number;
};

const DARE_TEMPLATES: DareTemplate[] = [
  { phrase: 'i folded pocket aces in chat and blamed the dealer', emoteCount: 2 },
  { phrase: 'i asked elroy for bailout money and got roasted live', emoteCount: 2 },
  { phrase: 'my blackjack strategy is vibes panic and bad math', emoteCount: 2 },
  { phrase: 'i chased losses and called it character development', emoteCount: 2 },
  { phrase: 'i tilted off a pair of threes like it was personal', emoteCount: 2 },
  { phrase: 'i need chip welfare and i am not ashamed enough yet', emoteCount: 2 },
];

function normalizeDareText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickDareTemplate(): { phrase: string; emotes: string[] } {
  const template = DARE_TEMPLATES[Math.floor(Math.random() * DARE_TEMPLATES.length)];
  const pool = [...EMBARRASSING_EMOTES];
  const emotes: string[] = [];
  while (emotes.length < template.emoteCount && pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    emotes.push(pool.splice(idx, 1)[0]);
  }
  return { phrase: template.phrase, emotes };
}

function dareMatchesMessage(pending: BjPendingDare, message: string): { ok: boolean; missingEmotes: string[] } {
  const normalized = normalizeDareText(message);
  const targetPhrase = normalizeDareText(pending.phrase);
  if (!normalized.includes(targetPhrase)) {
    return { ok: false, missingEmotes: pending.emotes };
  }

  const lower = message.toLowerCase();
  const missingEmotes = pending.emotes.filter((emote) => !lower.includes(emote.toLowerCase()));
  if (missingEmotes.length) {
    return { ok: false, missingEmotes };
  }
  return { ok: true, missingEmotes: [] };
}

async function getPendingDare(login: string): Promise<BjPendingDare | null> {
  if (hasRedisStorage()) {
    try {
      const raw = await redisCommand(['HGET', DARE_PENDING_KEY, login]);
      if (typeof raw === 'string' && raw) {
        const parsed = JSON.parse(raw) as BjPendingDare;
        if (parsed?.phrase && Array.isArray(parsed.emotes)) {
          if (parsed.expiresAt <= Date.now()) {
            await clearPendingDare(login);
            return null;
          }
          return parsed;
        }
      }
    } catch {
      /* fallback */
    }
  }

  const pending = mem().darePending.get(login);
  if (!pending) return null;
  if (pending.expiresAt <= Date.now()) {
    mem().darePending.delete(login);
    return null;
  }
  return pending;
}

async function setPendingDare(login: string, dare: BjPendingDare) {
  if (hasRedisStorage()) {
    try {
      await redisCommand(['HSET', DARE_PENDING_KEY, login, JSON.stringify(dare)]);
      return;
    } catch {
      /* fallback */
    }
  }
  mem().darePending.set(login, dare);
}

async function clearPendingDare(login: string) {
  if (hasRedisStorage()) {
    try {
      await redisCommand(['HDEL', DARE_PENDING_KEY, login]);
    } catch {
      /* fallback */
    }
  }
  mem().darePending.delete(login);
}

function seatSummary(seat: BjSeat) {
  const total = handValue(seat.hand);
  const cards = seat.hand.length ? formatHand(seat.hand) : '—';
  if (seat.status === 'bust') return `${seat.displayName}: ${cards} (BUST)`;
  if (seat.status === 'blackjack') return `${seat.displayName}: ${cards} (BJ!)`;
  if (seat.hand.length) return `${seat.displayName}: ${cards} (${total})`;
  return `${seat.displayName}: no cards`;
}

export function tableStatusMessage(table: BjTable): string {
  if (table.state === 'idle') {
    return '🃏 Table idle — !bj to open a round.';
  }
  if (table.state === 'seating') {
    const names = table.seats.map((s) => `@${s.displayName}`).join(' ') || '(empty)';
    const secs = Math.max(0, Math.ceil((table.phaseEndsAt - Date.now()) / 1000));
    return `🃏 Seating (${secs}s): ${names} — !bj to sit.`;
  }
  if (table.state === 'betting') {
    const secs = Math.max(0, Math.ceil((table.phaseEndsAt - Date.now()) / 1000));
    const names = table.seats.map((s) => `@${s.displayName}`).join(' ');
    return `🃏 Betting (${secs}s) ${names} — ${betHelpText()}`;
  }
  if (table.state === 'player_turn') {
    const seat = table.seats[table.currentSeatIndex];
    const secs = Math.max(0, Math.ceil((table.phaseEndsAt - Date.now()) / 1000));
    const hands = table.seats.map(seatSummary).join(' | ');
    const canDouble = seat?.status === 'playing' && seat.hand.length === 2 && !isNaturalBlackjack(seat.hand);
    const actions = canDouble ? '!hit, !stand, or !double' : '!hit or !stand';
    return `🃏 ${hands} | Dealer: ${formatHand(table.dealerHand, true)} — @${seat?.displayName} ${actions} (${secs}s)`;
  }
  return '🃏 Table busy.';
}

function findSeat(table: BjTable, login: string) {
  return table.seats.find((seat) => seat.login === login);
}

async function refundSeatBets(table: BjTable): Promise<void> {
  for (const seat of table.seats) {
    if (seat.bet <= 0) continue;
    const chips = await getPlayerChips(seat.login);
    await setPlayerChips(seat.login, chips + seat.bet, seat.displayName);
    if (await playerHasPlayed(seat.login)) {
      await syncLeaderboard(seat.login, chips + seat.bet);
    }
  }
}

function nextPlayingSeatIndex(seats: BjSeat[], from: number): number {
  for (let i = from + 1; i < seats.length; i += 1) {
    if (seats[i].status === 'playing') return i;
  }
  return -1;
}

function firstPlayingSeatIndex(seats: BjSeat[]): number {
  return seats.findIndex((seat) => seat.status === 'playing');
}

function anyPlayingSeatsRemain(seats: BjSeat[]): boolean {
  return seats.some((seat) => seat.status === 'playing');
}

function turnPromptForSeat(seat: BjSeat): string {
  const canDouble = seat.status === 'playing' && seat.hand.length === 2 && !isNaturalBlackjack(seat.hand);
  const actions = canDouble ? '!hit, !stand, or !double' : '!hit or !stand';
  return `🃏 @${seat.displayName} you're up — ${actions}.`;
}

function promptNextTurn(table: BjTable, seatIndex: number): { table: BjTable; messages: string[] } {
  const seat = table.seats[seatIndex];
  return {
    table: {
      ...table,
      state: 'player_turn',
      currentSeatIndex: seatIndex,
      phaseEndsAt: Date.now() + TURN_MS,
      turnNudged: false,
    },
    messages: [turnPromptForSeat(seat)],
  };
}

function startBetting(table: BjTable): BjTable {
  return {
    ...table,
    state: 'betting',
    phaseEndsAt: Date.now() + BETTING_MS,
  };
}

async function dealRound(table: BjTable): Promise<{ table: BjTable; messages: string[] }> {
  const seated = table.seats.filter((seat) => seat.bet > 0);
  if (!seated.length) {
    return { table: idleTable(), messages: ['🃏 No bets placed — table closed. !bj to open again.'] };
  }

  let deck = table.deck.length >= 20 ? [...table.deck] : newDeck();
  const seats: BjSeat[] = [];
  const dealerHand: Card[] = [];

  for (const seat of seated) {
    const c1 = drawCard(deck);
    const c2 = drawCard(c1.deck);
    deck = c2.deck;
    const hand = [c1.card, c2.card];
    seats.push({
      ...seat,
      hand,
      status: isNaturalBlackjack(hand) ? 'blackjack' : 'playing',
    });
  }

  const d1 = drawCard(deck);
  const d2 = drawCard(d1.deck);
  deck = d2.deck;
  dealerHand.push(d1.card, d2.card);

  const messages = [`🃏 Deal — ${seats.map(seatSummary).join(' | ')} | Dealer: ${formatHand(dealerHand, true)}`];

  for (const seat of seats) {
    if (seat.status === 'blackjack') {
      messages.push(`🃏 @${seat.displayName} blackjack — waiting on the rest of the table.`);
    }
  }

  const next: BjTable = {
    ...table,
    seats,
    dealerHand,
    deck,
    currentSeatIndex: 0,
    phaseEndsAt: 0,
  };

  const first = firstPlayingSeatIndex(seats);
  if (first < 0) {
    return finishDealerAndSettle(next);
  }

  const playing = promptNextTurn(next, first);
  return { table: playing.table, messages: [...messages, ...playing.messages] };
}

function standCurrentSeat(table: BjTable): { table: BjTable; messages: string[]; toSettle: boolean } {
  const seats = [...table.seats];
  const idx = table.currentSeatIndex;
  const seat = seats[idx];
  if (!seat || seat.status !== 'playing') {
    return { table, messages: [], toSettle: false };
  }
  seats[idx] = { ...seat, status: 'stood' };
  return advanceAfterSeatAction({ ...table, seats });
}

function advanceAfterSeatAction(table: BjTable): { table: BjTable; messages: string[]; toSettle: boolean } {
  const nextIdx = nextPlayingSeatIndex(table.seats, table.currentSeatIndex);
  if (nextIdx >= 0) {
    const prompted = promptNextTurn(table, nextIdx);
    return { table: prompted.table, messages: prompted.messages, toSettle: false };
  }

  if (anyPlayingSeatsRemain(table.seats)) {
    const catchUp = firstPlayingSeatIndex(table.seats);
    if (catchUp >= 0) {
      const prompted = promptNextTurn(table, catchUp);
      return { table: prompted.table, messages: prompted.messages, toSettle: false };
    }
  }

  return { table, messages: [], toSettle: true };
}

function skipInactiveCurrentSeat(table: BjTable): { table: BjTable; messages: string[]; toSettle: boolean } {
  const current = table.seats[table.currentSeatIndex];
  if (current?.status === 'playing') {
    return { table, messages: [], toSettle: false };
  }

  const nextIdx = nextPlayingSeatIndex(table.seats, table.currentSeatIndex);
  if (nextIdx >= 0) {
    const prompted = promptNextTurn(table, nextIdx);
    return { table: prompted.table, messages: prompted.messages, toSettle: false };
  }

  if (anyPlayingSeatsRemain(table.seats)) {
    const catchUp = firstPlayingSeatIndex(table.seats);
    if (catchUp >= 0) {
      const prompted = promptNextTurn(table, catchUp);
      return { table: prompted.table, messages: prompted.messages, toSettle: false };
    }
  }

  return { table, messages: [], toSettle: !anyPlayingSeatsRemain(table.seats) };
}

async function finishDealerAndSettle(table: BjTable): Promise<{ table: BjTable; messages: string[] }> {
  if (anyPlayingSeatsRemain(table.seats)) {
    const catchUp = firstPlayingSeatIndex(table.seats);
    if (catchUp >= 0) {
      const prompted = promptNextTurn(table, catchUp);
      return { table: prompted.table, messages: prompted.messages };
    }
  }

  let deck = table.deck;
  const dealerHand = [...table.dealerHand];
  while (handValue(dealerHand) < 17) {
    const drawn = drawCard(deck);
    dealerHand.push(drawn.card);
    deck = drawn.deck;
  }
  return settleRound({ ...table, dealerHand, deck });
}

async function settleRound(table: BjTable): Promise<{ table: BjTable; messages: string[] }> {
  const dealerHand = table.dealerHand;
  const dealerTotal = handValue(dealerHand);
  const dealerBj = isNaturalBlackjack(dealerHand);
  const messages: string[] = [`🃏 Dealer: ${formatHand(dealerHand)} (${dealerTotal})`];

  for (const seat of table.seats) {
    if (seat.bet <= 0) continue;

    let chips = await getPlayerChips(seat.login);
    const bet = seat.bet;
    const playerTotal = handValue(seat.hand);
    const playerBj = seat.status === 'blackjack' || isNaturalBlackjack(seat.hand);
    let outcome = '';

    if (playerBj && dealerBj) {
      chips += bet;
      outcome = 'push (both BJ)';
    } else if (playerBj) {
      chips += bet + Math.floor(bet * 1.5);
      outcome = `blackjack +${Math.floor(bet * 1.5)}`;
    } else if (dealerBj) {
      outcome = `lost -${bet}`;
    } else if (seat.status === 'bust') {
      outcome = `bust -${bet}`;
    } else if (dealerTotal > 21) {
      chips += bet * 2;
      outcome = `win +${bet}`;
    } else if (playerTotal > dealerTotal) {
      chips += bet * 2;
      outcome = `win +${bet}`;
    } else if (playerTotal === dealerTotal) {
      chips += bet;
      outcome = 'push';
    } else {
      outcome = `lost -${bet}`;
    }

    await setPlayerChips(seat.login, chips, seat.displayName);
    const debt = await getLoanDebt(seat.login);
    if (debt > 0) {
      const collected = Math.min(debt, chips);
      if (collected > 0) {
        chips -= collected;
        await setPlayerChips(seat.login, chips, seat.displayName);
        await setLoanDebt(seat.login, debt - collected);
        messages.push(`💸 @${seat.displayName}: house collected ${collected} toward loan (${Math.max(0, debt - collected)} debt left).`);
      }
    }
    await syncLeaderboard(seat.login, chips);
    messages.push(`@${seat.displayName}: ${outcome} — ${chips} chips`);
  }

  messages.push('🃏 Round over — !bj to open the next table.');
  return { table: idleTable(), messages };
}

async function closeBettingAndDeal(table: BjTable): Promise<{ table: BjTable; messages: string[] }> {
  const active = table.seats.filter((seat) => seat.bet > 0);
  const satOut = table.seats.filter((seat) => seat.bet <= 0);
  const messages: string[] = [];

  if (satOut.length) {
    messages.push(`🃏 Sat out (no bet): ${satOut.map((s) => `@${s.displayName}`).join(' ')}`);
  }

  if (!active.length) {
    await refundSeatBets(table);
    return { table: idleTable(), messages: [...messages, '🃏 Nobody bet — table closed. !bj to open again.'] };
  }

  messages.push(`🃏 Dealing to: ${active.map((s) => `@${s.displayName}`).join(' ')}`);

  const trimmed: BjTable = { ...table, seats: active };
  const dealt = await dealRound(trimmed);
  return { table: dealt.table, messages: [...messages, ...dealt.messages] };
}

async function advancePhase(table: BjTable): Promise<{ table: BjTable; messages: string[] }> {
  if (table.state === 'idle' || table.state === 'settle') {
    return { table, messages: [] };
  }

  if (table.state === 'player_turn') {
    const remaining = table.phaseEndsAt - Date.now();
    const seat = table.seats[table.currentSeatIndex];
    if (
      seat?.status === 'playing'
      && !table.turnNudged
      && remaining > 0
      && remaining <= TURN_NUDGE_REMAINING_MS
    ) {
      const secs = Math.max(1, Math.ceil(remaining / 1000));
      return {
        table: { ...table, turnNudged: true },
        messages: [`🃏 @${seat.displayName} — ${seat.hand.length === 2 && !isNaturalBlackjack(seat.hand) ? '!hit, !stand, or !double' : '!hit or !stand'}, you got ${secs}s left.`],
      };
    }
  }

  if (Date.now() < table.phaseEndsAt) {
    return { table, messages: [] };
  }

  if (table.state === 'seating') {
    if (!table.seats.length) {
      return { table: idleTable(), messages: ['🃏 Nobody sat — table closed.'] };
    }
    const betting = startBetting(table);
    return {
      table: betting,
      messages: [
        `🃏 Seats locked: ${betting.seats.map((s) => `@${s.displayName}`).join(' ')} — ${betHelpText()} (${BETTING_MS / 1000}s)`,
      ],
    };
  }

  if (table.state === 'betting') {
    return closeBettingAndDeal(table);
  }

  if (table.state === 'player_turn') {
    const skipped = skipInactiveCurrentSeat(table);
    if (skipped.messages.length || skipped.table.currentSeatIndex !== table.currentSeatIndex) {
      if (skipped.toSettle) {
        const settled = await finishDealerAndSettle(skipped.table);
        return { table: settled.table, messages: [...skipped.messages, ...settled.messages] };
      }
      return { table: skipped.table, messages: skipped.messages };
    }

    const seat = table.seats[table.currentSeatIndex];
    const timeoutNote = seat
      ? [`🃏 @${seat.displayName} timed out — auto-stand.`]
      : [];
    const stood = standCurrentSeat(table);
    if (stood.toSettle) {
      const settled = await finishDealerAndSettle(stood.table);
      return { table: settled.table, messages: [...timeoutNote, ...stood.messages, ...settled.messages] };
    }
    return { table: stood.table, messages: [...timeoutNote, ...stood.messages] };
  }

  return { table, messages: [] };
}

async function hitCurrentSeat(table: BjTable): Promise<{ table: BjTable; messages: string[] }> {
  const idx = table.currentSeatIndex;
  const seat = table.seats[idx];
  if (!seat || seat.status !== 'playing') {
    return { table, messages: [] };
  }

  const drawn = drawCard(table.deck);
  const hand = [...seat.hand, drawn.card];
  const total = handValue(hand);
  const seats = [...table.seats];

  if (total > 21) {
    seats[idx] = { ...seat, hand, status: 'bust' };
    const messages = [`🃏 @${seat.displayName} draws ${formatCard(drawn.card)} — BUST (${total})`];
    const advanced = advanceAfterSeatAction({ ...table, seats, deck: drawn.deck });
    if (advanced.toSettle) {
      const settled = await finishDealerAndSettle(advanced.table);
      return { table: settled.table, messages: [...messages, ...settled.messages] };
    }
    return { table: advanced.table, messages: [...messages, ...advanced.messages] };
  }

  seats[idx] = { ...seat, hand, status: 'playing' };
  return {
    table: {
      ...table,
      seats,
      deck: drawn.deck,
      phaseEndsAt: Date.now() + TURN_MS,
      turnNudged: false,
    },
    messages: [`🃏 @${seat.displayName} draws ${formatCard(drawn.card)} — now ${total}. !hit or !stand.`],
  };
}

async function applyStand(table: BjTable): Promise<{ table: BjTable; messages: string[] }> {
  const idx = table.currentSeatIndex;
  const seat = table.seats[idx];
  if (!seat || seat.status !== 'playing') {
    return { table, messages: [] };
  }

  const total = handValue(seat.hand);
  const messages = [`🃏 @${seat.displayName} stands on ${total}.`];
  const stood = standCurrentSeat(table);
  if (stood.toSettle) {
    const settled = await finishDealerAndSettle(stood.table);
    return { table: settled.table, messages: [...messages, ...settled.messages] };
  }
  return { table: stood.table, messages: [...messages, ...stood.messages] };
}

async function doubleDownCurrentSeat(table: BjTable): Promise<{ table: BjTable; messages: string[] }> {
  const idx = table.currentSeatIndex;
  const seat = table.seats[idx];
  if (!seat || seat.status !== 'playing') {
    return { table, messages: [] };
  }

  if (seat.hand.length !== 2) {
    return {
      table,
      messages: [`🃏 @${seat.displayName} double down is only on your first two cards — !hit or !stand.`],
    };
  }

  if (isNaturalBlackjack(seat.hand)) {
    return {
      table,
      messages: [`🃏 @${seat.displayName} can't double down on a natural blackjack.`],
    };
  }

  const additional = seat.bet;
  let chips = await getPlayerChips(seat.login);
  if (chips < additional) {
    return {
      table,
      messages: [
        `🃏 @${seat.displayName} need ${additional} more chips to double down (you have ${chips}).`,
      ],
    };
  }

  chips -= additional;
  await setPlayerChips(seat.login, chips, seat.displayName);
  await syncLeaderboard(seat.login, chips);

  const doubledBet = seat.bet + additional;
  const drawn = drawCard(table.deck);
  const hand = [...seat.hand, drawn.card];
  const total = handValue(hand);
  const seats = [...table.seats];
  const status: SeatStatus = total > 21 ? 'bust' : 'stood';

  seats[idx] = {
    ...seat,
    hand,
    bet: doubledBet,
    status,
    doubledDown: true,
  };

  const messages = [
    `🃏 @${seat.displayName} DOUBLE DOWN to ${doubledBet} — draws ${formatCard(drawn.card)} (${total})${
      status === 'bust' ? ' BUST' : ''
    }.`,
  ];

  const advanced = advanceAfterSeatAction({ ...table, seats, deck: drawn.deck });
  if (advanced.toSettle) {
    const settled = await finishDealerAndSettle(advanced.table);
    return { table: settled.table, messages: [...messages, ...settled.messages] };
  }
  return { table: advanced.table, messages: [...messages, ...advanced.messages] };
}

export async function handleBlackjackAction(req: BjActionRequest): Promise<BjActionResult> {
  const login = normalizeLogin(req.username);
  const displayName = req.displayName?.trim() || req.username.trim() || login;
  if (!login) {
    return { ok: false, messages: [], error: 'username required' };
  }

  if (req.action === 'chips') {
    const chips = await getPlayerChips(login);
    return { ok: true, messages: [`@${displayName} you have ${chips} OG chips.`] };
  }

  if (req.action === 'debt') {
    const debt = await getLoanDebt(login);
    if (debt <= 0) {
      return { ok: true, messages: [`@${displayName} you have no casino debt.`] };
    }
    return { ok: true, messages: [`@${displayName} loan debt remaining: ${debt} chips.`] };
  }

  if (req.action === 'dareComplete') {
    const message = req.message?.trim() ?? '';
    if (!message) {
      return { ok: false, messages: [], error: 'message required' };
    }

    const pending = await getPendingDare(login);
    if (!pending) {
      return { ok: false, messages: [], error: 'no pending dare' };
    }

    const match = dareMatchesMessage(pending, message);
    if (!match.ok) {
      const emoteHint =
        match.missingEmotes.length > 0
          ? ` Still need: ${match.missingEmotes.join(' ')}.`
          : ' Include the exact shame line from !dare.';
      return {
        ok: false,
        messages: [`🃏 @${displayName} ritual rejected.${emoteHint} No chips until you comply.`],
        error: 'dare incomplete',
      };
    }

    const now = Date.now();
    const chips = await getPlayerChips(login);
    const nextChips = chips + DARE_REWARD_CHIPS;
    await setPlayerChips(login, nextChips, displayName);
    await markPlayerPlayed(login, displayName, nextChips);
    await syncLeaderboard(login, nextChips);
    await setLastDareAt(login, now);
    await clearPendingDare(login);

    return {
      ok: true,
      messages: [
        `🃏 @${displayName} shame ritual ACCEPTED. Dignity forfeited.`,
        `🃏 +${DARE_REWARD_CHIPS} chips. Stack: ${nextChips}. Don't spend it on hope.`,
      ],
    };
  }

  if (req.action === 'dare') {
    const now = Date.now();
    const pending = await getPendingDare(login);
    if (pending) {
      const emoteList = pending.emotes.join(' ');
      const secs = Math.max(1, Math.ceil((pending.expiresAt - now) / 1000));
      return {
        ok: false,
        messages: [
          `🃏 @${displayName} finish your ritual first (${secs}s left): "${pending.phrase}" + emotes: ${emoteList}`,
        ],
        error: 'dare pending',
      };
    }

    const lastAt = await getLastDareAt(login);
    const waitMs = DARE_COOLDOWN_MS - (now - lastAt);
    if (waitMs > 0) {
      const mins = Math.max(1, Math.ceil(waitMs / 60_000));
      return {
        ok: false,
        messages: [`@${displayName} you already did your shame ritual. Try again in ~${mins}m.`],
        error: 'dare cooldown',
      };
    }

    const { phrase, emotes } = pickDareTemplate();
    const expiresAt = now + DARE_COMPLETE_MS;
    await setPendingDare(login, { phrase, emotes, expiresAt });
    const emoteList = emotes.join(' ');
    const mins = Math.ceil(DARE_COMPLETE_MS / 60_000);

    return {
      ok: true,
      messages: [
        `🃏 @${displayName} NO BAILOUT YET. Begging is nasty work — complete the ritual for +${DARE_REWARD_CHIPS} chips:`,
        `🃏 Type in ONE message: "${phrase}" AND spam: ${emoteList} (${mins} min)`,
      ],
    };
  }

  if (req.action === 'loan') {
    const debt = await getLoanDebt(login);
    if (debt > 0) {
      return {
        ok: false,
        messages: [`@${displayName} you already owe ${debt} chips. No new loan till that's repaid.`],
        error: 'existing debt',
      };
    }

    const chips = await getPlayerChips(login);
    const nextChips = chips + LOAN_AMOUNT;
    await setPlayerChips(login, nextChips, displayName);
    await setLoanDebt(login, LOAN_REPAY_AMOUNT);
    await markPlayerPlayed(login, displayName, nextChips);
    await syncLeaderboard(login, nextChips);

    return {
      ok: true,
      messages: [
        `🃏 @${displayName} LOAN SHARK SPECIAL: +${LOAN_AMOUNT} chips now.`,
        `🃏 Debt set to ${LOAN_REPAY_AMOUNT}. House auto-collects from future round results until paid. Stack: ${nextChips}.`,
      ],
    };
  }

  if (req.action === 'leaders') {
    const leaders = await getBlackjackLeaders();
    return { ok: true, messages: [formatBlackjackLeaderboard(leaders)] };
  }

  if (req.action === 'table') {
    const table = await loadTable();
    return { ok: true, messages: [tableStatusMessage(table)] };
  }

  if (req.action === 'tick') {
    return withTableMutation(async (table) => {
      const advanced = await advancePhase(table);
      return { table: advanced.table, result: { ok: true, messages: advanced.messages } };
    });
  }

  if (req.action === 'stop') {
    if (!req.isMod) {
      return { ok: false, messages: [], error: 'mods only' };
    }
    return withTableMutation(async (table) => {
      if (table.state !== 'idle') {
        await refundSeatBets(table);
      }
      return {
        table: idleTable(),
        result: { ok: true, messages: ['🃏 Table cleared by mod — bets refunded.'] },
      };
    });
  }

  if (req.action === 'open' || req.action === 'join') {
    return withTableMutation(async (table) => {
      const messages: string[] = [];

      if (table.state === 'idle') {
        table = {
          state: 'seating',
          roundId: newRoundId(),
          seats: [],
          dealerHand: [],
          deck: newDeck(),
          currentSeatIndex: 0,
          phaseEndsAt: Date.now() + SEATING_MS,
        };
        messages.push(`🃏 Table open — !bj to sit (${SEATING_MS / 1000}s).`);
      }

      if (table.state !== 'seating' && table.state !== 'betting') {
        return {
          table,
          result: {
            ok: false,
            messages: [table.state === 'idle' ? '' : tableStatusMessage(table)].filter(Boolean),
            error: 'not seating',
          },
        };
      }

      if (findSeat(table, login)) {
        return {
          table,
          result: {
            ok: false,
            messages: [`@${displayName} you're already seated.`],
            error: 'already seated',
          },
        };
      }

      if (table.seats.length >= MAX_SEATS) {
        return {
          table,
          result: { ok: false, messages: ['🃏 Table full — wait for the next round.'], error: 'full' },
        };
      }

      table = {
        ...table,
        seats: [
          ...table.seats,
          {
            login,
            displayName,
            bet: 0,
            hand: [],
            status: 'waiting_bet',
          },
        ],
      };

      if (table.state === 'betting') {
        const secs = Math.max(1, Math.ceil((table.phaseEndsAt - Date.now()) / 1000));
        messages.push(
          `🃏 @${displayName} took a seat (${table.seats.length}/${MAX_SEATS}) — ${betHelpText()} (${secs}s left).`,
        );
      } else {
        messages.push(`🃏 @${displayName} took a seat (${table.seats.length}/${MAX_SEATS}).`);
      }

      return { table, result: { ok: true, messages } };
    });
  }

  if (req.action === 'bet') {
    return withTableMutation(async (table) => {
      const messages: string[] = [];

      if (table.state !== 'betting') {
        return {
          table,
          result: { ok: false, messages: [tableStatusMessage(table)], error: 'not betting' },
        };
      }

      const seat = findSeat(table, login);
      if (!seat) {
        return {
          table,
          result: {
            ok: false,
            messages: ['🃏 !bj to sit at the table, then !bet during the betting window.'],
            error: 'not seated',
          },
        };
      }
      if (seat.bet > 0) {
        return {
          table,
          result: {
            ok: false,
            messages: [`@${displayName} you already bet ${seat.bet}.`],
            error: 'already bet',
          },
        };
      }

      let chips = await getPlayerChips(login);
      const parsed = parseBetAmount(req.betInput ?? String(req.amount ?? ''), chips);
      if (!parsed.ok) {
        return {
          table,
          result: {
            ok: false,
            messages: [`🃏 ${parsed.error}`],
            error: 'invalid bet',
          },
        };
      }
      const amount = parsed.amount;

      if (chips < amount) {
        return {
          table,
          result: {
            ok: false,
            messages: [`@${displayName} you only have ${chips} chips — need ${amount}.`],
            error: 'insufficient chips',
          },
        };
      }

      chips -= amount;
      await setPlayerChips(login, chips, displayName);
      await markPlayerPlayed(login, displayName, chips);
      await syncLeaderboard(login, chips);

      const seats = table.seats.map((s) =>
        s.login === login ? { ...s, bet: amount, displayName } : s,
      );

      let nextTable: BjTable = { ...table, seats };
      if (nextTable.phaseEndsAt - Date.now() < BETTING_EXTENSION_CUTOFF_MS) {
        nextTable = {
          ...nextTable,
          phaseEndsAt: nextTable.phaseEndsAt + BETTING_EXTENSION_MS,
        };
        messages.push('🃏 Betting extended a few seconds so the table can lock in.');
      }

      const allInNote = amount === chips ? ' (all-in)' : '';
      messages.push(`🃏 @${displayName} bets ${amount}${allInNote} (${chips} left) — you're in this hand.`);

      return { table: nextTable, result: { ok: true, messages } };
    });
  }

  if (req.action === 'hit' || req.action === 'stand' || req.action === 'double') {
    return withTableMutation(async (table) => {
      if (table.state !== 'player_turn') {
        return {
          table,
          result: { ok: false, messages: [tableStatusMessage(table)], error: 'not your turn' },
        };
      }

      const current = table.seats[table.currentSeatIndex];
      if (!current || current.login !== login) {
        return {
          table,
          result: {
            ok: false,
            messages: [`🃏 It's @${current?.displayName ?? 'someone else'}'s turn.`],
            error: 'wrong turn',
          },
        };
      }

      const result = req.action === 'hit'
        ? await hitCurrentSeat(table)
        : req.action === 'double'
          ? await doubleDownCurrentSeat(table)
          : await applyStand(table);
      return { table: result.table, result: { ok: true, messages: result.messages } };
    });
  }

  return { ok: false, messages: [], error: 'unknown action' };
}
