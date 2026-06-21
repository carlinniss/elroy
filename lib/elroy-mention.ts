/** Strip separators so "E l ro y" / "e-l-r-o-y" collapse to "elroy". */
export function collapseLettersForMentionMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const SPACED_ELROY = /e[\W_]*l[\W_]*r[\W_]*o[\W_]*y/i;
const SPACED_LROY = /(?<![a-z0-9])l[\W_]*r[\W_]*o[\W_]*y(?![a-z0-9])/i;

export function mentionsElroy(text: string): boolean {
  if (!text.trim()) return false;
  if (/\belroy\b/i.test(text)) return true;
  if (SPACED_ELROY.test(text)) return true;
  return collapseLettersForMentionMatch(text).includes('elroy');
}

export function misnamesElroyAsLRoy(text: string): boolean {
  if (mentionsElroy(text)) return false;
  if (/\bl[\s.\-_]*roy\b/i.test(text)) return true;
  if (SPACED_LROY.test(text)) return true;
  return /\blroy\b/i.test(text);
}

export function stripElroyFromMessage(text: string) {
  let stripped = text.replace(/@?\belroy\b/gi, ' ');
  stripped = stripped.replace(SPACED_ELROY, ' ');
  const collapsed = collapseLettersForMentionMatch(stripped);
  if (collapsed.includes('elroy')) {
    stripped = stripped.replace(/[eE][\W_]*[lL][\W_]*[rR][\W_]*[oO][\W_]*[yY]/g, ' ');
  }
  return stripped.replace(/\s+/g, ' ').trim();
}
