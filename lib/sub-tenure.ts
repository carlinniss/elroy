/** Parse Twitch cumulative sub tenure (total months subscribed). */
export function parseCumulativeSubMonths(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Parse streak months when the viewer opted to share it. */
export function parseStreakSubMonths(
  value: unknown,
  shouldShare: unknown = true,
): number | null {
  if (
    shouldShare === false
    || shouldShare === '0'
    || shouldShare === 0
    || shouldShare === 'false'
  ) {
    return null;
  }
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function tierLabel(tier?: string): string {
  if (tier === '3000' || tier === 'Tier 3') return 'Tier 3';
  if (tier === '2000' || tier === 'Tier 2') return 'Tier 2';
  if (tier === 'Prime' || tier === 'prime') return 'Prime';
  return '';
}

function monthWord(count: number): string {
  return `${count} month${count === 1 ? '' : 's'}`;
}

export function formatSubTenureLine(
  cumulativeMonths: number | null,
  streakMonths: number | null,
): string {
  if (cumulativeMonths && streakMonths && streakMonths !== cumulativeMonths) {
    return `${monthWord(cumulativeMonths)} subscribed (${monthWord(streakMonths)} streak).`;
  }
  if (cumulativeMonths) {
    return `${monthWord(cumulativeMonths)} subscribed.`;
  }
  if (streakMonths) {
    return `${monthWord(streakMonths)} consecutive months.`;
  }
  return 'Resubscribed!';
}

export function formatSubCelebrationDetail(options: {
  cumulativeMonths?: number | null;
  streakMonths?: number | null;
  tier?: string;
  isGift?: boolean;
  message?: string;
  kind?: 'new' | 'resub' | 'gift' | 'mystery_gift';
  giftRecipient?: string;
  giftCount?: number;
}): string {
  const {
    cumulativeMonths = null,
    streakMonths = null,
    tier,
    isGift,
    message,
    kind = 'resub',
    giftRecipient,
    giftCount,
  } = options;

  const trimmedMessage = message?.trim();
  const tierText = tierLabel(tier);
  const tierSuffix = tierText ? ` ${tierText}` : '';

  if (kind === 'gift' && giftRecipient) {
    return `They gifted a${tierSuffix} sub to ${giftRecipient}!`;
  }
  if (kind === 'mystery_gift' && giftCount) {
    return `They dropped ${giftCount} gift sub${giftCount === 1 ? '' : 's'} on the community!`;
  }
  if (kind === 'new') {
    const parts = [`Brand new${tierSuffix} sub!`];
    if (isGift) parts[0] = `Brand new${tierSuffix} gift sub!`;
    if (trimmedMessage) parts.push(`They said: "${trimmedMessage}"`);
    return parts.join(' ');
  }

  const tenure = formatSubTenureLine(cumulativeMonths, streakMonths);
  const parts = [`${tenure.replace(/\.$/, '')}${tierSuffix}${isGift ? ' (gift)' : ''}.`];
  if (trimmedMessage) parts.push(`They said: "${trimmedMessage}"`);
  return parts.join(' ');
}

export function subTenureFromTmiUserstate(userstate: Record<string, unknown> | undefined): {
  cumulativeMonths: number | null;
  streakMonths: number | null;
} {
  if (!userstate) {
    return { cumulativeMonths: null, streakMonths: null };
  }
  return {
    cumulativeMonths: parseCumulativeSubMonths(userstate['msg-param-cumulative-months']),
    streakMonths: parseStreakSubMonths(
      userstate['msg-param-streak-months'],
      userstate['msg-param-should-share-streak'],
    ),
  };
}

export function subTenureFromEventPayload(payload: Record<string, unknown>): {
  cumulativeMonths: number | null;
  streakMonths: number | null;
} {
  const cumulative = parseCumulativeSubMonths(payload.cumulative_months);
  const streak = parseStreakSubMonths(
    payload.streak_months,
    payload.streak_months != null && Number(payload.streak_months) > 0,
  );
  return { cumulativeMonths: cumulative, streakMonths: streak };
}
