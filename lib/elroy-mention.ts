const LEET_FOR_ELROY: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  '$': 's',
  '!': 'i',
};

/** Strip separators and map leetspeak so "E l ro y" / "3lroy" / "y0rle" collapse for matching. */
export function collapseLettersForMentionMatch(text: string): string {
  let s = text.normalize('NFKC').toLowerCase();
  for (const [from, to] of Object.entries(LEET_FOR_ELROY)) {
    s = s.replaceAll(from, to);
  }
  return s.replace(/[^a-z]/g, '');
}

/** Squash 3+ repeated letters so "ellroy" still reads as Elroy. */
function squashRepeatedLetters(text: string): string {
  return text.replace(/(.)\1{2,}/g, '$1$1');
}

const ELROY_FORWARD = 'elroy';
const ELROY_BACKWARD = 'yorle';

// Letters may be split by punctuation/spaces ("E l r o y", "e.l.r.o.y") but the name has to stand
// alone — "hotel royale" and "Delroy" are not Elroy.
const SPACED_ELROY = /(?<![a-z0-9])e[\W_]*l[\W_]*r[\W_]*o[\W_]*y(?![a-z0-9])/i;
const SPACED_YORLE = /(?<![a-z0-9])y[\W_]*o[\W_]*r[\W_]*l[\W_]*e(?![a-z0-9])/i;
const SPACED_LROY = /(?<![a-z0-9])l[\W_]*r[\W_]*o[\W_]*y(?![a-z0-9])/i;

/** "el roy" / "el-roy" — name split across a space or dash. */
const EL_ROY_SPLIT = /\bel[\W_]+roy\b/i;

/** "roy el" — backwards word order (talking about Elroy behind his back). */
const ROY_EL_SPLIT = /\broy[\W_]+el\b/i;

/** A run of tokens that collapses to exactly the name (plus possessive s): "3lr0y", "E L R O Y", "yorle's". */
const COLLAPSED_NAME = /^(e+l+r+o+y+|y+o+r+l+e+)s?$/;
const MAX_NAME_TOKENS = 5;

function collapsedIncludesElroyName(text: string): boolean {
  // Check each word, and short runs of adjacent words, on their own. Collapsing the whole message
  // at once made "hotel royale" → "hotelroyale" and "my orleans trip" → "myorleans…" count as mentions.
  const tokens = text.split(/\s+/).filter(Boolean);
  for (let start = 0; start < tokens.length; start += 1) {
    let joined = '';
    for (let end = start; end < Math.min(tokens.length, start + MAX_NAME_TOKENS); end += 1) {
      joined += tokens[end];
      const collapsed = squashRepeatedLetters(collapseLettersForMentionMatch(joined));
      if (COLLAPSED_NAME.test(collapsed)) return true;
      if (collapsed.length > 8) break;
    }
  }
  return false;
}

export function mentionsElroy(text: string): boolean {
  if (!text.trim()) return false;
  if (/\belroy\b/i.test(text)) return true;
  if (/\byorle\b/i.test(text)) return true;
  if (SPACED_ELROY.test(text)) return true;
  if (SPACED_YORLE.test(text)) return true;
  if (EL_ROY_SPLIT.test(text)) return true;
  if (ROY_EL_SPLIT.test(text)) return true;
  return collapsedIncludesElroyName(text);
}

/**
 * Speech-to-text often hears "Elroy" as "Leroy", "El Rey", etc. Used only for the host's mic
 * transcripts — in typed chat "Leroy" is a different name.
 */
const TRANSCRIPT_ELROY = /\b(le+roy|el+ ?roi|el ?rey|elroi|l ?roy)\b/i;

export function hostSpeechMentionsElroy(text: string): boolean {
  return mentionsElroy(text) || TRANSCRIPT_ELROY.test(text);
}

export function misnamesElroyAsLRoy(text: string): boolean {
  if (mentionsElroy(text)) return false;
  if (/\bl[\s.\-_]*roy\b/i.test(text)) return true;
  if (SPACED_LROY.test(text)) return true;
  return /\blroy\b/i.test(text);
}

export function stripElroyFromMessage(text: string) {
  let stripped = text.replace(/@?\belroy\b/gi, ' ');
  stripped = stripped.replace(/@?\byorle\b/gi, ' ');
  stripped = stripped.replace(SPACED_ELROY, ' ');
  stripped = stripped.replace(SPACED_YORLE, ' ');
  stripped = stripped.replace(EL_ROY_SPLIT, ' ');
  stripped = stripped.replace(ROY_EL_SPLIT, ' ');
  if (collapsedIncludesElroyName(stripped)) {
    stripped = stripped.replace(/[eE3][\W_]*[lL1][\W_]*[rR][\W_]*[oO0][\W_]*[yY]/g, ' ');
    stripped = stripped.replace(/[yY][\W_]*[oO0][\W_]*[rR][\W_]*[lL1][\W_]*[eE3]/g, ' ');
  }
  return stripped.replace(/\s+/g, ' ').trim();
}
