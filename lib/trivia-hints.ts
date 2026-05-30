import { normalizeTriviaAnswer } from '@/lib/cannabis-trivia';

/** Twitch chat answers should be short — never hint from displayAnswer prose. */
const HINT_MAX_ANSWER_LEN = 28;
const HINT_MAX_WORDS = 3;

function isEligibleHintAnswer(normalized: string): boolean {
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return normalized.length > 0 && normalized.length <= HINT_MAX_ANSWER_LEN && wordCount <= HINT_MAX_WORDS;
}

/** Prefer the main answer chat expects — never the shortest alias (e.g. "ca" vs "california"). */
function pickCanonicalHintAnswer(answers: string[], displayAnswer?: string): string {
  const trimmed = answers.map((entry) => entry.trim()).filter(Boolean);
  if (!trimmed.length) return '';

  const pool = trimmed
    .map((raw) => ({ raw, normalized: normalizeTriviaAnswer(raw) }))
    .filter((entry) => entry.normalized)
    .filter((entry) => isEligibleHintAnswer(entry.normalized));

  const candidates = pool.length
    ? pool
    : trimmed
      .map((raw) => ({ raw, normalized: normalizeTriviaAnswer(raw) }))
      .filter((entry) => entry.normalized);

  if (!candidates.length) return '';

  const longest = [...candidates].sort((a, b) => b.normalized.length - a.normalized.length)[0]!;

  const fromDisplay = displayAnswer ? normalizeTriviaAnswer(displayAnswer) : '';
  if (fromDisplay && isEligibleHintAnswer(fromDisplay) && fromDisplay.length >= longest.normalized.length) {
    return fromDisplay;
  }

  return longest.normalized;
}

/** Never reveal the whole word — short answers were leaking at high ratios. */
function maskWord(word: string, revealRatio: number): string {
  if (!word) return '';
  if (word.length === 1) return '_';

  const maxReveal = word.length - 1;
  const revealCount = Math.min(
    maxReveal,
    Math.max(1, Math.floor(word.length * revealRatio)),
  );
  return [...word].map((char, index) => (index < revealCount ? char : '_')).join('');
}

function revealRatioForBucket(minuteBucket: number): number {
  if (minuteBucket <= 1) return 0;
  if (minuteBucket === 2) return 0.25;
  if (minuteBucket === 3) return 0.4;
  return 0.55;
}

function formatWordLengths(words: string[]): string {
  if (words.length === 1) return `${words[0].length} letter${words[0].length === 1 ? '' : 's'}`;
  if (words.length === 2) return `${words[0].length} and ${words[1].length} letters`;
  const allButLast = words.slice(0, -1).map((w) => w.length).join(', ');
  const last = words[words.length - 1]!.length;
  return `${allButLast}, and ${last} letters`;
}

function buildYearHint(year: string, minuteBucket: number): string {
  const digits = year.replace(/\D/g, '');
  if (digits.length !== 4) {
    return `Hint: it's a year — ${maskWord(digits, revealRatioForBucket(minuteBucket))}`;
  }

  if (minuteBucket <= 1) {
    const century = digits.startsWith('19') ? '1900s' : digits.startsWith('20') ? '2000s' : 'a four-digit year';
    return `Hint: ${century}.`;
  }
  if (minuteBucket === 2) return `Hint: starts with ${digits[0]}___`;
  if (minuteBucket === 3) return `Hint: ${digits.slice(0, 2)}__`;
  return `Hint: ${digits.slice(0, 3)}_`;
}

function buildMultiWordHint(words: string[], minuteBucket: number): string {
  if (minuteBucket <= 1) {
    return `Hint: ${words.length} words (${formatWordLengths(words)}). First word starts with "${words[0]![0]?.toUpperCase() ?? '?'}".`;
  }

  const ratio = revealRatioForBucket(minuteBucket);
  const masked = words.map((word) => maskWord(word, ratio)).join(' ');
  if (minuteBucket >= 4) return `Hint: ${masked} — almost there!`;
  return `Hint: ${masked}`;
}

function buildSingleWordHint(answer: string, minuteBucket: number): string {
  const compact = answer.replace(/\s+/g, '');
  if (!compact) return 'Hint: you’re getting warmer.';

  if (minuteBucket <= 1) {
    return `Hint: ${compact.length} letters — starts with "${compact[0]?.toUpperCase() ?? '?'}"`;
  }

  const ratio = revealRatioForBucket(minuteBucket);
  const masked = maskWord(compact, ratio);
  if (minuteBucket >= 4) return `Hint: ${masked} — almost there!`;
  return `Hint: ${masked}`;
}

function assertNoAnswerLeak(hint: string, answer: string): string {
  const normalizedAnswer = normalizeTriviaAnswer(answer);
  if (!normalizedAnswer || normalizedAnswer.length < 3) return hint;

  const normalizedHint = normalizeTriviaAnswer(hint.replace(/_/g, ' '));
  if (normalizedHint.includes(normalizedAnswer)) {
    return 'Hint: keep guessing — you’re getting warmer.';
  }

  return hint;
}

/** Progressive hints for minute 1–4 of a 5-minute trivia window (bucket = minutes elapsed). */
export function buildTriviaProgressHint(
  answers: string[],
  minuteBucket: number,
  options: { displayAnswer?: string; maxLength?: number } = {},
): string {
  const { displayAnswer, maxLength = 500 } = options;
  const hint = buildAnswerProgressHint(answers, minuteBucket, displayAnswer);
  if (hint.length <= maxLength) return hint;
  return `${hint.slice(0, maxLength - 1).trim()}…`;
}

function buildAnswerProgressHint(
  answers: string[],
  minuteBucket: number,
  displayAnswer?: string,
): string {
  const primary = pickCanonicalHintAnswer(answers, displayAnswer);
  if (!primary) return 'Hint: dig deeper — answer’s still hiding.';

  const yearMatch = primary.match(/^(19|20)\d{2}$/);
  const hint = yearMatch
    ? buildYearHint(yearMatch[0], minuteBucket)
    : primary.split(/\s+/).filter(Boolean).length > 1
      ? buildMultiWordHint(primary.split(/\s+/).filter(Boolean), minuteBucket)
      : buildSingleWordHint(primary, minuteBucket);

  return assertNoAnswerLeak(hint, primary);
}
