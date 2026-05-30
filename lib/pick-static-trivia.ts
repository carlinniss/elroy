import type { ElroyTriviaQuestion, TriviaCategory } from '@/lib/cannabis-trivia';
import { ELROY_TRIVIA, normalizeTriviaAnswer } from '@/lib/cannabis-trivia';
import { passesTriviaDifficultyGate } from '@/lib/trivia-quality';
import {
  isNearDuplicateTriviaQuestion,
  noteTriviaQuestionAsked,
} from '@/lib/trivia-recent';

const RECENT_EXCLUDE_COUNT = 18;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function qualityPool(category: TriviaCategory): ElroyTriviaQuestion[] {
  return ELROY_TRIVIA.filter(
    (item) => item.category === category && passesTriviaDifficultyGate(item.question, item.answers),
  );
}

function excludeRecent(
  pool: ElroyTriviaQuestion[],
  recentIds: string[],
  recentQuestions: string[],
): ElroyTriviaQuestion[] {
  const recentIdSet = new Set(recentIds);
  const recentQuestionSet = new Set(
    recentQuestions.map((question) => normalizeTriviaAnswer(question)).filter(Boolean),
  );

  return pool.filter((item) => {
    if (recentIdSet.has(item.id)) return false;
    if (recentQuestionSet.has(normalizeTriviaAnswer(item.question))) return false;
    return true;
  });
}

function excludeNearDuplicates(pool: ElroyTriviaQuestion[], recentQuestions: string[]): ElroyTriviaQuestion[] {
  return pool.filter(
    (item) => !isNearDuplicateTriviaQuestion(item.question, recentQuestions),
  );
}

/**
 * Pick a curated static trivia question.
 * Cycles through the bank: prefers questions not asked recently, then recycles older ones.
 * Static questions do not auto-generate — variety comes from the bank size + shuffle + dedup window.
 */
export async function pickStaticTriviaQuestion(
  category: TriviaCategory,
  recentIds: string[],
  recentQuestions: string[],
): Promise<{ question: ElroyTriviaQuestion; recycled: boolean } | null> {
  const pool = qualityPool(category);
  if (!pool.length) return null;

  const shuffled = shuffle(pool);
  const recentTail = recentQuestions.slice(0, RECENT_EXCLUDE_COUNT);

  const passes = excludeNearDuplicates(
    excludeRecent(shuffled, recentIds, recentTail),
    recentTail,
  );

  for (const candidate of passes) {
    await noteTriviaQuestionAsked(candidate.question, category, candidate.answers);
    return { question: candidate, recycled: false };
  }

  const softRecycle = excludeNearDuplicates(
    excludeRecent(shuffled, recentIds, recentQuestions.slice(0, 6)),
    recentQuestions.slice(0, 6),
  );

  for (const candidate of softRecycle) {
    await noteTriviaQuestionAsked(candidate.question, category, candidate.answers);
    return { question: candidate, recycled: true };
  }

  const any = shuffled.find(
    (item) => !isNearDuplicateTriviaQuestion(item.question, recentQuestions.slice(0, 3)),
  );
  if (!any) return null;

  await noteTriviaQuestionAsked(any.question, category, any.answers);
  return { question: any, recycled: true };
}
