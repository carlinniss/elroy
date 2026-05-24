import { pickRandomElroyTrivia, type TriviaCategory } from '@/lib/cannabis-trivia';
import { generateTriviaQuestion } from '@/lib/trivia-generator';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      category?: TriviaCategory;
      recentQuestions?: string[];
    };

    const category = body.category === 'freaky' ? 'freaky' : 'cannabis';
    const recentQuestions = Array.isArray(body.recentQuestions)
      ? body.recentQuestions.filter((q): q is string => typeof q === 'string').slice(-20)
      : [];

    const generated = await generateTriviaQuestion(category, recentQuestions);
    if (generated) {
      return Response.json({ source: 'generated', question: generated });
    }

    const fallback = pickRandomElroyTrivia([], category);
    if (!fallback) {
      return Response.json({ error: 'No trivia available' }, { status: 503 });
    }
    return Response.json({ source: 'static', question: fallback });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trivia generation failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
