export type VoiceQuotaTier = {
  tier: 'full' | 'comfortable' | 'moderate' | 'low' | 'critical' | 'depleted';
  voiceCooldownMs: number;
  celebrationVoiceCooldownMs: number;
  voiceAllowed: boolean;
  celebrationsVoiceOnly: boolean;
};

/** Map remaining ElevenLabs characters to voice pacing. */
export function voiceQuotaTierFromRemaining(remaining: number): VoiceQuotaTier {
  if (remaining <= 0) {
    return {
      tier: 'depleted',
      voiceCooldownMs: Number.POSITIVE_INFINITY,
      celebrationVoiceCooldownMs: Number.POSITIVE_INFINITY,
      voiceAllowed: false,
      celebrationsVoiceOnly: false,
    };
  }
  if (remaining < 1_000) {
    return {
      tier: 'critical',
      voiceCooldownMs: Number.POSITIVE_INFINITY,
      celebrationVoiceCooldownMs: Number.POSITIVE_INFINITY,
      voiceAllowed: false,
      celebrationsVoiceOnly: false,
    };
  }
  if (remaining < 5_000) {
    return {
      tier: 'low',
      voiceCooldownMs: 5 * 60_000,
      celebrationVoiceCooldownMs: 2 * 60_000,
      voiceAllowed: true,
      celebrationsVoiceOnly: true,
    };
  }
  if (remaining < 15_000) {
    return {
      tier: 'moderate',
      voiceCooldownMs: 3 * 60_000,
      celebrationVoiceCooldownMs: 90_000,
      voiceAllowed: true,
      celebrationsVoiceOnly: false,
    };
  }
  if (remaining < 50_000) {
    return {
      tier: 'comfortable',
      voiceCooldownMs: 2 * 60_000,
      celebrationVoiceCooldownMs: 45_000,
      voiceAllowed: true,
      celebrationsVoiceOnly: false,
    };
  }
  return {
    tier: 'full',
    voiceCooldownMs: 90_000,
    celebrationVoiceCooldownMs: 25_000,
    voiceAllowed: true,
    celebrationsVoiceOnly: false,
  };
}

export function describeVoiceQuotaTier(tier: VoiceQuotaTier, remaining: number) {
  const mins = (ms: number) => Math.round(ms / 60_000);
  if (!tier.voiceAllowed) {
    return `${remaining.toLocaleString()} chars left — voice off (${tier.tier})`;
  }
  if (tier.celebrationsVoiceOnly) {
    return `${remaining.toLocaleString()} chars left — subs/bits voice only, ${mins(tier.celebrationVoiceCooldownMs)}m between (${tier.tier})`;
  }
  return `${remaining.toLocaleString()} chars left — voice every ${mins(tier.voiceCooldownMs)}m (${tier.tier})`;
}
