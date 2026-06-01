import { listAvailableElroyTrivia, type TriviaCategory } from '@/lib/cannabis-trivia';
import { pickStaticTriviaQuestion } from '@/lib/pick-static-trivia';
import { generateTriviaQuestion } from '@/lib/trivia-generator';
import { passesTriviaDifficultyGate } from '@/lib/trivia-quality';
import {
  claimTriviaQuestion,
  getRecentTriviaQuestions,
  hasSeenTriviaAnswers,
  hasSeenTriviaQuestion,
  isNearDuplicateTriviaQuestion,
  mergeRecentTriviaQuestions,
} from '@/lib/trivia-recent';

export const dynamic = 'force-dynamic';

/** Fewer retries than the original 18 — each attempt is a paid Gemini call. */
const GENERATION_ATTEMPTS = 10;

function triviaGeminiEnabled(): boolean {
  if (process.env.TRIVIA_DISABLE_GEMINI === 'true') return false;
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
}

async function acceptQuestion(
  category: TriviaCategory,
  question: { question: string; answers: string[] },
  recentQuestions: string[],
) {
  if (!passesTriviaDifficultyGate(question.question, question.answers)) return false;
  if (isNearDuplicateTriviaQuestion(question.question, recentQuestions)) return false;
  if (await hasSeenTriviaQuestion(question.question, category)) return false;
  if (await hasSeenTriviaAnswers(question.answers, category)) return false;
  return true;
}

async function tryStaticFallback(
  category: TriviaCategory,
  recentIds: string[],
  recentQuestions: string[],
) {
  let picked = await pickStaticTriviaQuestion(category, recentIds, recentQuestions);

  if (!picked) {
    const fallbackCategories: TriviaCategory[] =
      category === 'music90s'
        ? ['cannabis', 'freaky']
        : category === 'cannabis'
          ? ['music90s', 'freaky']
          : ['music90s', 'cannabis'];

    for (const alt of fallbackCategories) {
      const altRecent = await getRecentTriviaQuestions(alt);
      picked = await pickStaticTriviaQuestion(alt, recentIds, altRecent);
      if (picked) break;
    }
  }

  return picked;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      category?: TriviaCategory;
      recentQuestions?: string[];
      recentIds?: string[];
    };

    const category =
      body.category === 'freaky'
        ? 'freaky'
        : body.category === 'music90s'
          ? 'music90s'
          : 'cannabis';
    const clientRecent = Array.isArray(body.recentQuestions)
      ? body.recentQuestions.filter((q): q is string => typeof q === 'string')
      : [];
    const recentIds = Array.isArray(body.recentIds)
      ? body.recentIds.filter((id): id is string => typeof id === 'string').slice(-30)
      : [];
    const serverRecent = await getRecentTriviaQuestions(category);
    let recentQuestions = mergeRecentTriviaQuestions(clientRecent, serverRecent);

    if (triviaGeminiEnabled()) {
      for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
        const generated = await generateTriviaQuestion(category, recentQuestions, attempt);
        if (!generated) continue;
        if (!(await acceptQuestion(category, generated, recentQuestions))) {
          recentQuestions = mergeRecentTriviaQuestions([generated.question], recentQuestions);
          continue;
        }
        if (await claimTriviaQuestion(generated.question, category, generated.answers)) {
          const availableCount = listAvailableElroyTrivia(
            recentIds,
            generated.category,
            recentQuestions,
          ).length;

          return Response.json({
            source: 'generated',
            recycled: false,
            remainingInCategory: availableCount,
            question: generated,
          });
        }
        recentQuestions = mergeRecentTriviaQuestions([generated.question], recentQuestions);
      }
    }

    const picked = await tryStaticFallback(category, recentIds, recentQuestions);

    if (!picked) {
      return Response.json({ error: 'No fresh trivia available' }, { status: 503 });
    }

    const availableCount = listAvailableElroyTrivia(
      recentIds,
      picked.question.category,
      recentQuestions,
    ).length;

    return Response.json({
      source: 'static',
      recycled: picked.recycled,
      remainingInCategory: availableCount,
      question: picked.question,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trivia pick failed';
    return Response.json({ error: message }, { status: 503 });
  }
}
