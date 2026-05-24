import { listAvailableElroyTrivia, type TriviaCategory } from '@/lib/cannabis-trivia';
import { generateTriviaQuestion } from '@/lib/trivia-generator';
import {
  getRecentTriviaQuestions,
  hasSeenTriviaQuestion,
  isNearDuplicateTriviaQuestion,
  mergeRecentTriviaQuestions,
  recordTriviaQuestion,
} from '@/lib/trivia-recent';

export const dynamic = 'force-dynamic';

const GENERATION_ATTEMPTS = 5;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function acceptQuestion(
  category: TriviaCategory,
  question: { question: string },
  recentQuestions: string[],
) {
  if (isNearDuplicateTriviaQuestion(question.question, recentQuestions)) return false;
  if (await hasSeenTriviaQuestion(question.question, category)) return false;
  return true;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      category?: TriviaCategory;
      recentQuestions?: string[];
      recentIds?: string[];
    };

    const category = body.category === 'freaky' ? 'freaky' : 'cannabis';
    const clientRecent = Array.isArray(body.recentQuestions)
      ? body.recentQuestions.filter((q): q is string => typeof q === 'string')
      : [];
    const recentIds = Array.isArray(body.recentIds)
      ? body.recentIds.filter((id): id is string => typeof id === 'string').slice(-20)
      : [];
    const serverRecent = await getRecentTriviaQuestions(category);
    let recentQuestions = mergeRecentTriviaQuestions(clientRecent, serverRecent);

    for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
      const generated = await generateTriviaQuestion(category, recentQuestions);
      if (!generated) continue;
      if (!(await acceptQuestion(category, generated, recentQuestions))) {
        recentQuestions = mergeRecentTriviaQuestions([generated.question], recentQuestions);
        continue;
      }

      await recordTriviaQuestion(generated.question, category);
      return Response.json({ source: 'generated', question: generated });
    }

    const staticPool = shuffle(listAvailableElroyTrivia(recentIds, category, recentQuestions));
    for (const fallback of staticPool) {
      if (!(await acceptQuestion(category, fallback, recentQuestions))) continue;
      await recordTriviaQuestion(fallback.question, category);
      return Response.json({ source: 'static', question: fallback });
    }

    return Response.json({ error: 'No fresh trivia available for this category' }, { status: 503 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trivia generation failed';
    return Response.json({ error: message }, { status: 503 });
  }
}
