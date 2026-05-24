import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { ElroyTriviaQuestion, TriviaCategory } from '@/lib/cannabis-trivia';

const triviaSchema = z.object({
  question: z.string().min(10).max(220),
  answers: z.array(z.string().min(1).max(80)).min(1).max(10),
  displayAnswer: z.string().min(1).max(120),
});

const CATEGORY_GUIDANCE: Record<TriviaCategory, string> = {
  cannabis:
    'Cannabis, hemp, 420/710 culture, terpenes, cannabinoids, stoner history, smoking gear, and weed facts.',
  freaky:
    'Freaky sex, kink, BDSM basics, consent, safewords, aftercare, spicy internet culture, and playful adult trivia — cheeky not graphic, Twitch-safe.',
};

export async function generateTriviaQuestion(
  category: TriviaCategory,
  recentQuestions: string[] = [],
): Promise<ElroyTriviaQuestion | null> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;

  const avoidBlock = recentQuestions.length
    ? `\nDo NOT repeat or closely rephrase any of these recent questions:\n${recentQuestions.map((q) => `- ${q}`).join('\n')}`
    : '';

  try {
    const { object } = await generateObject({
      model: google('gemini-2.5-flash'),
      schema: triviaSchema,
      system: `You write Twitch chat trivia for Elroy, a sassy OG stream bot.
Return ONE fresh trivia question with multiple acceptable short chat answers.
Topic: ${CATEGORY_GUIDANCE[category]}
Rules:
- Question must be answerable in a few words in Twitch chat
- Include 2-6 acceptable answer variants (abbreviations, nicknames, numbers OK)
- displayAnswer is the friendly reveal shown after someone wins
- Keep it fun, factual, and chat-friendly
- No slurs, no minors, no illegal content, no extreme explicit anatomy`,
      prompt: `Generate a new ${category} trivia question.${avoidBlock}`,
    });

    const answers = [...new Set(object.answers.map((a) => a.trim()).filter(Boolean))];
    if (!answers.length) return null;

    return {
      id: `gen-${category}-${Date.now()}`,
      category,
      question: object.question.trim(),
      answers,
      displayAnswer: object.displayAnswer.trim(),
    };
  } catch (error) {
    console.error('Trivia generation failed', error);
    return null;
  }
}
