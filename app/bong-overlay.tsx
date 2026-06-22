"use client";

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import tmi from 'tmi.js';
import { describeVoiceQuotaTier, voiceQuotaTierFromRemaining } from '@/lib/voice-quota';
import { getElroySfxPlaybackUrl } from '@/lib/elroy-sfx';
import {
  alignTriviaQuestionCategory,
  matchesTriviaAnswer,
  triviaIntroFor,
  type ElroyTriviaQuestion,
  type TriviaCategory,
  detectElroyTriviaCheat,
} from '@/lib/cannabis-trivia';
import { formatTriviaLeaderboardChatMessage } from '@/lib/trivia-scores';
import {
  formatSubCelebrationDetail,
  subTenureFromEventPayload,
  subTenureFromTmiUserstate,
} from '@/lib/sub-tenure';
import { buildPeriodicCommandHelpMessage, buildCommandsChatReply, buildCommandsPageUrl } from '@/lib/bot-commands';
import { buildTriviaProgressHint } from '@/lib/trivia-hints';
import { buildSpotifyTrackPrompt } from '@/lib/spotify-prompt';
import type { SpotifyTrackSnapshot } from '@/lib/spotify';
import { getBotInstanceId } from '@/lib/bot-instance';
import { getBuildLabel } from '@/lib/build-version';
import { formatDirectiveInjection } from '@/lib/live-directives';
import {
  clampReplyLength,
  formatChatReplyBody,
  MAX_TWITCH_CHAT_CHARS,
  MAX_VOICE_REPLY_CHARS,
} from '@/lib/chat-reply';
import type { UserMemoryEvent } from '@/lib/user-memory';
import { controlAuthHeaders } from '@/lib/control-auth';
import { isOffensiveUsername } from '@/lib/offensive-username';
import { mentionsElroy, misnamesElroyAsLRoy } from '@/lib/elroy-mention';

const BOT_SESSION_HEARTBEAT_MS = 8_000;
const CONTROL_SECRET_STORAGE_KEY = 'elroy-control-secret';
const CHAT_BRAIN_TIMEOUT_MS = 45_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = CHAT_BRAIN_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function rememberUser(
  username: string,
  displayName: string | undefined,
  event: UserMemoryEvent,
  authHeaders: Record<string, string> = {},
) {
  void fetch('/api/users/remember', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, displayName, event }),
  }).catch((error) => {
    console.warn('User memory write failed', error);
  });
}

function BongContent({ initialControlSecret = '' }: { initialControlSecret?: string }) {
  const [isActive, setIsActive] = useState(false);
  const [botBlockReason, setBotBlockReason] = useState<string | null>(null);
  const [log, setLog] = useState<any[]>([]);
  const [isDingOn, setIsDingOn] = useState(true);
  const [isVoiceOn, setIsVoiceOn] = useState(true);
  const searchParams = useSearchParams();
  const controlSecretRef = useRef('');
  const [controlSecretReady, setControlSecretReady] = useState(false);
  const [resolvedControlSecret, setResolvedControlSecret] = useState('');
  const [diagnostics, setDiagnostics] = useState({
    chat: '...',
    twitch: '...',
    speech: '...',
    sound: '...',
    quota: '...',
    build: getBuildLabel(process.env.NEXT_PUBLIC_BUILD_ID || 'dev'),
    update: 'auto-update checking…',
  });
  const [postUpdateCheck, setPostUpdateCheck] = useState(false);
  const [overlayAuthStatus, setOverlayAuthStatus] = useState<'checking' | 'missing' | 'rejected' | 'ok' | 'open'>('checking');
  const [overlayAuthSource, setOverlayAuthSource] = useState<'path' | 'query' | 'storage' | 'none'>('none');
  const [runtimeHud, setRuntimeHud] = useState({
    stream: 'checking…',
    tts: 'idle',
    irc: 'off',
    chat: 'idle',
    mute: '',
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
  const lastElroyVoiceRef = useRef(0);
  const responseQueueRef = useRef<Promise<void>>(Promise.resolve());
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve());
  const elroySpeakerLoginsRef = useRef<Set<string>>(new Set());
  const elroySpeakerUserIdsRef = useRef<Set<string>>(new Set());
  const recentElroyOutboundRef = useRef<Array<{ fingerprint: string; at: number }>>([]);

  const ELROY_SYSTEM_BROADCAST = /^elroy initiated\./i;

  const SHUT_UP_DURATION_MS = 8 * 60 * 1000;
  const POWERUP_MUTE_MS = 10 * 60 * 1000;
  const SHUT_ELROY_POWERUP_PATTERN = /shut\s+elroy\s+up(\s+for\s+10\s+minutes?)?/i;
  const VOICE_COOLDOWN_MS = 90_000;
  const CELEBRATION_VOICE_COOLDOWN_MS = 25_000;
  const COMEBACK_CHANCE = 0.12;
  const CELEBRATION_COOLDOWN_MS = 25_000;
  const FOLLOW_CELEBRATION_COOLDOWN_MS = 60_000;
  const JOIN_GREET_WARMUP_MS = 60_000;
  const FOLLOWER_POLL_MS = 45_000;
  const CHANNEL_EVENTS_POLL_MS = 5_000;
  const STREAM_CHECKIN_MS = 15 * 60 * 1000;
  const STREAM_POLL_MS = 15_000;
  const TRIVIA_ANSWER_WINDOW_MS = 5 * 60 * 1000;
  const TRIVIA_CHECK_MS = 30_000;
  const BLACKJACK_TICK_MS = 4_000;
  const ROULETTE_TICK_MS = 4_000;
  const PICK_TICK_MS = 4_000;
  const COMMAND_HELP_INTERVAL_MS = 7 * 60 * 1000;
  const CHAT_ACTIVITY_MESSAGE_THRESHOLD = 90;
  const CHAT_ACTIVITY_CHANCE = 0.75;
  const chatActivityThresholdRef = useRef(CHAT_ACTIVITY_MESSAGE_THRESHOLD);
  const chatActivityChanceRef = useRef(CHAT_ACTIVITY_CHANCE);
  const ambientVoiceAllowedRef = useRef(false);
  const SESSION_CHAT_MAX = 600;
  const SESSION_STORAGE_KEY = 'elroy-stream-session';
  const AUTO_RESUME_STORAGE_KEY = 'elroy-auto-resume';
  const POST_UPDATE_DIAGNOSTICS_KEY = 'elroy-post-update-diagnostics';
  const VERSION_POLL_MS = 90_000;
  const DIRECTIVE_POLL_MS = 12_000;
  const SPOTIFY_POLL_MS = 5_000;
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
  const channelEventsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastChannelEventPollRef = useRef(Date.now() - 120_000);
  const processedChannelEventIdsRef = useRef<Set<string>>(new Set());
  const recentCelebrationKeysRef = useRef<Map<string, number>>(new Map());
  const streamTitleRef = useRef('');
  const streamGameRef = useRef('');
  const streamCheckinRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triviaPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blackjackPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roulettePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pickPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCommandHelpAtRef = useRef(0);
  const commandHelpIndexRef = useRef(0);
  const commandsPageUrlRef = useRef('');
  const spotifyPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSpotifyTrackIdRef = useRef<string | null>(null);
  const streamLiveRef = useRef(false);
  const lastTriviaAtRef = useRef(0);
  const recentTriviaHistoryRef = useRef<Array<{ category: TriviaCategory; question: string; id: string }>>([]);
  const activeTriviaRef = useRef<{
    category: TriviaCategory;
    question: string;
    answers: string[];
    displayAnswer: string;
    points: number;
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
  const voiceBlockReasonRef = useRef('');
  const celebrationsVoiceOnlyRef = useRef(false);
  const elevenLabsRemainingRef = useRef<number | null>(null);
  const lastQuotaTierRef = useRef<string | null>(null);
  const quotaPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const versionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const directivePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveDirectivesRef = useRef<{ sticky: string[]; next: string[] }>({ sticky: [], next: [] });
  const processedPushIdsRef = useRef<Set<string>>(new Set());
  const lastControlsRevisionRef = useRef(0);
  const processedControlCommandIdsRef = useRef<Set<string>>(new Set());
  const stopBotRef = useRef<(announceUser?: string) => Promise<void>>(async () => {});
  const pendingDeployReloadRef = useRef(false);
  const bundledBuildIdRef = useRef(process.env.NEXT_PUBLIC_BUILD_ID || 'dev');
  const sfxUrlCacheRef = useRef<Map<string, string>>(new Map());
  const offensiveBanAttemptedRef = useRef<Set<string>>(new Set());

  const controlSecretFromPath = initialControlSecret.trim();
  const controlSecretFromQuery =
    searchParams.get('controlKey')?.trim()
    || searchParams.get('key')?.trim()
    || searchParams.get('secret')?.trim()
    || '';

  const controlHeaders = useCallback((extra: Record<string, string> = {}): Record<string, string> => {
    return controlAuthHeaders(controlSecretRef.current, extra);
  }, []);

  const verifyOverlaySecret = useCallback(async (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed) return false;
    try {
      const res = await fetch('/api/control/verify', {
        headers: controlAuthHeaders(trimmed),
        cache: 'no-store',
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      commandsPageUrlRef.current = buildCommandsPageUrl(window.location.origin);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const statusRes = await fetch('/api/control/status', { cache: 'no-store' });
        const statusData = await statusRes.json() as { configured?: boolean };
        const authRequired = statusData.configured === true;

        if (!authRequired) {
          if (!cancelled) {
            setOverlayAuthStatus('open');
            setControlSecretReady(true);
          }
          return;
        }

        let stored = '';
        try {
          stored = sessionStorage.getItem(CONTROL_SECRET_STORAGE_KEY)?.trim() || '';
        } catch {
          stored = '';
        }

        const candidates: Array<{ secret: string; source: 'path' | 'query' | 'storage' }> = [];
        if (controlSecretFromPath) {
          candidates.push({ secret: controlSecretFromPath, source: 'path' });
        }
        if (controlSecretFromQuery && controlSecretFromQuery !== controlSecretFromPath) {
          candidates.push({ secret: controlSecretFromQuery, source: 'query' });
        }
        if (stored && !candidates.some((item) => item.secret === stored)) {
          candidates.push({ secret: stored, source: 'storage' });
        }

        if (!candidates.length) {
          if (!cancelled) {
            setOverlayAuthStatus('missing');
            setControlSecretReady(true);
          }
          return;
        }

        for (const { secret, source } of candidates) {
          const ok = await verifyOverlaySecret(secret);
          if (cancelled) return;
          if (!ok) continue;

          controlSecretRef.current = secret;
          setResolvedControlSecret(secret);
          setOverlayAuthSource(source);
          setOverlayAuthStatus('ok');
          setControlSecretReady(true);
          try {
            sessionStorage.setItem(CONTROL_SECRET_STORAGE_KEY, secret);
          } catch {
            /* ignore */
          }
          return;
        }

        if (!cancelled) {
          try {
            sessionStorage.removeItem(CONTROL_SECRET_STORAGE_KEY);
          } catch {
            /* ignore */
          }
          controlSecretRef.current = '';
          setResolvedControlSecret('');
          setOverlayAuthStatus('rejected');
          setControlSecretReady(true);
        }
      } catch {
        if (!cancelled) {
          setOverlayAuthStatus('rejected');
          setControlSecretReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [controlSecretFromPath, controlSecretFromQuery, verifyOverlaySecret]);

  const normalizeChatFingerprint = useCallback((text: string) => (
    text.trim().toLowerCase().replace(/\s+/g, ' ')
  ), []);

  const registerElroySpeaker = useCallback((login?: string, userId?: string) => {
    const normalized = login?.trim().toLowerCase();
    if (normalized) elroySpeakerLoginsRef.current.add(normalized);
    const id = userId?.trim();
    if (id) elroySpeakerUserIdsRef.current.add(id);
  }, []);

  const isElroySystemBroadcast = useCallback((message: string) => (
    ELROY_SYSTEM_BROADCAST.test(message.trim())
    || /^elroy is back/i.test(message.trim())
    || /^shut elroy up/i.test(message.trim())
  ), []);

  const isKnownElroySpeakerLogin = useCallback((normalizedUser: string) => {
    if (elroySpeakerLoginsRef.current.has(normalizedUser)) return true;
    const tokenUsesElroyName = [...elroySpeakerLoginsRef.current].some((login) => login.includes('elroy'));
    return tokenUsesElroyName && normalizedUser.includes('elroy');
  }, []);

  const rememberElroyOutbound = useCallback((text: string, senderLogin?: string) => {
    const fingerprint = normalizeChatFingerprint(text);
    if (!fingerprint) return;
    recentElroyOutboundRef.current.push({ fingerprint, at: Date.now() });
    recentElroyOutboundRef.current = recentElroyOutboundRef.current
      .filter((entry) => Date.now() - entry.at < 180_000)
      .slice(-50);
    registerElroySpeaker(senderLogin);
  }, [normalizeChatFingerprint, registerElroySpeaker]);

  const isEchoOfElroyOutbound = useCallback((message: string) => {
    const fingerprint = normalizeChatFingerprint(message);
    if (!fingerprint) return false;
    return recentElroyOutboundRef.current.some((entry) => (
      entry.fingerprint === fingerprint
      || fingerprint.startsWith(entry.fingerprint.slice(0, 48))
      || entry.fingerprint.startsWith(fingerprint.slice(0, 48))
    ));
  }, [normalizeChatFingerprint]);

  const seedElroySpeakerLogins = useCallback(async (normalizedChannel: string) => {
    const logins = new Set<string>([normalizedChannel]);
    const userIds = new Set<string>();
    const envBotLogin = process.env.NEXT_PUBLIC_TWITCH_BOT_LOGIN?.trim().toLowerCase();
    if (envBotLogin) logins.add(envBotLogin);

    try {
      const res = await fetch('/api/twitch/chat-status', {
        headers: controlHeaders(),
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json() as {
          tokenLogin?: string;
          speakerLogins?: string[];
          speakerUserIds?: string[];
        };
        const tokenLogin = data.tokenLogin?.trim().toLowerCase();
        if (tokenLogin) logins.add(tokenLogin);
        for (const login of data.speakerLogins ?? []) {
          const normalized = login.trim().toLowerCase();
          if (normalized) logins.add(normalized);
        }
        for (const userId of data.speakerUserIds ?? []) {
          const normalized = userId.trim();
          if (normalized) userIds.add(normalized);
        }
      }
    } catch {
      /* chat-status optional — channel login still ignored */
    }

    elroySpeakerLoginsRef.current = logins;
    elroySpeakerUserIdsRef.current = userIds;
  }, [controlHeaders]);

  const isElroyChatSpeaker = useCallback((
    userstate: tmi.ChatUserstate,
    normalizedUser: string,
    normalizedChannel: string,
    message: string,
  ) => {
    if (isElroySystemBroadcast(message)) return true;
    if (isEchoOfElroyOutbound(message)) return true;
    if (normalizedUser === normalizedChannel) return true;
    if (isKnownElroySpeakerLogin(normalizedUser)) return true;
    const userId = userstate['user-id'];
    if (userId && elroySpeakerUserIdsRef.current.has(userId)) return true;
    if (userstate.badges?.bot === '1') return true;
    return false;
  }, [isEchoOfElroyOutbound, isElroySystemBroadcast, isKnownElroySpeakerLogin]);

  const isShutUpCommand = (text: string) => {
    const lower = text.toLowerCase();
    if (!mentionsElroy(lower)) return false;
    return /\b(shut\s*up|be\s*quiet|stfu|stop\s*talking|zip\s*it|can\s*you\s*not|go\s*away|leave\s*us\s*alone|silence|shush)\b/.test(lower);
  };

  const isSilenced = () => Date.now() < silencedUntilRef.current;

  const isFullyMuted = () => isSilenced() && silenceModeRef.current === 'full';

  const syncMuteHud = useCallback(() => {
    if (!isSilenced()) {
      setRuntimeHud((prev) => ({ ...prev, mute: '' }));
      return;
    }
    const minutesLeft = Math.max(1, Math.ceil((silencedUntilRef.current - Date.now()) / 60_000));
    const mode = silenceModeRef.current === 'full' ? 'FULL MUTE — no chat' : 'voice muted — chat still on';
    setRuntimeHud((prev) => ({ ...prev, mute: `${mode} (~${minutesLeft}m)` }));
  }, []);

  const resolveShutElroyPowerUpId = useCallback(async () => {
    try {
      const res = await fetch('/api/twitch/powerups', {
        headers: controlHeaders(),
      });
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
  }, [controlHeaders]);

  const ensureEventSubSubscription = useCallback(async () => {
    try {
      const res = await fetch('/api/twitch/eventsub/subscribe', {
        method: 'POST',
        headers: controlHeaders(),
      });
      const data = await res.json();
      if (data.ok) {
        console.info('EventSub listeners:', data.lifecycle?.status ?? data.power_up?.status, data.lifecycle?.callback ?? data.power_up?.callback);
      } else {
        console.warn('EventSub listener setup:', data.lifecycle?.message || data.power_up?.message || data.lifecycle?.status || data.power_up?.status);
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

  const canUseVoice = (priority: 'celebration' | 'normal' = 'normal') => {
    if (!quotaVoiceAllowedRef.current) return false;
    const cooldown = priority === 'celebration'
      ? celebrationVoiceCooldownMsRef.current
      : voiceCooldownMsRef.current;
    if (!Number.isFinite(cooldown)) return false;
    return Date.now() - lastElroyVoiceRef.current >= cooldown;
  };

  const describeVoiceSkip = useCallback((
    opts: {
      chatOnly?: boolean;
      forceVoice?: boolean;
      bypassVoiceCooldown?: boolean;
      voicePriority?: 'celebration' | 'normal';
    },
  ) => {
    if (opts.chatOnly) return 'chat-only mode';
    if (!streamLiveRef.current) return 'waiting for LIVE (chat only until then)';
    if (!voiceEnabledRef.current && !opts.forceVoice) return 'voice off — !voice to toggle on';
    if (isSilenced() && silenceModeRef.current === 'voice') return 'silenced (voice off)';
    if (!quotaVoiceAllowedRef.current) {
      return voiceBlockReasonRef.current || 'ElevenLabs quota empty';
    }
    if (celebrationsVoiceOnlyRef.current && !opts.forceVoice) return 'subs/bits voice only (low quota)';
    if (!opts.bypassVoiceCooldown && !canUseVoice(opts.voicePriority ?? (opts.forceVoice ? 'celebration' : 'normal'))) {
      const cooldown = (opts.voicePriority ?? (opts.forceVoice ? 'celebration' : 'normal')) === 'celebration'
        ? celebrationVoiceCooldownMsRef.current
        : voiceCooldownMsRef.current;
      const waitSec = Math.max(0, Math.ceil((cooldown - (Date.now() - lastElroyVoiceRef.current)) / 1000));
      return `voice cooldown (~${waitSec}s)`;
    }
    return null;
  }, []);

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

  const applySubscriptionVoiceBlock = useCallback((data: {
    voiceBlocked?: boolean;
    voiceBlockReason?: string;
    subscriptionStatus?: string;
  }) => {
    if (!data.voiceBlocked) {
      voiceBlockReasonRef.current = '';
      return;
    }
    quotaVoiceAllowedRef.current = false;
    voiceBlockReasonRef.current = data.voiceBlockReason
      || `ElevenLabs subscription ${data.subscriptionStatus || 'blocked'} — voice disabled until billing is fixed`;
    setDiagnostics((prev) => ({
      ...prev,
      speech: '❌ billing',
      quota: voiceBlockReasonRef.current,
    }));
  }, []);

  const pollElevenLabsQuota = useCallback(async () => {
    try {
      const res = await fetch('/api/quota', {
        headers: controlHeaders(),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error('Quota lookup failed');
      applyVoiceQuotaTier(Number(data.remaining) || 0);
      applySubscriptionVoiceBlock(data);
    } catch (e) {
      console.warn('ElevenLabs quota poll failed', e);
    }
  }, [applySubscriptionVoiceBlock, applyVoiceQuotaTier, controlHeaders]);

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

  const sayChat = useCallback(async (message: string): Promise<boolean> => {
    const text = message.trim();
    if (!text) return false;
    rememberElroyOutbound(text);

    try {
      const res = await fetch('/api/twitch/say', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        const detail = data.error || `HTTP ${res.status}`;
        const hudLine = res.status === 401
          ? 'chat blocked — overlay not authorized'
          : `chat failed — ${detail}`;
        setRuntimeHud((prev) => ({ ...prev, chat: hudLine }));
        throw new Error(detail);
      }
      const data = await res.json().catch(() => ({})) as { sender_login?: string };
      rememberElroyOutbound(text, data.sender_login);
      setRuntimeHud((prev) => ({ ...prev, chat: 'sent' }));
      return true;
    } catch (error) {
      console.warn('Twitch say failed', error);
      return false;
    }
  }, [controlHeaders, rememberElroyOutbound]);

  const postTwitchAnnounce = useCallback(async (
    message: string,
    color: 'primary' | 'blue' | 'green' | 'orange' | 'purple' = 'primary',
  ) => {
    const text = message.trim();
    if (!text) return false;
    rememberElroyOutbound(text);
    try {
      const res = await fetch('/api/twitch/announce', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ message: text, color }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({})) as { sender_login?: string };
        rememberElroyOutbound(text, data.sender_login);
        setRuntimeHud((prev) => ({ ...prev, chat: 'announced' }));
        return true;
      }
    } catch (error) {
      console.warn('Twitch announce failed', error);
    }
    return sayChat(text);
  }, [controlHeaders, rememberElroyOutbound, sayChat]);

  const shouldSkipDuplicateCelebration = useCallback((key: string, windowMs = 30_000) => {
    const last = recentCelebrationKeysRef.current.get(key) ?? 0;
    if (Date.now() - last < windowMs) return true;
    recentCelebrationKeysRef.current.set(key, Date.now());
    return false;
  }, []);

  const streamMetadataLine = useCallback(() => {
    const title = streamTitleRef.current.trim();
    const game = streamGameRef.current.trim();
    if (title && game) return `Stream title: "${title}". Playing: ${game}.`;
    if (title) return `Stream title: "${title}".`;
    if (game) return `Currently playing: ${game}.`;
    return '';
  }, []);

  const stopMuteCountdown = useCallback(() => {
    if (muteCountdownRef.current) {
      clearInterval(muteCountdownRef.current);
      muteCountdownRef.current = null;
    }
  }, []);

  const postMuteCountdown = useCallback(() => {
    const msLeft = silencedUntilRef.current - Date.now();
    if (msLeft <= 0) {
      silencedUntilRef.current = 0;
      silenceModeRef.current = 'none';
      stopMuteCountdown();
      syncMuteHud();
      void sayChat('Elroy is back — you can talk to me again.');
      return;
    }
    syncMuteHud();
    const minutesLeft = Math.ceil(msLeft / 60_000);
    void sayChat(
      `${minutesLeft} minute${minutesLeft === 1 ? '' : 's'} until Elroy can talk again.`,
    );
  }, [sayChat, stopMuteCountdown, syncMuteHud]);

  const enterFullMute = useCallback((redeemer?: string) => {
    stopMuteCountdown();
    silencedUntilRef.current = Date.now() + POWERUP_MUTE_MS;
    silenceModeRef.current = 'full';
    voiceEnabledRef.current = false;
    setIsVoiceOn(false);
    syncMuteHud();

    const opener = redeemer
      ? `@${redeemer} shut Elroy up — no chat or voice for 10 minutes.`
      : 'Shut Elroy Up power-up activated — no chat or voice for 10 minutes.';
    void sayChat(opener);
    void playElroySfx('mute_zip');
    postMuteCountdown();
    muteCountdownRef.current = setInterval(() => {
      postMuteCountdown();
    }, 60_000);
  }, [postMuteCountdown, stopMuteCountdown, playElroySfx, sayChat, syncMuteHud]);

  const pollPowerupRedemptions = useCallback(async () => {
    const cachedId = shutElroyPowerUpIdRef.current;
    if (!cachedId) return;

    try {
      const res = await fetch(`/api/twitch/powerup-redemptions?since=${lastRedemptionPollRef.current}&_=${Date.now()}`, {
        headers: controlHeaders(),
      });
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
  }, [controlHeaders, enterFullMute]);

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

    if (typeof window !== 'undefined') {
      sessionStorage.setItem(POST_UPDATE_DIAGNOSTICS_KEY, '1');
    }

    if (isActiveRef.current) {
      localStorage.setItem(AUTO_RESUME_STORAGE_KEY, '1');
      try {
        await sayChat('🔄 Elroy updating — back in a few seconds.');
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      } catch {
        /* ignore */
      }
    }

    window.location.reload();
  }, [canSafelyReloadForDeploy, persistStreamSession, sayChat]);

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
    let title = streamTitleRef.current;
    let gameName = streamGameRef.current;
    try {
      const res = await fetch(`/api/twitch/stream?t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && (data.status === 'live' || data.status === 'offline' || data.status === 'unknown')) {
        streamStatus = data.status;
        if (typeof data.viewer_count === 'number') viewerCount = data.viewer_count;
        if (typeof data.title === 'string') title = data.title;
        if (typeof data.game_name === 'string') gameName = data.game_name;
      } else if (res.ok && data.is_live) {
        streamStatus = 'live';
        if (typeof data.viewer_count === 'number') viewerCount = data.viewer_count;
        if (typeof data.title === 'string') title = data.title;
        if (typeof data.game_name === 'string') gameName = data.game_name;
      } else if (res.ok) {
        streamStatus = 'offline';
      }
    } catch (e) {
      console.warn('Stream status fetch failed', e);
    }
    streamTitleRef.current = title;
    streamGameRef.current = gameName;
    const isLive = streamStatus === 'live';
    return { isLive, streamStatus, viewerCount, title, gameName };
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
    return `Use the recent Twitch chat for a topical comment (2-3 sentences). Reference the vibe from:\n${lines}${streamMetadataLine() ? `\nStream context: ${streamMetadataLine()}` : ''}\nDo not force a rhyme.`;
  }, [streamMetadataLine]);

  const formatSpeechHudError = useCallback((status: number, message: string) => {
    const lower = message.toLowerCase();
    if (lower.includes('payment')) {
      quotaVoiceAllowedRef.current = false;
      setDiagnostics((prev) => ({
        ...prev,
        speech: '❌ billing',
        quota: 'ElevenLabs payment failed — fix billing to restore voice',
      }));
      return 'ElevenLabs payment issue — complete billing at elevenlabs.io';
    }
    if (status === 401) return 'speech unauthorized — check overlay control key';
    if (status === 503 && lower.includes('api_key')) return 'ELEVENLABS_API_KEY missing on server';
    return message ? `speech: ${message.slice(0, 120)}` : `speech API error ${status}`;
  }, []);

  const parseSpeechApiError = useCallback(async (res: Response) => {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      return typeof data.error === 'string' ? data.error : '';
    }
    return (await res.text().catch(() => '')).trim();
  }, []);

  const runDiagnostics = useCallback(async (opts?: { afterDeploy?: boolean }) => {
    const afterDeploy = opts?.afterDeploy === true;
    setDiagnostics((prev) => ({
      ...prev,
      chat: '...',
      twitch: '...',
      speech: '...',
      sound: '...',
      ...(afterDeploy ? { quota: '...' } : {}),
      update: afterDeploy ? 'checking systems after update…' : prev.update,
    }));

    try {
      const chat = await fetch('/api/chat', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prompt: 'ping' }),
      });
      const twitchStatus = await fetch('/api/twitch/chat-status', {
        headers: controlHeaders(),
      });
      const twitchData = await twitchStatus.json() as {
        ok?: boolean;
        error?: string;
        hint?: string;
        tokenLogin?: string;
      };
      const speech = await fetch('/api/speech', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text: 'ping' }),
      });
      const speechContentType = speech.headers.get('content-type') || '';
      const speechOk = speech.ok && speechContentType.includes('audio');
      const sound = await fetch('/api/sfx/bong_rip');
      const quotaRes = await fetch('/api/quota', {
        headers: controlHeaders(),
      });
      const qData = await quotaRes.json();

      if (quotaRes.ok && !qData.error) {
        applyVoiceQuotaTier(Number(qData.remaining) || 0);
        applySubscriptionVoiceBlock(qData);
      }

      let quotaLabel = quotaRes.ok && !qData.error
        ? (qData.voiceBlocked && qData.voiceBlockReason
          ? String(qData.voiceBlockReason)
          : `${Number(qData.remaining || 0).toLocaleString()} left`)
        : '❌';
      if (!speechOk) {
        const speechErr = await parseSpeechApiError(speech);
        if (speechErr.toLowerCase().includes('payment')) {
          quotaVoiceAllowedRef.current = false;
          quotaLabel = 'ElevenLabs payment failed — fix billing to restore voice';
        }
      }

      const twitchLabel = twitchStatus.ok && twitchData.ok
        ? `✅ ${twitchData.tokenLogin || 'ready'}`
        : '❌';
      if (!twitchStatus.ok || !twitchData.ok) {
        const twitchHud = twitchData.error
          ? `${twitchData.error}${twitchData.hint ? ` — ${twitchData.hint}` : ''}`
          : 'Twitch chat not configured on server';
        setRuntimeHud((prev) => ({ ...prev, chat: twitchHud }));
      }

      setDiagnostics((prev) => ({
        ...prev,
        chat: chat.status === 200 ? '✅' : '❌',
        twitch: twitchLabel,
        speech: speechOk ? '✅' : '❌',
        sound: sound.ok ? '✅' : '❌',
        quota: afterDeploy ? quotaLabel : (prev.quota !== '...' ? prev.quota : quotaLabel),
        update: afterDeploy ? 'updated · systems checked' : prev.update,
      }));
    } catch (e) {
      console.error(e);
      if (afterDeploy) {
        setDiagnostics((prev) => ({
          ...prev,
          chat: '❌',
          twitch: '❌',
          speech: '❌',
          sound: '❌',
          quota: '❌',
          update: 'update check failed',
        }));
      }
    }
  }, [applySubscriptionVoiceBlock, applyVoiceQuotaTier, controlHeaders, parseSpeechApiError]);

  useEffect(() => {
    if (!controlSecretReady || overlayAuthStatus !== 'ok' && overlayAuthStatus !== 'open') return;
    void runDiagnostics();
  }, [controlSecretReady, overlayAuthStatus, resolvedControlSecret, runDiagnostics]);
  useEffect(() => { dingEnabledRef.current = isDingOn; }, [isDingOn]);
  useEffect(() => { voiceEnabledRef.current = isVoiceOn; }, [isVoiceOn]);
  useEffect(() => {
    startVersionPolling();
    return () => stopVersionPolling();
  }, [startVersionPolling, stopVersionPolling]);

  const speakNow = async (text: string) => {
    try {
      const res = await fetch('/api/speech', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || contentType.includes('application/json')) {
        const errMsg = await parseSpeechApiError(res);
        console.warn('Speech API failed', res.status, errMsg);
        setRuntimeHud((prev) => ({
          ...prev,
          tts: formatSpeechHudError(res.status, errMsg),
        }));
        return;
      }
      const audioUrl = URL.createObjectURL(await res.blob());
      const audio = new Audio(audioUrl);
      audio.volume = volumeRef.current;
      isSpeakingRef.current = true;
      setRuntimeHud((prev) => ({ ...prev, tts: 'speaking…' }));
      await new Promise<void>((resolve) => {
        const finish = () => {
          isSpeakingRef.current = false;
          URL.revokeObjectURL(audioUrl);
          setRuntimeHud((prev) => ({ ...prev, tts: 'audio ready' }));
          resolve();
        };

        audio.onended = finish;
        audio.onerror = () => {
          console.warn('Audio element error');
          setRuntimeHud((prev) => ({ ...prev, tts: 'playback error — check OBS audio' }));
          finish();
        };
        audio.play().catch((error) => {
          console.warn('Audio playback blocked', error);
          setRuntimeHud((prev) => ({
            ...prev,
            tts: 'playback blocked — OBS: Control audio via OBS + unmute source',
          }));
          isSpeakingRef.current = false;
          URL.revokeObjectURL(audioUrl);
          resolve();
        });
      });
    } catch (e) {
      isSpeakingRef.current = false;
      console.warn('Speech failed', e);
      setRuntimeHud((prev) => ({ ...prev, tts: 'speech failed' }));
    }
  };

  const unlockBrowserAudio = useCallback(async () => {
    const playUnlockClip = async (blob: Blob) => {
      const audioUrl = URL.createObjectURL(blob);
      try {
        const audio = new Audio(audioUrl);
        audio.volume = volumeRef.current;
        await audio.play();
        setRuntimeHud((prev) => ({ ...prev, tts: 'audio ready' }));
        return true;
      } finally {
        URL.revokeObjectURL(audioUrl);
      }
    };

    const playBundledUnlockSfx = async () => {
      if (await playElroySfx('bong_rip', volumeRef.current)) return true;
      try {
        const rip = new Audio('/sounds/bong.mp3');
        rip.volume = volumeRef.current;
        await rip.play();
        return true;
      } catch {
        return false;
      }
    };

    try {
      const res = await fetch('/api/speech', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text: 'Yo.' }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && !contentType.includes('application/json')) {
        await playUnlockClip(await res.blob());
        return;
      }

      const errMsg = await parseSpeechApiError(res);
      const voiceHud = formatSpeechHudError(res.status, errMsg);
      const sfxOk = await playBundledUnlockSfx();
      setRuntimeHud((prev) => ({
        ...prev,
        tts: sfxOk
          ? `${voiceHud} — bong rip played (Yo needs voice working)`
          : voiceHud,
      }));
    } catch {
      const sfxOk = await playBundledUnlockSfx();
      setRuntimeHud((prev) => ({
        ...prev,
        tts: sfxOk
          ? 'voice unavailable — bong rip played, OBS audio unlocked'
          : 'tap IGNITE BONG + enable Control audio via OBS',
      }));
    }
  }, [controlHeaders, formatSpeechHudError, parseSpeechApiError, playElroySfx]);

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
    return `Someone brought you up in Twitch chat. ${user} said: "${message}"\n\nRecent chat:\n${context}${streamMetadataLine() ? `\n\nStream context: ${streamMetadataLine()}` : ''}\n\nReply in OG character — 2-3 sentences, enough personality to land the bit.`;
  }, [streamMetadataLine]);

  const buildLRoyRoastPrompt = useCallback((user: string, message: string) => {
    const recent = recentChatRef.current.slice(0, 6);
    const context = recent.length
      ? recent.map((entry) => `- ${entry.user}: ${entry.text}`).join('\n')
      : '(no other recent lines)';
    return `${user} called you "L Roy" in Twitch chat (wrong name — you are ELROY, not L Roy): "${message}"\n\nRecent chat:\n${context}\n\nOne short roast sentence for the misname — playful not cruel.`;
  }, []);

  const buildFollowPrompt = useCallback((user: string) =>
    `${user} just followed the Twitch channel. One or two welcome sentences — hype but real.`, []);

  const buildJoinGreetingPrompt = useCallback((user: string) =>
    `${user} just entered the Twitch chat while the stream is live. One or two welcome sentences by username.`, []);

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
    return `${cheatLine}\n\nLive trivia question: "${triviaQuestion}"\n\nOne short roast sentence for ${user} — playful not cruel. They must answer in chat themselves.`;
  }, []);

  const buildSubPrompt = useCallback((user: string, details: string) =>
    `${user} just subscribed or resubbed! ${details} Celebrate them — use total months subscribed when given, not streak alone. One or two sentences.`, []);

  const buildRaidPrompt = useCallback((user: string, viewers: number) =>
    `${user} just raided with ${viewers} viewer${viewers === 1 ? '' : 's'}! Welcome them hard — hype the raid, shout them out by name, OG energy.`, []);

  const buildBitsPrompt = useCallback((user: string, details: string) =>
    `${user} just cheered ${details} in chat! One or two thank-you sentences.`, []);

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
      viewerLine = `The stream is LIVE with about ${viewerCount} viewers (latest Twitch API poll — may differ slightly from the player UI).`;
    } else if (chatActive) {
      viewerLine = streamStatus === 'live' && viewerCount != null
        ? `The stream is live with about ${viewerCount} viewers (API snapshot). Chat is active.`
        : 'Chat is active — the stream is clearly live. Viewer count could not be fetched; hype the room without inventing a number.';
    } else if (streamStatus === 'offline') {
      viewerLine = 'Twitch reports the channel is not live and chat has been quiet.';
    } else {
      viewerLine = 'Viewer count could not be verified. Do not say the stream or chat is offline — keep the energy up anyway.';
    }

    return `10-minute stream check-in.\n${viewerLine}\n${streamMetadataLine() ? `${streamMetadataLine()}\n` : ''}\nRecent chat (last ~20 minutes):\n${lines}\n\nWrite a chat check-in (2-3 sentences):\n- Mention viewer count only if provided above.\n- You may reference the stream title or game if listed.\n- Optionally shout out ONE chatter by username from the list.`;
  }, [streamMetadataLine]);

  const buildStreamGreetingPrompt = useCallback((viewerCount: number | null, cannabisFact: string) => {
    const viewers = viewerCount != null ? `About ${viewerCount} viewers are here.` : 'Stream just went live.';
    const meta = streamMetadataLine();
    return `The Twitch stream just went LIVE. ${viewers}${meta ? ` ${meta}` : ''}\n\nGive a hype stream-start greeting with VOICE energy. You MUST open with exactly "I AM ALIVE!" as the first words, then welcome chat and weave in this cannabis fact naturally: "${cannabisFact}"\nKeep it fun, OG, and welcoming.`;
  }, [streamMetadataLine]);

  const buildStreamGoodbyePrompt = useCallback(() =>
    'The Twitch stream just ended. Give a warm, brief goodbye to chat (1-2 sentences). Chat-only, no voice.',
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
    return `The stream just ended. Write a recap for Twitch chat (chat-only, no voice).\n${durationLine} ${messages.length} messages logged from ~${uniqueChatters} chatters.\n\nChat sample:\n${lines}\n\nTwo or three sentences: a highlight, a shout-out if someone stood out, and thanks. Stay under 450 characters. Only reference usernames/topics above.`;
  }, [sampleSessionChat]);

  const buildComebackPrompt = useCallback((user: string, message: string) => {
    const recent = recentChatRef.current.slice(0, 6);
    const context = recent.length
      ? recent.map((entry) => `- ${entry.user}: ${entry.text}`).join('\n')
      : '(no other recent lines)';
    return `You were trying to stay quiet, but chat kept talking about you. ${user} said: "${message}"\n\nRecent chat:\n${context}\n\nSnap back with a funny, crusty call-out — you're annoyed they couldn't let you chill. Roast ${user} by name; keep it playful, not cruel.`;
  }, []);

  const isTriviaRoundLive = useCallback(() => {
    const active = activeTriviaRef.current;
    return Boolean(active && !active.answered);
  }, []);

  const processBongLogic = useCallback(async (
    input: string,
    user?: string,
    opts: {
      isQuota?: boolean;
      forceVoice?: boolean;
      chatOnly?: boolean;
      skipDing?: boolean;
      bypassVoiceCooldown?: boolean;
      voicePriority?: 'celebration' | 'normal';
    } = {},
  ) => {
    try {
      if (isFullyMuted() && !opts.isQuota) return;
      if (isTriviaRoundLive() && !opts.isQuota) {
        opts = {
          ...opts,
          chatOnly: true,
          skipDing: true,
          forceVoice: false,
          bypassVoiceCooldown: false,
        };
      }
      if (opts.isQuota) {
        const res = await fetch('/api/quota', {
          headers: controlHeaders(),
        });
        const d = await res.json();
        void sayChat(`@${user} I got ${d.remaining.toLocaleString()} chars until ${d.resetDate}.`);
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
      const voiceSkip = willUseVoice ? null : describeVoiceSkip(opts);
      if (voiceSkip) {
        setRuntimeHud((prev) => ({ ...prev, tts: voiceSkip }));
      }

      const sticky = liveDirectivesRef.current.sticky;
      const next = liveDirectivesRef.current.next;
      const directiveBlock = formatDirectiveInjection(sticky, next);
      const hadNextDirectives = next.length > 0;

      const personalizationRule = user
        ? `- Personalize the response directly for ${user} by name (say their username naturally in the message).`
        : `- Keep it general for the whole chat, not aimed at one person.`;
      const lengthRule = willUseVoice
        ? `- Voice: 2-3 sentences, about 180-${MAX_VOICE_REPLY_CHARS} characters total. Say the full thought — do not stop mid-sentence.`
        : `- Chat only: 2-4 sentences, about 200-${MAX_TWITCH_CHAT_CHARS} characters total.
- Hard cap ${MAX_TWITCH_CHAT_CHARS} characters. No bullet lists or paragraphs — keep it flowing chat prose.`;
      const fullPrompt = `${input}${directiveBlock}\n\nResponse requirements:\n${lengthRule}\n- Keep the same OG personality and rhythm.\n${personalizationRule}`;
      let res: Response;
      try {
        res = await fetchWithTimeout('/api/chat', {
          method: 'POST',
          headers: controlHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ prompt: fullPrompt }),
        });
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === 'AbortError';
        console.warn('Chat brain request failed', error);
        setRuntimeHud((prev) => ({
          ...prev,
          chat: timedOut ? 'brain timed out — try again' : 'brain unreachable',
        }));
        if (user) {
          const failLine = clampReplyLength(
            timedOut ? 'Brain timed out — try again in a sec.' : 'Brain unreachable — check overlay auth.',
            MAX_TWITCH_CHAT_CHARS - (`@${user} `.length),
          );
          await sayChat(`@${user} ${failLine}`);
        }
        return;
      }
      const data = await res.json() as { text?: string; error?: string };
      if (!res.ok || !data.text?.trim()) {
        console.warn('Chat brain failed', data.error || res.status);
        setRuntimeHud((prev) => ({
          ...prev,
          chat: res.status === 401 ? 'brain blocked — overlay not authorized' : `brain error ${res.status}`,
        }));
        if (user) {
          const failLine = clampReplyLength(
            data.error || 'Brain stall — check Gemini billing in AI Studio.',
            MAX_TWITCH_CHAT_CHARS - (`@${user} `.length),
          );
          await sayChat(`@${user} ${failLine}`);
        }
        return;
      }
      if (hadNextDirectives && !opts.isQuota) {
        liveDirectivesRef.current = { ...liveDirectivesRef.current, next: [] };
        void fetch('/api/directives', {
          method: 'POST',
          headers: controlHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ action: 'consume-next' }),
        }).catch((error) => {
          console.warn('Directive consume failed', error);
        });
      }
      const safeChatText = formatChatReplyBody(data.text, user);
      setLog(p => [{ text: safeChatText }, ...p].slice(0, 5));
      await sayChat(user ? `@${user} ${safeChatText}` : safeChatText);

      if (willUseVoice) {
        lastElroyVoiceRef.current = Date.now();
        const playDing = dingEnabledRef.current && !opts.skipDing;
        const voiceText = clampReplyLength(safeChatText, MAX_VOICE_REPLY_CHARS);
        void (async () => {
          if (playDing) {
            await playBongRip(volumeRef.current);
            await new Promise<void>((resolve) => setTimeout(resolve, 1600));
          }
          void speak(voiceText);
        })();
      }
    } catch (e) { console.error(e); }
  }, [controlHeaders, describeVoiceSkip, isTriviaRoundLive, playBongRip, sayChat, speak]);

  const queueBongLogic = useCallback((
    input: string,
    user?: string,
    opts: {
      isQuota?: boolean;
      forceVoice?: boolean;
      chatOnly?: boolean;
      skipDing?: boolean;
      bypassVoiceCooldown?: boolean;
      voicePriority?: 'celebration' | 'normal';
    } = {},
  ) => {
    responseQueueRef.current = responseQueueRef.current
      .then(() => processBongLogic(input, user, opts))
      .catch((e) => { console.error(e); });
    return responseQueueRef.current;
  }, [processBongLogic]);

  const pollLiveDirectives = useCallback(async () => {
    try {
      const res = await fetch(`/api/directives?t=${Date.now()}`, {
        cache: 'no-store',
        headers: controlHeaders(),
      });
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
            bypassVoiceCooldown: Boolean(item.forceVoice),
          },
        );

        void fetch('/api/directives', {
          method: 'POST',
          headers: controlHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ action: 'ack-push', id: item.id }),
        }).catch((error) => {
          console.warn('Push ack failed', error);
        });
      }
    } catch (error) {
      console.warn('Directive poll failed', error);
    }
  }, [controlHeaders, queueBongLogic]);

  const pollBotControls = useCallback(async () => {
    try {
      const res = await fetch(`/api/bot/controls?t=${Date.now()}`, {
        cache: 'no-store',
        headers: controlHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json() as {
        revision?: number;
        settings?: {
          voiceEnabled?: boolean;
          dingEnabled?: boolean;
          volume?: number;
        };
        commands?: Array<{ id: string; type: string }>;
      };

      const revision = Number(data.revision) || 0;
      if (revision > lastControlsRevisionRef.current) {
        lastControlsRevisionRef.current = revision;
        if (typeof data.settings?.voiceEnabled === 'boolean') {
          voiceEnabledRef.current = data.settings.voiceEnabled;
          setIsVoiceOn(data.settings.voiceEnabled);
        }
        if (typeof data.settings?.dingEnabled === 'boolean') {
          dingEnabledRef.current = data.settings.dingEnabled;
          setIsDingOn(data.settings.dingEnabled);
        }
        if (typeof data.settings?.volume === 'number' && Number.isFinite(data.settings.volume)) {
          volumeRef.current = Math.min(1, Math.max(0, data.settings.volume));
        }
      }

      const ackIds: string[] = [];
      for (const command of data.commands ?? []) {
        if (!command?.id || processedControlCommandIdsRef.current.has(command.id)) continue;
        processedControlCommandIdsRef.current.add(command.id);
        ackIds.push(command.id);
        if (command.type === 'disconnect') {
          void stopBotRef.current();
        }
      }

      if (ackIds.length) {
        void fetch('/api/bot/controls', {
          method: 'POST',
          headers: controlHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ action: 'ack', commandIds: ackIds }),
        }).catch((error) => {
          console.warn('Bot controls ack failed', error);
        });
      }
    } catch (error) {
      console.warn('Bot controls poll failed', error);
    }
  }, [controlHeaders]);

  useEffect(() => {
    void pollLiveDirectives();
    void pollBotControls();
    directivePollRef.current = setInterval(() => {
      void pollLiveDirectives();
      void pollBotControls();
    }, DIRECTIVE_POLL_MS);
    return () => {
      if (directivePollRef.current) {
        clearInterval(directivePollRef.current);
        directivePollRef.current = null;
      }
    };
  }, [pollBotControls, pollLiveDirectives]);

  const enterSilence = useCallback(() => {
    silencedUntilRef.current = Date.now() + SHUT_UP_DURATION_MS;
    silenceModeRef.current = 'voice';
    voiceEnabledRef.current = false;
    setIsVoiceOn(false);
    syncMuteHud();
    window.setTimeout(() => {
      if (silenceModeRef.current !== 'voice') return;
      if (Date.now() < silencedUntilRef.current) return;
      voiceEnabledRef.current = true;
      setIsVoiceOn(true);
      syncMuteHud();
    }, SHUT_UP_DURATION_MS + 250);
  }, [syncMuteHud]);

  const canCelebrate = (kind: 'follow' | 'sub' | 'bits' | 'raid') => {
    const cooldown = kind === 'follow'
      ? FOLLOW_CELEBRATION_COOLDOWN_MS
      : kind === 'raid'
        ? 15_000
        : CELEBRATION_COOLDOWN_MS;
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

  const moderateOffensiveChatter = useCallback((
    username: string,
    displayName?: string,
    userId?: string,
  ) => {
    const login = username.trim();
    const display = displayName?.trim();
    const offensive = isOffensiveUsername(login) || Boolean(display && isOffensiveUsername(display));
    if (!offensive) return false;

    const key = login.toLowerCase();
    if (!offensiveBanAttemptedRef.current.has(key)) {
      offensiveBanAttemptedRef.current.add(key);
      void fetch('/api/twitch/ban', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          login: key,
          userId: userId?.trim() || undefined,
          reason: 'Auto-ban: offensive username',
        }),
      }).then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          console.warn('Auto-ban failed', key, data.error || res.status);
        } else {
          console.info('Auto-banned', key);
        }
      }).catch((error) => {
        console.warn('Auto-ban request failed', error);
      });
    }
    return true;
  }, [controlHeaders]);

  const tryGreetChatter = useCallback((username: string, normalizedUser: string, normalizedChannel: string) => {
    if (moderateOffensiveChatter(username)) return;
    if (!streamLiveRef.current || isFullyMuted() || isSilenced()) return;
    if (Date.now() < joinGreetWarmupUntilRef.current) return;
    if (shouldSkipJoinGreet(normalizedUser, normalizedChannel)) return;
    if (greetedThisSessionRef.current.has(normalizedUser)) return;

    greetedThisSessionRef.current.add(normalizedUser);
    if (streamStartedAtRef.current) {
      persistStreamSession();
    }
    void queueBongLogic(buildJoinGreetingPrompt(username), username, { chatOnly: true });
  }, [buildJoinGreetingPrompt, moderateOffensiveChatter, persistStreamSession, queueBongLogic, shouldSkipJoinGreet]);

  const celebrate = useCallback((
    kind: 'follow' | 'sub' | 'bits' | 'raid',
    username: string,
    extra = '',
    bitsAmount?: number,
    memoryEvent?: Record<string, unknown>,
  ) => {
    if (!streamLiveRef.current || isFullyMuted() || !canCelebrate(kind)) return;
    if (kind === 'follow' && moderateOffensiveChatter(
      username,
      username,
      typeof memoryEvent?.user_id === 'string' ? memoryEvent.user_id : undefined,
    )) return;
    const dedupeKey = kind === 'bits'
      ? `bits:${username.toLowerCase()}:${bitsAmount ?? 0}`
      : `${kind}:${username.toLowerCase()}`;
    if (shouldSkipDuplicateCelebration(dedupeKey, kind === 'raid' ? 60_000 : 30_000)) return;

    lastCelebrationRef.current = Date.now();
    if (kind === 'follow') {
      rememberUser(username, username, {
        type: 'follow',
        followedAt: typeof memoryEvent?.followed_at === 'string' ? memoryEvent.followed_at : undefined,
      }, controlHeaders());
    }
    if (kind === 'sub') {
      const payload = memoryEvent ?? {};
      const tenure = subTenureFromEventPayload(payload as Record<string, unknown>);
      rememberUser(username, username, {
        type: 'sub',
        tier: typeof payload.tier === 'string' ? payload.tier : undefined,
        months: tenure.cumulativeMonths ?? undefined,
        streakMonths: tenure.streakMonths ?? undefined,
        isGift: payload.is_gift === true,
      }, controlHeaders());
    }
    if (kind === 'bits') rememberUser(username, username, { type: 'bits', amount: bitsAmount }, controlHeaders());

    const sfxId = kind === 'sub' || kind === 'raid'
      ? 'sub_fanfare'
      : kind === 'bits'
        ? 'bits_kaching'
        : 'follow_ding';
    void playElroySfx(sfxId);
    const prompt =
      kind === 'follow' ? buildFollowPrompt(username)
      : kind === 'sub' ? buildSubPrompt(username, extra)
      : kind === 'raid' ? buildRaidPrompt(username, Number(extra) || 0)
      : buildBitsPrompt(username, extra);
    void queueBongLogic(prompt, username, {
      forceVoice: true,
      voicePriority: kind === 'follow' ? 'normal' : 'celebration',
    });
  }, [buildBitsPrompt, buildFollowPrompt, buildRaidPrompt, buildSubPrompt, controlHeaders, moderateOffensiveChatter, playElroySfx, queueBongLogic, shouldSkipDuplicateCelebration]);

  const handleRaid = useCallback(async (login: string, viewers: number) => {
    if (!login.trim()) return;
    if (shouldSkipDuplicateCelebration(`raid:${login.toLowerCase()}`, 60_000)) return;
    try {
      await fetch('/api/twitch/shoutout', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ login }),
      });
    } catch (error) {
      console.warn('Raid shoutout failed', error);
    }
    celebrate('raid', login, String(viewers));
  }, [celebrate, controlHeaders, shouldSkipDuplicateCelebration]);

  const pollNewFollowers = useCallback(async () => {
    try {
      const res = await fetch('/api/twitch/followers', {
        headers: controlHeaders(),
      });
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
        celebrate('follow', follower.user_login, '', undefined, { followed_at: follower.followed_at });
      }
    } catch (e) {
      console.warn('Follower poll failed', e);
    }
  }, [celebrate, controlHeaders]);

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

  const pollChannelEvents = useCallback(async () => {
    try {
      const res = await fetch(`/api/twitch/events?since=${lastChannelEventPollRef.current}`, {
        headers: controlHeaders(),
        cache: 'no-store',
      });
      const data = await res.json() as {
        events?: Array<{ id: string; type: string; payload: Record<string, unknown> }>;
        serverTime?: number;
      };
      if (!res.ok || !Array.isArray(data.events)) return;

      for (const event of data.events) {
        if (processedChannelEventIdsRef.current.has(event.id)) continue;
        processedChannelEventIdsRef.current.add(event.id);
        const payload = event.payload ?? {};

        if (event.type === 'raid') {
          const login = String(payload.login ?? '');
          const viewers = Number(payload.viewers ?? 0);
          void handleRaid(login, viewers);
        } else if (event.type === 'follow') {
          const login = String(payload.user_login ?? '');
          const userId = String(payload.user_id ?? '');
          if (userId) knownFollowerIdsRef.current.add(userId);
          celebrate('follow', login, '', undefined, payload);
        } else if (event.type === 'subscribe') {
          const login = String(payload.user_login ?? '');
          const tenure = subTenureFromEventPayload(payload);
          const detail = formatSubCelebrationDetail({
            cumulativeMonths: tenure.cumulativeMonths ?? 1,
            streakMonths: tenure.streakMonths,
            tier: String(payload.tier ?? '1000'),
            isGift: payload.is_gift === true,
            kind: (tenure.cumulativeMonths ?? 1) <= 1 ? 'new' : 'resub',
          });
          celebrate('sub', login, detail, undefined, payload);
        } else if (event.type === 'subscription_gift') {
          const login = String(payload.user_login ?? '');
          const total = Number(payload.total ?? 1);
          celebrate('sub', login, formatSubCelebrationDetail({
            kind: 'mystery_gift',
            giftCount: total,
            tier: String(payload.tier ?? '1000'),
          }), undefined, payload);
        } else if (event.type === 'subscription_message') {
          const login = String(payload.user_login ?? '');
          const tenure = subTenureFromEventPayload(payload);
          const text = String(payload.text ?? '').trim();
          const detail = formatSubCelebrationDetail({
            cumulativeMonths: tenure.cumulativeMonths,
            streakMonths: tenure.streakMonths,
            tier: String(payload.tier ?? '1000'),
            message: text,
            kind: 'resub',
          });
          celebrate('sub', login, detail, undefined, payload);
        } else if (event.type === 'cheer') {
          const login = String(payload.user_login ?? '');
          const bits = Number(payload.bits ?? 0);
          const message = String(payload.message ?? '').trim();
          const detail = message
            ? `${bits} bits: "${message}"`
            : `${bits} bits`;
          celebrate('bits', login, detail, bits);
        } else if (event.type === 'channel_update') {
          const nextTitle = String(payload.title ?? '');
          const nextGame = String(payload.game_name ?? '');
          const titleChanged = nextTitle && nextTitle !== streamTitleRef.current;
          const gameChanged = nextGame && nextGame !== streamGameRef.current;
          streamTitleRef.current = nextTitle || streamTitleRef.current;
          streamGameRef.current = nextGame || streamGameRef.current;
          if ((titleChanged || gameChanged) && streamLiveRef.current) {
            void postTwitchAnnounce(
              titleChanged && gameChanged
                ? `📺 Now streaming: "${nextTitle}" — playing ${nextGame}`
                : titleChanged
                  ? `📺 New title: "${nextTitle}"`
                  : `🎮 Now playing: ${nextGame}`,
              'blue',
            );
          }
        } else if (event.type === 'poll_end') {
          const title = String(payload.title ?? 'Poll');
          const winner = String(payload.winner ?? 'Nobody');
          void postTwitchAnnounce(`📊 Poll "${title}" ended — winner: ${winner}`, 'purple');
        }
      }

      if (typeof data.serverTime === 'number') {
        lastChannelEventPollRef.current = data.serverTime;
      } else {
        lastChannelEventPollRef.current = Date.now();
      }
    } catch (error) {
      console.warn('Channel events poll failed', error);
    }
  }, [celebrate, controlHeaders, handleRaid, postTwitchAnnounce]);

  const startChannelEventPolling = useCallback(() => {
    if (channelEventsPollRef.current) return;
    lastChannelEventPollRef.current = Date.now() - 120_000;
    void pollChannelEvents();
    channelEventsPollRef.current = setInterval(() => {
      void pollChannelEvents();
    }, CHANNEL_EVENTS_POLL_MS);
  }, [pollChannelEvents]);

  const stopChannelEventPolling = useCallback(() => {
    if (channelEventsPollRef.current) {
      clearInterval(channelEventsPollRef.current);
      channelEventsPollRef.current = null;
    }
    processedChannelEventIdsRef.current.clear();
  }, []);

  const onStreamStarted = useCallback((viewerCount: number | null) => {
    const resumed = Boolean(streamStartedAtRef.current);
    if (!resumed) {
      streamStartedAtRef.current = Date.now();
      sessionChatRef.current = [];
      greetedThisSessionRef.current.clear();
      lastCommandHelpAtRef.current = Date.now();
      commandHelpIndexRef.current = 0;
      activeTriviaRef.current = null;
      recentTriviaHistoryRef.current = [];
      void playElroySfx('go_live');
      void queueBongLogic(buildStreamGreetingPrompt(viewerCount, randomCannabisFact()), undefined, {
        forceVoice: true,
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
      }))
      .then(() => processBongLogic(summaryPrompt, undefined, {
        chatOnly: true,
        skipDing: true,
      }))
      .then(() => { clearStreamSession(); })
      .catch((e) => { console.error(e); });
  }, [buildStreamGoodbyePrompt, buildStreamSummaryPrompt, clearStreamSession, processBongLogic]);

  const pollStreamLive = useCallback(async () => {
    const wasLive = streamLiveRef.current;
    const { isLive, viewerCount, title, gameName } = await fetchStreamStatus();
    streamLiveRef.current = isLive;
    const metaBits = [
      isLive && viewerCount != null ? `LIVE (~${viewerCount})` : isLive ? 'LIVE' : 'offline — voice waits for LIVE',
      title ? `"${title}"` : '',
      gameName || '',
    ].filter(Boolean);
    setRuntimeHud((prev) => ({
      ...prev,
      stream: metaBits.join(' · '),
    }));

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
    void postTwitchAnnounce(
      `⏰ Trivia time's up! Nobody got it — the answer was ${active.displayAnswer}.`,
      'purple',
    );
  }, [postTwitchAnnounce]);

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
    const countdownPrefix = `⏳ ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'} left! `;
    const hint = buildTriviaProgressHint(
      active.answers,
      minuteBucket,
      {
        displayAnswer: active.displayAnswer,
        maxLength: 500 - countdownPrefix.length,
      },
    );
    void postTwitchAnnounce(
      `⏳ ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'} left! ${hint}`,
      'primary',
    );
  }, [postTwitchAnnounce]);

  const askCannabisTrivia = useCallback(async (options?: {
    category?: TriviaCategory;
    requestedBy?: string;
  }) => {
    if (isFullyMuted() || !streamLiveRef.current) return;
    if (activeTriviaRef.current && !activeTriviaRef.current.answered) return;
    if (triviaAskInFlightRef.current) return;

    triviaAskInFlightRef.current = true;
    lastTriviaAtRef.current = Date.now();

    try {
      const roll = Math.random();
      const category: TriviaCategory = options?.category
        ?? (roll < 0.4 ? 'music90s' : roll < 0.8 ? 'cannabis' : 'freaky');
      let picked: ElroyTriviaQuestion | null = null;

      const categoryHistory = recentTriviaHistoryRef.current.filter((entry) => entry.category === category);

      try {
        const generateRes = await fetch('/api/trivia/generate', {
          method: 'POST',
          headers: controlHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            category,
            recentQuestions: categoryHistory.map((entry) => entry.question),
            recentIds: categoryHistory.map((entry) => entry.id),
          }),
        });
        if (generateRes.ok) {
          const data = await generateRes.json();
          if (data.question?.question && Array.isArray(data.question.answers)) {
            picked = alignTriviaQuestionCategory(data.question as ElroyTriviaQuestion);
          }
        } else {
          console.warn('Trivia generation unavailable', generateRes.status);
        }
      } catch (error) {
        console.warn('Trivia pick failed', error);
      }

      if (!picked) {
        void sayChat(
          options?.requestedBy
            ? `@${options.requestedBy} trivia deck is tapped out — every question was asked recently. Try again in a bit.`
            : '🌿 Trivia round skipped — every curated question in the deck was asked recently.',
        );
        return;
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
        points: Math.max(1, Number(picked.points) || 1),
        askedAt: Date.now(),
        answered: false,
        lastCountdownMinute: 0,
      };

      const roundPoints = Math.max(1, Number(picked.points) || 1);
      const requestNote = options?.requestedBy ? ` (requested by @${options.requestedBy})` : '';
      void postTwitchAnnounce(
        `${triviaIntroFor(picked.category)} ${picked.question} — first correct answer gets ${roundPoints} point${roundPoints === 1 ? '' : 's'}!${requestNote}`,
        'orange',
      );
    } finally {
      triviaAskInFlightRef.current = false;
    }
  }, [controlHeaders, persistStreamSession, postTwitchAnnounce]);

  const runTriviaCycle = useCallback(() => {
    if (!streamLiveRef.current || isFullyMuted()) return;
    announceTriviaCountdown();
    expireTriviaIfNeeded();
  }, [announceTriviaCountdown, expireTriviaIfNeeded]);

  const parseTriviaCategoryRequest = useCallback((raw: string): TriviaCategory | undefined => {
    const token = raw.replace(/^!trivia\b/i, '').trim().toLowerCase();
    if (!token) return undefined;
    if (token === 'cannabis' || token === 'weed' || token === '420') return 'cannabis';
    if (token === 'freaky') return 'freaky';
    if (token === 'music' || token === 'music90s' || token === '90s') return 'music90s';
    return undefined;
  }, []);

  const handleTriviaRequest = useCallback((username: string, rawMessage: string) => {
    if (isFullyMuted()) return;
    if (!streamLiveRef.current) {
      void sayChat(`@${username} trivia only runs while we're live — type !trivia when we're on air.`);
      return;
    }
    if (activeTriviaRef.current && !activeTriviaRef.current.answered) {
      void sayChat(`@${username} trivia's already live — jump in!`);
      return;
    }
    const category = parseTriviaCategoryRequest(rawMessage);
    const token = rawMessage.replace(/^!trivia\b/i, '').trim().toLowerCase();
    if (token && !category) {
      void sayChat(`@${username} use !trivia or !trivia cannabis / freaky / music90s`);
      return;
    }
    void askCannabisTrivia({ category, requestedBy: username });
  }, [askCannabisTrivia, parseTriviaCategoryRequest, sayChat]);

  const announceStreamMetadata = useCallback(async (username?: string) => {
    try {
      const res = await fetch('/api/twitch/channel', { headers: controlHeaders() });
      const data = await res.json() as { title?: string; game_name?: string };
      if (!res.ok) throw new Error('metadata unavailable');
      streamTitleRef.current = data.title ?? streamTitleRef.current;
      streamGameRef.current = data.game_name ?? streamGameRef.current;
      const title = data.title?.trim() || 'Untitled stream';
      const game = data.game_name?.trim() || 'something mysterious';
      const line = username
        ? `@${username} we're on "${title}" playing ${game}.`
        : `Currently on "${title}" playing ${game}.`;
      await postTwitchAnnounce(line, 'blue');
    } catch (error) {
      console.warn('Stream metadata announce failed', error);
      const fallback = streamMetadataLine();
      if (fallback) {
        await sayChat(username ? `@${username} ${fallback}` : fallback);
      } else if (username) {
        await sayChat(`@${username} stream metadata unavailable right now.`);
      }
    }
  }, [controlHeaders, postTwitchAnnounce, sayChat, streamMetadataLine]);

  const handleClipCommand = useCallback(async (username: string) => {
    try {
      const res = await fetch('/api/twitch/clip', {
        method: 'POST',
        headers: controlHeaders(),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || 'Clip failed');
      await postTwitchAnnounce(`🎬 Clip that! ${data.url}`, 'green');
    } catch (error) {
      console.warn('Clip command failed', error);
      await sayChat(`@${username} clip failed — make sure we're live and Elroy has clips:edit.`);
    }
  }, [controlHeaders, postTwitchAnnounce, sayChat]);

  const handlePollCommand = useCallback(async (username: string, raw: string, isMod: boolean) => {
    if (!isMod) {
      await sayChat(`@${username} mods only — !poll Question? | Option A | Option B`);
      return;
    }
    const body = raw.replace(/^!poll\s+/i, '').trim();
    const parts = body.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) {
      await sayChat(`@${username} use !poll Question? | Option A | Option B [| Option C]`);
      return;
    }
    const [title, ...choices] = parts;
    try {
      const res = await fetch('/api/twitch/poll', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title, choices, duration: 90 }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Poll failed');
      await postTwitchAnnounce(`📊 Poll live: ${title}`, 'purple');
    } catch (error) {
      console.warn('Poll command failed', error);
      await sayChat(`@${username} poll failed — need channel:manage:polls on the bot token.`);
    }
  }, [controlHeaders, postTwitchAnnounce, sayChat]);

  const commentOnSpotifyTrack = useCallback((
    track: SpotifyTrackSnapshot,
    requestedBy?: string,
  ) => {
    if (!streamLiveRef.current || isFullyMuted()) return;

    lastSpotifyTrackIdRef.current = track.id;
    void queueBongLogic(buildSpotifyTrackPrompt(track), requestedBy, { chatOnly: true });
  }, [queueBongLogic]);

  const pollSpotifyNowPlaying = useCallback(async () => {
    if (!streamLiveRef.current || isFullyMuted()) return;

    try {
      const res = await fetch(`/api/spotify/now-playing?t=${Date.now()}`, {
        cache: 'no-store',
        headers: controlHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json() as {
        connected?: boolean;
        playing?: boolean;
        track?: SpotifyTrackSnapshot | null;
      };
      if (!data.connected || !data.playing || !data.track) return;
      if (data.track.id === lastSpotifyTrackIdRef.current) return;
      commentOnSpotifyTrack(data.track);
    } catch (error) {
      console.warn('Spotify poll failed', error);
    }
  }, [commentOnSpotifyTrack, controlHeaders]);

  const requestSpotifyComment = useCallback(async (username: string) => {
    if (isFullyMuted()) return;

    try {
      const res = await fetch(`/api/spotify/now-playing?t=${Date.now()}`, {
        cache: 'no-store',
        headers: controlHeaders(),
      });
      const data = await res.json() as {
        connected?: boolean;
        playing?: boolean;
        track?: SpotifyTrackSnapshot | null;
        error?: string;
      };

      if (!data.connected) {
        void sayChat(`@${username} Spotify ain't linked — broadcaster connects it from /control.`);
        return;
      }
      if (!data.track || !data.playing) {
        void sayChat(`@${username} Nothing playing on Spotify right now.`);
        return;
      }

      commentOnSpotifyTrack(data.track, username);
    } catch {
      void sayChat(`@${username} Couldn't read Spotify — try again in a sec.`);
    }
  }, [commentOnSpotifyTrack, controlHeaders, sayChat]);

  const awardTriviaWinner = useCallback(async (username: string) => {
    const active = activeTriviaRef.current;
    if (!active || active.answered) return;

    active.answered = true;
    lastTriviaAtRef.current = Date.now();

    let totalWins = 1;
    const awardedPoints = Math.max(1, active.points || 1);
    try {
      const winRes = await fetch('/api/trivia/win', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ username, category: active.category, points: awardedPoints }),
      });
      if (winRes.ok) {
        const data = await winRes.json();
        if (typeof data.score === 'number' && data.score > 0) totalWins = data.score;
      }
    } catch (error) {
      console.warn('Trivia score update failed', error);
    }

    void playElroySfx('sub_fanfare');
    void sayChat(
      `🎉 @${username} got it FIRST! Correct — ${active.displayAnswer}. (+${awardedPoints} point${awardedPoints === 1 ? '' : 's'} • ${totalWins} total)`,
    );
    void queueBongLogic(
      `${username} just won trivia with the first correct answer. Hype them up in 1-2 OG sentences — make them feel legendary.`,
      username,
      {
        chatOnly: true,
        skipDing: true,
      },
    );
    rememberUser(username, username, {
      type: 'trivia_win',
      category: active.category,
      totalWins,
    }, controlHeaders());
  }, [controlHeaders, playElroySfx, queueBongLogic, sayChat]);

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

    rememberUser(username, displayName, { type: 'mention', message }, controlHeaders());

    void playElroySfx('roast_sting');
    void queueBongLogic(
      buildTriviaCheatRoastPrompt(username, message, active.question, cheatKind),
      username,
      { chatOnly: true },
    );
    return true;
  }, [buildTriviaCheatRoastPrompt, controlHeaders, playElroySfx, queueBongLogic]);

  const runStreamCheckin = useCallback(async () => {
    if (isSilenced() || !streamLiveRef.current) return;
    const { streamStatus, viewerCount } = await fetchStreamStatus();
    void queueBongLogic(buildStreamCheckinPrompt(viewerCount, streamStatus), undefined, {
      chatOnly: !ambientVoiceAllowedRef.current,
    });
  }, [buildStreamCheckinPrompt, fetchStreamStatus, queueBongLogic]);

  const sayBlackjackLines = useCallback((lines: string[]) => {
    for (const line of lines) {
      if (line?.trim()) void sayChat(line);
    }
  }, [sayChat]);

  const blackjackPendingDareRef = useRef<Set<string>>(new Set());

  const postBlackjackAction = useCallback(async (payload: {
    action: string;
    username: string;
    displayName?: string;
    amount?: number;
    betInput?: string;
    message?: string;
    isMod?: boolean;
  }) => {
    try {
      const res = await fetch('/api/blackjack/action', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
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
  }, [controlHeaders, sayBlackjackLines]);

  const tryCompleteDareRitual = useCallback((
    username: string,
    displayName: string,
    message: string,
  ) => {
    if (!streamLiveRef.current || isFullyMuted()) return;
    const login = username.toLowerCase();
    if (!blackjackPendingDareRef.current.has(login)) return;
    void postBlackjackAction({
      action: 'dareComplete',
      username,
      displayName,
      message,
    }).then((data) => {
      if (data?.ok || data?.error === 'no pending dare') {
        blackjackPendingDareRef.current.delete(login);
      }
    });
  }, [postBlackjackAction]);

  const tickBlackjackTable = useCallback(() => {
    if (!streamLiveRef.current || isFullyMuted()) return;
    void postBlackjackAction({ action: 'tick', username: 'elroy', displayName: 'Elroy' });
  }, [postBlackjackAction]);

  const postRouletteAction = useCallback(async (payload: {
    action: string;
    username: string;
    displayName?: string;
    betInput?: string;
    choice?: string;
    isMod?: boolean;
  }) => {
    try {
      const res = await fetch('/api/roulette/action', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (Array.isArray(data.messages) && data.messages.length) {
        sayBlackjackLines(data.messages);
      }
      return data;
    } catch (error) {
      console.warn('Roulette action failed', error);
      return null;
    }
  }, [controlHeaders, sayBlackjackLines]);

  const tickRouletteTable = useCallback(() => {
    if (!streamLiveRef.current || isFullyMuted()) return;
    void postRouletteAction({ action: 'tick', username: 'elroy', displayName: 'Elroy' });
  }, [postRouletteAction]);

  const postPickAction = useCallback(async (payload: {
    action: string;
    game: 'pick3' | 'pick4';
    username: string;
    displayName?: string;
    betType?: string;
    digits?: string;
    betInput?: string;
    isMod?: boolean;
  }) => {
    try {
      const res = await fetch('/api/pick-numbers/action', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (Array.isArray(data.messages) && data.messages.length) {
        sayBlackjackLines(data.messages);
      }
      return data;
    } catch (error) {
      console.warn('Pick numbers action failed', error);
      return null;
    }
  }, [controlHeaders, sayBlackjackLines]);

  const tickPickGames = useCallback(() => {
    if (!streamLiveRef.current || isFullyMuted()) return;
    void postPickAction({ action: 'tick', game: 'pick3', username: 'elroy', displayName: 'Elroy' });
    void postPickAction({ action: 'tick', game: 'pick4', username: 'elroy', displayName: 'Elroy' });
  }, [postPickAction]);

  const announceCommandHelp = useCallback(() => {
    if (!streamLiveRef.current || isFullyMuted()) return;
    const url = commandsPageUrlRef.current || buildCommandsPageUrl(
      typeof window !== 'undefined' ? window.location.origin : undefined,
    );
    const message = buildPeriodicCommandHelpMessage(url, commandHelpIndexRef.current);
    commandHelpIndexRef.current += 1;
    void sayChat(message);
  }, [sayChat]);

  const announceCommandsLink = useCallback((username: string) => {
    if (isFullyMuted()) return;
    const url = commandsPageUrlRef.current || buildCommandsPageUrl(
      typeof window !== 'undefined' ? window.location.origin : undefined,
    );
    void sayChat(buildCommandsChatReply(username, url));
  }, [sayChat]);

  const maybeAnnounceCommandHelp = useCallback(() => {
    if (!streamLiveRef.current || isFullyMuted()) return;
    if (Date.now() - lastCommandHelpAtRef.current < COMMAND_HELP_INTERVAL_MS) return;
    lastCommandHelpAtRef.current = Date.now();
    announceCommandHelp();
  }, [announceCommandHelp]);

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
      void sayChat(`@${username} trivia's live — wait for the next round to open blackjack.`);
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
    if (cmd === 'dare') {
      void postBlackjackAction({ action: 'dare', username, displayName }).then((data) => {
        if (data?.ok) blackjackPendingDareRef.current.add(login);
      });
      return;
    }
    if (cmd === 'loan') {
      void postBlackjackAction({ action: 'loan', username, displayName });
      return;
    }
    if (cmd === 'debt') {
      void postBlackjackAction({ action: 'debt', username, displayName });
      return;
    }
    if (cmd === 'bjtop' || cmd === 'bjlb') {
      void postBlackjackAction({ action: 'leaders', username, displayName });
      return;
    }
    if (cmd === 'bjstop' && isMod) {
      void postBlackjackAction({ action: 'stop', username, displayName, isMod: true });
    }
  }, [postBlackjackAction, sayChat]);

  const handleRouletteCommand = useCallback((
    cmd: string,
    username: string,
    displayName: string,
    isMod: boolean,
    rawMessage: string,
  ) => {
    if (!streamLiveRef.current || isFullyMuted()) return;

    if (cmd === 'roulette' || cmd === 'spin') {
      void postRouletteAction({ action: 'open', username, displayName });
      return;
    }
    if (cmd === 'rtable' || cmd === 'rstatus') {
      void postRouletteAction({ action: 'status', username, displayName });
      return;
    }
    if (cmd === 'rstop' && isMod) {
      void postRouletteAction({ action: 'stop', username, displayName, isMod: true });
      return;
    }
    if (cmd === 'rbet') {
      const match = rawMessage.trim().match(/^!rbet\s+(\S+)\s+(\S+)$/i);
      if (!match) {
        void sayChat(`@${username} use !rbet red/black/odd/even/0-36 <amount>`);
        return;
      }
      void postRouletteAction({
        action: 'bet',
        username,
        displayName,
        choice: match[1],
        betInput: match[2],
      });
    }
  }, [postRouletteAction, sayChat]);

  const handlePickCommand = useCallback((
    game: 'pick3' | 'pick4',
    cmd: string,
    username: string,
    displayName: string,
    isMod: boolean,
    rawMessage: string,
  ) => {
    if (!streamLiveRef.current || isFullyMuted()) return;

    const openCmd = game === 'pick3' ? 'pick3' : 'pick4';
    const betPrefix = game === 'pick3' ? '!p3bet' : '!p4bet';

    if (cmd === openCmd || cmd === (game === 'pick3' ? 'p3' : 'p4')) {
      void postPickAction({ action: 'open', game, username, displayName });
      return;
    }
    if (cmd === `${game}table` || cmd === (game === 'pick3' ? 'p3table' : 'p4table')) {
      void postPickAction({ action: 'status', game, username, displayName });
      return;
    }
    if (cmd === `${game}stop` || cmd === (game === 'pick3' ? 'p3stop' : 'p4stop')) {
      if (!isMod) return;
      void postPickAction({ action: 'stop', game, username, displayName, isMod: true });
      return;
    }
    if (cmd === (game === 'pick3' ? 'p3bet' : 'p4bet')) {
      const match = rawMessage.trim().match(new RegExp(`^${betPrefix}\\s+(\\S+)\\s+(\\d+)\\s+(\\S+)$`, 'i'));
      if (!match) {
        const pairHint = game === 'pick4' ? '/mid' : '';
        void sayChat(`@${username} use ${betPrefix} straight/box/combo/front${pairHint}/back <num> <amt>`);
        return;
      }
      void postPickAction({
        action: 'bet',
        game,
        username,
        displayName,
        betType: match[1],
        digits: match[2],
        betInput: match[3],
      });
    }
  }, [postPickAction, sayChat]);

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
        maybeAnnounceCommandHelp();
      }, TRIVIA_CHECK_MS);
    }
    if (!blackjackPollRef.current) {
      blackjackPollRef.current = setInterval(() => {
        tickBlackjackTable();
      }, BLACKJACK_TICK_MS);
    }
    if (!roulettePollRef.current) {
      roulettePollRef.current = setInterval(() => {
        tickRouletteTable();
      }, ROULETTE_TICK_MS);
    }
    if (!pickPollRef.current) {
      pickPollRef.current = setInterval(() => {
        tickPickGames();
      }, PICK_TICK_MS);
    }
    if (!spotifyPollRef.current) {
      void pollSpotifyNowPlaying();
      spotifyPollRef.current = setInterval(() => {
        void pollSpotifyNowPlaying();
      }, SPOTIFY_POLL_MS);
    }
  }, [maybeAnnounceCommandHelp, pollStreamLive, pollSpotifyNowPlaying, runStreamCheckin, runTriviaCycle, tickBlackjackTable, tickPickGames, tickRouletteTable]);

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
    if (roulettePollRef.current) {
      clearInterval(roulettePollRef.current);
      roulettePollRef.current = null;
    }
    if (pickPollRef.current) {
      clearInterval(pickPollRef.current);
      pickPollRef.current = null;
    }
    if (spotifyPollRef.current) {
      clearInterval(spotifyPollRef.current);
      spotifyPollRef.current = null;
    }
    lastSpotifyTrackIdRef.current = null;
    activeTriviaRef.current = null;
    triviaAskInFlightRef.current = false;
    streamLiveRef.current = false;
  }, []);

  const handleElroyMention = useCallback((username: string, displayName: string, message: string) => {
    if (isFullyMuted()) return;
    const normalizedUser = username.toLowerCase();
    if (moderateOffensiveChatter(username, displayName, undefined)) return;
    if (isKnownElroySpeakerLogin(normalizedUser) || isElroySystemBroadcast(message)) return;
    rememberUser(username, displayName, { type: 'mention', message }, controlHeaders());

    const lower = message.toLowerCase();
    const looksLikeSongQuestion = /\b(now\s+playing|what('?s)?\s+playing|playing\s+now|song\s+playing|what\s+song|what\s+track|current\s+song|current\s+track|what\s+music|what\s+music\s+is)\b/.test(lower);
    const looksLikeStreamQuestion = /\b(what('?s)?\s+(the\s+)?(title|stream|game|category)|what\s+are\s+we\s+playing|what\s+game|what\s+category)\b/.test(lower);
    if (!isSilenced() && looksLikeStreamQuestion) {
      void announceStreamMetadata(username);
      return;
    }
    if (!isSilenced() && looksLikeSongQuestion) {
      void requestSpotifyComment(username);
      return;
    }

    if (isSilenced()) {
      if (!streamLiveRef.current || Math.random() >= COMEBACK_CHANCE) return;
      void queueBongLogic(buildComebackPrompt(username, message), username, { chatOnly: true });
      return;
    }
    void queueBongLogic(buildMentionPrompt(username, message), username);
  }, [announceStreamMetadata, buildComebackPrompt, buildMentionPrompt, controlHeaders, isElroySystemBroadcast, isKnownElroySpeakerLogin, moderateOffensiveChatter, queueBongLogic, requestSpotifyComment]);

  const handleLRoyMisname = useCallback((username: string, displayName: string, message: string) => {
    if (isFullyMuted()) return;
    if (moderateOffensiveChatter(username, displayName, undefined)) return;
    if (isKnownElroySpeakerLogin(username.toLowerCase()) || isElroySystemBroadcast(message)) return;
    rememberUser(username, displayName, { type: 'mention', message }, controlHeaders());
    if (isSilenced()) {
      if (!streamLiveRef.current || Math.random() >= COMEBACK_CHANCE) return;
      void queueBongLogic(buildLRoyRoastPrompt(username, message), username, { chatOnly: true });
      return;
    }
    void playElroySfx('roast_sting');
    void queueBongLogic(buildLRoyRoastPrompt(username, message), username);
  }, [buildLRoyRoastPrompt, controlHeaders, isElroySystemBroadcast, isKnownElroySpeakerLogin, moderateOffensiveChatter, playElroySfx, queueBongLogic]);

  const toggleDing = useCallback((user?: string) => {
    const nextState = !dingEnabledRef.current;
    dingEnabledRef.current = nextState;
    setIsDingOn(nextState);
    void fetch('/api/bot/controls', {
      method: 'POST',
      headers: controlHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ settings: { dingEnabled: nextState } }),
    }).catch((error) => {
      console.warn('Bot controls sync failed', error);
    });
    void sayChat(user ? `@${user} ding ${nextState ? 'on' : 'off'}.` : `ding ${nextState ? 'on' : 'off'}.`);
  }, [controlHeaders, sayChat]);

  const toggleVoice = useCallback((user?: string) => {
    const nextState = !voiceEnabledRef.current;
    voiceEnabledRef.current = nextState;
    setIsVoiceOn(nextState);
    void fetch('/api/bot/controls', {
      method: 'POST',
      headers: controlHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ settings: { voiceEnabled: nextState } }),
    }).catch((error) => {
      console.warn('Bot controls sync failed', error);
    });
    void sayChat(user ? `@${user} voice ${nextState ? 'on' : 'off'}.` : `voice ${nextState ? 'on' : 'off'}.`);
  }, [controlHeaders, sayChat]);

  const setVolume = useCallback((level: number, user?: string) => {
    const clamped = Math.min(1, Math.max(0, level));
    volumeRef.current = clamped;
    void fetch('/api/bot/controls', {
      method: 'POST',
      headers: controlHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ settings: { volume: clamped } }),
    }).catch((error) => {
      console.warn('Bot controls sync failed', error);
    });
    const pct = Math.round(clamped * 100);
    void sayChat(user ? `@${user} volume ${pct}%.` : `volume ${pct}%.`);
  }, [controlHeaders, sayChat]);

  const announceAboutMe = useCallback(async (username: string) => {
    try {
      const res = await fetch(`/api/users/aboutme?username=${encodeURIComponent(username)}`, {
        headers: controlHeaders(),
      });
      if (!res.ok) throw new Error('aboutme lookup failed');
      const data = await res.json();
      const text = typeof data.text === 'string' && data.text.trim()
        ? data.text.trim()
        : `Still getting to know you — mention me or win trivia so I can build your file.`;
      void sayChat(`@${username} ${text}`);
    } catch (error) {
      console.warn('!aboutme failed', error);
      void sayChat(`@${username} I cannot pull your file right now — try again in a bit.`);
    }
  }, [controlHeaders, sayChat]);

  const announceTriviaLeaderboard = useCallback(async (user?: string) => {
    try {
      const res = await fetch('/api/trivia/leaders');
      if (!res.ok) throw new Error('leader lookup failed');
      const leaders = await res.json();
      const message = formatTriviaLeaderboardChatMessage(leaders);
      void sayChat(user ? `@${user} ${message}` : message);
    } catch (error) {
      console.warn('Trivia leaderboard command failed', error);
      void sayChat(user ? `@${user} leaderboard unavailable right now.` : 'Leaderboard unavailable right now.');
    }
  }, [sayChat]);

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
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'release', instanceId }),
        keepalive: true,
      });
    } catch (error) {
      console.warn('Bot session release failed', error);
    }
  }, [controlHeaders, stopBotSessionHeartbeat]);

  const claimBotSessionLock = useCallback(async () => {
    const instanceId = getBotInstanceId();
    botInstanceIdRef.current = instanceId;
    try {
      const res = await fetch('/api/bot/session', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'claim', instanceId }),
      });
      if (res.status === 401) {
        setBotBlockReason(
          overlayAuthStatus === 'rejected'
            ? 'Control key rejected — your URL controlKey does not match ELROY_CONTROL_SECRET in Vercel. Fix the env var or URL, redeploy if needed.'
            : 'Overlay not authorized. Add ?controlKey=YOUR_SECRET to the browser source URL — must match ELROY_CONTROL_SECRET in Vercel.',
        );
        return false;
      }
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
  }, [controlHeaders, overlayAuthStatus]);

  const disconnectBotClient = useCallback(async (announceUser?: string) => {
    const client = clientRef.current;
    if (client) {
      try {
        if (announceUser) {
          await sayChat(`@${announceUser} Elroy is off.`);
        }
        await client.disconnect();
      } catch (e) {
        console.warn(e);
      }
      clientRef.current = null;
    }
    stopFollowerPolling();
    stopChannelEventPolling();
    stopPowerupRedemptionPolling();
    stopQuotaPolling();
    stopStreamMonitoring();
    stopMuteCountdown();
    isActiveRef.current = false;
    setIsActive(false);
  }, [sayChat, stopChannelEventPolling, stopFollowerPolling, stopPowerupRedemptionPolling, stopQuotaPolling, stopStreamMonitoring, stopMuteCountdown]);

  const stopBot = useCallback(async (announceUser?: string) => {
    try {
      localStorage.removeItem(AUTO_RESUME_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    await releaseBotSessionLock();
    await disconnectBotClient(announceUser);
  }, [disconnectBotClient, releaseBotSessionLock]);

  useEffect(() => {
    stopBotRef.current = stopBot;
  }, [stopBot]);

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
            headers: controlHeaders({ 'Content-Type': 'application/json' }),
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
  }, [controlHeaders, stopBotForSessionLoss, stopBotSessionHeartbeat]);

  const startBot = async () => {
    if (isActive) return;
    if (!(await claimBotSessionLock())) return;

    const chan = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    const normalizedChannel = chan.toLowerCase().replace(/^#/, '');
    await seedElroySpeakerLogins(normalizedChannel);
    chatMessageCountRef.current = 0;
    setRuntimeHud((prev) => ({ ...prev, irc: 'connecting…' }));
    const client = new tmi.Client({
      connection: { reconnect: true, secure: true },
      channels: [chan],
    });
    client.on('connected', () => {
      setRuntimeHud((prev) => ({ ...prev, irc: 'connected — listening' }));
    });
    client.on('disconnected', (reason: string) => {
      setRuntimeHud((prev) => ({
        ...prev,
        irc: reason ? `disconnected (${reason})` : 'disconnected',
      }));
    });
    client.on('message', (_c: string, t: tmi.ChatUserstate, m: string, s: boolean) => {
      if (s) return;
      const username = t.username || 'viewer';
      const displayName = t['display-name'] || username;
      const normalizedUser = username.toLowerCase();
      const isBroadcaster = normalizedUser === normalizedChannel;

      if (moderateOffensiveChatter(username, displayName, t['user-id'])) return;

      if (isElroyChatSpeaker(t, normalizedUser, normalizedChannel, m)) return;

      if (isShutElroyPowerUpRedemption(m, t)) {
        enterFullMute(username);
        return;
      }

      const isWizebot = normalizedUser === 'wizebot';

      if (!m.startsWith('!')) {
        if (!isWizebot) {
          tryCompleteDareRitual(username, displayName, m);
        }

        if (!isWizebot && tryRoastTriviaCheat(username, displayName, m)) {
          rememberChatLine(username, m);
          return;
        }

        if (!isWizebot && tryHandleTriviaAnswer(username, m)) {
          rememberChatLine(username, m);
          return;
        }

        rememberChatLine(username, m);

        if (!isWizebot) {
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
      if (lowerCmd === '!commands' || lowerCmd === '!cmds' || lowerCmd === '!help') {
        if (isFullyMuted()) return;
        return void announceCommandsLink(username);
      }
      if (lowerCmd === '!trivia' || lowerCmd.startsWith('!trivia ')) {
        if (isFullyMuted()) return;
        return void handleTriviaRequest(username, m);
      }
      if (lowerCmd === '!np' || lowerCmd === '!nowplaying' || lowerCmd === '!song') {
        if (isFullyMuted()) return;
        return void requestSpotifyComment(username);
      }
      if (lowerCmd === '!clip' || lowerCmd === '!clipthat') {
        if (isFullyMuted()) return;
        return void handleClipCommand(username);
      }
      if (lowerCmd.startsWith('!poll')) {
        if (isFullyMuted()) return;
        return void handlePollCommand(username, m, t.mod === true || isBroadcaster);
      }
      if (lowerCmd === '!stream' || lowerCmd === '!title' || lowerCmd === '!game' || lowerCmd === '!category') {
        if (isFullyMuted()) return;
        return void announceStreamMetadata(username);
      }
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
      if (lowerCmd === '!dare') {
        return handleBlackjackCommand('dare', username, displayName, normalizedChannel, false, m);
      }
      if (lowerCmd === '!loan') {
        return handleBlackjackCommand('loan', username, displayName, normalizedChannel, false, m);
      }
      if (lowerCmd === '!debt') {
        return handleBlackjackCommand('debt', username, displayName, normalizedChannel, false, m);
      }
      if (lowerCmd === '!bjtop' || lowerCmd === '!bjlb') {
        return handleBlackjackCommand('bjtop', username, displayName, normalizedChannel, false, m);
      }
      if (lowerCmd === '!bjstop') {
        return handleBlackjackCommand('bjstop', username, displayName, normalizedChannel, t.mod === true || isBroadcaster, m);
      }
      if (lowerCmd === '!roulette' || lowerCmd === '!spin') {
        return handleRouletteCommand('roulette', username, displayName, t.mod === true || isBroadcaster, m);
      }
      if (lowerCmd === '!rtable' || lowerCmd === '!rstatus') {
        return handleRouletteCommand('rtable', username, displayName, t.mod === true || isBroadcaster, m);
      }
      if (lowerCmd === '!rstop') {
        return handleRouletteCommand('rstop', username, displayName, t.mod === true || isBroadcaster, m);
      }
      if (/^!rbet\s+\S+\s+\S+$/i.test(lowerCmd)) {
        return handleRouletteCommand('rbet', username, displayName, t.mod === true || isBroadcaster, m);
      }
      if (lowerCmd === '!pick3' || lowerCmd === '!p3') {
        return handlePickCommand('pick3', 'pick3', username, displayName, t.mod === true || isBroadcaster, m);
      }
      if (lowerCmd === '!p3table' || lowerCmd === '!pick3table') {
        return handlePickCommand('pick3', 'pick3table', username, displayName, t.mod === true || isBroadcaster, m);
      }
      if (lowerCmd === '!p3stop' || lowerCmd === '!pick3stop') {
        return handlePickCommand('pick3', 'pick3stop', username, displayName, t.mod === true || isBroadcaster, m);
      }
      if (/^!p3bet\s+\S+\s+\d+\s+\S+$/i.test(lowerCmd)) {
        return handlePickCommand('pick3', 'p3bet', username, displayName, t.mod === true || isBroadcaster, m);
      }
      if (lowerCmd === '!pick4' || lowerCmd === '!p4') {
        return handlePickCommand('pick4', 'pick4', username, displayName, t.mod === true || isBroadcaster, m);
      }
      if (lowerCmd === '!p4table' || lowerCmd === '!pick4table') {
        return handlePickCommand('pick4', 'pick4table', username, displayName, t.mod === true || isBroadcaster, m);
      }
      if (lowerCmd === '!p4stop' || lowerCmd === '!pick4stop') {
        return handlePickCommand('pick4', 'pick4stop', username, displayName, t.mod === true || isBroadcaster, m);
      }
      if (/^!p4bet\s+\S+\s+\d+\s+\S+$/i.test(lowerCmd)) {
        return handlePickCommand('pick4', 'p4bet', username, displayName, t.mod === true || isBroadcaster, m);
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
        const arg = m.slice('!volume'.length).trim();
        if (!arg) {
          const pct = Math.round(volumeRef.current * 100);
          void sayChat(`@${t.username} volume ${pct}%.`);
          return;
        }
        const deltaMatch = arg.match(/^([+-])(\d+)$/);
        if (deltaMatch) {
          const delta = (deltaMatch[1] === '+' ? 1 : -1) * Number(deltaMatch[2]) / 100;
          return setVolume(volumeRef.current + delta, t.username);
        }
        const parsed = Number(arg.replace(/%$/, ''));
        if (!Number.isFinite(parsed)) {
          void sayChat(`@${t.username} use !volume, !volume 50, or !volume +10 / -10.`);
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

    client.on('subscription', (_channel, username, _method, message, userstate) => {
      const tenure = subTenureFromTmiUserstate(userstate as Record<string, unknown>);
      const detail = formatSubCelebrationDetail({
        cumulativeMonths: tenure.cumulativeMonths ?? 1,
        streakMonths: tenure.streakMonths,
        tier: String(userstate['msg-param-sub-plan'] ?? ''),
        message: message?.trim(),
        kind: 'new',
      });
      celebrate('sub', username, detail, undefined, {
        cumulative_months: tenure.cumulativeMonths ?? 1,
        streak_months: tenure.streakMonths ?? 0,
        tier: userstate['msg-param-sub-plan'],
        is_gift: userstate['msg-param-sub-plan'] === 'Prime',
      });
    });

    client.on('resub', (_channel, username, _streakMonths, message, userstate) => {
      const tenure = subTenureFromTmiUserstate(userstate as Record<string, unknown>);
      const detail = formatSubCelebrationDetail({
        cumulativeMonths: tenure.cumulativeMonths,
        streakMonths: tenure.streakMonths,
        tier: String(userstate['msg-param-sub-plan'] ?? ''),
        message: message?.trim(),
        kind: 'resub',
      });
      celebrate('sub', username, detail, undefined, {
        cumulative_months: tenure.cumulativeMonths ?? 0,
        streak_months: tenure.streakMonths ?? 0,
        tier: userstate['msg-param-sub-plan'],
      });
    });

    client.on('subgift', (_channel, username, _streakMonths, recipient, _methods, userstate) => {
      celebrate('sub', username, formatSubCelebrationDetail({
        kind: 'gift',
        giftRecipient: recipient,
        tier: String(userstate['msg-param-sub-plan'] ?? ''),
      }), undefined, {
        tier: userstate['msg-param-sub-plan'],
        is_gift: true,
      });
    });

    client.on('submysterygift', (_channel: string, username: string, numbOfSubs: number) => {
      celebrate('sub', username, formatSubCelebrationDetail({
        kind: 'mystery_gift',
        giftCount: numbOfSubs,
      }));
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

    client.on('raided', (_channel: string, username: string, viewers: number) => {
      void handleRaid(username, viewers);
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
      const opener = `Elroy initiated. ${randomCannabisFact()}`;
      rememberElroyOutbound(opener);
      const initiated = await sayChat(opener);
      await seedElroySpeakerLogins(normalizedChannel);
      if (!initiated) {
        setRuntimeHud((prev) => ({
          ...prev,
          chat: 'cannot post to Twitch — set TWITCH_BOT_OAUTH_TOKEN in Vercel',
        }));
      }
      restoreStreamSession();
      void ensureEventSubSubscription();
      const foundPowerUp = await resolveShutElroyPowerUpId();
      if (foundPowerUp) {
        startPowerupRedemptionPolling();
      }
      startFollowerPolling();
      startChannelEventPolling();
      startQuotaPolling();
      warmupElroySfx();
      void unlockBrowserAudio();
      void fetch('/api/bot/controls', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          settings: {
            voiceEnabled: voiceEnabledRef.current,
            dingEnabled: dingEnabledRef.current,
            volume: volumeRef.current,
          },
        }),
      }).then(async (res) => {
        if (!res.ok) return;
        const data = await res.json() as { revision?: number };
        lastControlsRevisionRef.current = Number(data.revision) || 0;
      }).catch(() => {});
      void pollBotControls();
      startStreamMonitoring();
      void pollStreamLive();
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
      void fetch('/api/bot/session', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'release', instanceId }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener('pagehide', onLeave);
    return () => window.removeEventListener('pagehide', onLeave);
  }, [controlHeaders]);

  useEffect(() => {
    if (!controlSecretReady) return;

    const shouldAutoStart =
      searchParams.get('autostart') === 'true'
      || (typeof window !== 'undefined' && localStorage.getItem(AUTO_RESUME_STORAGE_KEY) === '1');
    if (!shouldAutoStart) return;

    const needsPostUpdateCheck =
      typeof window !== 'undefined'
      && sessionStorage.getItem(POST_UPDATE_DIAGNOSTICS_KEY) === '1';

    if (needsPostUpdateCheck) {
      sessionStorage.removeItem(POST_UPDATE_DIAGNOSTICS_KEY);
      setPostUpdateCheck(true);
      void runDiagnostics({ afterDeploy: true }).finally(() => {
        setPostUpdateCheck(false);
        void startBot();
      });
      return;
    }

    void startBot();
  }, [controlSecretReady, searchParams, runDiagnostics]);
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
        <div style={{ fontSize: isActive ? '13px' : '16px' }}>
          Brain: {diagnostics.chat} | Twitch: {diagnostics.twitch} | Voice: {diagnostics.speech} | Sound: {diagnostics.sound}
        </div>
        <div style={{ color: '#00FF00', marginTop: '5px', fontSize: isActive ? '13px' : '16px' }}>
          Quota: {diagnostics.quota}
        </div>
        {isActive ? (
          <>
            <div style={{ color: '#7DD3FC', marginTop: '6px', fontSize: '12px' }}>
              IRC: {runtimeHud.irc}
            </div>
            <div style={{ color: '#7DD3FC', marginTop: '4px', fontSize: '12px' }}>
              Stream: {runtimeHud.stream}
            </div>
            <div style={{ color: '#A7F3D0', marginTop: '4px', fontSize: '12px' }}>
              Chat: {runtimeHud.chat}
            </div>
            <div style={{ color: '#FDE68A', marginTop: '4px', fontSize: '12px' }}>
              TTS: {runtimeHud.tts}
            </div>
            {runtimeHud.mute ? (
              <div style={{ color: '#FCA5A5', marginTop: '4px', fontSize: '12px' }}>
                {runtimeHud.mute}
              </div>
            ) : null}
          </>
        ) : null}
        {postUpdateCheck ? (
          <div style={{ color: '#FFE08A', marginTop: '6px', fontSize: isActive ? '12px' : '14px' }}>
            Verifying Brain / Voice / Sound after auto-update…
          </div>
        ) : null}
        {overlayAuthStatus === 'missing' ? (
          <div style={{ color: '#FFB4B4', marginTop: '8px', fontSize: isActive ? '12px' : '14px', lineHeight: 1.45 }}>
            Overlay locked — use <code style={{ color: '#FFE08A' }}>/embed/YOUR_SECRET</code> in OBS (recommended) or{' '}
            <code style={{ color: '#FFE08A' }}>?controlKey=YOUR_SECRET</code> (same as <code style={{ color: '#FFE08A' }}>ELROY_CONTROL_SECRET</code>).
          </div>
        ) : null}
        {overlayAuthStatus === 'rejected' ? (
          <div style={{ color: '#FFB4B4', marginTop: '8px', fontSize: isActive ? '12px' : '14px', lineHeight: 1.45 }}>
            Control key rejected — must match <code style={{ color: '#FFE08A' }}>ELROY_CONTROL_SECRET</code> in Vercel.
            Use the exact same slug as <code style={{ color: '#FFE08A' }}>/control/YOUR_SECRET</code> at{' '}
            <code style={{ color: '#FFE08A' }}>/embed/YOUR_SECRET</code>, or open control in this browser first.
          </div>
        ) : null}
        {overlayAuthStatus === 'ok' ? (
          <div style={{ color: '#8AE68A', marginTop: '6px', fontSize: isActive ? '12px' : '14px' }}>
            Overlay authorized{overlayAuthSource !== 'none' ? ` (${overlayAuthSource})` : ''}
          </div>
        ) : null}
        <div style={{ color: '#B794F6', marginTop: isActive ? '6px' : '8px', fontSize: isActive ? '12px' : '14px' }}>
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

export function BongOverlay({ initialControlSecret }: { initialControlSecret?: string } = {}) {
  return (
    <Suspense fallback={null}>
      <BongContent initialControlSecret={initialControlSecret} />
    </Suspense>
  );
}

export default function HomeOverlay() {
  return <BongOverlay />;
}