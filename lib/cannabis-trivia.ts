export type CannabisTriviaQuestion = {
  id: string;
  question: string;
  /** Acceptable normalized answers (see normalizeTriviaAnswer). */
  answers: string[];
  /** Shown when revealing the answer. */
  displayAnswer: string;
};

export const CANNABIS_TRIVIA: CannabisTriviaQuestion[] = [
  {
    id: 'oil-710',
    question: 'What three-digit number spells OIL when flipped upside down?',
    answers: ['710', 'seven ten', 'seven one zero'],
    displayAnswer: '710',
  },
  {
    id: 'hemp-washington',
    question: 'Which U.S. founding father grew hemp at Mount Vernon?',
    answers: ['george washington', 'washington', 'gw'],
    displayAnswer: 'George Washington',
  },
  {
    id: 'cbd-full-name',
    question: 'What does CBD stand for?',
    answers: ['cannabidiol', 'canna bi diol'],
    displayAnswer: 'Cannabidiol',
  },
  {
    id: 'thc-full-name',
    question: 'What does THC stand for?',
    answers: ['tetrahydrocannabinol', 'tetra hydro cannabinol'],
    displayAnswer: 'Tetrahydrocannabinol',
  },
  {
    id: 'ecs',
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
    question: 'What aromatic compounds give cannabis and citrus their smell?',
    answers: ['terpenes', 'terpene', 'terpenoids', 'terpenoid'],
    displayAnswer: 'Terpenes',
  },
  {
    id: 'canvas-etymology',
    question: 'The word "canvas" comes from what plant fiber?',
    answers: ['cannabis', 'hemp', 'cannabis hemp'],
    displayAnswer: 'Cannabis / hemp',
  },
  {
    id: 'indica-sativa',
    question: 'Name either of the two classic cannabis species types (Indica or ___).',
    answers: ['indica', 'sativa', 'cannabis indica', 'cannabis sativa'],
    displayAnswer: 'Indica or Sativa',
  },
  {
    id: 'hemp-protein',
    question: 'Hemp seeds are known as a complete plant what?',
    answers: ['protein', 'plant protein', 'proteins'],
    displayAnswer: 'Protein',
  },
  {
    id: '420-origin-myth',
    question: 'What time of day is weed culture\'s famous number 420 associated with?',
    answers: ['420', '4 20', '4:20', 'four twenty', 'four twenty pm', '4 20 pm'],
    displayAnswer: '4:20',
  },
  {
    id: 'cannabinoid-count',
    question: 'Cannabis has over 100 unique what? (compounds like THC and CBD)',
    answers: ['cannabinoids', 'cannabinoid'],
    displayAnswer: 'Cannabinoids',
  },
  {
    id: 'hemp-fiber',
    question: 'Historically, hemp fiber was used for rope and what kind of cloth?',
    answers: ['canvas', 'sailcloth', 'sails', 'fabric', 'cloth', 'textile', 'textiles'],
    displayAnswer: 'Canvas / sailcloth',
  },
  {
    id: 'cbd-isolated',
    question: 'Who first isolated CBD from cannabis in 1940? (last name only is fine)',
    answers: ['adams', 'roger adams'],
    displayAnswer: 'Roger Adams',
  },
  {
    id: 'marijuana-spelling',
    question: 'How many letters are in the word marijuana?',
    answers: ['9', 'nine'],
    displayAnswer: '9',
  },
  {
    id: 'hemp-vs-marijuana',
    question: 'Industrial hemp is legally defined by low levels of what compound?',
    answers: ['thc', 'tetrahydrocannabinol', 'delta 9 thc', 'delta-9-thc'],
    displayAnswer: 'THC',
  },
  {
    id: 'bong-water',
    question: 'What do you put in the bottom of a water pipe besides the bowl?',
    answers: ['water', 'h2o'],
    displayAnswer: 'Water',
  },
  {
    id: 'grinder-purpose',
    question: 'What tool do you use to break up nugs before rolling?',
    answers: ['grinder', 'weed grinder', 'herb grinder', 'cannabis grinder'],
    displayAnswer: 'A grinder',
  },
  {
    id: 'joint-paper',
    question: 'A classic hand-rolled cannabis cigarette is called a what?',
    answers: ['joint', 'j', 'doobie', 'dooby', 'jay'],
    displayAnswer: 'A joint',
  },
];

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

export function pickRandomCannabisTrivia(recentIds: string[]): CannabisTriviaQuestion | null {
  const recent = new Set(recentIds);
  const pool = CANNABIS_TRIVIA.filter((item) => !recent.has(item.id));
  const choices = pool.length > 0 ? pool : CANNABIS_TRIVIA;
  if (!choices.length) return null;
  return choices[Math.floor(Math.random() * choices.length)];
}
