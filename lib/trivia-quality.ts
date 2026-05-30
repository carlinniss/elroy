import { normalizeTriviaAnswer } from '@/lib/cannabis-trivia';

const GENERIC_QUESTION_PATTERNS = [
  /what does (thc|cbd|ecs|bdsm|nsfw|dom|sub)\b/i,
  /what (is|does) (thc|cbd) stand for/i,
  /what (are|is) terpen/i,
  /indica or sativa/i,
  /cannabis indica.*sativa/i,
  /how many cannabinoids/i,
  /endocannabinoid system/i,
  /420|4:20|four twenty/i,
  /\b710\b.*oil/i,
  /george washington.*hemp/i,
  /what plant.*canvas/i,
  /what does bdsm stand for/i,
  /what is a safeword/i,
  /what is consent/i,
  /what is aftercare/i,
  /what does (dom|sub|switch) mean/i,
  /what is (a )?(dom|sub|switch)\b/i,
  /50 shades/i,
  /how many letters/i,
];

const OVERUSED_ANSWER_TERMS = new Set([
  'thc', 'cbd', 'tetrahydrocannabinol', 'cannabidiol', 'terpenes', 'terpene',
  'cannabinoids', 'cannabinoid', 'endocannabinoid system', 'endocannabinoid', 'ecs',
  'indica', 'sativa', 'cannabis', 'hemp', 'marijuana', '420', '710',
  'george washington', 'washington', 'bdsm', 'safeword', 'safe word', 'consent',
  'aftercare', 'bondage', 'dom', 'sub', 'switch', 'nsfw', 'kink', 'consensual',
  'white', 'black', 'blue', 'japan', 'corset', 'joint', 'grinder', 'water',
]);

const TRIVIAL_SINGLE_WORD_ANSWERS = new Set([
  ...OVERUSED_ANSWER_TERMS,
  'oil', 'haze', 'kush', 'dab', 'wax', 'fire', 'loud', 'gas', 'weed', 'pot',
  'smoke', 'high', 'bong', 'blunt', 'doobie', 'canvas', 'rope', 'fabric',
  'wand', 'love', 'music', 'rap', 'rock', 'grunge',
]);

const GIVEAWAY_QUESTION_PATTERNS = [
  /\bstands for\b/i,
  /\bwhat third (word|letter|color|colour|stripe)\b/i,
  /\bacronym\b/i,
  /\babbreviated\b/i,
  /\bwhat does .+ stand for\b/i,
  /\bwhich restrictive garment\b/i,
];

export function isGenericTriviaQuestion(question: string): boolean {
  const trimmed = question.trim();
  if (!trimmed) return true;
  if (trimmed.length < 48) return true;
  return GENERIC_QUESTION_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function isOverusedTriviaAnswer(answers: string[]): boolean {
  const normalized = answers.map((a) => normalizeTriviaAnswer(a)).filter(Boolean);
  if (!normalized.length) return true;
  const primary = normalized.reduce((a, b) => (a.length >= b.length ? a : b), normalized[0]);
  if (OVERUSED_ANSWER_TERMS.has(primary)) return true;
  if (normalized.every((answer) => OVERUSED_ANSWER_TERMS.has(answer))) return true;
  return false;
}

export function hasSpecificTriviaAnswer(answers: string[]): boolean {
  const normalized = answers.map((a) => normalizeTriviaAnswer(a)).filter(Boolean);
  if (!normalized.length) return false;

  return normalized.some((answer) => {
    if (/^(19|20)\d{2}$/.test(answer)) return true;
    if (OVERUSED_ANSWER_TERMS.has(answer)) return false;
    if (TRIVIAL_SINGLE_WORD_ANSWERS.has(answer)) return false;
    if (answer.includes(' ') && answer.length >= 6) return true;
    return answer.length >= 4;
  });
}

export function answerLeaksInQuestion(question: string, answers: string[]): boolean {
  const qNorm = normalizeTriviaAnswer(question);
  if (!qNorm) return true;

  for (const answer of answers) {
    const aNorm = normalizeTriviaAnswer(answer);
    if (!aNorm || aNorm.length < 3) continue;
    if (qNorm.includes(aNorm)) return true;

    const tokens = aNorm.split(/\s+/).filter((token) => token.length >= 4);
    if (tokens.length >= 2 && tokens.every((token) => qNorm.includes(token))) {
      return true;
    }
  }

  return false;
}

export function isGiveawayTriviaQuestion(question: string, answers: string[]): boolean {
  const trimmed = question.trim();
  if (GIVEAWAY_QUESTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    const normalized = answers.map((a) => normalizeTriviaAnswer(a)).filter(Boolean);
    const primary = normalized.reduce((a, b) => (a.length <= b.length ? a : b), normalized[0] ?? '');
    if (!primary || primary.split(/\s+/).length <= 2) return true;
  }

  const qNorm = normalizeTriviaAnswer(trimmed);
  for (const answer of answers) {
    const aNorm = normalizeTriviaAnswer(answer);
    if (/^(19|20)\d{2}$/.test(aNorm) && qNorm.includes(aNorm)) return true;
  }

  return false;
}

export function passesTriviaDifficultyGate(question: string, answers: string[]): boolean {
  if (isGenericTriviaQuestion(question)) return false;
  if (isOverusedTriviaAnswer(answers)) return false;
  if (!hasSpecificTriviaAnswer(answers)) return false;
  if (answerLeaksInQuestion(question, answers)) return false;
  if (isGiveawayTriviaQuestion(question, answers)) return false;
  return true;
}
