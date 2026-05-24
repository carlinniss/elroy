export type TriviaCategory = 'cannabis' | 'freaky';

export type ElroyTriviaQuestion = {
  id: string;
  category: TriviaCategory;
  question: string;
  /** Acceptable normalized answers (see normalizeTriviaAnswer). */
  answers: string[];
  /** Shown when revealing the answer. */
  displayAnswer: string;
};

/** @deprecated Use ElroyTriviaQuestion */
export type CannabisTriviaQuestion = ElroyTriviaQuestion;

const CANNABIS_QUESTIONS: ElroyTriviaQuestion[] = [
  {
    id: 'oil-710',
    category: 'cannabis',
    question: 'What three-digit number spells OIL when flipped upside down?',
    answers: ['710', 'seven ten', 'seven one zero'],
    displayAnswer: '710',
  },
  {
    id: 'hemp-washington',
    category: 'cannabis',
    question: 'Which U.S. founding father grew hemp at Mount Vernon?',
    answers: ['george washington', 'washington', 'gw'],
    displayAnswer: 'George Washington',
  },
  {
    id: 'cbd-full-name',
    category: 'cannabis',
    question: 'What does CBD stand for?',
    answers: ['cannabidiol', 'canna bi diol'],
    displayAnswer: 'Cannabidiol',
  },
  {
    id: 'thc-full-name',
    category: 'cannabis',
    question: 'What does THC stand for?',
    answers: ['tetrahydrocannabinol', 'tetra hydro cannabinol'],
    displayAnswer: 'Tetrahydrocannabinol',
  },
  {
    id: 'ecs',
    category: 'cannabis',
    question: 'What system in the human body interacts with cannabinoids? (abbreviation OK)',
    answers: [
      'endocannabinoid system',
      'endocannabinoid',
      'ecs',
      'endogenous cannabinoid system',
    ],
    displayAnswer: 'The endocannabinoid system',
  },
  {
    id: 'terpenes',
    category: 'cannabis',
    question: 'What aromatic compounds give cannabis and citrus their smell?',
    answers: ['terpenes', 'terpene', 'terpenoids', 'terpenoid'],
    displayAnswer: 'Terpenes',
  },
  {
    id: 'canvas-etymology',
    category: 'cannabis',
    question: 'The word "canvas" comes from what plant fiber?',
    answers: ['cannabis', 'hemp', 'cannabis hemp'],
    displayAnswer: 'Cannabis / hemp',
  },
  {
    id: 'indica-sativa',
    category: 'cannabis',
    question: 'Name either of the two classic cannabis species types (Indica or ___).',
    answers: ['indica', 'sativa', 'cannabis indica', 'cannabis sativa'],
    displayAnswer: 'Indica or Sativa',
  },
  {
    id: 'hemp-protein',
    category: 'cannabis',
    question: 'Hemp seeds are known as a complete plant what?',
    answers: ['protein', 'plant protein', 'proteins'],
    displayAnswer: 'Protein',
  },
  {
    id: '420-origin-myth',
    category: 'cannabis',
    question: 'What time of day is weed culture\'s famous number 420 associated with?',
    answers: ['420', '4 20', '4:20', 'four twenty', 'four twenty pm', '4 20 pm'],
    displayAnswer: '4:20',
  },
  {
    id: 'cannabinoid-count',
    category: 'cannabis',
    question: 'Cannabis has over 100 unique what? (compounds like THC and CBD)',
    answers: ['cannabinoids', 'cannabinoid'],
    displayAnswer: 'Cannabinoids',
  },
  {
    id: 'hemp-fiber',
    category: 'cannabis',
    question: 'Historically, hemp fiber was used for rope and what kind of cloth?',
    answers: ['canvas', 'sailcloth', 'sails', 'fabric', 'cloth', 'textile', 'textiles'],
    displayAnswer: 'Canvas / sailcloth',
  },
  {
    id: 'cbd-isolated',
    category: 'cannabis',
    question: 'Who first isolated CBD from cannabis in 1940? (last name only is fine)',
    answers: ['adams', 'roger adams'],
    displayAnswer: 'Roger Adams',
  },
  {
    id: 'marijuana-spelling',
    category: 'cannabis',
    question: 'How many letters are in the word marijuana?',
    answers: ['9', 'nine'],
    displayAnswer: '9',
  },
  {
    id: 'hemp-vs-marijuana',
    category: 'cannabis',
    question: 'Industrial hemp is legally defined by low levels of what compound?',
    answers: ['thc', 'tetrahydrocannabinol', 'delta 9 thc', 'delta-9-thc'],
    displayAnswer: 'THC',
  },
  {
    id: 'bong-water',
    category: 'cannabis',
    question: 'What do you put in the bottom of a water pipe besides the bowl?',
    answers: ['water', 'h2o'],
    displayAnswer: 'Water',
  },
  {
    id: 'grinder-purpose',
    category: 'cannabis',
    question: 'What tool do you use to break up nugs before rolling?',
    answers: ['grinder', 'weed grinder', 'herb grinder', 'cannabis grinder'],
    displayAnswer: 'A grinder',
  },
  {
    id: 'joint-paper',
    category: 'cannabis',
    question: 'A classic hand-rolled cannabis cigarette is called a what?',
    answers: ['joint', 'j', 'doobie', 'dooby', 'jay'],
    displayAnswer: 'A joint',
  },
];

const FREAKY_QUESTIONS: ElroyTriviaQuestion[] = [
  {
    id: 'bdsm-stands-for',
    category: 'freaky',
    question: 'What four-letter acronym covers bondage, dom/sub, and kink play?',
    answers: ['bdsm'],
    displayAnswer: 'BDSM',
  },
  {
    id: 'sub-short-for',
    category: 'freaky',
    question: 'In kink chat, what is a "sub" short for?',
    answers: ['submissive', 'submissive partner'],
    displayAnswer: 'Submissive',
  },
  {
    id: 'dom-short-for',
    category: 'freaky',
    question: 'In kink chat, what is a "dom" short for?',
    answers: ['dominant', 'dominant partner'],
    displayAnswer: 'Dominant',
  },
  {
    id: 'safeword-purpose',
    category: 'freaky',
    question: 'What is a safeword used for during freaky time?',
    answers: ['stop', 'to stop', 'stopping', 'pause', 'end scene', 'consent', 'safety'],
    displayAnswer: 'To stop or slow things down',
  },
  {
    id: 'aftercare',
    category: 'freaky',
    question: 'What do kink folks call the cuddles-and-check-ins after a scene?',
    answers: ['aftercare', 'after care'],
    displayAnswer: 'Aftercare',
  },
  {
    id: 'edging',
    category: 'freaky',
    question: 'What is it called when you get right to the edge but don\'t finish?',
    answers: ['edging', 'edge play', 'orgasm denial'],
    displayAnswer: 'Edging',
  },
  {
    id: 'pegging',
    category: 'freaky',
    question: 'What is it called when a woman wears a strap-on and tops her partner?',
    answers: ['pegging', 'pegged'],
    displayAnswer: 'Pegging',
  },
  {
    id: 'foot-fetish',
    category: 'freaky',
    question: 'What body-part kink is called a foot fetish?',
    answers: ['feet', 'foot', 'toes', 'toe'],
    displayAnswer: 'Feet',
  },
  {
    id: 'g-spot',
    category: 'freaky',
    question: 'The G-spot is named after what doctor\'s last name?',
    answers: ['grafenberg', 'gräfenberg', 'graf'],
    displayAnswer: 'Gräfenberg',
  },
  {
    id: 'prostate-nickname',
    category: 'freaky',
    question: 'The prostate is sometimes nicknamed the male what-spot?',
    answers: ['g spot', 'g-spot', 'p spot', 'p-spot'],
    displayAnswer: 'G-spot / P-spot',
  },
  {
    id: 'latex-lube',
    category: 'freaky',
    question: 'Oil-based lube can break what safer-sex barrier material?',
    answers: ['latex', 'condom', 'condoms', 'rubber'],
    displayAnswer: 'Latex condoms',
  },
  {
    id: 'nsfw',
    category: 'freaky',
    question: 'What does NSFW stand for?',
    answers: ['not safe for work', 'not safe for work nsfw'],
    displayAnswer: 'Not safe for work',
  },
  {
    id: 'onlyfans-content',
    category: 'freaky',
    question: 'OnlyFans creators are most famous for selling what kind of content?',
    answers: ['adult', 'spicy', 'nsfw', 'sexual', 'sex', 'nudes', '18 plus', '18+', 'explicit'],
    displayAnswer: 'Adult / spicy content',
  },
  {
    id: 'fifty-shades-kink',
    category: 'freaky',
    question: 'Fifty Shades of Grey popularized what bedroom dynamic?',
    answers: ['bdsm', 'dom sub', 'dominant submissive', 'dominance submission'],
    displayAnswer: 'BDSM / dom-sub',
  },
  {
    id: 'mile-high',
    category: 'freaky',
    question: 'Sex on an airplane is part of what rhyming "club"?',
    answers: ['mile high club', 'mile high', 'the mile high club'],
    displayAnswer: 'The mile high club',
  },
  {
    id: 'voyeur-exhibitionist',
    category: 'freaky',
    question: 'Someone who likes being watched gets turned on by being an what?',
    answers: ['exhibitionist', 'exhibitionism'],
    displayAnswer: 'Exhibitionist',
  },
  {
    id: 'cuckold',
    category: 'freaky',
    question: 'In cuckold kink, a partner gets aroused watching their lover with who?',
    answers: ['someone else', 'another person', 'another man', 'another partner', 'other people'],
    displayAnswer: 'Someone else',
  },
  {
    id: 'threesome-count',
    category: 'freaky',
    question: 'How many people are in a threesome?',
    answers: ['3', 'three', '3 people', 'three people'],
    displayAnswer: 'Three',
  },
];

export const ELROY_TRIVIA = [...CANNABIS_QUESTIONS, ...FREAKY_QUESTIONS];

/** @deprecated Use ELROY_TRIVIA */
export const CANNABIS_TRIVIA = ELROY_TRIVIA;

export function triviaIntroFor(category: ElroyTriviaQuestion['category']): string {
  return category === 'freaky' ? '😈 Freaky sex trivia!' : '🌿 Cannabis trivia!';
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

  for (const answer of acceptable) {
    const target = normalizeTriviaAnswer(answer);
    if (!target) continue;
    if (normalized === target) return true;
    if (normalized.includes(target) && target.length >= 4) return true;
    if (target.includes(normalized) && normalized.length >= 4) return true;
  }

  return false;
}

export function pickRandomElroyTrivia(
  recentIds: string[],
  category?: TriviaCategory,
  recentQuestions: string[] = [],
): ElroyTriviaQuestion | null {
  const recentIdSet = new Set(recentIds);
  const recentQuestionSet = new Set(
    recentQuestions.map((question) => normalizeTriviaAnswer(question)).filter(Boolean),
  );
  let pool = ELROY_TRIVIA.filter((item) => {
    if (recentIdSet.has(item.id)) return false;
    if (recentQuestionSet.has(normalizeTriviaAnswer(item.question))) return false;
    return true;
  });
  if (category) {
    const categoryPool = pool.filter((item) => item.category === category);
    if (categoryPool.length > 0) pool = categoryPool;
  }
  const choices = pool.length > 0 ? pool : (category
    ? ELROY_TRIVIA.filter((item) => item.category === category)
    : ELROY_TRIVIA);
  if (!choices.length) return null;
  return choices[Math.floor(Math.random() * choices.length)];
}

/** @deprecated Use pickRandomElroyTrivia */
export function pickRandomCannabisTrivia(recentIds: string[]): ElroyTriviaQuestion | null {
  return pickRandomElroyTrivia(recentIds);
}
