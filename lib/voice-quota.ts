export type VoiceQuotaTierName =
  | 'depleted'
  | 'critical'
  | 'low'
  | 'moderate'
  | 'comfortable'
  | 'full'
  | 'plentiful'
  | 'abundant';

export type VoiceQuotaTier = {
  tier: VoiceQuotaTierName;
  voiceCooldownMs: number;
  celebrationVoiceCooldownMs: number;
  voiceAllowed: boolean;
  /** When true, only subs/bits/follows get TTS — mentions stay chat-only. */
  celebrationsVoiceOnly: boolean;
  /** Stream check-ins and random chat banter may use voice when live. */
  ambientVoice: boolean;
  /** Chat messages before Elroy may jump in unprompted. */
  chatActivityThreshold: number;
  /** 0–1 chance per threshold hit for ambient banter. */
  chatActivityChance: number;
};

/** Map remaining ElevenLabs characters to voice pacing (use credits when high, conserve when low). */
export function voiceQuotaTierFromRemaining(remaining: number): VoiceQuotaTier {
  if (remaining <= 0) {
    return {
      tier: 'depleted',
      voiceCooldownMs: Number.POSITIVE_INFINITY,
      celebrationVoiceCooldownMs: Number.POSITIVE_INFINITY,
      voiceAllowed: false,
      celebrationsVoiceOnly: false,
      ambientVoice: false,
      chatActivityThreshold: 75,
      chatActivityChance: 0.55,
    };
  }
  if (remaining < 1_000) {
    return {
      tier: 'critical',
      voiceCooldownMs: Number.POSITIVE_INFINITY,
      celebrationVoiceCooldownMs: Number.POSITIVE_INFINITY,
      voiceAllowed: false,
      celebrationsVoiceOnly: false,
      ambientVoice: false,
      chatActivityThreshold: 75,
      chatActivityChance: 0.55,
    };
  }
  if (remaining < 5_000) {
    return {
      tier: 'low',
      voiceCooldownMs: 5 * 60_000,
      celebrationVoiceCooldownMs: 2 * 60_000,
      voiceAllowed: true,
      celebrationsVoiceOnly: true,
      ambientVoice: false,
      chatActivityThreshold: 75,
      chatActivityChance: 0.55,
    };
  }
  if (remaining < 15_000) {
    return {
      tier: 'moderate',
      voiceCooldownMs: 3 * 60_000,
      celebrationVoiceCooldownMs: 90_000,
      voiceAllowed: true,
      celebrationsVoiceOnly: false,
      ambientVoice: false,
      chatActivityThreshold: 75,
      chatActivityChance: 0.55,
    };
  }
  if (remaining < 50_000) {
    return {
      tier: 'comfortable',
      voiceCooldownMs: 2 * 60_000,
      celebrationVoiceCooldownMs: 45_000,
      voiceAllowed: true,
      celebrationsVoiceOnly: false,
      ambientVoice: false,
      chatActivityThreshold: 75,
      chatActivityChance: 0.55,
    };
  }
  if (remaining < 100_000) {
    return {
      tier: 'full',
      voiceCooldownMs: 4 * 60_000,
      celebrationVoiceCooldownMs: 30_000,
      voiceAllowed: true,
      celebrationsVoiceOnly: false,
      ambientVoice: false,
      chatActivityThreshold: 75,
      chatActivityChance: 0.55,
    };
  }
  if (remaining < 250_000) {
    return {
      tier: 'plentiful',
      voiceCooldownMs: 4 * 60_000,
      celebrationVoiceCooldownMs: 22_000,
      voiceAllowed: true,
      celebrationsVoiceOnly: false,
      ambientVoice: false,
      chatActivityThreshold: 75,
      chatActivityChance: 0.55,
    };
  }
  return {
    tier: 'abundant',
    voiceCooldownMs: 4 * 60_000,
    celebrationVoiceCooldownMs: 18_000,
    voiceAllowed: true,
    celebrationsVoiceOnly: false,
    ambientVoice: false,
    chatActivityThreshold: 75,
    chatActivityChance: 0.55,
  };
}

function formatCooldown(ms: number) {
  if (!Number.isFinite(ms)) return 'off';
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

export function describeVoiceQuotaTier(tier: VoiceQuotaTier, remaining: number) {
  if (!tier.voiceAllowed) {
    return `${remaining.toLocaleString()} chars left — voice off (${tier.tier})`;
  }
  if (tier.celebrationsVoiceOnly) {
    return `${remaining.toLocaleString()} chars left — subs/bits voice only, ${formatCooldown(tier.celebrationVoiceCooldownMs)} between (${tier.tier})`;
  }
  const ambient = tier.ambientVoice ? ', ambient voice on' : '';
  return `${remaining.toLocaleString()} chars left — voice ~every ${formatCooldown(tier.voiceCooldownMs)}${ambient} (${tier.tier})`;
}
