export type TriviaCategory = 'cannabis' | 'freaky' | 'music90s';

export type ElroyTriviaQuestion = {
  id: string;
  category: TriviaCategory;
  question: string;
  /** Acceptable normalized answers (see normalizeTriviaAnswer). */
  answers: string[];
  /** Shown when revealing the answer. */
  displayAnswer: string;
  /** Optional bonus scoring weight. Defaults to 1 point. */
  points?: number;
};

/** @deprecated Use ElroyTriviaQuestion */
export type CannabisTriviaQuestion = ElroyTriviaQuestion;

import { ELROY_TRIVIA_BANK } from '@/lib/trivia-bank';
import {
  mentionsElroy,
  stripElroyFromMessage,
} from '@/lib/elroy-mention';

export { mentionsElroy, stripElroyFromMessage };

export const ELROY_TRIVIA = ELROY_TRIVIA_BANK;

/** @deprecated Use ELROY_TRIVIA */
export const CANNABIS_TRIVIA = ELROY_TRIVIA;

export function triviaIntroFor(category: ElroyTriviaQuestion['category']): string {
  if (category === 'music90s') return '🎵 90s music trivia!';
  return category === 'freaky' ? '😈 Freaky sex trivia!' : '🌿 Cannabis trivia!';
}

const CANNABIS_TOPIC_PATTERNS = [
  /\bcannabis\b/i,
  /\bmarijuana\b/i,
  /\bhemp\b/i,
  /\bthc\b/i,
  /\bthca\b/i,
  /\bcbd\b/i,
  /\bcbda\b/i,
  /\bcannabinoid/i,
  /\bterpene/i,
  /\bindica\b/i,
  /\bsativa\b/i,
  /\bprop\s*215\b/i,
  /\bfarm bill\b/i,
  /\bdecarb/i,
  /\brosin\b/i,
  /\bhash(ish)?\b/i,
  /\bdispensar/i,
  /\bedible/i,
  /\blandrace\b/i,
  /\bmyrcene\b/i,
  /\b420\b/,
  /\b710\b/,
  /\bstrain\b/i,
  /\bschedul(e|ing)\b.*\b(cannabis|marijuana|drug)/i,
];

const FREAKY_TOPIC_PATTERNS = [
  /\bsex\b/i,
  /\berotic/i,
  /\bkink\b/i,
  /\bbdsm\b/i,
  /\bqueer\b/i,
  /\bstonewall/i,
  /\bfetish/i,
  /\bkinsey\b/i,
  /\bmasoch/i,
  /\bsadis/i,
  /\bsexolog/i,
  /\borgasm/i,
  /\bbondage/i,
  /\bsodomy/i,
  /\bobscene/i,
  /\bhomosex/i,
  /\blesbian/i,
  /\btransvest/i,
  /\bkama sutra/i,
  /\bplanned parenthood\b/i,
  /\bcontracept/i,
  /\bvenus in furs/i,
  /\blady chatterley/i,
];

const MUSIC90S_TOPIC_PATTERNS = [
  /\bhip.?hop\b/i,
  /\brap\b/i,
  /\balbum\b/i,
  /\bbillboard\b/i,
  /\b199\d\b/,
  /\bmtv\b/i,
  /\bgrammy/i,
  /\br&b\b/i,
  /\bdeath row\b/i,
  /\bbad boy\b/i,
  /\bdiss track/i,
  /\bno limit\b/i,
  /\btupac\b/i,
  /\bbiggie\b/i,
  /\bdr\.?\s*dre\b/i,
  /\btimbaland\b/i,
  /\b90s\b/i,
];

function scoreTopicPatterns(text: string, patterns: RegExp[]): number {
  return patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
}

/** Infer the real trivia lane from question text — fixes Gemini mis-tagging. */
export function inferTriviaCategory(
  question: string,
  answers: string[] = [],
  displayAnswer?: string,
): TriviaCategory {
  const blob = [question, displayAnswer ?? '', ...answers].join(' ');
  const scores: Record<TriviaCategory, number> = {
    cannabis: scoreTopicPatterns(blob, CANNABIS_TOPIC_PATTERNS),
    freaky: scoreTopicPatterns(blob, FREAKY_TOPIC_PATTERNS),
    music90s: scoreTopicPatterns(blob, MUSIC90S_TOPIC_PATTERNS),
  };

  const ranked = (Object.entries(scores) as [TriviaCategory, number][])
    .sort((a, b) => b[1] - a[1]);
  const [topCategory, topScore] = ranked[0] ?? ['cannabis', 0];
  const secondScore = ranked[1]?.[1] ?? 0;

  if (topScore <= 0) return 'cannabis';
  if (topScore === secondScore) {
    if (scores.music90s >= scores.cannabis && scores.music90s >= scores.freaky) return 'music90s';
    if (scores.cannabis >= scores.freaky) return 'cannabis';
    return 'freaky';
  }
  return topCategory;
}

export function triviaCategoryMatchesContent(
  category: TriviaCategory,
  question: string,
  answers: string[] = [],
  displayAnswer?: string,
): boolean {
  return inferTriviaCategory(question, answers, displayAnswer) === category;
}

/** Re-tag a question so intro/scoring match what it is actually about. */
export function alignTriviaQuestionCategory(question: ElroyTriviaQuestion): ElroyTriviaQuestion {
  const inferred = inferTriviaCategory(question.question, question.answers, question.displayAnswer);
  if (inferred === question.category) return question;
  return { ...question, category: inferred };
}

export function normalizeTriviaAnswer(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesTriviaAnswer(message: string, acceptable: string[]): boolean {
  const normalized = normalizeTriviaAnswer(message);
  if (!normalized) return false;

  const msgTokens = normalized.split(/\s+/).filter(Boolean);

  for (const answer of acceptable) {
    const target = normalizeTriviaAnswer(answer);
    if (!target) continue;

    if (normalized === target) return true;

    const answerTokens = target.split(/\s+/).filter(Boolean);
    if (!answerTokens.length) continue;

    // Every answer token must appear as a whole token in chat (not a substring like crop → cropping).
    const allAnswerTokensPresent = answerTokens.every((token) =>
      msgTokens.some((msgToken) => msgToken === token),
    );
    if (!allAnswerTokensPresent) continue;

    // Reject partial guesses: chat can't be mostly unrelated words.
    const extraTokens = msgTokens.filter((token) => !answerTokens.includes(token));
    if (extraTokens.length > 1) continue;
    if (extraTokens.some((token) => token.length > 3)) continue;

    return true;
  }

  return false;
}

export function isAskingElroyForTriviaHelp(message: string) {
  const msg = normalizeTriviaAnswer(stripElroyFromMessage(message));
  if (!msg) return false;
  const patterns = [
    /\bwhat is the answer\b/,
    /\bwhats the answer\b/,
    /\btell me the answer\b/,
    /\bgive me the answer\b/,
    /\btrivia answer\b/,
    /\banswer to (the|this) trivia\b/,
    /\bwhat was the answer\b/,
  ];
  return patterns.some((pattern) => pattern.test(msg));
}

export function isRepeatingActiveTriviaQuestion(message: string, question: string) {
  const msg = normalizeTriviaAnswer(stripElroyFromMessage(message));
  const q = normalizeTriviaAnswer(question);
  if (!msg || !q || msg.length < 12) return false;
  if (msg.includes(q) || q.includes(msg)) return true;

  const stop = new Set([
    'what', 'which', 'who', 'when', 'where', 'the', 'and', 'for', 'with', 'that', 'this',
    'from', 'into', 'about', 'name', 'first', 'under', 'most', 'what year', 'which country',
  ]);
  const qWords = q.split(' ').filter((word) => word.length >= 4 && !stop.has(word));
  if (qWords.length < 2) return false;
  const matched = qWords.filter((word) => msg.includes(word));
  return matched.length >= Math.min(3, Math.ceil(qWords.length * 0.45));
}

export type ElroyTriviaCheatKind = 'answer' | 'question' | 'help';

export function detectElroyTriviaCheat(
  message: string,
  question: string,
  answers: string[],
): ElroyTriviaCheatKind | null {
  if (!mentionsElroy(message)) return null;
  if (matchesTriviaAnswer(message, answers)) return 'answer';
  if (isRepeatingActiveTriviaQuestion(message, question)) return 'question';
  if (isAskingElroyForTriviaHelp(message)) return 'help';
  return null;
}

export function listAvailableElroyTrivia(
  recentIds: string[],
  category: TriviaCategory,
  recentQuestions: string[] = [],
): ElroyTriviaQuestion[] {
  const recentIdSet = new Set(recentIds);
  const recentQuestionSet = new Set(
    recentQuestions.map((question) => normalizeTriviaAnswer(question)).filter(Boolean),
  );

  return ELROY_TRIVIA.filter((item) => {
    if (item.category !== category) return false;
    if (recentIdSet.has(item.id)) return false;
    if (recentQuestionSet.has(normalizeTriviaAnswer(item.question))) return false;
    return true;
  });
}

export function pickRandomElroyTrivia(
  recentIds: string[],
  category?: TriviaCategory,
  recentQuestions: string[] = [],
): ElroyTriviaQuestion | null {
  if (!category) return null;

  const choices = listAvailableElroyTrivia(recentIds, category, recentQuestions);
  if (!choices.length) return null;

  return choices[Math.floor(Math.random() * choices.length)];
}

/** @deprecated Use pickRandomElroyTrivia */
export function pickRandomCannabisTrivia(recentIds: string[]): ElroyTriviaQuestion | null {
  return pickRandomElroyTrivia(recentIds);
}
