export type ElroySfxDefinition = {
  id: string;
  prompt: string;
  duration_seconds: number;
  prompt_influence?: number;
  /** Bundled file in public/sounds/elroy — skips ElevenLabs generation. */
  bundled?: boolean;
};

export const ELROY_SFX_CATALOG: Record<string, ElroySfxDefinition> = {
  bong_rip: {
    id: 'bong_rip',
    prompt: 'Quick glass water bong rip inhale and exhale, short cannabis pipe hit, punchy 1.5 seconds',
    duration_seconds: 1.5,
    prompt_influence: 0.75,
  },
  sub_fanfare: {
    id: 'sub_fanfare',
    prompt: 'Bundled La Cucaracha car horn melody',
    duration_seconds: 3,
    bundled: true,
  },
  bits_kaching: {
    id: 'bits_kaching',
    prompt: 'Coins dropping cash register kaching sparkle, Twitch bits cheer, 1.5 seconds',
    duration_seconds: 1.5,
    prompt_influence: 0.7,
  },
  follow_ding: {
    id: 'follow_ding',
    prompt: 'Friendly bright notification ding for a new follower, 1 second',
    duration_seconds: 1,
    prompt_influence: 0.65,
  },
  go_live: {
    id: 'go_live',
    prompt: 'Dramatic stream go-live power activation whoosh energy burst, 2.5 seconds',
    duration_seconds: 2.5,
    prompt_influence: 0.7,
  },
  mute_zip: {
    id: 'mute_zip',
    prompt: 'Comedy zipper mouth silenced muzzle shut up, 1 second',
    duration_seconds: 1,
    prompt_influence: 0.75,
  },
  roast_sting: {
    id: 'roast_sting',
    prompt: 'Comedic roast insult sting rimshot bah dum tss, 1.5 seconds',
    duration_seconds: 1.5,
    prompt_influence: 0.7,
  },
};

export function getElroySfx(id: string): ElroySfxDefinition | null {
  return ELROY_SFX_CATALOG[id] ?? null;
}

export function getElroySfxPlaybackUrl(id: string): string | null {
  const definition = getElroySfx(id);
  if (!definition) return null;
  if (definition.bundled) return `/sounds/elroy/${id}.wav`;
  return `/api/sfx/${id}`;
}

export const ELROY_SFX_IDS = Object.keys(ELROY_SFX_CATALOG);
