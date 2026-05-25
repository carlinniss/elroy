import { hasRedisStorage, redisCommand, redisPipeline } from '@/lib/redis-rest';

export const STARTING_CHIPS = 1000;
export const MAX_SEATS = 5;
export const MIN_BET = 10;
export const MAX_BET = 200;
export const SEATING_MS = 45_000;
export const BETTING_MS = 30_000;
export const TURN_MS = 25_000;
/** Warn the active player once when this much time is left on their turn. */
export const TURN_NUDGE_REMAINING_MS = 12_000;
export const LEADERBOARD_SIZE = 3;

const TABLE_KEY = 'elroy:bj:table';
const CHIPS_KEY = 'elroy:bj:chips';
const PLAYED_KEY = 'elroy:bj:played';
const LEADERBOARD_KEY = 'elroy:bj:leaderboard';
const DISPLAY_NAMES_KEY = 'elroy:bj:display-names';

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
    | 'table'
    | 'chips'
    | 'leaders'
    | 'tick'
    | 'stop';
  username: string;
  displayName?: string;
  amount?: number;
  isMod?: boolean;
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
};

const globalStore = globalThis as typeof globalThis & { __elroyBlackjack?: MemoryStore };

function mem(): MemoryStore {
  if (!globalStore.__elroyBlackjack) {
    globalStore.__elroyBlackjack = {
      table: null,
      chips: new Map(),
      played: new Set(),
      displayNames: new Map(),
    };
  }
  return globalStore.__elroyBlackjack;
}

export function normalizeLogin(username: string) {
  return username.trim().toLowerCase();
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
    return `🃏 Betting (${secs}s) ${names} — !bet ${MIN_BET}-${MAX_BET}`;
  }
  if (table.state === 'player_turn') {
    const seat = table.seats[table.currentSeatIndex];
    const secs = Math.max(0, Math.ceil((table.phaseEndsAt - Date.now()) / 1000));
    const hands = table.seats.map(seatSummary).join(' | ');
    return `🃏 ${hands} | Dealer: ${formatHand(table.dealerHand, true)} — @${seat?.displayName} !hit or !stand (${secs}s)`;
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
    messages: [`🃏 @${seat.displayName} you're up — !hit or !stand.`],
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
        messages: [`🃏 @${seat.displayName} — !hit or !stand, you got ${secs}s left.`],
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
        `🃏 Seats locked: ${betting.seats.map((s) => `@${s.displayName}`).join(' ')} — !bet ${MIN_BET}-${MAX_BET} (${BETTING_MS / 1000}s)`,
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
          `🃏 @${displayName} took a seat (${table.seats.length}/${MAX_SEATS}) — !bet ${MIN_BET}-${MAX_BET} (${secs}s left).`,
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

      const amount = Math.floor(req.amount ?? 0);
      if (!Number.isFinite(amount) || amount < MIN_BET || amount > MAX_BET) {
        return {
          table,
          result: {
            ok: false,
            messages: [`🃏 Bet must be ${MIN_BET}-${MAX_BET} chips.`],
            error: 'invalid bet',
          },
        };
      }

      let chips = await getPlayerChips(login);
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

      messages.push(`🃏 @${displayName} bets ${amount} (${chips} left) — you're in this hand.`);

      return { table: nextTable, result: { ok: true, messages } };
    });
  }

  if (req.action === 'hit' || req.action === 'stand') {
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

      const result = req.action === 'hit' ? await hitCurrentSeat(table) : await applyStand(table);
      return { table: result.table, result: { ok: true, messages: result.messages } };
    });
  }

  return { ok: false, messages: [], error: 'unknown action' };
}
