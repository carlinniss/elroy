import { pickRandomElroyTrivia, type TriviaCategory } from '@/lib/cannabis-trivia';
import { generateTriviaQuestion } from '@/lib/trivia-generator';
import {
  getRecentTriviaQuestions,
  isNearDuplicateTriviaQuestion,
  mergeRecentTriviaQuestions,
  recordTriviaQuestion,
} from '@/lib/trivia-recent';

export const dynamic = 'force-dynamic';

const GENERATION_ATTEMPTS = 3;

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
    const serverRecent = await getRecentTriviaQuestions();
    let recentQuestions = mergeRecentTriviaQuestions(clientRecent, serverRecent);

    for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
      const generated = await generateTriviaQuestion(category, recentQuestions);
      if (!generated) continue;
      if (isNearDuplicateTriviaQuestion(generated.question, recentQuestions)) {
        recentQuestions = mergeRecentTriviaQuestions([generated.question], recentQuestions);
        continue;
      }

      await recordTriviaQuestion(generated.question);
      return Response.json({ source: 'generated', question: generated });
    }

    const fallback = pickRandomElroyTrivia(recentIds, category, recentQuestions);
    if (!fallback) {
      return Response.json({ error: 'No trivia available' }, { status: 503 });
    }

    await recordTriviaQuestion(fallback.question);
    return Response.json({ source: 'static', question: fallback });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trivia generation failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
