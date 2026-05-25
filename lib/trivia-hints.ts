import { normalizeTriviaAnswer } from '@/lib/cannabis-trivia';

/** Twitch chat answers should be short — never hint from displayAnswer prose. */
const HINT_MAX_ANSWER_LEN = 28;
const HINT_MAX_WORDS = 3;

function pickHintAnswer(answers: string[]): string {
  if (!answers.length) return '';

  const trimmed = answers.map((entry) => entry.trim()).filter(Boolean);
  const eligible = trimmed.filter((entry) => {
    const normalized = normalizeTriviaAnswer(entry);
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    return normalized.length <= HINT_MAX_ANSWER_LEN && wordCount <= HINT_MAX_WORDS;
  });

  const pool = eligible.length ? eligible : trimmed;
  return [...pool].sort((a, b) => a.length - b.length)[0] ?? '';
}

function maskWord(word: string, revealRatio: number): string {
  if (!word) return '';
  const revealCount = Math.max(1, Math.round(word.length * revealRatio));
  return [...word].map((char, index) => (index < revealCount ? char : '_')).join('');
}

function buildYearHint(year: string, minuteBucket: number): string {
  const digits = year.replace(/\D/g, '');
  if (digits.length !== 4) return `Hint: it's a year — ${maskWord(digits, 0.25 + minuteBucket * 0.2)}`;

  if (minuteBucket <= 1) return 'Hint: four-digit year (1900s or 2000s).';
  if (minuteBucket === 2) return `Hint: starts with ${digits.slice(0, 2)}__`;
  if (minuteBucket === 3) return `Hint: ${digits.slice(0, 3)}_`;
  return `Hint: ${digits.slice(0, 3)}_ — last digit left!`;
}

function buildMultiWordHint(words: string[], minuteBucket: number): string {
  if (minuteBucket <= 1) {
    const lengths = words.map((word) => word.length).join('-letter, ');
    return `Hint: ${words.length} words (${lengths}-letter). First word starts with "${words[0][0]?.toUpperCase() ?? '?'}".`;
  }
  if (minuteBucket === 2) {
    return `Hint: ${words.map((word) => maskWord(word, 0.35)).join(' ')}`;
  }
  if (minuteBucket === 3) {
    return `Hint: ${words.map((word, index) => (index === 0 ? word : maskWord(word, 0.55))).join(' ')}`;
  }
  return `Hint: ${words.map((word) => maskWord(word, 0.82)).join(' ')} — almost there!`;
}

function buildSingleWordHint(answer: string, minuteBucket: number): string {
  const compact = answer.replace(/\s+/g, '');
  if (!compact) return 'Hint: you’re getting warmer.';

  if (minuteBucket <= 1) {
    return `Hint: ${compact.length} letters — starts with "${compact[0]?.toUpperCase() ?? '?'}"`;
  }
  if (minuteBucket === 2) {
    return `Hint: ${maskWord(compact, 0.35)}`;
  }
  if (minuteBucket === 3) {
    return `Hint: ${maskWord(compact, 0.62)}`;
  }
  return `Hint: ${maskWord(compact, 0.88)} — almost there!`;
}

/** Progressive hints for minute 1–4 of a 5-minute trivia window (bucket = minutes elapsed). */
export function buildTriviaProgressHint(answers: string[], minuteBucket: number): string {
  const primary = normalizeTriviaAnswer(pickHintAnswer(answers));
  if (!primary) return 'Hint: dig deeper — answer’s still hiding.';

  const yearMatch = primary.match(/^(19|20)\d{2}$/);
  if (yearMatch) return buildYearHint(yearMatch[0], minuteBucket);

  const words = primary.split(/\s+/).filter(Boolean);
  if (words.length > 1) return buildMultiWordHint(words, minuteBucket);

  return buildSingleWordHint(primary, minuteBucket);
}
