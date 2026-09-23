import { describe, expect, it } from 'vitest';
import { findBlockedLanguage, isSafeToPost } from '@/lib/output-guard';

describe('output guard', () => {
  it('blocks slurs, including leetspeak', () => {
    expect(findBlockedLanguage('yo n1gg3r')).not.toBeNull();
    expect(findBlockedLanguage('what a f4g')).not.toBeNull();
    expect(findBlockedLanguage('sieg heil lol')).not.toBeNull();
  });

  it("allows Elroy's normal crude persona", () => {
    for (const line of [
      'That spicy raccoon in a cocoon',
      'Dab rips, bong hits, and the freaky hour — this track is a 9/10 for sex appeal',
      'coonhound energy',
      'Pakistan has great food',
      'damn that was a bitch of a boss fight',
    ]) {
      expect(isSafeToPost(line), line).toBe(true);
    }
  });
});
