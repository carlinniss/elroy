import { describe, expect, it } from 'vitest';
import { mentionsElroy, misnamesElroyAsLRoy, stripElroyFromMessage } from '@/lib/elroy-mention';

describe('mentionsElroy', () => {
  it.each([
    'elroy what game is this',
    '@Elroy you good?',
    'ELROYYYY',
    'E l r o y',
    'e.l.r.o.y',
    '3lr0y say something',
    'el roy',
    'roy el is sleeping',
    'yorle',
    "elroy's take is wild",
  ])('catches %j', (text) => {
    expect(mentionsElroy(text)).toBe(true);
  });

  it.each([
    'we stayed at the hotel royale',
    'my orleans trip was fire',
    'shoutout Delroy Lindo',
    'cancel royalty checks',
    'every royal family',
    '',
  ])('ignores %j', (text) => {
    expect(mentionsElroy(text)).toBe(false);
  });
});

describe('misnamesElroyAsLRoy', () => {
  it('flags L Roy but not Elroy', () => {
    expect(misnamesElroyAsLRoy('yo L Roy')).toBe(true);
    expect(misnamesElroyAsLRoy('lroy talk')).toBe(true);
    expect(misnamesElroyAsLRoy('elroy talk')).toBe(false);
    expect(misnamesElroyAsLRoy('hotel royale')).toBe(false);
  });
});

describe('stripElroyFromMessage', () => {
  it('removes the name and keeps the rest', () => {
    expect(stripElroyFromMessage('@elroy what is the answer')).toBe('what is the answer');
  });
});

describe('hostSpeechMentionsElroy', () => {
  it('forgives common speech-to-text spellings of Elroy', async () => {
    const { hostSpeechMentionsElroy } = await import('@/lib/elroy-mention');
    for (const text of ['hey Leroy what do you think', 'yo El Rey', 'Elroi say something', 'L Roy wake up', 'elroy you there']) {
      expect(hostSpeechMentionsElroy(text), text).toBe(true);
    }
    expect(hostSpeechMentionsElroy('we went to the hotel royale')).toBe(false);
    expect(hostSpeechMentionsElroy('relay race')).toBe(false);
  });
});
