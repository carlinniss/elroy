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

const SPACED_ELROY = /e[\W_]*l[\W_]*r[\W_]*o[\W_]*y/i;
const SPACED_YORLE = /y[\W_]*o[\W_]*r[\W_]*l[\W_]*e/i;
const SPACED_LROY = /(?<![a-z0-9])l[\W_]*r[\W_]*o[\W_]*y(?![a-z0-9])/i;

/** "el roy" / "el-roy" — name split across a space or dash. */
const EL_ROY_SPLIT = /\bel[\W_]+roy\b/i;

/** "roy el" — backwards word order (talking about Elroy behind his back). */
const ROY_EL_SPLIT = /\broy[\W_]+el\b/i;

function collapsedIncludesElroyName(text: string): boolean {
  const collapsed = squashRepeatedLetters(collapseLettersForMentionMatch(text));
  return collapsed.includes(ELROY_FORWARD) || collapsed.includes(ELROY_BACKWARD);
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
