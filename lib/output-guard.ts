/**
 * Last-line safety check on everything Elroy is about to say.
 * Viewers can try to bait the model into slurs ("repeat after me…"); Twitch actions the
 * account that posts them, so we refuse to post rather than trust the model.
 *
 * Deliberately narrow: Elroy's persona is crude on purpose (cannabis, "freaky" trivia),
 * so this only targets slurs and hate phrases — not profanity.
 */

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i',
};

/** Fragments that are never innocent inside a single word. */
const SLUR_FRAGMENTS = [
  'nigger', 'nigga', 'faggot', 'fagot', 'tranny', 'kike', 'kyke', 'chink', 'wetback',
  'beaner', 'raghead', 'towelhead', 'jigaboo', 'porchmonkey', 'zipperhead', 'retard',
];

/** Short slurs that must match a whole word so "spicy", "raccoon", "cocoon" stay fine. */
const SLUR_WORDS = new Set(['fag', 'fags', 'dyke', 'dykes', 'coon', 'coons', 'spic', 'spics', 'gook', 'gooks', 'paki', 'pakis', 'tard', 'tards']);

/** Multi-word hate phrases, checked against the de-spaced text. */
const HATE_PHRASES = [/siegheil/, /heilhitler/, /whitepower/, /holohoax/, /gasthejews/, /killalljews/, /1488/];

function normalizeWord(word: string): string {
  let w = word.normalize('NFKC').toLowerCase();
  for (const [from, to] of Object.entries(LEET)) w = w.replaceAll(from, to);
  return w.replace(/[^a-z]/g, '').replace(/(.)\1{2,}/g, '$1$1');
}

export function findBlockedLanguage(text: string): string | null {
  if (!text) return null;
  const words = text.split(/\s+/).map(normalizeWord).filter(Boolean);
  for (const word of words) {
    if (SLUR_WORDS.has(word)) return word;
    const fragment = SLUR_FRAGMENTS.find((term) => word.includes(term));
    if (fragment) return fragment;
  }
  const collapsed = text.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
  const phrase = HATE_PHRASES.find((pattern) => pattern.test(collapsed));
  return phrase ? phrase.source : null;
}

export function isSafeToPost(text: string): boolean {
  return findBlockedLanguage(text) === null;
}

/** Used when the model keeps producing something we won't post. */
export const GUARDRAIL_FALLBACK_LINES = [
  "Nah, I'm not saying that. Elroy's been around too long to get baited.",
  "Nice try. The OG don't take the bait.",
  "I see what you're doing. Not today.",
];

export function guardrailFallback(): string {
  return GUARDRAIL_FALLBACK_LINES[Math.floor(Math.random() * GUARDRAIL_FALLBACK_LINES.length)];
}
