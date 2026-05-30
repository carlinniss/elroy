import { listAvailableElroyTrivia, type TriviaCategory } from '@/lib/cannabis-trivia';
import { pickStaticTriviaQuestion } from '@/lib/pick-static-trivia';
import { getRecentTriviaQuestions, mergeRecentTriviaQuestions } from '@/lib/trivia-recent';

export const dynamic = 'force-dynamic';

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
    const recentQuestions = mergeRecentTriviaQuestions(clientRecent, serverRecent);

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

    if (!picked) {
      return Response.json({ error: 'No fresh trivia available' }, { status: 503 });
    }

    const availableCount = listAvailableElroyTrivia(recentIds, picked.question.category, recentQuestions).length;

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
