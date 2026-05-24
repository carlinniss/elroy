import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { ElroyTriviaQuestion, TriviaCategory } from '@/lib/cannabis-trivia';
import { normalizeTriviaAnswer } from '@/lib/cannabis-trivia';

const triviaSchema = z.object({
  question: z.string().min(12).max(220),
  answers: z.array(z.string().min(1).max(80)).min(1).max(10),
  displayAnswer: z.string().min(1).max(120),
});

const CANNABIS_ANGLES = [
  'obscure cannabis history before 1970 (figures, events, publications — not George Washington hemp)',
  'phytochemistry deep cut (minor cannabinoids, decarb chemistry, terpene interactions, CBG/CBN/CBC)',
  'global cannabis culture (regional traditions, slang origins, historic consumption methods)',
  'cultivation science (photoperiod, phenotypes, harvest timing, curing — not indica vs sativa 101)',
  'industrial hemp and fiber history (textiles, rope, paper, biofuel — specific facts)',
  'cannabis law and policy milestones (countries, court cases, scheduling — specific names/dates)',
  'strain genetics and breeder lore (landrace origins, famous crosses, lineage — not "what is sativa")',
  'consumption tech and extraction (rosin, solventless, vaporization science — specific terms)',
  'cannabis in music/film/counterculture (specific albums, scenes, movements — not "420 time")',
  'medical/research milestones (clinical trials, discovery dates, researchers — not "ECS" intro)',
];

const FREAKY_ANGLES = [
  'kink terminology etymology and history (where a term came from, not "what is BDSM")',
  'sex-positive pioneers, authors, and movements (specific people, books, years)',
  'consent and negotiation specifics (frameworks, acronyms beyond basic safeword)',
  'relationship and intimacy psychology (attachment, communication models — named concepts)',
  'LGBTQ+ and queer history tied to sexuality (events, figures, legal milestones)',
  'fetish subculture lore (leather, latex, pup, etc. — niche not beginner)',
  'anatomy and physiology with clinical terms (Twitch-safe, educational, not graphic)',
  'internet-era spicy culture deep cuts (memes, platforms, era-specific slang)',
  'BDSM safety and scene etiquette (specific protocols, roles beyond dom/sub 101)',
  'pop culture references that require real knowledge (specific shows, songs, scenes)',
];

const GENERIC_QUESTION_PATTERNS = [
  /what does (thc|cbd|ecs)\b/i,
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
  /50 shades/i,
  /what is (a )?dildo/i,
  /what is (a )?vibrator/i,
];

const OVERUSED_ANSWER_TERMS = new Set([
  'thc',
  'cbd',
  'tetrahydrocannabinol',
  'cannabidiol',
  'terpenes',
  'terpene',
  'cannabinoids',
  'cannabinoid',
  'endocannabinoid system',
  'endocannabinoid',
  'ecs',
  'indica',
  'sativa',
  'cannabis',
  'hemp',
  'marijuana',
  '420',
  '710',
  'george washington',
  'washington',
  'bdsm',
  'safeword',
  'safe word',
  'consent',
  'aftercare',
  'bondage',
  'dom',
  'sub',
  'switch',
  'vibrator',
  'dildo',
]);

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function isGenericTriviaQuestion(question: string): boolean {
  const trimmed = question.trim();
  if (!trimmed) return true;
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

function buildAvoidBlock(recentQuestions: string[]): string {
  if (!recentQuestions.length) return '';

  return `\nSTRICT DEDUP — do NOT repeat or closely rephrase these recent questions. Pick a different subtopic, era, and answer entirely:
${recentQuestions.slice(0, 40).map((q) => `- ${q}`).join('\n')}

Also avoid overused beginner answers as the correct answer: THC, CBD, terpenes, endocannabinoid system, indica, sativa, 420, 710, George Washington, BDSM, safeword, consent, aftercare.`;
}

function buildPrompt(category: TriviaCategory, recentQuestions: string[], attempt: number): string {
  const angles = category === 'freaky' ? FREAKY_ANGLES : CANNABIS_ANGLES;
  const primaryAngle = pickRandom(angles);
  const secondaryAngle = pickRandom(angles.filter((a) => a !== primaryAngle));
  const difficulty =
    attempt < 3
      ? 'HARD — requires enthusiast-level knowledge; a casual viewer should struggle'
      : attempt < 6
        ? 'EXPERT — obscure fact, specific name/number/year; not searchable in one Google snippet'
        : 'OBSCURE — deep cut only a dedicated fan would know';

  return `Generate ONE ${category} trivia question for a savvy adult Twitch chat.

This round's angle: ${primaryAngle}
Also weave in something from: ${secondaryAngle}
Difficulty: ${difficulty}
Generation salt: ${Date.now()}-${attempt}-${Math.random().toString(36).slice(2, 8)}

Requirements:
- NOT generic weed/sex 101 — no acronyms-as-the-whole-joke, no "what does X stand for", no indica/sativa, no 420/710, no George Washington hemp
- The correct answer must be a specific proper noun, number, year, chemical name (minor cannabinoid), place, person, or niche term
- Question should make chat think for a moment — avoid one-word giveaway setups
- Answerable in 1-4 words in Twitch chat
- 2-6 acceptable answer variants (abbreviations, alternate spellings OK)
- displayAnswer: friendly reveal with the full fact spelled out
- Twitch-safe: no slurs, no minors, no illegal how-to, no graphic anatomy${buildAvoidBlock(recentQuestions)}`;
}

export async function generateTriviaQuestion(
  category: TriviaCategory,
  recentQuestions: string[] = [],
  attempt = 0,
): Promise<ElroyTriviaQuestion | null> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;

  try {
    const { object } = await generateObject({
      model: google('gemini-2.5-flash'),
      schema: triviaSchema,
      temperature: 1.15,
      system: `You write HARD Twitch chat trivia for Elroy, a sassy OG stream bot.
Your audience has heard "what is THC" and "what is BDSM" a thousand times — never write that again.
Favor specific names, dates, chemistry, history, and niche culture over textbook definitions.
Return exactly one question object. Every question must feel distinct from typical cannabis/sex trivia lists.`,
      prompt: buildPrompt(category, recentQuestions, attempt),
    });

    const answers = [...new Set(object.answers.map((a) => a.trim()).filter(Boolean))];
    if (!answers.length) return null;

    const question = object.question.trim();
    if (isGenericTriviaQuestion(question) || isOverusedTriviaAnswer(answers)) {
      return null;
    }

    return {
      id: `gen-${category}-${Date.now()}-${attempt}`,
      category,
      question,
      answers,
      displayAnswer: object.displayAnswer.trim(),
    };
  } catch (error) {
    console.error('Trivia generation failed', error);
    return null;
  }
}
