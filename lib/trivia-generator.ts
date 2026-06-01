import { generateObject } from 'ai';
import { z } from 'zod';
import type { ElroyTriviaQuestion, TriviaCategory } from '@/lib/cannabis-trivia';
import { getGeminiModel } from '@/lib/gemini-model';
import { passesTriviaDifficultyGate } from '@/lib/trivia-quality';

const triviaSchema = z.object({
  question: z.string().min(20).max(220),
  answers: z.array(z.string().min(1).max(80)).min(1).max(10),
  displayAnswer: z.string().min(1).max(120),
});

const CANNABIS_ANGLES = [
  'pre-1970 cannabis history (specific people, publications, court cases — not George Washington hemp)',
  'minor cannabinoids and acid precursors (THCA, CBDA, CBG, CBC, CBN formation — not THC/CBD 101)',
  'terpene biochemistry tied to a specific strain or effect (named terpene + mechanism)',
  'global prohibition and legalization milestones (country, year, law name, ballot measure number)',
  'landrace genetics and breeder lineage (parent strains, origin region, decade)',
  'extraction and solventless tech (hash-making methods, rosin, ice water — technical terms)',
  'cannabis pharmacology research (named researchers, universities, study years)',
  'industrial hemp history beyond rope (specific companies, patents, colonial trade)',
  'counterculture and media deep cuts (albums, films, events — not 420 memes)',
  'cultivation science (photoperiod, VPD, dry/cure chemistry — not indica vs sativa)',
  'international slang and consumption traditions (bhang, charas, kief — regional specifics)',
  'US scheduling and policy (CSA, Cole Memo, Farm Bill thresholds — dates and numbers)',
];

const FREAKY_ANGLES = [
  'kink history and etymology (who coined a term, which book, which century)',
  'BDSM frameworks beyond SSC (RACK, PRICK, negotiation models — acronyms with depth)',
  'sexology pioneers and landmark studies (Kinsey, Masters & Johnson, Hirschfeld — specifics)',
  'queer history and legal milestones (Stonewall context, decriminalization dates, activists)',
  'fetish subculture origins (leather, rubber, pup play — named clubs, cities, decades)',
  'relationship psychology with named models (attachment styles, love languages — not basics)',
  'anatomy trivia with clinical precision (named structures, discoverers — Twitch-safe)',
  'internet-era platform and community lore (specific forums, eras, subreddit culture)',
  'scene etiquette and safety protocols (dungeon rules, vetting, flagging systems)',
  'literary and cinematic deep cuts (authors, banned books, directors — not Fifty Shades 101)',
  'consent law and policy (age of consent variation by country, landmark cases — educational)',
  'paraphilia terminology from DSM/clinical context (definitions requiring real knowledge)',
];

const MUSIC_90S_ANGLES = [
  '1990s hip-hop album chronology (release year, city, label, producer credits)',
  'East Coast vs West Coast era specifics (labels, diss tracks, timeline details)',
  '90s R&B and hip-hop crossover samples (original song + sampled hit)',
  'Billboard Hot 100 and rap chart milestones from 1990-1999',
  'iconic 90s music video directors, cameos, and MTV-era deep cuts',
  'regional rap scenes in the 90s (Houston, Bay, Atlanta, NYC borough ties)',
  'producer signatures (DJ Premier, RZA, Dre, Timbaland) and exact tracks',
  'label roster lore (Bad Boy, Death Row, Ruff Ryders, No Limit) with dates',
  '90s festival/award moments (The Source Awards, Grammys, MTV VMAs)',
  'one-hit-wonder and posse-cut details from 90s rap/r&b radio',
];

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function buildAvoidBlock(recentQuestions: string[]): string {
  if (!recentQuestions.length) return '';

  return `\nSTRICT DEDUP — do NOT repeat or closely rephrase these recent questions. Pick a different subtopic, era, and answer entirely:
${recentQuestions.slice(0, 40).map((q) => `- ${q}`).join('\n')}

BANNED correct answers (too easy): THC, CBD, terpenes, ECS, indica, sativa, 420, 710, George Washington, BDSM, safeword, consent, aftercare, joint, grinder, water, NSFW, threesome, foot fetish.`;
}

function buildPrompt(category: TriviaCategory, recentQuestions: string[], attempt: number): string {
  const angles = category === 'freaky'
    ? FREAKY_ANGLES
    : category === 'music90s'
      ? MUSIC_90S_ANGLES
      : CANNABIS_ANGLES;
  const primaryAngle = pickRandom(angles);
  const secondaryAngle = pickRandom(angles.filter((a) => a !== primaryAngle));
  const difficulty =
    attempt < 3
      ? 'HARD — enthusiast-only; casual viewers should miss this'
      : attempt < 6
        ? 'EXPERT — obscure proper noun, year, or technical term; not a Google featured snippet'
        : 'OBSCURE — deep cut a dedicated hobbyist might know, not a meme answer';

  return `Generate ONE ${category} trivia question for a savvy adult Twitch chat that already knows the basics.

Angle: ${primaryAngle}
Secondary angle: ${secondaryAngle}
Difficulty: ${difficulty}
Generation salt: ${Date.now()}-${attempt}-${Math.random().toString(36).slice(2, 8)}

HARD RULES:
- Question must be at least 50 characters and require real knowledge — NOT "what is X" definition trivia
- Correct answer must be a specific person (last name OK), year, place, chemical name (minor cannabinoid/acid form), law/ballot name, or niche term (7+ letters or multi-word)
- Chat should pause and think — no giveaway phrasing like "short for", "stand for", "how many letters"
- 2-6 acceptable answer variants (abbreviations, alternate spellings OK)
- displayAnswer: friendly reveal spelling out the full fact
- Twitch-safe: no slurs, no minors, no illegal how-to, no graphic anatomy

BAD (never write): "What does THC stand for?", "How many cannabinoids?", "What is a safeword?"
GOOD: "Which Israeli chemist first isolated THC in 1964?", "RACK adds what word after Risk Aware Consensual?", "Prop 215 passed in which US state in 1996?"${buildAvoidBlock(recentQuestions)}`;
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
      model: getGeminiModel(),
      schema: triviaSchema,
      temperature: 1.1,
      system: `You write EXPERT-LEVEL Twitch trivia for Elroy. The chat already knows THC, BDSM, 420, terpenes, safewords, and indica/sativa.
Every question must test obscure history, chemistry, policy, or niche culture — never textbook definitions or meme answers.
If your question could appear on a BuzzFeed list, rewrite it harder.
Return exactly one question object.`,
      prompt: buildPrompt(category, recentQuestions, attempt),
    });

    const answers = [...new Set(object.answers.map((a) => a.trim()).filter(Boolean))];
    if (!answers.length) return null;

    const question = object.question.trim();
    if (!passesTriviaDifficultyGate(question, answers)) {
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
