export type TriviaCategory = 'cannabis' | 'freaky' | 'music90s';

export type ElroyTriviaQuestion = {
  id: string;
  category: TriviaCategory;
  question: string;
  /** Acceptable normalized answers (see normalizeTriviaAnswer). */
  answers: string[];
  /** Shown when revealing the answer. */
  displayAnswer: string;
  /** Optional bonus scoring weight. Defaults to 1 point. */
  points?: number;
};

/** @deprecated Use ElroyTriviaQuestion */
export type CannabisTriviaQuestion = ElroyTriviaQuestion;

const CANNABIS_QUESTIONS: ElroyTriviaQuestion[] = [
  {
    id: 'mechoulam-thc-year',
    category: 'cannabis',
    question: 'Israeli chemist Raphael Mechoulam first isolated THC in what year?',
    answers: ['1964', 'nineteen sixty four'],
    displayAnswer: '1964',
  },
  {
    id: 'prop-215-state',
    category: 'cannabis',
    question: 'California\'s Prop 215 (1996) made it the first US state to legalize medical cannabis — name the state.',
    answers: ['california', 'ca'],
    displayAnswer: 'California',
  },
  {
    id: 'uruguay-legal-year',
    category: 'cannabis',
    question: 'Uruguay became the first country to legalize recreational cannabis nationwide in what year?',
    answers: ['2013', 'twenty thirteen'],
    displayAnswer: '2013',
  },
  {
    id: 'oshaughnessy-country',
    category: 'cannabis',
    question: 'Dr. William O\'Shaughnessy introduced cannabis to Western medicine after observing it in which country?',
    answers: ['india', 'british india'],
    displayAnswer: 'India',
  },
  {
    id: 'thca-precursor',
    category: 'cannabis',
    question: 'Before decarboxylation, THC exists in raw flower primarily as what four-letter acid?',
    answers: ['thca', 't h c a', 'tetrahydrocannabinolic acid'],
    displayAnswer: 'THCA',
  },
  {
    id: 'schedule-one',
    category: 'cannabis',
    question: 'Under the US Controlled Substances Act, marijuana remains on which schedule?',
    answers: ['schedule i', 'schedule 1', 'schedule one', 'i'],
    displayAnswer: 'Schedule I',
  },
  {
    id: 'myrcene-mango',
    category: 'cannabis',
    question: 'Which terpene — abundant in mangoes — is most linked to sedating "couch-lock" profiles?',
    answers: ['myrcene', 'beta myrcene', 'β myrcene'],
    displayAnswer: 'Myrcene',
  },
  {
    id: 'blue-dream-cross',
    category: 'cannabis',
    question: 'Classic strain Blue Dream crosses Blueberry with which legendary sativa lineage?',
    answers: ['haze', 'super silver haze', 'silver haze'],
    displayAnswer: 'Haze (Super Silver Haze)',
  },
  {
    id: 'cbd-adams',
    category: 'cannabis',
    question: 'Who first isolated CBD from cannabis in 1940? (last name is enough)',
    answers: ['adams', 'roger adams'],
    displayAnswer: 'Roger Adams',
  },
  {
    id: 'cbda-precursor',
    category: 'cannabis',
    question: 'Raw hemp flower holds CBD mostly as which acid precursor before decarb?',
    answers: ['cbda', 'c b d a', 'cannabidiolic acid'],
    displayAnswer: 'CBDA',
  },
  {
    id: 'acapulco-origin',
    category: 'cannabis',
    question: 'The landrace strain Acapulco Gold originated in which country?',
    answers: ['mexico', 'méxico'],
    displayAnswer: 'Mexico',
  },
  {
    id: 'farm-bill-thc-limit',
    category: 'cannabis',
    question: 'The 2018 US Farm Bill legalized hemp with delta-9 THC below what percentage by dry weight?',
    answers: ['0.3', '0.3%', 'point 3', 'point three', 'three tenths'],
    displayAnswer: '0.3%',
  },
  {
    id: 'cannabis-cup-city',
    category: 'cannabis',
    question: 'The original High Times Cannabis Cup was famously held annually in which Dutch city?',
    answers: ['amsterdam'],
    displayAnswer: 'Amsterdam',
  },
  {
    id: 'lebanon-hash-region',
    category: 'cannabis',
    question: 'Traditional Lebanese hash production is most associated with which valley region?',
    answers: ['bekaa', 'bekaa valley', 'beqaa', 'beqaa valley'],
    displayAnswer: 'Bekaa Valley',
  },
  {
    id: 'cbn-from-thc',
    category: 'cannabis',
    question: 'When THC oxidizes with age, it degrades into which minor cannabinoid abbreviated CBN?',
    answers: ['cbn', 'c b n', 'cannabinol'],
    displayAnswer: 'CBN (cannabinol)',
  },
];

const FREAKY_QUESTIONS: ElroyTriviaQuestion[] = [
  {
    id: 'rack-acronym',
    category: 'freaky',
    question: 'In kink, RACK stands for Risk Aware Consensual what?',
    answers: ['kink'],
    displayAnswer: 'Kink',
  },
  {
    id: 'prick-acronym',
    category: 'freaky',
    question: 'PRICK in BDSM negotiation stands for Personal Responsibility Informed Consensual what?',
    answers: ['kink'],
    displayAnswer: 'Kink',
  },
  {
    id: 'story-of-o-author',
    category: 'freaky',
    question: 'The erotic novel "The Story of O" was published under the pseudonym Pauline what?',
    answers: ['reage', 'réage', 'pauline reage', 'pauline réage'],
    displayAnswer: 'Pauline Réage',
  },
  {
    id: 'kinsey-institute',
    category: 'freaky',
    question: 'Sex researcher Alfred Kinsey founded what institute at Indiana University?',
    answers: ['kinsey institute', 'the kinsey institute', 'kinsey'],
    displayAnswer: 'The Kinsey Institute',
  },
  {
    id: 'ssc-consensual',
    category: 'freaky',
    question: 'SSC in BDSM stands for Safe, Sane, and what third word?',
    answers: ['consensual'],
    displayAnswer: 'Consensual',
  },
  {
    id: 'sadism-namesake',
    category: 'freaky',
    question: 'The term "sadism" comes from the Marquis de who?',
    answers: ['sade', 'de sade', 'marquis de sade', 'donatien'],
    displayAnswer: 'Marquis de Sade',
  },
  {
    id: 'masochism-namesake',
    category: 'freaky',
    question: 'Masochism is named after Austrian writer Leopold von who?',
    answers: ['sacher masoch', 'sacher-masoch', 'sachermasoch'],
    displayAnswer: 'Leopold von Sacher-Masoch',
  },
  {
    id: 'shibari-origin',
    category: 'freaky',
    question: 'Shibari rope bondage as practiced in kink communities traces to which country?',
    answers: ['japan', 'japanese'],
    displayAnswer: 'Japan',
  },
  {
    id: 'grafenberg-spot',
    category: 'freaky',
    question: 'The G-spot is named after German physician Ernst what?',
    answers: ['grafenberg', 'gräfenberg', 'graf'],
    displayAnswer: 'Gräfenberg',
  },
  {
    id: 'hirschfeld-institute',
    category: 'freaky',
    question: 'Magnus Hirschfeld pioneered early sexology in Berlin at his Institute for what?',
    answers: ['sexual science', 'sexology', 'sex research'],
    displayAnswer: 'Sexual Science (Institut für Sexualwissenschaft)',
  },
  {
    id: 'stonewall-year',
    category: 'freaky',
    question: 'The Stonewall riots — a turning point for queer liberation — erupted in what year?',
    answers: ['1969', 'nineteen sixty nine'],
    displayAnswer: '1969',
  },
  {
    id: 'masters-johnson-city',
    category: 'freaky',
    question: 'Masters and Johnson conducted their pioneering sex research in which US city?',
    answers: ['st louis', 'saint louis', 'st. louis'],
    displayAnswer: 'St. Louis',
  },
  {
    id: 'leather-flag-color-order',
    category: 'freaky',
    question: 'The leather pride flag has black, blue, and what third stripe color?',
    answers: ['white'],
    displayAnswer: 'White (black, blue, white)',
  },
  {
    id: 'corset-training',
    category: 'freaky',
    question: 'Tight-lacing fetishism centers on which restrictive garment?',
    answers: ['corset', 'corsets', 'waist cincher'],
    displayAnswer: 'Corset',
  },
  {
    id: 'violet-wand',
    category: 'freaky',
    question: 'Electroplay kinksters often use a handheld Tesla coil device called a violet what?',
    answers: ['wand', 'violet wand'],
    displayAnswer: 'Violet wand',
  },
];

const MUSIC_90S_QUESTIONS: ElroyTriviaQuestion[] = [
  {
    id: 'music90s-grunge-nevermind-year',
    category: 'music90s',
    question: 'Nirvana released "Nevermind" in what year?',
    answers: ['1991', 'nineteen ninety one'],
    displayAnswer: '1991',
  },
  {
    id: 'music90s-mariah-fantasy-sample',
    category: 'music90s',
    question: 'Mariah Carey\'s 1995 "Fantasy" famously samples which Tom Tom Club song?',
    answers: ['genius of love', 'the genius of love'],
    displayAnswer: 'Genius of Love',
  },
  {
    id: 'music90s-hiphop-bonus-illmatic',
    category: 'music90s',
    question: '🎤 BONUS (2 points): Nas dropped "Illmatic" in 1994. What NYC borough is he most associated with?',
    answers: ['queensbridge', 'queens', 'qb'],
    displayAnswer: 'Queensbridge, Queens',
    points: 2,
  },
  {
    id: 'music90s-hiphop-bonus-ready-to-die-label',
    category: 'music90s',
    question: '🎤 BONUS (2 points): The Notorious B.I.G.\'s "Ready to Die" was released on which label founded by Puff Daddy?',
    answers: ['bad boy', 'bad boy records', 'bad boy entertainment'],
    displayAnswer: 'Bad Boy Records',
    points: 2,
  },
  {
    id: 'music90s-wu-36-chambers-year',
    category: 'music90s',
    question: 'Wu-Tang Clan\'s debut "Enter the Wu-Tang (36 Chambers)" dropped in what year?',
    answers: ['1993', 'nineteen ninety three'],
    displayAnswer: '1993',
  },
  {
    id: 'music90s-lauryn-miseducation-year',
    category: 'music90s',
    question: 'Lauryn Hill\'s "The Miseducation of Lauryn Hill" won Album of the Year in what year?',
    answers: ['1999', 'nineteen ninety nine'],
    displayAnswer: '1999',
  },
];

export const ELROY_TRIVIA = [...CANNABIS_QUESTIONS, ...FREAKY_QUESTIONS, ...MUSIC_90S_QUESTIONS];

/** @deprecated Use ELROY_TRIVIA */
export const CANNABIS_TRIVIA = ELROY_TRIVIA;

export function triviaIntroFor(category: ElroyTriviaQuestion['category']): string {
  if (category === 'music90s') return '🎵 90s music trivia!';
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

  const msgTokens = normalized.split(/\s+/).filter(Boolean);

  for (const answer of acceptable) {
    const target = normalizeTriviaAnswer(answer);
    if (!target) continue;

    if (normalized === target) return true;

    const answerTokens = target.split(/\s+/).filter(Boolean);
    if (!answerTokens.length) continue;

    // Every answer token must appear as a whole token in chat (not a substring like crop → cropping).
    const allAnswerTokensPresent = answerTokens.every((token) =>
      msgTokens.some((msgToken) => msgToken === token),
    );
    if (!allAnswerTokensPresent) continue;

    // Reject partial guesses: chat can't be mostly unrelated words.
    const extraTokens = msgTokens.filter((token) => !answerTokens.includes(token));
    if (extraTokens.length > 1) continue;
    if (extraTokens.some((token) => token.length > 3)) continue;

    return true;
  }

  return false;
}

export function mentionsElroy(text: string) {
  return /\belroy\b/i.test(text);
}

export function stripElroyFromMessage(text: string) {
  return text.replace(/@?\belroy\b/gi, ' ').replace(/\s+/g, ' ').trim();
}

export function isAskingElroyForTriviaHelp(message: string) {
  const msg = normalizeTriviaAnswer(stripElroyFromMessage(message));
  if (!msg) return false;
  const patterns = [
    /\bwhat is the answer\b/,
    /\bwhats the answer\b/,
    /\btell me the answer\b/,
    /\bgive me the answer\b/,
    /\btrivia answer\b/,
    /\banswer to (the|this) trivia\b/,
    /\bwhat was the answer\b/,
  ];
  return patterns.some((pattern) => pattern.test(msg));
}

export function isRepeatingActiveTriviaQuestion(message: string, question: string) {
  const msg = normalizeTriviaAnswer(stripElroyFromMessage(message));
  const q = normalizeTriviaAnswer(question);
  if (!msg || !q || msg.length < 12) return false;
  if (msg.includes(q) || q.includes(msg)) return true;

  const stop = new Set([
    'what', 'which', 'who', 'when', 'where', 'the', 'and', 'for', 'with', 'that', 'this',
    'from', 'into', 'about', 'name', 'first', 'under', 'most', 'what year', 'which country',
  ]);
  const qWords = q.split(' ').filter((word) => word.length >= 4 && !stop.has(word));
  if (qWords.length < 2) return false;
  const matched = qWords.filter((word) => msg.includes(word));
  return matched.length >= Math.min(3, Math.ceil(qWords.length * 0.45));
}

export type ElroyTriviaCheatKind = 'answer' | 'question' | 'help';

export function detectElroyTriviaCheat(
  message: string,
  question: string,
  answers: string[],
): ElroyTriviaCheatKind | null {
  if (!mentionsElroy(message)) return null;
  if (matchesTriviaAnswer(message, answers)) return 'answer';
  if (isRepeatingActiveTriviaQuestion(message, question)) return 'question';
  if (isAskingElroyForTriviaHelp(message)) return 'help';
  return null;
}

export function listAvailableElroyTrivia(
  recentIds: string[],
  category: TriviaCategory,
  recentQuestions: string[] = [],
): ElroyTriviaQuestion[] {
  const recentIdSet = new Set(recentIds);
  const recentQuestionSet = new Set(
    recentQuestions.map((question) => normalizeTriviaAnswer(question)).filter(Boolean),
  );

  return ELROY_TRIVIA.filter((item) => {
    if (item.category !== category) return false;
    if (recentIdSet.has(item.id)) return false;
    if (recentQuestionSet.has(normalizeTriviaAnswer(item.question))) return false;
    return true;
  });
}

export function pickRandomElroyTrivia(
  recentIds: string[],
  category?: TriviaCategory,
  recentQuestions: string[] = [],
): ElroyTriviaQuestion | null {
  if (!category) return null;

  const choices = listAvailableElroyTrivia(recentIds, category, recentQuestions);
  if (!choices.length) return null;

  return choices[Math.floor(Math.random() * choices.length)];
}

/** @deprecated Use pickRandomElroyTrivia */
export function pickRandomCannabisTrivia(recentIds: string[]): ElroyTriviaQuestion | null {
  return pickRandomElroyTrivia(recentIds);
}
