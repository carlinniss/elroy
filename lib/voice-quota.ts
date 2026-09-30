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

/**
 * How chatty Elroy's voice is, set with ELROY_VOICE_PACE. Credit tiers still apply on top —
 * even "liberal" slows down automatically as the ElevenLabs balance drops.
 */
export type VoicePace = 'conservative' | 'normal' | 'liberal';

export function parseVoicePace(raw: unknown): VoicePace {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return value === 'liberal' || value === 'conservative' ? value : 'normal';
}

/** Spoken-line length target per pace — liberal talks more often but keeps each line short. */
export function voiceLineCharTarget(pace: VoicePace): { min: number; max: number } {
  if (pace === 'liberal') return { min: 100, max: 240 };
  if (pace === 'conservative') return { min: 120, max: 300 };
  return { min: 180, max: 480 };
}

function scaleCooldown(ms: number, factor: number, floorMs: number) {
  if (!Number.isFinite(ms)) return ms;
  return Math.max(floorMs, Math.round(ms * factor));
}

function applyVoicePace(tier: VoiceQuotaTier, pace: VoicePace): VoiceQuotaTier {
  if (pace === 'normal' || !tier.voiceAllowed) return tier;
  if (pace === 'conservative') {
    return {
      ...tier,
      voiceCooldownMs: scaleCooldown(tier.voiceCooldownMs, 1.5, 60_000),
      celebrationVoiceCooldownMs: scaleCooldown(tier.celebrationVoiceCooldownMs, 1.5, 20_000),
      ambientVoice: false,
      chatActivityThreshold: Math.round(tier.chatActivityThreshold * 1.3),
    };
  }
  return {
    ...tier,
    voiceCooldownMs: scaleCooldown(tier.voiceCooldownMs, 0.25, 10_000),
    celebrationVoiceCooldownMs: scaleCooldown(tier.celebrationVoiceCooldownMs, 0.5, 6_000),
    // Ambient voice once there's a comfortable cushion; below that, save credits for real moments.
    ambientVoice: tier.ambientVoice || (!tier.celebrationsVoiceOnly && tier.tier !== 'moderate'),
    chatActivityThreshold: Math.max(20, Math.round(tier.chatActivityThreshold * 0.6)),
    chatActivityChance: Math.min(0.85, tier.chatActivityChance + 0.15),
  };
}

/** Map remaining ElevenLabs characters to voice pacing (use credits when high, conserve when low). */
export function voiceQuotaTierFromRemaining(remaining: number, pace: VoicePace = 'normal'): VoiceQuotaTier {
  return applyVoicePace(baseVoiceQuotaTier(remaining), pace);
}

function baseVoiceQuotaTier(remaining: number): VoiceQuotaTier {
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
      voiceCooldownMs: 3 * 60_000,
      celebrationVoiceCooldownMs: 60_000,
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
      voiceCooldownMs: 90_000,
      celebrationVoiceCooldownMs: 45_000,
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
      voiceCooldownMs: 60_000,
      celebrationVoiceCooldownMs: 25_000,
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
      voiceCooldownMs: 75_000,
      celebrationVoiceCooldownMs: 20_000,
      voiceAllowed: true,
      celebrationsVoiceOnly: false,
      ambientVoice: true,
      chatActivityThreshold: 55,
      chatActivityChance: 0.6,
    };
  }
  if (remaining < 250_000) {
    return {
      tier: 'plentiful',
      voiceCooldownMs: 60_000,
      celebrationVoiceCooldownMs: 15_000,
      voiceAllowed: true,
      celebrationsVoiceOnly: false,
      ambientVoice: true,
      chatActivityThreshold: 45,
      chatActivityChance: 0.65,
    };
  }
  return {
    tier: 'abundant',
    voiceCooldownMs: 45_000,
    celebrationVoiceCooldownMs: 12_000,
    voiceAllowed: true,
    celebrationsVoiceOnly: false,
    ambientVoice: true,
    chatActivityThreshold: 35,
    chatActivityChance: 0.7,
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
