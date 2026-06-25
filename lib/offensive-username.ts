const LEET_SPEAK: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  '$': 's',
  '!': 'i',
  '+': 't',
};

/** Collapse leetspeak and separators for substring checks. */
export function normalizeUsernameForModeration(login: string): string {
  let s = login.normalize('NFKC').toLowerCase();
  for (const [from, to] of Object.entries(LEET_SPEAK)) {
    s = s.replaceAll(from, to);
  }
  s = s.replace(/[^a-z0-9]/g, '');
  s = s.replace(/(.)\1{2,}/g, '$1$1');
  return s;
}

/** Same cleanup without digit leetspeak so "100 deep" stays 100deep, not ioo deep. */
function normalizeUsernameLiteral(login: string): string {
  let s = login.normalize('NFKC').toLowerCase();
  s = s.replace(/[^a-z0-9]/g, '');
  s = s.replace(/(.)\1{2,}/g, '$1$1');
  return s;
}

function matchesHatePhrase(value: string) {
  return HATE_PHRASES.some((phrase) => value.includes(phrase));
}

function usernameSegments(login: string): string[] {
  const raw = login.normalize('NFKC').trim();
  if (!raw) return [];

  const split = raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\W_]+/)
    .flatMap((part) => part.split(/(?<=\D)(?=\d)|(?<=\d)(?=\D)/))
    .map((part) => normalizeUsernameForModeration(part))
    .filter(Boolean);

  return split.length ? split : [normalizeUsernameForModeration(raw)];
}

const HATE_PHRASES = [
  '1488',
  '14words',
  '100deep',
  'hundreddeep',
  'whitepower',
  'wpww',
  'rahowa',
  'siegheil',
  'heilhitler',
  'hitlerdid',
  'holohoax',
  'killalljew',
  'killallnig',
  'killallfag',
  'killallgay',
  'killalltrans',
  'killjew',
  'killnig',
  'killfag',
  'killgay',
  'killtrans',
  'gasjew',
  'ihatejew',
  'ihatenig',
  'ihategay',
  'ihateblack',
  'deadjew',
  'deadnig',
  'rapekid',
  'pedophil',
  'childpred',
];

/** High-confidence fragments — unlikely to appear innocently inside a login. */
const OFFENSIVE_FRAGMENTS = [
  'nigger',
  'nigga',
  'faggot',
  'fagot',
  'tranny',
  'kike',
  'kyke',
  'chink',
  'wetback',
  'beaner',
  'raghead',
  'towelhead',
  'hitler',
  'swastika',
  'pedophile',
  'pedophil',
  'jigaboo',
  'porchmonkey',
  'zipperhead',
  'sandnigger',
  'shemale',
  'shitlord',
];

/** Short slurs — segment-exact only so innocent substrings are not flagged. */
const OFFENSIVE_SEGMENT_EXACT = [
  'fag',
  'dyke',
  'kike',
  'spic',
  'gook',
  'nazi',
  'pedo',
  'nigg',
  'cunt',
  'twat',
  'slut',
  'whore',
  'bitch',
];

export function isOffensiveUsername(login: string): boolean {
  const trimmed = login.trim();
  if (!trimmed) return false;

  const collapsed = normalizeUsernameForModeration(trimmed);
  const literal = normalizeUsernameLiteral(trimmed);
  const literalLeet = literal.replace(/3/g, 'e').replace(/4/g, 'a');
  if (!collapsed && !literal) return false;

  if (
    matchesHatePhrase(collapsed)
    || matchesHatePhrase(literal)
    || matchesHatePhrase(literalLeet)
  ) {
    return true;
  }

  if (OFFENSIVE_FRAGMENTS.some((term) => collapsed.includes(term))) {
    return true;
  }

  for (const segment of usernameSegments(trimmed)) {
    if (OFFENSIVE_SEGMENT_EXACT.includes(segment)) {
      return true;
    }
  }

  return false;
}
