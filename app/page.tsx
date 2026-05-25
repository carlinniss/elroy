"use client";

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import tmi from 'tmi.js';
import { describeVoiceQuotaTier, voiceQuotaTierFromRemaining } from '@/lib/voice-quota';
import { getElroySfxPlaybackUrl } from '@/lib/elroy-sfx';
import { matchesTriviaAnswer, triviaIntroFor, type ElroyTriviaQuestion, type TriviaCategory, detectElroyTriviaCheat } from '@/lib/cannabis-trivia';
import { buildTriviaLeaderRoastPrompt, formatTriviaLeaderboardChatMessage } from '@/lib/trivia-scores';
import { buildTriviaProgressHint } from '@/lib/trivia-hints';
import { getBotInstanceId } from '@/lib/bot-instance';
import { getBuildLabel } from '@/lib/build-version';
import { formatDirectiveInjection } from '@/lib/live-directives';
import type { UserMemoryEvent } from '@/lib/user-memory';

const BOT_SESSION_HEARTBEAT_MS = 8_000;

function rememberUser(username: string, displayName: string | undefined, event: UserMemoryEvent) {
  void fetch('/api/users/remember', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, displayName, event }),
  }).catch((error) => {
    console.warn('User memory write failed', error);
  });
}

function BongContent() {
  const [isActive, setIsActive] = useState(false);
  const [botBlockReason, setBotBlockReason] = useState<string | null>(null);
  const [log, setLog] = useState<any[]>([]);
  const [isDingOn, setIsDingOn] = useState(true);
  const [isVoiceOn, setIsVoiceOn] = useState(true);
  const searchParams = useSearchParams();
  const [diagnostics, setDiagnostics] = useState({
    chat: '...',
    speech: '...',
    sound: '...',
    quota: '...',
    build: getBuildLabel(process.env.NEXT_PUBLIC_BUILD_ID || 'dev'),
    update: 'auto-update checking…',
  });

  const DEFAULT_VOLUME = 0.85;
  const clientRef = useRef<tmi.Client | null>(null);
  const botInstanceIdRef = useRef('');
  const botSessionHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isActiveRef = useRef(false);
  const dingEnabledRef = useRef(true);
  const voiceEnabledRef = useRef(true);
  const volumeRef = useRef(DEFAULT_VOLUME);
  const recentChatRef = useRef<Array<{ user: string; text: string; at: number }>>([]);
  const chatMessageCountRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const silencedUntilRef = useRef(0);
  const silenceModeRef = useRef<'none' | 'voice' | 'full'>('none');
  const muteCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastElroyChatRef = useRef(0);
  const lastElroyVoiceRef = useRef(0);
  const responseQueueRef = useRef<Promise<void>>(Promise.resolve());
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve());

  const SHUT_UP_DURATION_MS = 8 * 60 * 1000;
  const POWERUP_MUTE_MS = 10 * 60 * 1000;
  const SHUT_ELROY_POWERUP_PATTERN = /shut\s+elroy\s+up(\s+for\s+10\s+minutes?)?/i;
  const MENTION_COOLDOWN_MS = 35_000;
  const CHAT_COOLDOWN_MS = 35_000;
  const VOICE_COOLDOWN_MS = 90_000;
  const CELEBRATION_VOICE_COOLDOWN_MS = 25_000;
  const COMEBACK_COOLDOWN_MS = 5 * 60 * 1000;
  const COMEBACK_CHANCE = 0.12;
  const CELEBRATION_COOLDOWN_MS = 25_000;
  const FOLLOW_CELEBRATION_COOLDOWN_MS = 60_000;
  const JOIN_GREET_COOLDOWN_MS = 45_000;
  const JOIN_GREET_WARMUP_MS = 60_000;
  const FOLLOWER_POLL_MS = 45_000;
  const STREAM_CHECKIN_MS = 15 * 60 * 1000;
  const STREAM_POLL_MS = 60_000;
  const TRIVIA_INTERVAL_MS = 10 * 60 * 1000;
  const TRIVIA_FIRST_DELAY_MS = 5 * 60 * 1000;
  const TRIVIA_ANSWER_WINDOW_MS = 5 * 60 * 1000;
  const TRIVIA_CHECK_MS = 60_000;
  const BLACKJACK_TICK_MS = 4_000;
  const CHAT_ACTIVITY_MESSAGE_THRESHOLD = 90;
  const CHAT_ACTIVITY_CHANCE = 0.75;
  const chatActivityThresholdRef = useRef(CHAT_ACTIVITY_MESSAGE_THRESHOLD);
  const chatActivityChanceRef = useRef(CHAT_ACTIVITY_CHANCE);
  const ambientVoiceAllowedRef = useRef(false);
  const SESSION_CHAT_MAX = 600;
  const SESSION_STORAGE_KEY = 'elroy-stream-session';
  const AUTO_RESUME_STORAGE_KEY = 'elroy-auto-resume';
  const VERSION_POLL_MS = 90_000;
  const DIRECTIVE_POLL_MS = 12_000;

  const CANNABIS_FACTS = [
    'The word "canvas" comes from cannabis — sailcloth was historically made from hemp.',
    'Cannabis has been cultivated for thousands of years; ancient China used hemp for rope and medicine.',
    'Hemp seeds are a complete plant protein and were eaten on long sea voyages.',
    'The human body has an endocannabinoid system that interacts with compounds found in cannabis.',
    'George Washington grew hemp at Mount Vernon for industrial fiber, not smoking.',
    'Cannabis contains over 100 different cannabinoids besides THC and CBD.',
    'Industrial hemp was legal tender to pay taxes in early America.',
    'Terpenes in cannabis are the same aromatic compounds found in citrus, pine, and lavender.',
    'Hemp can grow up to 15 feet tall in a single season with relatively little water.',
    'Ancient Indian texts describe cannabis as one of five sacred plants.',
    'Hemp plastic is biodegradable and was used in early Ford car prototypes.',
    'CBD was first isolated from cannabis by chemist Roger Adams in 1940.',
    'Cannabis pollen grains have been found in tombs dating back over 2,500 years.',
    'Hemp fiber is stronger than cotton and was used for ship rigging and uniforms.',
    'The 710 community celebrates oil culture — 710 upside-down spells OIL.',
  ];

  const randomCannabisFact = () =>
    CANNABIS_FACTS[Math.floor(Math.random() * CANNABIS_FACTS.length)];

  const lastCelebrationRef = useRef(0);
  const knownFollowerIdsRef = useRef<Set<string>>(new Set());
  const greetedThisSessionRef = useRef<Set<string>>(new Set());
  const joinGreetWarmupUntilRef = useRef(0);
  const followersInitializedRef = useRef(false);
  const followerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamCheckinRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triviaPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blackjackPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamLiveRef = useRef(false);
  const lastTriviaAtRef = useRef(0);
  const recentTriviaHistoryRef = useRef<Array<{ category: TriviaCategory; question: string; id: string }>>([]);
  const activeTriviaRef = useRef<{
    category: TriviaCategory;
    question: string;
    answers: string[];
    displayAnswer: string;
    askedAt: number;
    answered: boolean;
    lastCountdownMinute: number;
  } | null>(null);
  const triviaAskInFlightRef = useRef(false);
  const sessionChatRef = useRef<Array<{ user: string; text: string; at: number }>>([]);
  const streamStartedAtRef = useRef<number | null>(null);
  const shutElroyPowerUpIdRef = useRef<string | null>(null);
  const powerupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRedemptionPollRef = useRef(Date.now());
  const processedRedemptionIdsRef = useRef<Set<string>>(new Set());
  const powerupStorageWarnedRef = useRef(false);
  const POWERUP_POLL_MS = 2_000;
  const QUOTA_POLL_MS = 2 * 60_000;
  const voiceCooldownMsRef = useRef(VOICE_COOLDOWN_MS);
  const celebrationVoiceCooldownMsRef = useRef(CELEBRATION_VOICE_COOLDOWN_MS);
  const quotaVoiceAllowedRef = useRef(true);
  const celebrationsVoiceOnlyRef = useRef(false);
  const elevenLabsRemainingRef = useRef<number | null>(null);
  const lastQuotaTierRef = useRef<string | null>(null);
  const quotaPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const versionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const directivePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveDirectivesRef = useRef<{ sticky: string[]; next: string[] }>({ sticky: [], next: [] });
  const processedPushIdsRef = useRef<Set<string>>(new Set());
  const pendingDeployReloadRef = useRef(false);
  const bundledBuildIdRef = useRef(process.env.NEXT_PUBLIC_BUILD_ID || 'dev');
  const sfxUrlCacheRef = useRef<Map<string, string>>(new Map());

  const mentionsElroy = (text: string) => /\belroy\b/i.test(text);

  /** "L Roy" / L-Roy / lroy (without "Elroy") — misname, gets roasted. */
  const misnamesElroyAsLRoy = (text: string) => {
    if (/\bl[\s.\-]?roy\b/i.test(text)) return true;
    if (/\belroy\b/i.test(text)) return false;
    return /\blroy\b/i.test(text);
  };

  const isShutUpCommand = (text: string) => {
    const lower = text.toLowerCase();
    if (!mentionsElroy(lower)) return false;
    return /\b(shut\s*up|be\s*quiet|stfu|stop\s*talking|zip\s*it|can\s*you\s*not|go\s*away|leave\s*us\s*alone|silence|shush)\b/.test(lower);
  };

  const isSilenced = () => Date.now() < silencedUntilRef.current;

  const isFullyMuted = () => isSilenced() && silenceModeRef.current === 'full';

  const resolveShutElroyPowerUpId = useCallback(async () => {
    try {
      const res = await fetch('/api/twitch/powerups');
      const data = await res.json();
      const id = data.shut_elroy_powerup_id as string | null | undefined;
      if (id) {
        shutElroyPowerUpIdRef.current = id;
        console.info('Shut Elroy power-up auto-detected:', id, data.shut_elroy_title);
      } else if (data.error) {
        console.warn('Shut Elroy power-up lookup:', data.error);
      }
      return Boolean(id);
    } catch (e) {
      console.warn('Shut Elroy power-up lookup failed', e);
      return false;
    }
  }, []);

  const ensureEventSubSubscription = useCallback(async () => {
    try {
      const res = await fetch('/api/twitch/eventsub/subscribe', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        console.info('EventSub power-up redemption listener:', data.status, data.callback);
      } else {
        console.warn('EventSub power-up listener:', data.message || data.status, data.hint || '');
      }
    } catch (e) {
      console.warn('EventSub subscription failed', e);
    }
  }, []);

  const isShutElroyPowerUpRedemption = (message: string, tags: tmi.ChatUserstate) => {
    const tagRecord = tags as Record<string, string | undefined>;
    const tagId =
      tagRecord['custom-reward-id']
      || tagRecord['power-up-id']
      || tagRecord['msg-param-powerup-id'];
    const cachedId = shutElroyPowerUpIdRef.current;
    if (cachedId && tagId === cachedId) return true;

    if (!SHUT_ELROY_POWERUP_PATTERN.test(message)) return false;

    const lower = message.toLowerCase();
    return Boolean(
      tagId ||
      tagRecord['msg-id'] === 'highlighted-message' ||
      /\b(redeemed|used|activated)\b/.test(lower) ||
      /\bpower[\s-]?up\b/.test(lower),
    );
  };

  const canRespondInChat = (cooldownMs = CHAT_COOLDOWN_MS) =>
    Date.now() - lastElroyChatRef.current >= cooldownMs;

  const canUseVoice = (priority: 'celebration' | 'normal' = 'normal') => {
    if (!quotaVoiceAllowedRef.current) return false;
    const cooldown = priority === 'celebration'
      ? celebrationVoiceCooldownMsRef.current
      : voiceCooldownMsRef.current;
    if (!Number.isFinite(cooldown)) return false;
    return Date.now() - lastElroyVoiceRef.current >= cooldown;
  };

  const applyVoiceQuotaTier = useCallback((remaining: number) => {
    const tier = voiceQuotaTierFromRemaining(remaining);
    voiceCooldownMsRef.current = tier.voiceCooldownMs;
    celebrationVoiceCooldownMsRef.current = tier.celebrationVoiceCooldownMs;
    quotaVoiceAllowedRef.current = tier.voiceAllowed;
    celebrationsVoiceOnlyRef.current = tier.celebrationsVoiceOnly;
    ambientVoiceAllowedRef.current = tier.ambientVoice;
    chatActivityThresholdRef.current = tier.chatActivityThreshold;
    chatActivityChanceRef.current = tier.chatActivityChance;
    elevenLabsRemainingRef.current = remaining;

    setDiagnostics((prev) => ({
      ...prev,
      quota: describeVoiceQuotaTier(tier, remaining),
    }));

    if (lastQuotaTierRef.current !== tier.tier) {
      console.info(
        'ElevenLabs voice tier:',
        tier.tier,
        '—',
        describeVoiceQuotaTier(tier, remaining),
      );
      lastQuotaTierRef.current = tier.tier;
    }
  }, []);

  const pollElevenLabsQuota = useCallback(async () => {
    try {
      const res = await fetch('/api/quota');
      const data = await res.json();
      if (!res.ok || data.error) throw new Error('Quota lookup failed');
      applyVoiceQuotaTier(Number(data.remaining) || 0);
    } catch (e) {
      console.warn('ElevenLabs quota poll failed', e);
    }
  }, [applyVoiceQuotaTier]);

  const startQuotaPolling = useCallback(() => {
    if (quotaPollRef.current) return;
    void pollElevenLabsQuota();
    quotaPollRef.current = setInterval(() => {
      void pollElevenLabsQuota();
    }, QUOTA_POLL_MS);
  }, [pollElevenLabsQuota]);

  const stopQuotaPolling = useCallback(() => {
    if (quotaPollRef.current) {
      clearInterval(quotaPollRef.current);
      quotaPollRef.current = null;
    }
  }, []);

  const playElroySfx = useCallback(async (id: string, volume = volumeRef.current) => {
    try {
      let url = sfxUrlCacheRef.current.get(id);
      if (!url) {
        const playbackUrl = getElroySfxPlaybackUrl(id);
        if (!playbackUrl) return false;
        if (playbackUrl.startsWith('/sounds/')) {
          url = playbackUrl;
        } else {
          const res = await fetch(playbackUrl);
          if (!res.ok) return false;
          url = URL.createObjectURL(await res.blob());
        }
        sfxUrlCacheRef.current.set(id, url);
      }
      const audio = new Audio(url);
      audio.volume = volume;
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const playBongRip = useCallback(async (volume = volumeRef.current) => {
    if (!dingEnabledRef.current) return;
    if (await playElroySfx('bong_rip', volume)) return;
    const rip = new Audio('/sounds/bong.mp3');
    rip.volume = volume;
    await rip.play().catch(() => {});
  }, [playElroySfx]);

  const warmupElroySfx = useCallback(() => {
    for (const id of ['bong_rip', 'sub_fanfare', 'bits_kaching', 'follow_ding', 'go_live', 'mute_zip', 'roast_sting', 'cough']) {
      const playbackUrl = getElroySfxPlaybackUrl(id);
      if (!playbackUrl) continue;
      if (playbackUrl.startsWith('/sounds/')) {
        sfxUrlCacheRef.current.set(id, playbackUrl);
        continue;
      }
      void fetch(playbackUrl)
        .then(async (res) => {
          if (!res.ok) return;
          const url = URL.createObjectURL(await res.blob());
          sfxUrlCacheRef.current.set(id, url);
        })
        .catch(() => {});
    }
  }, []);

  const stopMuteCountdown = useCallback(() => {
    if (muteCountdownRef.current) {
      clearInterval(muteCountdownRef.current);
      muteCountdownRef.current = null;
    }
  }, []);

  const postMuteCountdown = useCallback(() => {
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    const msLeft = silencedUntilRef.current - Date.now();
    if (msLeft <= 0) {
      silencedUntilRef.current = 0;
      silenceModeRef.current = 'none';
      stopMuteCountdown();
      clientRef.current?.say(channel, 'Elroy is back — you can talk to me again.');
      return;
    }
    const minutesLeft = Math.ceil(msLeft / 60_000);
    clientRef.current?.say(
      channel,
      `${minutesLeft} minute${minutesLeft === 1 ? '' : 's'} until Elroy can talk again.`,
    );
  }, [stopMuteCountdown]);

  const enterFullMute = useCallback((redeemer?: string) => {
    stopMuteCountdown();
    silencedUntilRef.current = Date.now() + POWERUP_MUTE_MS;
    silenceModeRef.current = 'full';
    voiceEnabledRef.current = false;
    setIsVoiceOn(false);

    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    const opener = redeemer
      ? `@${redeemer} shut Elroy up — no chat or voice for 10 minutes.`
      : 'Shut Elroy Up power-up activated — no chat or voice for 10 minutes.';
    clientRef.current?.say(channel, opener);
    void playElroySfx('mute_zip');
    postMuteCountdown();
    muteCountdownRef.current = setInterval(() => {
      postMuteCountdown();
    }, 60_000);
  }, [postMuteCountdown, stopMuteCountdown, playElroySfx]);

  const pollPowerupRedemptions = useCallback(async () => {
    const cachedId = shutElroyPowerUpIdRef.current;
    if (!cachedId) return;

    try {
      const res = await fetch(`/api/twitch/powerup-redemptions?since=${lastRedemptionPollRef.current}&_=${Date.now()}`);
      const data = await res.json();
      if (data.storage === 'memory' && !powerupStorageWarnedRef.current) {
        powerupStorageWarnedRef.current = true;
        console.warn('Power-up redemptions using in-memory storage — add Vercel KV / Upstash Redis or redemptions may be missed.', data.warning);
      }
      const redemptions = (data.redemptions ?? []) as Array<{
        id: string;
        userLogin: string;
        rewardId: string;
      }>;

      for (const redemption of redemptions) {
        if (processedRedemptionIdsRef.current.has(redemption.id)) continue;
        if (redemption.rewardId && redemption.rewardId !== cachedId) continue;
        processedRedemptionIdsRef.current.add(redemption.id);
        enterFullMute(redemption.userLogin);
      }

      if (typeof data.serverTime === 'number') {
        lastRedemptionPollRef.current = data.serverTime;
      }
    } catch (e) {
      console.warn('Power-up redemption poll failed', e);
    }
  }, [enterFullMute]);

  const startPowerupRedemptionPolling = useCallback(() => {
    if (powerupPollRef.current) return;
    lastRedemptionPollRef.current = Date.now() - 120_000;
    void pollPowerupRedemptions();
    powerupPollRef.current = setInterval(() => {
      void pollPowerupRedemptions();
    }, POWERUP_POLL_MS);
  }, [pollPowerupRedemptions]);

  const stopPowerupRedemptionPolling = useCallback(() => {
    if (powerupPollRef.current) {
      clearInterval(powerupPollRef.current);
      powerupPollRef.current = null;
    }
  }, []);

  const persistStreamSession = useCallback(() => {
    if (typeof window === 'undefined' || !streamStartedAtRef.current) return;
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        startedAt: streamStartedAtRef.current,
        messages: sessionChatRef.current,
        greetedJoiners: [...greetedThisSessionRef.current],
      }));
    } catch (e) {
      console.warn('Session save failed', e);
    }
  }, []);

  const clearStreamSession = useCallback(() => {
    sessionChatRef.current = [];
    streamStartedAtRef.current = null;
    recentTriviaHistoryRef.current = [];
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* ignore */ }
    }
  }, []);

  const restoreStreamSession = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        startedAt?: number;
        messages?: Array<{ user: string; text: string; at: number }>;
        greetedJoiners?: string[];
      };
      if (parsed.startedAt && Array.isArray(parsed.messages)) {
        streamStartedAtRef.current = parsed.startedAt;
        sessionChatRef.current = parsed.messages.slice(0, SESSION_CHAT_MAX);
      }
      if (Array.isArray(parsed.greetedJoiners)) {
        for (const login of parsed.greetedJoiners) {
          if (typeof login === 'string' && login.trim()) {
            greetedThisSessionRef.current.add(login.toLowerCase());
          }
        }
      }
      for (const entry of sessionChatRef.current) {
        greetedThisSessionRef.current.add(entry.user.toLowerCase());
      }
    } catch (e) {
      console.warn('Session restore failed', e);
    }
  }, []);

  const canSafelyReloadForDeploy = useCallback(() => {
    if (isSpeakingRef.current) return false;
    const trivia = activeTriviaRef.current;
    if (trivia && !trivia.answered) return false;
    return true;
  }, []);

  const tryApplyDeployUpdate = useCallback(async () => {
    if (!pendingDeployReloadRef.current) return;

    if (isActiveRef.current && !canSafelyReloadForDeploy()) {
      setDiagnostics((prev) => ({
        ...prev,
        update: 'update pending — waiting for safe moment',
      }));
      return;
    }

    pendingDeployReloadRef.current = false;
    persistStreamSession();

    if (isActiveRef.current) {
      localStorage.setItem(AUTO_RESUME_STORAGE_KEY, '1');
      const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
      const client = clientRef.current;
      if (client) {
        try {
          await client.say(channel, '🔄 Elroy updating — back in a few seconds.');
          await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        } catch {
          /* ignore */
        }
      }
    }

    window.location.reload();
  }, [canSafelyReloadForDeploy, persistStreamSession]);

  const pollDeployVersion = useCallback(async () => {
    try {
      const res = await fetch(`/api/version?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) {
        setDiagnostics((prev) => ({ ...prev, update: 'auto-update check failed' }));
        return;
      }
      const data = await res.json() as { buildId?: string; label?: string };
      const remoteBuildId = typeof data.buildId === 'string' ? data.buildId : '';
      const localLabel = getBuildLabel(bundledBuildIdRef.current);
      const remoteLabel = typeof data.label === 'string' ? data.label : getBuildLabel(remoteBuildId);

      if (!remoteBuildId || remoteBuildId === bundledBuildIdRef.current) {
        pendingDeployReloadRef.current = false;
        setDiagnostics((prev) => ({
          ...prev,
          build: localLabel,
          update: 'live · auto-update on',
        }));
        return;
      }

      console.info('Elroy deploy detected:', bundledBuildIdRef.current, '->', remoteBuildId);
      setDiagnostics((prev) => ({
        ...prev,
        build: localLabel,
        update: `update ${remoteLabel} available`,
      }));
      pendingDeployReloadRef.current = true;
      await tryApplyDeployUpdate();
    } catch (error) {
      console.warn('Deploy version poll failed', error);
      setDiagnostics((prev) => ({ ...prev, update: 'auto-update check failed' }));
    }
  }, [tryApplyDeployUpdate]);

  const startVersionPolling = useCallback(() => {
    if (versionPollRef.current) return;
    void pollDeployVersion();
    versionPollRef.current = setInterval(() => {
      void pollDeployVersion();
    }, VERSION_POLL_MS);
  }, [pollDeployVersion]);

  const stopVersionPolling = useCallback(() => {
    if (versionPollRef.current) {
      clearInterval(versionPollRef.current);
      versionPollRef.current = null;
    }
  }, []);

  const rememberChatLine = useCallback((user: string, text: string) => {
    const normalized = text.trim();
    if (!normalized) return;
    const now = Date.now();
    recentChatRef.current = [
      { user, text: normalized, at: now },
      ...recentChatRef.current.filter((entry) => now - entry.at < STREAM_CHECKIN_MS),
    ].slice(0, 80);
    if (streamLiveRef.current) {
      sessionChatRef.current = [
        { user, text: normalized, at: now },
        ...sessionChatRef.current,
      ].slice(0, SESSION_CHAT_MAX);
      persistStreamSession();
    }
  }, [persistStreamSession]);

  const fetchStreamStatus = useCallback(async () => {
    let streamStatus: 'live' | 'offline' | 'unknown' = 'unknown';
    let viewerCount: number | null = null;
    try {
      const res = await fetch('/api/twitch/stream');
      const data = await res.json();
      if (res.ok && (data.status === 'live' || data.status === 'offline' || data.status === 'unknown')) {
        streamStatus = data.status;
        if (typeof data.viewer_count === 'number') viewerCount = data.viewer_count;
      } else if (res.ok && data.is_live) {
        streamStatus = 'live';
        if (typeof data.viewer_count === 'number') viewerCount = data.viewer_count;
      } else if (res.ok) {
        streamStatus = 'offline';
      }
    } catch (e) {
      console.warn('Stream status fetch failed', e);
    }
    const isLive = streamStatus === 'live';
    return { isLive, streamStatus, viewerCount };
  }, []);

  const sampleSessionChat = useCallback((maxLines = 120) => {
    const messages = sessionChatRef.current;
    if (messages.length <= maxLines) return messages;
    const step = Math.ceil(messages.length / maxLines);
    return messages.filter((_, index) => index % step === 0).slice(0, maxLines);
  }, []);

  const buildChatAwarePrompt = useCallback(() => {
    const recent = recentChatRef.current.slice(0, 8);
    if (!recent.length) {
      return "No one is chatting yet. Drop a longer, welcoming OG check-in and invite chat to ask a question.";
    }
    const lines = recent.map((entry) => `- ${entry.user}: ${entry.text}`).join("\n");
    return `Use the recent Twitch chat to make a topical comment with some depth (3-4 sentences). Reference the vibe from these messages:\n${lines}\nDo not force a rhyme.`;
  }, []);

  const runDiagnostics = useCallback(async () => {
    try {
      const chat = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ prompt: 'ping' }) });
      const speech = await fetch('/api/speech', { method: 'POST', body: JSON.stringify({ text: 'ping' }) });
      const sound = await fetch('/api/sfx/bong_rip');
      const quotaRes = await fetch('/api/quota');
      const qData = await quotaRes.json();

      if (quotaRes.ok && !qData.error) {
        applyVoiceQuotaTier(Number(qData.remaining) || 0);
      }

      setDiagnostics((prev) => ({
        ...prev,
        chat: chat.status === 200 ? '✅' : '❌',
        speech: speech.status === 200 ? '✅' : '❌',
        sound: sound.ok ? '✅' : '❌',
        quota: prev.quota !== '...' ? prev.quota : `${Number(qData.remaining || 0).toLocaleString()} left`,
      }));
    } catch (e) { console.error(e); }
  }, [applyVoiceQuotaTier]);

  useEffect(() => { runDiagnostics(); }, [runDiagnostics]);
  useEffect(() => { dingEnabledRef.current = isDingOn; }, [isDingOn]);
  useEffect(() => { voiceEnabledRef.current = isVoiceOn; }, [isVoiceOn]);
  useEffect(() => {
    startVersionPolling();
    return () => stopVersionPolling();
  }, [startVersionPolling, stopVersionPolling]);

  const speakNow = async (text: string) => {
    try {
      const res = await fetch('/api/speech', { method: 'POST', body: JSON.stringify({ text }) });
      const audioUrl = URL.createObjectURL(await res.blob());
      const audio = new Audio(audioUrl);
      audio.volume = volumeRef.current;
      isSpeakingRef.current = true;
      await new Promise<void>((resolve) => {
        const finish = () => {
          isSpeakingRef.current = false;
          URL.revokeObjectURL(audioUrl);
          resolve();
        };

        audio.onended = finish;
        audio.onerror = finish;
        audio.play().catch(() => {
          isSpeakingRef.current = false;
          URL.revokeObjectURL(audioUrl);
          resolve();
        });
      });
    } catch (e) {
      isSpeakingRef.current = false;
      console.warn("Audio blocked");
    }
  };

  const speak = useCallback((text: string) => {
    speechQueueRef.current = speechQueueRef.current
      .then(() => speakNow(text))
      .then(() => { void playElroySfx('cough'); })
      .catch((e) => { console.error(e); });
    return speechQueueRef.current;
  }, [playElroySfx]);

  const buildMentionPrompt = useCallback((user: string, message: string) => {
    const recent = recentChatRef.current.slice(0, 6);
    const context = recent.length
      ? recent.map((entry) => `- ${entry.user}: ${entry.text}`).join('\n')
      : '(no other recent lines)';
    return `Someone brought you up in Twitch chat. ${user} said: "${message}"\n\nRecent chat:\n${context}\n\nRespond in character with your full OG energy.`;
  }, []);

  const buildLRoyRoastPrompt = useCallback((user: string, message: string) => {
    const recent = recentChatRef.current.slice(0, 6);
    const context = recent.length
      ? recent.map((entry) => `- ${entry.user}: ${entry.text}`).join('\n')
      : '(no other recent lines)';
    return `${user} called you "L Roy" in Twitch chat (wrong name — you are ELROY, not L Roy): "${message}"\n\nRecent chat:\n${context}\n\nRoast ${user} by username for the misname — funny, crusty, playful not cruel.`;
  }, []);

  const buildFollowPrompt = useCallback((user: string) =>
    `${user} just followed the Twitch channel. Welcome them with a warm, hype OG hello — make them feel seen and glad they joined the community.`, []);

  const buildJoinGreetingPrompt = useCallback((user: string) =>
    `${user} just entered the Twitch chat while the stream is live. Give a quick, warm welcome by username — one or two sentences. Make them feel noticed without being cheesy or over the top.`, []);

  const buildTriviaCheatRoastPrompt = useCallback((
    user: string,
    message: string,
    triviaQuestion: string,
    cheatKind: 'answer' | 'question' | 'help',
  ) => {
    const cheatLine = cheatKind === 'answer'
      ? `${user} tagged Elroy trying to slip in the trivia answer: "${message}"`
      : cheatKind === 'question'
        ? `${user} tried to ask Elroy the same trivia question instead of answering fair: "${message}"`
        : `${user} tried to fish the trivia answer out of Elroy: "${message}"`;
    return `${cheatLine}\n\nLive trivia question: "${triviaQuestion}"\n\nRoast ${user} by username for tryna cheat trivia through Elroy — funny, crusty, playful not cruel. Make it clear they gotta answer in chat themselves.`;
  }, []);

  const buildSubPrompt = useCallback((user: string, details: string) =>
    `${user} just subscribed to the channel! ${details} Celebrate them in your OG style — genuine gratitude, stream hype, make them feel legendary.`, []);

  const buildBitsPrompt = useCallback((user: string, details: string) =>
    `${user} just cheered ${details} in chat! Celebrate the support with enthusiastic OG energy and thank them by name.`, []);

  const buildStreamCheckinPrompt = useCallback((
    viewerCount: number | null,
    streamStatus: 'live' | 'offline' | 'unknown',
  ) => {
    const cutoff = Date.now() - STREAM_CHECKIN_MS;
    const recent = recentChatRef.current.filter((entry) => entry.at >= cutoff);
    const chatActive = recent.length >= 3;
    const lines = recent.length
      ? recent.map((entry) => `- ${entry.user}: ${entry.text}`).join('\n')
      : '(few messages in the last 10 minutes)';

    let viewerLine: string;
    if (streamStatus === 'live' && viewerCount != null) {
      viewerLine = `The stream is LIVE with ${viewerCount} viewers right now.`;
    } else if (chatActive) {
      viewerLine = streamStatus === 'live' && viewerCount != null
        ? `The stream is live with about ${viewerCount} viewers. Chat is active.`
        : 'Chat is active — the stream is clearly live. Viewer count could not be fetched; hype the room without inventing a number.';
    } else if (streamStatus === 'offline') {
      viewerLine = 'Twitch reports the channel is not live and chat has been quiet.';
    } else {
      viewerLine = 'Viewer count could not be verified. Do not say the stream or chat is offline — keep the energy up anyway.';
    }

    return `10-minute stream check-in.\n${viewerLine}\n\nRecent chat (last ~20 minutes):\n${lines}\n\nWrite a chat check-in with some meat on it (3-4 sentences):\n- Mention viewer count only if provided above.\n- Shout out ONE interesting chatter by username if the list has good material.\n- Only name chatters from the list above.`;
  }, []);

  const buildStreamGreetingPrompt = useCallback((viewerCount: number | null, cannabisFact: string) => {
    const viewers = viewerCount != null ? `About ${viewerCount} viewers are here.` : 'Stream just went live.';
    return `The Twitch stream just went LIVE. ${viewers}\n\nGive a hype stream-start greeting with VOICE energy. You MUST open with exactly "I AM ALIVE!" as the first words, then welcome chat and weave in this cannabis fact naturally: "${cannabisFact}"\nKeep it fun, OG, and welcoming.`;
  }, []);

  const buildStreamGoodbyePrompt = useCallback(() =>
    'The Twitch stream just ended. Give a warm, sincere goodbye to chat — thank everyone for hanging out. Chat-only, no voice. Take your time with it.',
  []);

  const buildStreamSummaryPrompt = useCallback(() => {
    const messages = sampleSessionChat(120);
    const durationMin = streamStartedAtRef.current
      ? Math.max(1, Math.round((Date.now() - streamStartedAtRef.current) / 60_000))
      : null;
    const uniqueChatters = new Set(messages.map((m) => m.user.toLowerCase())).size;
    const lines = messages.length
      ? messages.map((entry) => `- ${entry.user}: ${entry.text}`).join('\n')
      : '(very little chat captured this stream)';
    const durationLine = durationMin ? `Stream ran about ${durationMin} minutes.` : '';
    return `The stream just ended. Write a recap for Twitch chat (chat-only, no voice).\n${durationLine} ${messages.length} messages logged from ~${uniqueChatters} chatters.\n\nFull session chat sample:\n${lines}\n\nSummarize the whole stream: highlights, running jokes, notable moments, and thank the community. Aim for 350-450 characters. Only reference usernames and topics that appear above.`;
  }, [sampleSessionChat]);

  const buildComebackPrompt = useCallback((user: string, message: string) => {
    const recent = recentChatRef.current.slice(0, 6);
    const context = recent.length
      ? recent.map((entry) => `- ${entry.user}: ${entry.text}`).join('\n')
      : '(no other recent lines)';
    return `You were trying to stay quiet, but chat kept talking about you. ${user} said: "${message}"\n\nRecent chat:\n${context}\n\nSnap back with a funny, crusty call-out — you're annoyed they couldn't let you chill. Roast ${user} by name; keep it playful, not cruel.`;
  }, []);

  const processBongLogic = useCallback(async (
    input: string,
    user?: string,
    opts: {
      isQuota?: boolean;
      forceVoice?: boolean;
      chatOnly?: boolean;
      skipDing?: boolean;
      bypassChatCooldown?: boolean;
      bypassVoiceCooldown?: boolean;
      voicePriority?: 'celebration' | 'normal';
      chatCooldownMs?: number;
    } = {},
  ) => {
    try {
      if (isFullyMuted() && !opts.isQuota) return;
      const chatCooldown = opts.chatCooldownMs ?? CHAT_COOLDOWN_MS;
      if (
        !opts.isQuota
        && !opts.bypassChatCooldown
        && Date.now() - lastElroyChatRef.current < chatCooldown
      ) {
        return;
      }
      if (opts.isQuota) {
        const res = await fetch('/api/quota');
        const d = await res.json();
        clientRef.current?.say(process.env.NEXT_PUBLIC_TWITCH_CHANNEL!, `@${user} I got ${d.remaining.toLocaleString()} chars until ${d.resetDate}.`);
        return;
      }

      const voiceSilenced = isSilenced() && silenceModeRef.current === 'voice';
      const voicePriority = opts.voicePriority ?? (opts.forceVoice ? 'celebration' : 'normal');
      const quotaAllowsVoice = quotaVoiceAllowedRef.current
        && (!celebrationsVoiceOnlyRef.current || opts.forceVoice);
      const voiceAllowed = quotaAllowsVoice && !voiceSilenced && (
        opts.bypassVoiceCooldown || canUseVoice(voicePriority)
      );
      const willUseVoice = Boolean(
        streamLiveRef.current
        && !opts.chatOnly
        && voiceAllowed
        && (opts.forceVoice || voiceEnabledRef.current),
      );

      const sticky = liveDirectivesRef.current.sticky;
      const next = liveDirectivesRef.current.next;
      const directiveBlock = formatDirectiveInjection(sticky, next);
      const hadNextDirectives = next.length > 0;

      const personalizationRule = user
        ? `- Personalize the response directly for ${user} by name (say their username naturally in the message).`
        : `- Keep it general for the whole chat, not aimed at one person.`;
      const lengthRule = willUseVoice
        ? '- Keep it SHORT for voice: one or two sentences, roughly 80-160 characters.'
        : `- Chat only (no voice): write 3-5 sentences, roughly 350-480 characters.
- No voice means chat carries the whole performance — be noticeably more verbose, descriptive, and colorful than voice lines.
- Add extra OG personality: a setup line, the main take, and a closing quip or call-out when it fits.
- Stay under 480 characters (Twitch chat limit).
- If the task above asks for something short, ignore that — expand for chat-only.`;
      const fullPrompt = `${input}${directiveBlock}\n\nResponse requirements:\n${lengthRule}\n- Keep the same OG personality and rhythm.\n${personalizationRule}`;
      const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ prompt: fullPrompt }) });
      const data = await res.json();
      if (hadNextDirectives && !opts.isQuota) {
        liveDirectivesRef.current = { ...liveDirectivesRef.current, next: [] };
        void fetch('/api/directives', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'consume-next' }),
        }).catch((error) => {
          console.warn('Directive consume failed', error);
        });
      }
      setLog(p => [{ text: data.text }, ...p].slice(0, 5));
      clientRef.current?.say(process.env.NEXT_PUBLIC_TWITCH_CHANNEL!, user ? `@${user} ${data.text}` : data.text);
      lastElroyChatRef.current = Date.now();

      if (willUseVoice) {
        lastElroyVoiceRef.current = Date.now();
        const playDing = dingEnabledRef.current && !opts.skipDing;
        if (playDing) {
          await playBongRip(volumeRef.current);
        }
        const speechDelayMs = playDing ? 1600 : 0;
        if (speechDelayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, speechDelayMs));
        }
        await speak(data.text);
      }
    } catch (e) { console.error(e); }
  }, [playBongRip, speak]);

  const queueBongLogic = useCallback((
    input: string,
    user?: string,
    opts: {
      isQuota?: boolean;
      forceVoice?: boolean;
      chatOnly?: boolean;
      skipDing?: boolean;
      bypassChatCooldown?: boolean;
      bypassVoiceCooldown?: boolean;
      voicePriority?: 'celebration' | 'normal';
      chatCooldownMs?: number;
    } = {},
  ) => {
    responseQueueRef.current = responseQueueRef.current
      .then(() => processBongLogic(input, user, opts))
      .catch((e) => { console.error(e); });
    return responseQueueRef.current;
  }, [processBongLogic]);

  const pollLiveDirectives = useCallback(async () => {
    try {
      const res = await fetch(`/api/directives?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json() as {
        sticky?: Array<{ id: string; text: string }>;
        next?: Array<{ id: string; text: string }>;
        push?: Array<{ id: string; text: string; chatOnly?: boolean; forceVoice?: boolean }>;
      };

      liveDirectivesRef.current = {
        sticky: (data.sticky ?? []).map((item) => item.text),
        next: (data.next ?? []).map((item) => item.text),
      };

      for (const item of data.push ?? []) {
        if (processedPushIdsRef.current.has(item.id)) continue;
        processedPushIdsRef.current.add(item.id);

        void queueBongLogic(
          `Broadcaster pushed a live prompt — respond in your OG voice now:\n${item.text}`,
          undefined,
          {
            chatOnly: item.chatOnly,
            forceVoice: item.forceVoice,
            bypassChatCooldown: true,
            bypassVoiceCooldown: Boolean(item.forceVoice),
          },
        );

        void fetch('/api/directives', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'ack-push', id: item.id }),
        }).catch((error) => {
          console.warn('Push ack failed', error);
        });
      }
    } catch (error) {
      console.warn('Directive poll failed', error);
    }
  }, [queueBongLogic]);

  useEffect(() => {
    void pollLiveDirectives();
    directivePollRef.current = setInterval(() => {
      void pollLiveDirectives();
    }, DIRECTIVE_POLL_MS);
    return () => {
      if (directivePollRef.current) {
        clearInterval(directivePollRef.current);
        directivePollRef.current = null;
      }
    };
  }, [pollLiveDirectives]);

  const enterSilence = useCallback(() => {
    silencedUntilRef.current = Date.now() + SHUT_UP_DURATION_MS;
    silenceModeRef.current = 'voice';
    voiceEnabledRef.current = false;
    setIsVoiceOn(false);
  }, []);

  const canCelebrate = (kind: 'follow' | 'sub' | 'bits') => {
    const cooldown = kind === 'follow' ? FOLLOW_CELEBRATION_COOLDOWN_MS : CELEBRATION_COOLDOWN_MS;
    return Date.now() - lastCelebrationRef.current >= cooldown;
  };

  const shouldSkipJoinGreet = useCallback((normalizedUser: string, normalizedChannel: string) => {
    if (!normalizedUser) return true;
    if (normalizedUser === normalizedChannel) return true;
    const skipBots = new Set([
      'wizebot', 'nightbot', 'streamelements', 'moobot', 'streamlabs',
      'soundalerts', 'fossabot', 'botrix', 'coebot', 'stay_hydrated_bot',
    ]);
    if (skipBots.has(normalizedUser)) return true;
    return false;
  }, []);

  const tryGreetChatter = useCallback((username: string, normalizedUser: string, normalizedChannel: string) => {
    if (!streamLiveRef.current || isFullyMuted() || isSilenced()) return;
    if (Date.now() < joinGreetWarmupUntilRef.current) return;
    if (shouldSkipJoinGreet(normalizedUser, normalizedChannel)) return;
    if (greetedThisSessionRef.current.has(normalizedUser)) return;
    if (!canRespondInChat(JOIN_GREET_COOLDOWN_MS)) return;

    greetedThisSessionRef.current.add(normalizedUser);
    if (streamStartedAtRef.current) {
      persistStreamSession();
    }
    void queueBongLogic(buildJoinGreetingPrompt(username), username, {
      chatOnly: true,
      chatCooldownMs: JOIN_GREET_COOLDOWN_MS,
    });
  }, [buildJoinGreetingPrompt, persistStreamSession, queueBongLogic, shouldSkipJoinGreet]);

  const celebrate = useCallback((kind: 'follow' | 'sub' | 'bits', username: string, extra = '', bitsAmount?: number) => {
    if (!streamLiveRef.current || isFullyMuted() || !canCelebrate(kind)) return;
    if (kind === 'follow' && !canRespondInChat(FOLLOW_CELEBRATION_COOLDOWN_MS)) return;
    lastCelebrationRef.current = Date.now();
    if (kind === 'follow') rememberUser(username, username, { type: 'follow' });
    if (kind === 'sub') rememberUser(username, username, { type: 'sub' });
    if (kind === 'bits') rememberUser(username, username, { type: 'bits', amount: bitsAmount });
    const sfxId = kind === 'sub' ? 'sub_fanfare' : kind === 'bits' ? 'bits_kaching' : 'follow_ding';
    void playElroySfx(sfxId);
    const prompt =
      kind === 'follow' ? buildFollowPrompt(username)
      : kind === 'sub' ? buildSubPrompt(username, extra)
      : buildBitsPrompt(username, extra);
    void queueBongLogic(prompt, username, {
      forceVoice: true,
      bypassChatCooldown: kind !== 'follow',
      voicePriority: kind === 'follow' ? 'normal' : 'celebration',
    });
  }, [buildBitsPrompt, buildFollowPrompt, buildSubPrompt, playElroySfx, queueBongLogic]);

  const pollNewFollowers = useCallback(async () => {
    try {
      const res = await fetch('/api/twitch/followers');
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.followers)) return;

      if (!followersInitializedRef.current) {
        for (const follower of data.followers) {
          knownFollowerIdsRef.current.add(follower.user_id);
        }
        followersInitializedRef.current = true;
        return;
      }

      for (const follower of data.followers) {
        if (knownFollowerIdsRef.current.has(follower.user_id)) continue;
        knownFollowerIdsRef.current.add(follower.user_id);
        celebrate('follow', follower.user_login);
      }
    } catch (e) {
      console.warn('Follower poll failed', e);
    }
  }, [celebrate]);

  const startFollowerPolling = useCallback(() => {
    if (followerPollRef.current) return;
    void pollNewFollowers();
    followerPollRef.current = setInterval(() => {
      void pollNewFollowers();
    }, FOLLOWER_POLL_MS);
  }, [pollNewFollowers]);

  const stopFollowerPolling = useCallback(() => {
    if (followerPollRef.current) {
      clearInterval(followerPollRef.current);
      followerPollRef.current = null;
    }
    followersInitializedRef.current = false;
    knownFollowerIdsRef.current.clear();
  }, []);

  const onStreamStarted = useCallback((viewerCount: number | null) => {
    const resumed = Boolean(streamStartedAtRef.current);
    if (!resumed) {
      streamStartedAtRef.current = Date.now();
      sessionChatRef.current = [];
      greetedThisSessionRef.current.clear();
      lastTriviaAtRef.current = Date.now() - (TRIVIA_INTERVAL_MS - TRIVIA_FIRST_DELAY_MS);
      activeTriviaRef.current = null;
      recentTriviaHistoryRef.current = [];
      void playElroySfx('go_live');
      void queueBongLogic(buildStreamGreetingPrompt(viewerCount, randomCannabisFact()), undefined, {
        forceVoice: true,
        bypassChatCooldown: true,
        bypassVoiceCooldown: true,
      });
    }
    persistStreamSession();
  }, [buildStreamGreetingPrompt, persistStreamSession, playElroySfx, queueBongLogic]);

  const onStreamEnded = useCallback(() => {
    const summaryPrompt = buildStreamSummaryPrompt();
    responseQueueRef.current = responseQueueRef.current
      .then(() => processBongLogic(buildStreamGoodbyePrompt(), undefined, {
        chatOnly: true,
        skipDing: true,
        bypassChatCooldown: true,
      }))
      .then(() => processBongLogic(summaryPrompt, undefined, {
        chatOnly: true,
        skipDing: true,
        bypassChatCooldown: true,
      }))
      .then(() => { clearStreamSession(); })
      .catch((e) => { console.error(e); });
  }, [buildStreamGoodbyePrompt, buildStreamSummaryPrompt, clearStreamSession, processBongLogic]);

  const pollStreamLive = useCallback(async () => {
    const wasLive = streamLiveRef.current;
    const { isLive, viewerCount } = await fetchStreamStatus();
    streamLiveRef.current = isLive;

    if (!wasLive && isLive) {
      onStreamStarted(viewerCount);
    } else if (wasLive && !isLive) {
      onStreamEnded();
    }
  }, [fetchStreamStatus, onStreamEnded, onStreamStarted]);

  const expireTriviaIfNeeded = useCallback(() => {
    const active = activeTriviaRef.current;
    if (!active || active.answered) return;
    if (Date.now() - active.askedAt < TRIVIA_ANSWER_WINDOW_MS) return;

    activeTriviaRef.current = null;
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    clientRef.current?.say(
      channel,
      `⏰ Trivia time's up! Nobody got it — the answer was ${active.displayAnswer}.`,
    );
  }, []);

  const announceTriviaCountdown = useCallback(() => {
    const active = activeTriviaRef.current;
    if (!active || active.answered) return;

    const elapsedMs = Date.now() - active.askedAt;
    if (elapsedMs >= TRIVIA_ANSWER_WINDOW_MS) return;

    const minuteBucket = Math.floor(elapsedMs / 60_000);
    if (minuteBucket <= 0 || minuteBucket >= TRIVIA_ANSWER_WINDOW_MS / 60_000) return;
    if (active.lastCountdownMinute >= minuteBucket) return;

    active.lastCountdownMinute = minuteBucket;
    const remainingMs = TRIVIA_ANSWER_WINDOW_MS - elapsedMs;
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    const hint = buildTriviaProgressHint(active.answers, minuteBucket);
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    clientRef.current?.say(
      channel,
      `⏳ ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'} left! ${hint}`,
    );
  }, []);

  const askCannabisTrivia = useCallback(async () => {
    if (isFullyMuted() || !streamLiveRef.current) return;
    if (activeTriviaRef.current && !activeTriviaRef.current.answered) return;
    if (triviaAskInFlightRef.current) return;

    triviaAskInFlightRef.current = true;
    lastTriviaAtRef.current = Date.now();

    try {
      const category: TriviaCategory = Math.random() < 0.5 ? 'cannabis' : 'freaky';
      let picked: ElroyTriviaQuestion | null = null;

      const categoryHistory = recentTriviaHistoryRef.current.filter((entry) => entry.category === category);

      try {
        const generateRes = await fetch('/api/trivia/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category,
            recentQuestions: categoryHistory.map((entry) => entry.question),
            recentIds: categoryHistory.map((entry) => entry.id),
          }),
        });
        if (generateRes.ok) {
          const data = await generateRes.json();
          if (data.question?.question && Array.isArray(data.question.answers)) {
            picked = data.question as ElroyTriviaQuestion;
          }
        } else {
          console.warn('Trivia generation unavailable', generateRes.status);
        }
      } catch (error) {
        console.warn('Gemini trivia generation failed', error);
      }

      if (!picked) {
        lastTriviaAtRef.current = Date.now() - TRIVIA_INTERVAL_MS + 2 * 60 * 1000;
        return;
      }

      if (activeTriviaRef.current && !activeTriviaRef.current.answered) return;

      try {
        const leadersRes = await fetch('/api/trivia/leaders');
        if (leadersRes.ok) {
          const leaders = await leadersRes.json();
          const roastPrompt = buildTriviaLeaderRoastPrompt(leaders);
          if (roastPrompt) {
            await processBongLogic(roastPrompt, undefined, {
              chatOnly: !ambientVoiceAllowedRef.current,
              bypassChatCooldown: true,
              skipDing: true,
            });
          }
        }
      } catch (error) {
        console.warn('Trivia leader shoutout failed', error);
      }

      if (activeTriviaRef.current && !activeTriviaRef.current.answered) return;

      recentTriviaHistoryRef.current = [
        ...recentTriviaHistoryRef.current,
        { category: picked.category, question: picked.question, id: picked.id },
      ].slice(-40);
      persistStreamSession();
      activeTriviaRef.current = {
        category: picked.category,
        question: picked.question,
        answers: picked.answers,
        displayAnswer: picked.displayAnswer,
        askedAt: Date.now(),
        answered: false,
        lastCountdownMinute: 0,
      };

      const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
      clientRef.current?.say(
        channel,
        `${triviaIntroFor(picked.category)} ${picked.question} — first correct answer wins!`,
      );
    } finally {
      triviaAskInFlightRef.current = false;
    }
  }, [persistStreamSession, processBongLogic]);

  const runTriviaCycle = useCallback(() => {
    if (!streamLiveRef.current || isFullyMuted()) return;
    announceTriviaCountdown();
    expireTriviaIfNeeded();
    if (Date.now() - lastTriviaAtRef.current >= TRIVIA_INTERVAL_MS) {
      void askCannabisTrivia();
    }
  }, [announceTriviaCountdown, askCannabisTrivia, expireTriviaIfNeeded]);

  const awardTriviaWinner = useCallback(async (username: string) => {
    const active = activeTriviaRef.current;
    if (!active || active.answered) return;

    active.answered = true;
    lastTriviaAtRef.current = Date.now();

    let totalWins = 1;
    try {
      const winRes = await fetch('/api/trivia/win', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, category: active.category }),
      });
      if (winRes.ok) {
        const data = await winRes.json();
        if (typeof data.score === 'number' && data.score > 0) totalWins = data.score;
      }
    } catch (error) {
      console.warn('Trivia score update failed', error);
    }

    void playElroySfx('sub_fanfare');
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    clientRef.current?.say(
      channel,
      `🎉 @${username} got it FIRST! Correct — ${active.displayAnswer}. (${totalWins} trivia win${totalWins === 1 ? '' : 's'} total)`,
    );
    void queueBongLogic(
      `${username} just won trivia with the first correct answer. Hype them up in one short OG sentence — make them feel legendary.`,
      username,
      {
        forceVoice: true,
        bypassChatCooldown: true,
        voicePriority: 'celebration',
      },
    );
    rememberUser(username, username, {
      type: 'trivia_win',
      category: active.category,
      totalWins,
    });
  }, [playElroySfx, queueBongLogic]);

  const tryHandleTriviaAnswer = useCallback((username: string, message: string) => {
    if (isFullyMuted()) return false;
    if (mentionsElroy(message)) return false;
    const active = activeTriviaRef.current;
    if (!active || active.answered) return false;
    if (Date.now() - active.askedAt > TRIVIA_ANSWER_WINDOW_MS) return false;
    if (!matchesTriviaAnswer(message, active.answers)) return false;

    awardTriviaWinner(username);
    return true;
  }, [awardTriviaWinner]);

  const tryRoastTriviaCheat = useCallback((username: string, displayName: string, message: string) => {
    if (isFullyMuted()) return false;
    const active = activeTriviaRef.current;
    if (!active || active.answered) return false;
    if (Date.now() - active.askedAt > TRIVIA_ANSWER_WINDOW_MS) return false;

    const cheatKind = detectElroyTriviaCheat(message, active.question, active.answers);
    if (!cheatKind) return false;

    rememberUser(username, displayName, { type: 'mention', message });
    if (!canRespondInChat(MENTION_COOLDOWN_MS)) return true;

    void playElroySfx('roast_sting');
    void queueBongLogic(
      buildTriviaCheatRoastPrompt(username, message, active.question, cheatKind),
      username,
      { chatOnly: true },
    );
    return true;
  }, [buildTriviaCheatRoastPrompt, playElroySfx, queueBongLogic]);

  const runStreamCheckin = useCallback(async () => {
    if (isSilenced() || !streamLiveRef.current) return;
    const { streamStatus, viewerCount } = await fetchStreamStatus();
    void queueBongLogic(buildStreamCheckinPrompt(viewerCount, streamStatus), undefined, {
      chatOnly: !ambientVoiceAllowedRef.current,
    });
  }, [buildStreamCheckinPrompt, fetchStreamStatus, queueBongLogic]);

  const sayBlackjackLines = useCallback((lines: string[]) => {
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    for (const line of lines) {
      if (line?.trim()) clientRef.current?.say(channel, line);
    }
  }, []);

  const postBlackjackAction = useCallback(async (payload: {
    action: string;
    username: string;
    displayName?: string;
    amount?: number;
    betInput?: string;
    isMod?: boolean;
  }) => {
    try {
      const res = await fetch('/api/blackjack/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (Array.isArray(data.messages) && data.messages.length) {
        sayBlackjackLines(data.messages);
      }
      return data;
    } catch (error) {
      console.warn('Blackjack action failed', error);
      return null;
    }
  }, [sayBlackjackLines]);

  const tickBlackjackTable = useCallback(() => {
    if (!streamLiveRef.current || isFullyMuted()) return;
    void postBlackjackAction({ action: 'tick', username: 'elroy', displayName: 'Elroy' });
  }, [postBlackjackAction]);

  const handleBlackjackCommand = useCallback((
    cmd: string,
    username: string,
    displayName: string,
    normalizedChannel: string,
    isMod: boolean,
    rawMessage: string,
  ) => {
    if (!streamLiveRef.current || isFullyMuted()) return;
    const login = username.toLowerCase();
    if (login === normalizedChannel || login === 'wizebot') return;

    const activeTrivia = activeTriviaRef.current;
    if (activeTrivia && !activeTrivia.answered && (cmd === 'bj' || cmd === 'blackjack')) {
      const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
      clientRef.current?.say(channel, `@${username} trivia's live — wait for the next round to open blackjack.`);
      return;
    }

    if (cmd === 'bj' || cmd === 'blackjack') {
      void postBlackjackAction({ action: 'join', username, displayName });
      return;
    }
    if (cmd === 'bet') {
      const match = rawMessage.trim().match(/^!bet\s+(\S+)$/i);
      if (!match) return;
      void postBlackjackAction({
        action: 'bet',
        username,
        displayName,
        betInput: match[1],
      });
      return;
    }
    if (cmd === 'double' || cmd === 'dd') {
      void postBlackjackAction({ action: 'double', username, displayName });
      return;
    }
    if (cmd === 'hit' || cmd === 'h') {
      void postBlackjackAction({ action: 'hit', username, displayName });
      return;
    }
    if (cmd === 'stand' || cmd === 's') {
      void postBlackjackAction({ action: 'stand', username, displayName });
      return;
    }
    if (cmd === 'table' || cmd === 'bjtable') {
      void postBlackjackAction({ action: 'table', username, displayName });
      return;
    }
    if (cmd === 'chips') {
      void postBlackjackAction({ action: 'chips', username, displayName });
      return;
    }
    if (cmd === 'bjtop' || cmd === 'bjlb') {
      void postBlackjackAction({ action: 'leaders', username, displayName });
      return;
    }
    if (cmd === 'bjstop' && isMod) {
      void postBlackjackAction({ action: 'stop', username, displayName, isMod: true });
    }
  }, [postBlackjackAction]);

  const startStreamMonitoring = useCallback(() => {
    if (!streamPollRef.current) {
      void pollStreamLive();
      streamPollRef.current = setInterval(() => {
        void pollStreamLive();
      }, STREAM_POLL_MS);
    }
    if (!streamCheckinRef.current) {
      streamCheckinRef.current = setInterval(() => {
        void runStreamCheckin();
      }, STREAM_CHECKIN_MS);
    }
    if (!triviaPollRef.current) {
      triviaPollRef.current = setInterval(() => {
        runTriviaCycle();
      }, TRIVIA_CHECK_MS);
    }
    if (!blackjackPollRef.current) {
      blackjackPollRef.current = setInterval(() => {
        tickBlackjackTable();
      }, BLACKJACK_TICK_MS);
    }
  }, [pollStreamLive, runStreamCheckin, runTriviaCycle, tickBlackjackTable]);

  const stopStreamMonitoring = useCallback(() => {
    if (streamPollRef.current) {
      clearInterval(streamPollRef.current);
      streamPollRef.current = null;
    }
    if (streamCheckinRef.current) {
      clearInterval(streamCheckinRef.current);
      streamCheckinRef.current = null;
    }
    if (triviaPollRef.current) {
      clearInterval(triviaPollRef.current);
      triviaPollRef.current = null;
    }
    if (blackjackPollRef.current) {
      clearInterval(blackjackPollRef.current);
      blackjackPollRef.current = null;
    }
    activeTriviaRef.current = null;
    triviaAskInFlightRef.current = false;
    streamLiveRef.current = false;
  }, []);

  const handleElroyMention = useCallback((username: string, displayName: string, message: string) => {
    if (isFullyMuted()) return;
    rememberUser(username, displayName, { type: 'mention', message });
    if (isSilenced()) {
      if (!streamLiveRef.current || !canRespondInChat(COMEBACK_COOLDOWN_MS) || Math.random() >= COMEBACK_CHANCE) return;
      void queueBongLogic(buildComebackPrompt(username, message), username, { chatOnly: true });
      return;
    }
    if (!canRespondInChat(MENTION_COOLDOWN_MS)) return;
    void queueBongLogic(buildMentionPrompt(username, message), username);
  }, [buildComebackPrompt, buildMentionPrompt, queueBongLogic]);

  const handleLRoyMisname = useCallback((username: string, displayName: string, message: string) => {
    if (isFullyMuted()) return;
    rememberUser(username, displayName, { type: 'mention', message });
    if (isSilenced()) {
      if (!streamLiveRef.current || !canRespondInChat(COMEBACK_COOLDOWN_MS) || Math.random() >= COMEBACK_CHANCE) return;
      void queueBongLogic(buildLRoyRoastPrompt(username, message), username, { chatOnly: true });
      return;
    }
    if (!canRespondInChat(MENTION_COOLDOWN_MS)) return;
    void playElroySfx('roast_sting');
    void queueBongLogic(buildLRoyRoastPrompt(username, message), username);
  }, [buildLRoyRoastPrompt, playElroySfx, queueBongLogic]);

  const toggleDing = useCallback((user?: string) => {
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    const nextState = !dingEnabledRef.current;
    dingEnabledRef.current = nextState;
    setIsDingOn(nextState);
    clientRef.current?.say(channel, user ? `@${user} ding ${nextState ? 'on' : 'off'}.` : `ding ${nextState ? 'on' : 'off'}.`);
  }, []);

  const toggleVoice = useCallback((user?: string) => {
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    const nextState = !voiceEnabledRef.current;
    voiceEnabledRef.current = nextState;
    setIsVoiceOn(nextState);
    clientRef.current?.say(channel, user ? `@${user} voice ${nextState ? 'on' : 'off'}.` : `voice ${nextState ? 'on' : 'off'}.`);
  }, []);

  const setVolume = useCallback((level: number, user?: string) => {
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    const clamped = Math.min(1, Math.max(0, level));
    volumeRef.current = clamped;
    const pct = Math.round(clamped * 100);
    clientRef.current?.say(channel, user ? `@${user} volume ${pct}%.` : `volume ${pct}%.`);
  }, []);

  const announceAboutMe = useCallback(async (username: string) => {
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    try {
      const res = await fetch(`/api/users/aboutme?username=${encodeURIComponent(username)}`);
      if (!res.ok) throw new Error('aboutme lookup failed');
      const data = await res.json();
      const text = typeof data.text === 'string' && data.text.trim()
        ? data.text.trim()
        : `Still getting to know you — mention me or win trivia so I can build your file.`;
      clientRef.current?.say(channel, `@${username} ${text}`);
    } catch (error) {
      console.warn('!aboutme failed', error);
      clientRef.current?.say(channel, `@${username} I cannot pull your file right now — try again in a bit.`);
    }
  }, []);

  const announceTriviaLeaderboard = useCallback(async (user?: string) => {
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    try {
      const res = await fetch('/api/trivia/leaders');
      if (!res.ok) throw new Error('leader lookup failed');
      const leaders = await res.json();
      const message = formatTriviaLeaderboardChatMessage(leaders);
      clientRef.current?.say(channel, user ? `@${user} ${message}` : message);
    } catch (error) {
      console.warn('Trivia leaderboard command failed', error);
      clientRef.current?.say(channel, user ? `@${user} leaderboard unavailable right now.` : 'Leaderboard unavailable right now.');
    }
  }, []);

  const stopBotSessionHeartbeat = useCallback(() => {
    if (botSessionHeartbeatRef.current) {
      clearInterval(botSessionHeartbeatRef.current);
      botSessionHeartbeatRef.current = null;
    }
  }, []);

  const releaseBotSessionLock = useCallback(async () => {
    stopBotSessionHeartbeat();
    const instanceId = botInstanceIdRef.current || getBotInstanceId();
    if (!instanceId) return;
    try {
      await fetch('/api/bot/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'release', instanceId }),
        keepalive: true,
      });
    } catch (error) {
      console.warn('Bot session release failed', error);
    }
  }, [stopBotSessionHeartbeat]);

  const claimBotSessionLock = useCallback(async () => {
    const instanceId = getBotInstanceId();
    botInstanceIdRef.current = instanceId;
    try {
      const res = await fetch('/api/bot/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claim', instanceId }),
      });
      if (res.status === 409) {
        setBotBlockReason('Another Elroy is already running. Close the other browser tab or OBS browser source.');
        return false;
      }
      if (!res.ok) {
        setBotBlockReason('Could not start Elroy session. Try again in a few seconds.');
        return false;
      }
      setBotBlockReason(null);
      return true;
    } catch (error) {
      console.warn('Bot session claim failed', error);
      setBotBlockReason('Could not reach Elroy session service.');
      return false;
    }
  }, []);

  const disconnectBotClient = useCallback(async (announceUser?: string) => {
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    const client = clientRef.current;
    if (client) {
      try {
        if (announceUser) {
          await client.say(channel, `@${announceUser} Elroy is off.`);
        }
        await client.disconnect();
      } catch (e) {
        console.warn(e);
      }
      clientRef.current = null;
    }
    stopFollowerPolling();
    stopPowerupRedemptionPolling();
    stopQuotaPolling();
    stopStreamMonitoring();
    stopMuteCountdown();
    isActiveRef.current = false;
    setIsActive(false);
  }, [stopFollowerPolling, stopPowerupRedemptionPolling, stopQuotaPolling, stopStreamMonitoring, stopMuteCountdown]);

  const stopBot = useCallback(async (announceUser?: string) => {
    try {
      localStorage.removeItem(AUTO_RESUME_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    await releaseBotSessionLock();
    await disconnectBotClient(announceUser);
  }, [disconnectBotClient, releaseBotSessionLock]);

  const stopBotForSessionLoss = useCallback(async () => {
    stopBotSessionHeartbeat();
    setBotBlockReason('Another Elroy instance took over. Close duplicate tabs or OBS sources.');
    await disconnectBotClient();
  }, [disconnectBotClient, stopBotSessionHeartbeat]);

  const startBotSessionHeartbeat = useCallback(() => {
    stopBotSessionHeartbeat();
    botSessionHeartbeatRef.current = setInterval(() => {
      void (async () => {
        const instanceId = botInstanceIdRef.current || getBotInstanceId();
        if (!instanceId || !isActiveRef.current) return;
        try {
          const res = await fetch('/api/bot/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'heartbeat', instanceId }),
          });
          if (res.status === 409) {
            await stopBotForSessionLoss();
          }
        } catch (error) {
          console.warn('Bot session heartbeat failed', error);
        }
      })();
    }, BOT_SESSION_HEARTBEAT_MS);
  }, [stopBotForSessionLoss, stopBotSessionHeartbeat]);

  const startBot = async () => {
    if (isActive) return;
    if (!(await claimBotSessionLock())) return;

    const chan = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    const normalizedChannel = chan.toLowerCase().replace(/^#/, '');
    chatMessageCountRef.current = 0;
    const client = new tmi.Client({ identity: { username: chan, password: process.env.NEXT_PUBLIC_TWITCH_OAUTH_TOKEN! }, channels: [chan] });
    client.on('message', (_c: string, t: tmi.ChatUserstate, m: string, s: boolean) => {
      if (s) return;
      const username = t.username || 'viewer';
      const displayName = t['display-name'] || username;
      const normalizedUser = username.toLowerCase();
      const isBroadcaster = normalizedUser === normalizedChannel;

      if (isShutElroyPowerUpRedemption(m, t)) {
        enterFullMute(username);
        return;
      }

      const isWizebot = normalizedUser === 'wizebot';
      const isBotAccount = normalizedUser === normalizedChannel;

      if (!m.startsWith('!')) {
        if (!isBotAccount && !isWizebot && tryRoastTriviaCheat(username, displayName, m)) {
          rememberChatLine(username, m);
          return;
        }

        if (!isBotAccount && !isWizebot && tryHandleTriviaAnswer(username, m)) {
          rememberChatLine(username, m);
          return;
        }

        rememberChatLine(username, m);

        if (!isBotAccount && !isWizebot) {
          if (isShutUpCommand(m)) {
            enterSilence();
            return;
          }

          if (misnamesElroyAsLRoy(m)) {
            handleLRoyMisname(username, displayName, m);
          } else if (mentionsElroy(m)) {
            handleElroyMention(username, displayName, m);
          } else if (streamLiveRef.current && !isFullyMuted() && !isSilenced() && !isBroadcaster) {
            chatMessageCountRef.current += 1;
            if (
              chatMessageCountRef.current >= chatActivityThresholdRef.current
              && Math.random() < chatActivityChanceRef.current
            ) {
              chatMessageCountRef.current = 0;
              void queueBongLogic(buildChatAwarePrompt(), undefined, {
                chatOnly: !ambientVoiceAllowedRef.current,
              });
            }
          }
        }
      }
      if (m.toLowerCase() === '!quota') {
        if (isFullyMuted()) return;
        return queueBongLogic('', t.username, { isQuota: true });
      }
      if (m.toLowerCase() === '!leaderboard' || m.toLowerCase() === '!lb') {
        if (isFullyMuted()) return;
        return void announceTriviaLeaderboard(t.username);
      }
      if (m.toLowerCase() === '!aboutme') {
        if (isFullyMuted()) return;
        return void announceAboutMe(username);
      }
      const lowerCmd = m.toLowerCase().trim();
      if (lowerCmd === '!bj' || lowerCmd === '!blackjack') {
        return handleBlackjackCommand('bj', username, displayName, normalizedChannel, t.mod === true || isBroadcaster, m);
      }
      if (/^!bet\s+\S+$/i.test(lowerCmd)) {
        return handleBlackjackCommand('bet', username, displayName, normalizedChannel, false, m);
      }
      if (lowerCmd === '!double' || lowerCmd === '!dd') {
        return handleBlackjackCommand('double', username, displayName, normalizedChannel, false, m);
      }
      if (lowerCmd === '!hit' || lowerCmd === '!h') {
        return handleBlackjackCommand('hit', username, displayName, normalizedChannel, false, m);
      }
      if (lowerCmd === '!stand' || lowerCmd === '!s') {
        return handleBlackjackCommand('stand', username, displayName, normalizedChannel, false, m);
      }
      if (lowerCmd === '!table' || lowerCmd === '!bjtable') {
        return handleBlackjackCommand('table', username, displayName, normalizedChannel, false, m);
      }
      if (lowerCmd === '!chips') {
        return handleBlackjackCommand('chips', username, displayName, normalizedChannel, false, m);
      }
      if (lowerCmd === '!bjtop' || lowerCmd === '!bjlb') {
        return handleBlackjackCommand('bjtop', username, displayName, normalizedChannel, false, m);
      }
      if (lowerCmd === '!bjstop') {
        return handleBlackjackCommand('bjstop', username, displayName, normalizedChannel, t.mod === true || isBroadcaster, m);
      }
      if (m.toLowerCase() === '!ding' || m.toLowerCase() === '!gong') {
        const isModerator = t.mod === true;
        if (isBroadcaster || isModerator) {
          return toggleDing(t.username);
        }
        return;
      }
      if (m.toLowerCase() === '!elroyoff') {
        const isModerator = t.mod === true;
        if (isBroadcaster || isModerator) {
          return void stopBot(t.username);
        }
        return;
      }
      if (m.toLowerCase() === '!voice') {
        const isModerator = t.mod === true;
        if (isBroadcaster || isModerator) {
          return toggleVoice(t.username);
        }
        return;
      }
      if (m.toLowerCase().startsWith('!volume')) {
        const isModerator = t.mod === true;
        if (!isBroadcaster && !isModerator) return;
        const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
        const arg = m.slice('!volume'.length).trim();
        if (!arg) {
          const pct = Math.round(volumeRef.current * 100);
          clientRef.current?.say(channel, `@${t.username} volume ${pct}%.`);
          return;
        }
        const deltaMatch = arg.match(/^([+-])(\d+)$/);
        if (deltaMatch) {
          const delta = (deltaMatch[1] === '+' ? 1 : -1) * Number(deltaMatch[2]) / 100;
          return setVolume(volumeRef.current + delta, t.username);
        }
        const parsed = Number(arg.replace(/%$/, ''));
        if (!Number.isFinite(parsed)) {
          clientRef.current?.say(channel, `@${t.username} use !volume, !volume 50, or !volume +10 / -10.`);
          return;
        }
        return setVolume(parsed / 100, t.username);
      }
    });

    (client as tmi.Client & { on(event: 'redeem', listener: (...args: unknown[]) => void): void }).on(
      'redeem',
      (_channel, username, rewardType) => {
        const cachedId = shutElroyPowerUpIdRef.current;
        if (cachedId && rewardType === cachedId && typeof username === 'string') {
          enterFullMute(username);
        }
      },
    );

    client.on('subscription', (_channel: string, username: string, _method: unknown, message: string) => {
      const detail = message?.trim() ? `They said: "${message.trim()}"` : 'Brand new sub!';
      celebrate('sub', username, detail);
    });

    client.on('resub', (_channel: string, username: string, months: number, message: string) => {
      const detail = `${months} month streak.${message?.trim() ? ` They said: "${message.trim()}"` : ''}`;
      celebrate('sub', username, detail);
    });

    client.on('subgift', (_channel: string, username: string, _streakMonths: number, recipient: string) => {
      celebrate('sub', username, `They gifted a sub to ${recipient}!`);
    });

    client.on('submysterygift', (_channel: string, username: string, numbOfSubs: number) => {
      celebrate('sub', username, `They dropped ${numbOfSubs} gift subs on the community!`);
    });

    client.on('cheer', (_channel: string, userstate: tmi.ChatUserstate, message: string) => {
      const username = userstate['display-name'] || userstate.username || 'viewer';
      const bits = Number.parseInt(userstate.bits || '0', 10);
      if (bits <= 0) return;
      const detail = message?.trim()
        ? `${bits} bits with message: "${message.trim()}"`
        : `${bits} bits`;
      celebrate('bits', username, detail, bits);
    });

    client.on('join', (_channel: string, username: string, self: boolean) => {
      if (self) return;
      tryGreetChatter(username, username.toLowerCase(), normalizedChannel);
    });

    try {
      await client.connect();
      joinGreetWarmupUntilRef.current = Date.now() + JOIN_GREET_WARMUP_MS;
      clientRef.current = client;
      isActiveRef.current = true;
      setIsActive(true);
      try {
        localStorage.setItem(AUTO_RESUME_STORAGE_KEY, '1');
      } catch {
        /* ignore */
      }
      startBotSessionHeartbeat();
      client.say(chan, `Elroy initiated. ${randomCannabisFact()}`);
      restoreStreamSession();
      const foundPowerUp = await resolveShutElroyPowerUpId();
      if (foundPowerUp) {
        void ensureEventSubSubscription();
        startPowerupRedemptionPolling();
      }
      startFollowerPolling();
      startQuotaPolling();
      warmupElroySfx();
      startStreamMonitoring();
      void pollStreamLive().then(() => {
        if (streamLiveRef.current) {
          lastTriviaAtRef.current = Date.now() - TRIVIA_INTERVAL_MS;
        }
      });
    } catch (error) {
      console.error('Elroy failed to connect', error);
      await releaseBotSessionLock();
      setBotBlockReason('Elroy failed to connect to Twitch. Try again.');
    }
  };

  useEffect(() => {
    const onLeave = () => {
      const instanceId = botInstanceIdRef.current || getBotInstanceId();
      if (!instanceId || !isActiveRef.current) return;
      const payload = JSON.stringify({ action: 'release', instanceId });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/bot/session', new Blob([payload], { type: 'application/json' }));
      }
    };
    window.addEventListener('pagehide', onLeave);
    return () => window.removeEventListener('pagehide', onLeave);
  }, []);

  useEffect(() => {
    const shouldAutoStart =
      searchParams.get('autostart') === 'true'
      || (typeof window !== 'undefined' && localStorage.getItem(AUTO_RESUME_STORAGE_KEY) === '1');
    if (shouldAutoStart) {
      void startBot();
    }
  }, [searchParams]);
  return (
    <div style={{ height: '100vh', padding: '60px', color: 'white', backgroundColor: 'transparent', fontFamily: 'sans-serif' }}>
      <div
        style={{
          position: 'fixed',
          top: 20,
          right: 20,
          background: 'rgba(0,0,0,0.85)',
          padding: isActive ? '10px 14px' : '20px',
          borderRadius: '15px',
          border: '2px solid #9146FF',
          fontSize: isActive ? '14px' : '16px',
          lineHeight: 1.4,
          maxWidth: '420px',
          zIndex: 1000,
        }}
      >
        {!isActive && (
          <>
            <div>Brain: {diagnostics.chat} | Voice: {diagnostics.speech} | Sound: {diagnostics.sound}</div>
            <div style={{ color: '#00FF00', marginTop: '5px' }}>Quota: {diagnostics.quota}</div>
          </>
        )}
        <div style={{ color: '#B794F6', marginTop: isActive ? 0 : '8px' }}>
          Build {diagnostics.build} · {diagnostics.update}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        {!isActive ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <button onClick={startBot} style={{ padding: '40px 80px', background: '#9146FF', borderRadius: '20px', fontSize: '40px', fontWeight: 'bold', color: 'white', cursor: 'pointer' }}>IGNITE BONG</button>
            {botBlockReason ? (
              <div style={{ maxWidth: '520px', textAlign: 'center', color: '#FFB4B4', fontSize: '18px', lineHeight: 1.4 }}>
                {botBlockReason}
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ width: '800px', display: 'flex', flexDirection: 'column-reverse', gap: '20px' }}>
            {log.map((e, i) => <div key={i} style={{ background: 'rgba(0,0,0,0.9)', padding: '30px', borderRadius: '20px', borderLeft: '10px solid #9146FF', fontSize: '32px' }}>{e.text}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BongOverlay() { return <Suspense fallback={null}><BongContent /></Suspense>; }