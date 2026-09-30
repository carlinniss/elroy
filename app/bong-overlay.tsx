"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import tmi from 'tmi.js';
import {
  describeVoiceQuotaTier,
  parseVoicePace,
  voiceLineCharTarget,
  voiceQuotaTierFromRemaining,
  type VoicePace,
} from '@/lib/voice-quota';
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
import {
  buildPeriodicCommandHelpMessage,
  buildCommandsChatReply,
  buildCommandsPageUrl,
  COMMANDS_ALLOWED_WHILE_MUTED,
  parseChatCommand,
} from '@/lib/bot-commands';
import { buildTriviaProgressHint } from '@/lib/trivia-hints';
import { buildSpotifyTrackPrompt } from '@/lib/spotify-prompt';
import type { SpotifyTrackSnapshot } from '@/lib/spotify';
import { getBotInstanceId } from '@/lib/bot-instance';
import { getBuildLabel } from '@/lib/build-version';
import { formatDirectiveInjection } from '@/lib/live-directives';
import { createElroyPromptBuilders } from '@/lib/elroy-prompts';
import type { SongRequestAction } from '@/lib/song-requests';
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
import { DEFAULT_STUDIO_SETTINGS } from '@/lib/studio-state';
import { getStreamerDisplayName } from '@/lib/streamer-name';
import {
  describeStreamerGate,
  isStreamerBlockingVoice,
  isStudioGateActive,
  waitForStreamerSilence,
  type StudioGateState,
} from '@/lib/streamer-gate';

const BOT_SESSION_HEARTBEAT_MS = 8_000;
const CONTROL_SECRET_STORAGE_KEY = 'elroy-control-secret';
const CHAT_BRAIN_TIMEOUT_MS = 45_000;
const STUDIO_POLL_MS = 500;
const STUDIO_VOICE_WAIT_MS = 30_000;
const STUDIO_TRANSCRIPT_LAG_BUFFER_MS = 1_200;
const STREAMER_DISPLAY_NAME = getStreamerDisplayName();

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
  // Stream-clean by default once ignited: add ?hud=on to see diagnostics while troubleshooting.
  const showHud = searchParams.get('hud') === 'on';
  const showWidgets = searchParams.get('widgets') !== 'off';
  const showBubble = searchParams.get('bubble') !== 'off';
  const showCaptions = searchParams.get('captions') !== 'off';
  const [elroyBubble, setElroyBubble] = useState<{ id: number; text: string } | null>(null);
  const [hostCaption, setHostCaption] = useState<{ id: string; text: string } | null>(null);
  const elroyBubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostCaptionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHostCaptionIdRef = useRef('');
  const [widgetTrivia, setWidgetTrivia] = useState<{
    category: TriviaCategory;
    question: string;
    points: number;
    endsAt: number;
    winner?: string;
    answer?: string;
  } | null>(null);
  const [widgetTrack, setWidgetTrack] = useState<{ name: string; artists: string; requestedBy?: string; requestsOff?: boolean } | null>(null);
  const [widgetTables, setWidgetTables] = useState({ blackjack: false, roulette: false, pick3: false, pick4: false });
  const [widgetNow, setWidgetNow] = useState(() => Date.now());
  const widgetTrackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notPlayingPollsRef = useRef(0);
  const widgetTriviaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [runtimeHud, setRuntimeHud] = useState({
    stream: 'checking…',
    tts: 'idle',
    irc: 'off',
    chat: 'idle',
    mute: '',
    studio: '',
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
  const recentElroyRepliesRef = useRef<string[]>([]);
  /** Spotify is playing (refreshed by the now-playing poll; expires if polls stop). */
  const musicPlayingUntilRef = useRef(0);
  const lastMusicConfirmedAtRef = useRef(0);
  const isMusicPlaying = () => Date.now() < musicPlayingUntilRef.current;
  const voicePaceRef = useRef<VoicePace>('normal');
  const bargeInRef = useRef(false);
  const lastSpeechInterruptedRef = useRef(false);
  const lastMentionReplyByUserRef = useRef<Map<string, number>>(new Map());
  const hostMentionTimesRef = useRef<number[]>([]);
  const mentionHistoryByUserRef = useRef<Map<string, number[]>>(new Map());
  const recentVoicePlaybackRef = useRef<Array<{ fingerprint: string; at: number }>>([]);

  const ELROY_SYSTEM_BROADCAST = /^elroy initiated\./i;
  const RECENT_VOICE_STORAGE_KEY = 'elroy-recent-voice-playback';
  const VOICE_PLAYBACK_GAP_MS = 30_000;

  const SHUT_UP_DURATION_MS = 8 * 60 * 1000;
  const POWERUP_MUTE_MS = 10 * 60 * 1000;
  const SHUT_ELROY_POWERUP_PATTERN = /shut\s+elroy\s+up(\s+for\s+10\s+minutes?)?/i;
  const VOICE_COOLDOWN_MS = 60_000;
  const CELEBRATION_VOICE_COOLDOWN_MS = 15_000;
  const COMEBACK_CHANCE = 0.12;
  const CELEBRATION_COOLDOWN_MS = 25_000;
  const FOLLOWER_POLL_MS = 45_000;
  const CHANNEL_EVENTS_POLL_MS = 5_000;
  const STREAM_CHECKIN_MS = 20 * 60 * 1000;
  // No real cooldown for the host — just enough to not answer one sentence twice.
  const HOST_MENTION_RESPONSE_COOLDOWN_MS = 3_000;
  /** Safety cap even for the host: at most this many mic-triggered replies per minute. */
  const HOST_MENTION_MAX_PER_MINUTE = 5;
  const STREAM_POLL_MS = 15_000;
  const TRIVIA_ANSWER_WINDOW_MS = 5 * 60 * 1000;
  const TRIVIA_CHECK_MS = 30_000;
  const BLACKJACK_TICK_MS = 4_000;
  const ROULETTE_TICK_MS = 4_000;
  const PICK_TICK_MS = 4_000;
  const COMMAND_HELP_INTERVAL_MS = 7 * 60 * 1000;
  const CHAT_ACTIVITY_MESSAGE_THRESHOLD = 75;
  const CHAT_ACTIVITY_CHANCE = 0.55;
  const chatActivityThresholdRef = useRef(CHAT_ACTIVITY_MESSAGE_THRESHOLD);
  const chatActivityChanceRef = useRef(CHAT_ACTIVITY_CHANCE);
  const ambientVoiceAllowedRef = useRef(false);
  const SESSION_CHAT_MAX = 600;
  const SESSION_STORAGE_KEY = 'elroy-stream-session';
  const SESSION_RESUME_MAX_GAP_MS = 20 * 60 * 1000;
  const MENTION_USER_COOLDOWN_MS = 6_000;
  /** Spam guard: more than this many mentions from one viewer in a minute → they wait a minute. */
  const MENTION_BURST_LIMIT = 4;
  const MENTION_BURST_WINDOW_MS = 60_000;
  const RECENT_REPLY_MEMORY = 6;
  const AUTO_RESUME_STORAGE_KEY = 'elroy-auto-resume';
  const POST_UPDATE_DIAGNOSTICS_KEY = 'elroy-post-update-diagnostics';
  const VERSION_POLL_MS = 90_000;
  const DIRECTIVE_POLL_MS = 12_000;
  const SPOTIFY_POLL_MS = 10_000;
  const SPOTIFY_RECONNECT_REMINDER_MS = 4 * 60 * 1000;
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
  const lastSpotifyReconnectReminderAtRef = useRef(0);
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
  const rewardIdsRef = useRef<{ roast?: string; ask?: string }>({});
  const powerupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRedemptionPollRef = useRef(Date.now());
  const processedRedemptionIdsRef = useRef<Set<string>>(new Set());
  const powerupStorageWarnedRef = useRef(false);
  const POWERUP_POLL_MS = 4_000;
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
  const processedHostMentionIdsRef = useRef<Set<string>>(new Set());
  const lastHostMentionResponseRef = useRef(0);
  const studioRef = useRef<StudioGateState>({
    listening: false,
    listenerAlive: false,
    streamerSpeaking: false,
    lastSpeechAt: 0,
    recentHostSpeech: [],
    latestHostMention: null,
    settings: { ...DEFAULT_STUDIO_SETTINGS },
  });
  const studioPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  const shouldSkipVoicePlayback = useCallback((text: string) => {
    const fingerprint = normalizeChatFingerprint(text);
    if (!fingerprint) return true;
    const now = Date.now();
    const cutoff = now - VOICE_PLAYBACK_GAP_MS;
    const recent = recentVoicePlaybackRef.current
      .filter((entry) => entry.at >= cutoff);

    try {
      const stored = window.localStorage.getItem(RECENT_VOICE_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) as Array<{ fingerprint?: string; at?: number }> : [];
      for (const entry of parsed) {
        if (typeof entry.fingerprint === 'string' && typeof entry.at === 'number' && entry.at >= cutoff) {
          recent.push({ fingerprint: entry.fingerprint, at: entry.at });
        }
      }
    } catch {
      /* storage is optional */
    }

    const duplicate = recent.some((entry) => (
      entry.fingerprint === fingerprint
      || fingerprint.startsWith(entry.fingerprint.slice(0, 48))
      || entry.fingerprint.startsWith(fingerprint.slice(0, 48))
    ));

    if (duplicate) {
      recentVoicePlaybackRef.current = recent.slice(-20);
      return true;
    }

    const updated = [...recent, { fingerprint, at: now }].slice(-20);
    recentVoicePlaybackRef.current = updated;
    try {
      window.localStorage.setItem(RECENT_VOICE_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      /* storage is optional */
    }
    return false;
  }, [normalizeChatFingerprint]);

  const seedElroySpeakerLogins = useCallback(async (normalizedChannel: string) => {
    const logins = new Set<string>([normalizedChannel]);
    const userIds = new Set<string>();
    // The bot's own login comes from its OAuth token (via /api/twitch/chat-status below).

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
    // The broadcaster is a human. If Elroy ever posts with the broadcaster token, those lines are
    // already caught by the outbound-echo check above, so everything else the host types is real.
    if (normalizedUser === normalizedChannel) return false;
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
      allowDuringMusic?: boolean;
    },
  ) => {
    if (opts.chatOnly) return 'chat-only mode';
    if (isMusicPlaying() && !opts.allowDuringMusic) return 'music playing — chat only';
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

  const applyVoiceQuotaTier = useCallback((remaining: number, pace: VoicePace = voicePaceRef.current) => {
    voicePaceRef.current = pace;
    const tier = voiceQuotaTierFromRemaining(remaining, pace);
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
      bargeInRef.current = data.bargeIn === true;
      applyVoiceQuotaTier(Number(data.remaining) || 0, parseVoicePace(data.voicePace));
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
        savedAt: Date.now(),
        messages: sessionChatRef.current,
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
        savedAt?: number;
        messages?: Array<{ user: string; text: string; at: number }>;
      };
      // Only resume a session that was still being written recently (deploy reload / OBS restart).
      // Anything older is a previous stream that ended without Elroy seeing it go offline.
      const lastActivity = parsed.savedAt
        ?? parsed.messages?.[0]?.at
        ?? parsed.startedAt
        ?? 0;
      if (Date.now() - lastActivity > SESSION_RESUME_MAX_GAP_MS) {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        return;
      }
      if (parsed.startedAt && Array.isArray(parsed.messages)) {
        streamStartedAtRef.current = parsed.startedAt;
        sessionChatRef.current = parsed.messages.slice(0, SESSION_CHAT_MAX);
      }
    } catch (e) {
      console.warn('Session restore failed', e);
    }
  }, []);

  const canSafelyReloadForDeploy = useCallback(() => {
    // Never swap code under a live show — a bad deploy mid-stream takes Elroy down on air.
    // The update lands once the stream ends (or refresh the OBS browser source to take it now).
    if (streamLiveRef.current) return false;
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
        update: streamLiveRef.current
          ? 'update ready — applies after stream (refresh OBS source to take it now)'
          : 'update pending — waiting for safe moment',
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
        bargeInRef.current = qData.bargeIn === true;
        applyVoiceQuotaTier(Number(qData.remaining) || 0, parseVoicePace(qData.voicePace));
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
  useEffect(() => {
    if (!widgetTrivia || widgetTrivia.winner) return;
    const timer = setInterval(() => setWidgetNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [widgetTrivia]);
  useEffect(() => { voiceEnabledRef.current = isVoiceOn; }, [isVoiceOn]);
  useEffect(() => {
    startVersionPolling();
    return () => stopVersionPolling();
  }, [startVersionPolling, stopVersionPolling]);

  const fetchSpeech = (text: string) => fetch('/api/speech', {
    method: 'POST',
    headers: controlHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ text }),
  });

  const speakNow = async (text: string, prefetched?: Promise<Response>) => {
    try {
      // Audio may already be generating (started while the bong played) — no dead air.
      const res = await (prefetched ?? fetchSpeech(text));
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
        let bargeTimer: ReturnType<typeof setInterval> | null = null;
        let finished = false;
        const finish = (hudText = 'audio ready') => {
          if (finished) return;
          finished = true;
          if (bargeTimer) clearInterval(bargeTimer);
          isSpeakingRef.current = false;
          URL.revokeObjectURL(audioUrl);
          setRuntimeHud((prev) => ({ ...prev, tts: hudText }));
          resolve();
        };

        // Barge-in: host starts talking while Elroy is mid-line → fade him out fast.
        if (bargeInRef.current) {
          const startedAt = Date.now();
          bargeTimer = setInterval(() => {
            const studio = studioRef.current;
            if (!isStudioGateActive(studio) || !studio.streamerSpeaking) return;
            if (Date.now() - startedAt < 400) return;
            if (bargeTimer) clearInterval(bargeTimer);
            const startVolume = audio.volume;
            let step = 0;
            const fade = setInterval(() => {
              step += 1;
              audio.volume = Math.max(0, startVolume * (1 - step / 6));
              if (step >= 6) {
                clearInterval(fade);
                audio.pause();
                lastSpeechInterruptedRef.current = true;
                finish('host talking — Elroy stopped');
              }
            }, 40);
          }, 100);
        }

        audio.onended = () => finish();
        audio.onerror = () => {
          console.warn('Audio element error');
          finish('playback error — check OBS audio');
        };
        audio.play().catch((error) => {
          console.warn('Audio playback blocked', error);
          finish('playback blocked — OBS: Control audio via OBS + unmute source');
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

  const speak = useCallback((text: string, prefetched?: Promise<Response>, allowDuringMusic = false) => {
    if (shouldSkipVoicePlayback(text)) {
      setRuntimeHud((prev) => ({ ...prev, tts: 'recent voice skipped' }));
      return speechQueueRef.current;
    }
    lastElroyVoiceRef.current = Date.now();
    speechQueueRef.current = speechQueueRef.current
      .then(() => {
        lastSpeechInterruptedRef.current = false;
        // A line waiting in the queue can't sneak out once music has started.
        if (isMusicPlaying() && !allowDuringMusic) {
          lastSpeechInterruptedRef.current = true;
          return undefined;
        }
        return speakNow(text, prefetched);
      })
      .then(() => {
        // No cough after being cut off — it would land on top of the host.
        if (!lastSpeechInterruptedRef.current) void playElroySfx('cough');
      })
      .catch((e) => { console.error(e); });
    return speechQueueRef.current;
  }, [playElroySfx, shouldSkipVoicePlayback]);

  // Prompt text lives in lib/elroy-prompts.ts (pure + testable); this wires it to live state.
  const promptBuilders = useMemo(() => createElroyPromptBuilders({
    streamer: STREAMER_DISPLAY_NAME,
    checkinWindowMs: STREAM_CHECKIN_MS,
    recentChat: () => recentChatRef.current,
    hostSpeech: () => studioRef.current.recentHostSpeech,
    streamMetadataLine: () => streamMetadataLine(),
    sampleSessionChat: (maxLines) => sampleSessionChat(maxLines),
    streamStartedAt: () => streamStartedAtRef.current,
  }), [sampleSessionChat, streamMetadataLine]);
  const {
    buildSongRequestIntroPrompt,
    buildRoastRedeemPrompt,
    buildAskRedeemPrompt,
    buildChatAwarePrompt,
    buildHostAwarePrompt,
    buildMentionPrompt,
    buildLRoyRoastPrompt,
    buildTriviaCheatRoastPrompt,
    buildSubPrompt,
    buildRaidPrompt,
    buildBitsPrompt,
    buildStreamCheckinPrompt,
    buildStreamGreetingPrompt,
    buildStreamGoodbyePrompt,
    buildStreamSummaryPrompt,
    buildComebackPrompt,
  } = promptBuilders;

  const isTriviaRoundLive = useCallback(() => {
    const active = activeTriviaRef.current;
    return Boolean(active && !active.answered);
  }, []);

  const syncStudioHud = useCallback((state: StudioGateState) => {
    if (!isStudioGateActive(state)) {
      setRuntimeHud((prev) => ({ ...prev, studio: '' }));
      return;
    }
    const label = describeStreamerGate(state);
    setRuntimeHud((prev) => ({
      ...prev,
      studio: label || 'studio listening',
    }));
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
      /** Viewer login whose memory file should inform the reply. */
      viewer?: string;
      /** Song-request intros are the one thing Elroy says out loud while music plays. */
      allowDuringMusic?: boolean;
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
        const d = await res.json().catch(() => ({})) as { remaining?: unknown; resetDate?: string };
        if (!res.ok || typeof d.remaining !== 'number') {
          void sayChat(`@${user} can't read my voice quota right now — try again in a bit.`);
          return;
        }
        void sayChat(`@${user} I got ${d.remaining.toLocaleString()} chars until ${d.resetDate ?? 'the next reset'}.`);
        return;
      }

      const voiceSilenced = isSilenced() && silenceModeRef.current === 'voice';
      const voicePriority = opts.voicePriority ?? (opts.forceVoice ? 'celebration' : 'normal');
      const quotaAllowsVoice = quotaVoiceAllowedRef.current
        && (!celebrationsVoiceOnlyRef.current || opts.forceVoice);
      const voiceAllowed = quotaAllowsVoice && !voiceSilenced && (
        opts.bypassVoiceCooldown || canUseVoice(voicePriority)
      );
      // Voice works offline too, so the host can hear Elroy before going live.
      const mutedForMusic = isMusicPlaying() && !opts.allowDuringMusic;
      const willUseVoice = Boolean(
        !opts.chatOnly
        && !mutedForMusic
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
      const voiceTarget = voiceLineCharTarget(voicePaceRef.current);
      const lengthRule = willUseVoice
        ? voicePaceRef.current === 'liberal'
          ? `- Voice: 1-2 punchy sentences, about ${voiceTarget.min}-${voiceTarget.max} characters total. Say the full thought — do not stop mid-sentence.`
          : `- Voice: 2-3 sentences, about ${voiceTarget.min}-${voiceTarget.max} characters total. Say the full thought — do not stop mid-sentence.`
        : `- Chat only: 2-4 sentences, about 200-${MAX_TWITCH_CHAT_CHARS} characters total.
- Hard cap ${MAX_TWITCH_CHAT_CHARS} characters. No bullet lists or paragraphs — keep it flowing chat prose.`;
      const recentReplies = recentElroyRepliesRef.current;
      const antiRepeatBlock = recentReplies.length
        ? `\n\nYour last few lines in chat (do NOT reuse their openers, jokes, catchphrases, or structure):\n${recentReplies.map((line) => `- ${line}`).join('\n')}`
        : '';
      const fullPrompt = `${input}${directiveBlock}${antiRepeatBlock}\n\nResponse requirements:\n${lengthRule}\n- Keep the same OG personality and rhythm.\n${personalizationRule}`;
      let res: Response;
      try {
        res = await fetchWithTimeout('/api/chat', {
          method: 'POST',
          headers: controlHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ prompt: fullPrompt, viewer: opts.viewer }),
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
      recentElroyRepliesRef.current = [
        ...recentElroyRepliesRef.current,
        safeChatText.slice(0, 160),
      ].slice(-RECENT_REPLY_MEMORY);
      setLog(p => [{ text: safeChatText }, ...p].slice(0, 5));
      const bubbleId = Date.now();
      setElroyBubble({ id: bubbleId, text: safeChatText });
      if (elroyBubbleTimerRef.current) clearTimeout(elroyBubbleTimerRef.current);
      elroyBubbleTimerRef.current = setTimeout(() => setElroyBubble(null), 15_000);
      await sayChat(user ? `@${user} ${safeChatText}` : safeChatText);

      if (willUseVoice) {
        const playDing = dingEnabledRef.current && !opts.skipDing;
        // Liberal pace speaks more often, so each spoken line is capped shorter to stretch credits.
        const voiceText = clampReplyLength(
          safeChatText,
          Math.min(MAX_VOICE_REPLY_CHARS, voiceLineCharTarget(voicePaceRef.current).max + 40),
        );
        void (async () => {
          if (isStudioGateActive(studioRef.current)) {
            const gateLabel = describeStreamerGate(studioRef.current, Date.now(), {
              extraTailMs: STUDIO_TRANSCRIPT_LAG_BUFFER_MS,
            });
            if (gateLabel) {
              setRuntimeHud((prev) => ({ ...prev, tts: gateLabel }));
            }
            const gateResult = await waitForStreamerSilence(
              () => studioRef.current,
              {
                maxWaitMs: STUDIO_VOICE_WAIT_MS,
                pollMs: 100,
                extraTailMs: STUDIO_TRANSCRIPT_LAG_BUFFER_MS,
              },
            );
            if (gateResult === 'timeout') {
              setRuntimeHud((prev) => ({
                ...prev,
                tts: 'streamer talking — skipped voice (chat sent)',
              }));
              syncStudioHud(studioRef.current);
              return;
            }
          }
          // Music may have started while the reply was being written or while waiting for the host.
          if (isMusicPlaying() && !opts.allowDuringMusic) {
            setRuntimeHud((prev) => ({ ...prev, tts: 'music started — chat only' }));
            return;
          }
          // Start generating the voice now so it's ready the moment the bong finishes.
          const speech = fetchSpeech(voiceText);
          if (playDing) {
            await playBongRip(volumeRef.current);
            await new Promise<void>((resolve) => setTimeout(resolve, 250));
          }
          if (isStreamerBlockingVoice(studioRef.current, Date.now(), {
            extraTailMs: STUDIO_TRANSCRIPT_LAG_BUFFER_MS,
          })) {
            setRuntimeHud((prev) => ({
              ...prev,
              tts: 'streamer resumed - voice held',
            }));
            const gateResult = await waitForStreamerSilence(
              () => studioRef.current,
              {
                maxWaitMs: STUDIO_VOICE_WAIT_MS,
                pollMs: 100,
                extraTailMs: STUDIO_TRANSCRIPT_LAG_BUFFER_MS,
              },
            );
            if (gateResult === 'clear') {
              syncStudioHud(studioRef.current);
              if (isMusicPlaying() && !opts.allowDuringMusic) return;
              void speak(voiceText, speech, Boolean(opts.allowDuringMusic));
              return;
            }
            setRuntimeHud((prev) => ({
              ...prev,
              tts: 'streamer resumed - skipped voice (chat sent)',
            }));
            syncStudioHud(studioRef.current);
            return;
          }
          void speak(voiceText, speech, Boolean(opts.allowDuringMusic));
        })();
      }
    } catch (e) { console.error(e); }
  }, [controlHeaders, describeVoiceSkip, isTriviaRoundLive, playBongRip, sayChat, speak, syncStudioHud]);

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
      /** Viewer login whose memory file should inform the reply. */
      viewer?: string;
      /** Song-request intros are the one thing Elroy says out loud while music plays. */
      allowDuringMusic?: boolean;
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

  const pollStudioStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/studio/status?t=${Date.now()}`, {
        cache: 'no-store',
        headers: controlHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json() as StudioGateState;
      studioRef.current = {
        listening: data.listening === true,
        listenerAlive: data.listenerAlive === true,
        streamerSpeaking: data.streamerSpeaking === true,
        lastSpeechAt: Number(data.lastSpeechAt) || 0,
        recentHostSpeech: Array.isArray(data.recentHostSpeech) ? data.recentHostSpeech : [],
        latestHostMention: data.latestHostMention ?? null,
        settings: data.settings ?? studioRef.current.settings,
      };
      syncStudioHud(studioRef.current);
      const newestSpeech = studioRef.current.recentHostSpeech.at(-1);
      if (
        newestSpeech
        && newestSpeech.id !== lastHostCaptionIdRef.current
        && Date.now() - newestSpeech.at < 45_000
      ) {
        lastHostCaptionIdRef.current = newestSpeech.id;
        setHostCaption({ id: newestSpeech.id, text: newestSpeech.text });
        if (hostCaptionTimerRef.current) clearTimeout(hostCaptionTimerRef.current);
        // Roughly reading time: ~6s plus a bit per word, capped.
        const holdMs = Math.min(12_000, 5_000 + newestSpeech.text.split(/\s+/).length * 250);
        hostCaptionTimerRef.current = setTimeout(() => setHostCaption(null), holdMs);
      }
      const mention = studioRef.current.latestHostMention;
      const now = Date.now();
      // Feedback guard: if the "host" transcript is really Elroy's own voice leaking into the
      // mic (speakers, monitoring), it mostly repeats words he just said — skip it.
      const soundsLikeElroy = (text: string) => {
        const words = text.toLowerCase().match(/[a-z']{3,}/g) ?? [];
        if (words.length < 3) return false;
        return recentElroyRepliesRef.current.some((line) => {
          const spoken = new Set(line.toLowerCase().match(/[a-z']{3,}/g) ?? []);
          const overlap = words.filter((word) => spoken.has(word)).length;
          return overlap / words.length >= 0.5;
        });
      };
      hostMentionTimesRef.current = hostMentionTimesRef.current.filter((at) => now - at < 60_000);
      if (mention && !processedHostMentionIdsRef.current.has(mention.id) && soundsLikeElroy(mention.text)) {
        processedHostMentionIdsRef.current.add(mention.id);
        console.info('Ignoring host transcript that echoes Elroy:', mention.text);
      }
      if (
        mention
        && !processedHostMentionIdsRef.current.has(mention.id)
        && !isFullyMuted()
        && hostMentionTimesRef.current.length < HOST_MENTION_MAX_PER_MINUTE
        && now - mention.at < 45_000
        // Inside the cooldown the mention waits (next poll) instead of being thrown away.
        && now - lastHostMentionResponseRef.current >= HOST_MENTION_RESPONSE_COOLDOWN_MS
      ) {
        processedHostMentionIdsRef.current.add(mention.id);
        lastHostMentionResponseRef.current = now;
        hostMentionTimesRef.current.push(now);
        // The host talking to Elroy on mic always gets a spoken answer.
        void queueBongLogic(buildHostAwarePrompt(mention.text), undefined, {
          voicePriority: 'celebration',
          bypassVoiceCooldown: true,
        });
      }
    } catch (error) {
      console.warn('Studio poll failed', error);
    }
  }, [buildHostAwarePrompt, controlHeaders, queueBongLogic, syncStudioHud]);

  useEffect(() => {
    void pollLiveDirectives();
    void pollBotControls();
    void pollStudioStatus();
    directivePollRef.current = setInterval(() => {
      void pollLiveDirectives();
      void pollBotControls();
    }, DIRECTIVE_POLL_MS);
    let studioTick = 0;
    studioPollRef.current = setInterval(() => {
      // Only the running bot needs Studio state. Poll fast while the listener is live
      // (voice gating needs it), otherwise check every ~10s to notice when Studio starts.
      if (!isActiveRef.current) return;
      studioTick += 1;
      const studioLive = studioRef.current.listening && studioRef.current.listenerAlive;
      if (!studioLive && studioTick % 20 !== 0) return;
      void pollStudioStatus();
    }, STUDIO_POLL_MS);
    return () => {
      if (directivePollRef.current) {
        clearInterval(directivePollRef.current);
        directivePollRef.current = null;
      }
      if (studioPollRef.current) {
        clearInterval(studioPollRef.current);
        studioPollRef.current = null;
      }
    };
  }, [pollBotControls, pollLiveDirectives, pollStudioStatus]);

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

  const canCelebrate = (kind: 'sub' | 'bits' | 'raid') => {
    const cooldown = kind === 'raid'
      ? 15_000
      : CELEBRATION_COOLDOWN_MS;
    return Date.now() - lastCelebrationRef.current >= cooldown;
  };

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

  const recordFollow = useCallback((
    username: string,
    memoryEvent?: Record<string, unknown>,
  ) => {
    if (!username.trim()) return;
    if (moderateOffensiveChatter(
      username,
      username,
      typeof memoryEvent?.user_id === 'string' ? memoryEvent.user_id : undefined,
    )) return;
    rememberUser(username, username, {
      type: 'follow',
      followedAt: typeof memoryEvent?.followed_at === 'string' ? memoryEvent.followed_at : undefined,
    }, controlHeaders());
  }, [controlHeaders, moderateOffensiveChatter]);

  const celebrate = useCallback((
    kind: 'sub' | 'bits' | 'raid',
    username: string,
    extra = '',
    bitsAmount?: number,
    memoryEvent?: Record<string, unknown>,
  ) => {
    if (!username.trim()) return;
    const dedupeKey = kind === 'bits'
      ? `bits:${username.toLowerCase()}:${bitsAmount ?? 0}`
      : `${kind}:${username.toLowerCase()}`;
    // Same event arriving from both IRC and EventSub — handle it once.
    if (shouldSkipDuplicateCelebration(dedupeKey, kind === 'raid' ? 60_000 : 30_000)) return;

    // Always remember supporters, even offline or mid-burst, so !aboutme stays accurate.
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

    if (!streamLiveRef.current || isFullyMuted()) return;

    if (!canCelebrate(kind)) {
      // Gift recipients arrive as a flood of sub events during a gift bomb — the gifter gets thanked.
      if (memoryEvent?.is_gift === true) return;
      // Burst (sub train, bits spam): skip the AI line + voice, but never leave a supporter unthanked.
      const quickLine = kind === 'bits'
        ? `💎 @${username} thank you for the bits!`
        : kind === 'raid'
          ? `🚨 @${username} thank you for the raid!`
          : `💜 @${username} thank you for the sub!`;
      void sayChat(quickLine);
      return;
    }

    lastCelebrationRef.current = Date.now();
    const sfxId = kind === 'sub' || kind === 'raid'
      ? 'sub_fanfare'
      : 'bits_kaching';
    void playElroySfx(sfxId);
    const prompt =
      kind === 'sub' ? buildSubPrompt(username, extra)
      : kind === 'raid' ? buildRaidPrompt(username, Number(extra) || 0)
      : buildBitsPrompt(username, extra);
    void queueBongLogic(prompt, username, {
      forceVoice: true,
      voicePriority: 'celebration',
    });
  }, [buildBitsPrompt, buildRaidPrompt, buildSubPrompt, controlHeaders, playElroySfx, queueBongLogic, sayChat, shouldSkipDuplicateCelebration]);

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
        recordFollow(follower.user_login, { followed_at: follower.followed_at });
      }
    } catch (e) {
      console.warn('Follower poll failed', e);
    }
  }, [controlHeaders, recordFollow]);

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
          recordFollow(login, payload);
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
  }, [celebrate, controlHeaders, handleRaid, postTwitchAnnounce, recordFollow]);

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
    } else if (isLive) {
      // Keep the session's savedAt fresh during quiet stretches so a reload mid-stream still resumes.
      persistStreamSession();
    }
  }, [fetchStreamStatus, onStreamEnded, onStreamStarted, persistStreamSession]);

  const expireTriviaIfNeeded = useCallback(() => {
    const active = activeTriviaRef.current;
    if (!active || active.answered) return;
    if (Date.now() - active.askedAt < TRIVIA_ANSWER_WINDOW_MS) return;

    activeTriviaRef.current = null;
    setWidgetTrivia(null);
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
      if (widgetTriviaTimerRef.current) clearTimeout(widgetTriviaTimerRef.current);
      setWidgetTrivia({
        category: picked.category,
        question: picked.question,
        points: roundPoints,
        endsAt: Date.now() + TRIVIA_ANSWER_WINDOW_MS,
      });
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

  const maybeRemindSpotifyReconnect = useCallback((reason?: string) => {
    if (!streamLiveRef.current || isFullyMuted()) return;
    if (reason !== 'auth_expired' && reason !== 'not_connected') return;
    const now = Date.now();
    if (now - lastSpotifyReconnectReminderAtRef.current < SPOTIFY_RECONNECT_REMINDER_MS) return;
    lastSpotifyReconnectReminderAtRef.current = now;
    const reconnectUrl = commandsPageUrlRef.current
      ? commandsPageUrlRef.current.replace(/\/commands(?:\?.*)?$/, '/control')
      : '/control';
    const cause = reason === 'auth_expired' ? 'link expired' : 'is not linked';
    void sayChat(
      `${STREAMER_DISPLAY_NAME}, Spotify ${cause} - reconnect it in ${reconnectUrl} so Elroy can announce songs.`,
    );
  }, [sayChat]);

  const pollSpotifyNowPlaying = useCallback(async () => {
    // Runs offline too so song requests hand off and get intros before a stream.
    // Unprompted track-change comments stay live-only (commentOnSpotifyTrack checks that).
    if (isFullyMuted()) return;

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
        reason?: string;
        requestMessages?: string[];
        requestedBy?: string | null;
        requestsOn?: boolean;
        requestIntro?: { name: string; artists: string; releaseYear?: string; requestedByDisplay: string } | null;
      };
      // Spotify hiccup (rate limit / API error): unknown, not "stopped". Keep everything as-is,
      // but never stretch the quiet window more than ~90s past the last confirmed song.
      if (data.connected && data.reason === 'api_error') {
        if (isMusicPlaying()) {
          musicPlayingUntilRef.current = Math.max(musicPlayingUntilRef.current, Math.min(Date.now() + 25_000, lastMusicConfirmedAtRef.current + 90_000));
        }
        return;
      }
      if (data.connected && data.playing && data.track) {
        // Quiet until this song is over (plus a gap for the next one), not just 25s —
        // so a missed poll mid-song can't let him talk.
        const remaining = Math.max(0, data.track.durationMs - (data.track.progressMs ?? 0));
        lastMusicConfirmedAtRef.current = Date.now();
        musicPlayingUntilRef.current = Math.max(musicPlayingUntilRef.current, Date.now() + Math.max(25_000, remaining + 20_000));
        // Now-playing card stays up for the whole song.
        notPlayingPollsRef.current = 0;
        const card = {
          name: data.track.name,
          artists: data.track.artists.join(', '),
          requestedBy: data.requestedBy ?? undefined,
          requestsOff: data.requestsOn === false,
        };
        setWidgetTrack((prev) => (
          prev && prev.name === card.name && prev.artists === card.artists && prev.requestedBy === card.requestedBy && prev.requestsOff === card.requestsOff
            ? prev
            : card
        ));
      } else if (data.connected) {
        // Spotify really says nothing's playing. Three in a row (~30s) = music stopped/paused:
        // hide the card and let him talk again shortly after.
        notPlayingPollsRef.current += 1;
        if (notPlayingPollsRef.current >= 3) {
          setWidgetTrack(null);
          musicPlayingUntilRef.current = Math.min(musicPlayingUntilRef.current, Date.now() + 5_000);
        }
      }
      for (const line of data.requestMessages ?? []) {
        if (line.trim()) void sayChat(line);
      }
      if (data.requestIntro) {
        // Intro plays over the last ~25s of the current song, right before the request comes on.
        void queueBongLogic(buildSongRequestIntroPrompt(data.requestIntro), undefined, {
          forceVoice: true,
          voicePriority: 'celebration',
          bypassVoiceCooldown: true,
          allowDuringMusic: true,
        });
      }
      if (!data.connected) {
        maybeRemindSpotifyReconnect(data.reason);
        return;
      }
      if (!data.playing || !data.track) return;
      lastSpotifyReconnectReminderAtRef.current = 0;
      if (data.track.id === lastSpotifyTrackIdRef.current) return;
      if (data.requestedBy) {
        // A request Elroy already introduced — skip the second AI comment (the card shows the requester).
        lastSpotifyTrackIdRef.current = data.track.id;
      } else {
        commentOnSpotifyTrack(data.track);
      }
    } catch (error) {
      console.warn('Spotify poll failed', error);
    }
  }, [buildSongRequestIntroPrompt, commentOnSpotifyTrack, controlHeaders, maybeRemindSpotifyReconnect, queueBongLogic, sayChat]);

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
        reason?: string;
        error?: string;
      };

      if (!data.connected && data.reason !== 'auth_expired') {
        void sayChat(`@${username} Spotify ain't linked — broadcaster connects it from /control.`);
        return;
      }
      if (!data.connected && data.reason === 'auth_expired') {
        void sayChat(`@${username} Spotify link expired - broadcaster reconnects it from /control.`);
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
    setWidgetTrivia((prev) => (prev ? { ...prev, winner: username, answer: active.displayAnswer } : prev));
    if (widgetTriviaTimerRef.current) clearTimeout(widgetTriviaTimerRef.current);
    widgetTriviaTimerRef.current = setTimeout(() => setWidgetTrivia(null), 10_000);
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
  // Which casino tables need ticking. Start true so the first tick syncs with Redis after a reload;
  // a tick that reports idle turns it off, and any player command turns it back on.
  const gameActiveRef = useRef({ blackjack: true, roulette: true, pick3: true, pick4: true });
  const trackGameActivity = useCallback((
    game: 'blackjack' | 'roulette' | 'pick3' | 'pick4',
    action: string,
    data: { active?: boolean } | null,
  ) => {
    if (action === 'tick') {
      if (data?.active === false) gameActiveRef.current[game] = false;
      if (typeof data?.active === 'boolean') {
        const open = data.active;
        setWidgetTables((prev) => (prev[game] === open ? prev : { ...prev, [game]: open }));
      }
    } else {
      gameActiveRef.current[game] = true;
    }
  }, []);

  const postBlackjackAction = useCallback(async (payload: {
    action: string;
    username: string;
    displayName?: string;
    amount?: number;
    betInput?: string;
    message?: string;
    target?: string;
    isMod?: boolean;
  }) => {
    try {
      if (payload.action !== 'tick') trackGameActivity('blackjack', payload.action, null);
      const res = await fetch('/api/blackjack/action', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (payload.action === 'tick') trackGameActivity('blackjack', 'tick', data);
      if (Array.isArray(data.messages) && data.messages.length) {
        sayBlackjackLines(data.messages);
      }
      return data;
    } catch (error) {
      console.warn('Blackjack action failed', error);
      return null;
    }
  }, [controlHeaders, sayBlackjackLines, trackGameActivity]);

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
    if (!streamLiveRef.current || isFullyMuted() || !gameActiveRef.current.blackjack) return;
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
      if (payload.action !== 'tick') trackGameActivity('roulette', payload.action, null);
      const res = await fetch('/api/roulette/action', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (payload.action === 'tick') trackGameActivity('roulette', 'tick', data);
      if (Array.isArray(data.messages) && data.messages.length) {
        sayBlackjackLines(data.messages);
      }
      return data;
    } catch (error) {
      console.warn('Roulette action failed', error);
      return null;
    }
  }, [controlHeaders, sayBlackjackLines, trackGameActivity]);

  const tickRouletteTable = useCallback(() => {
    if (!streamLiveRef.current || isFullyMuted() || !gameActiveRef.current.roulette) return;
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
      if (payload.action !== 'tick') trackGameActivity(payload.game, payload.action, null);
      const res = await fetch('/api/pick-numbers/action', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (payload.action === 'tick') trackGameActivity(payload.game, 'tick', data);
      if (Array.isArray(data.messages) && data.messages.length) {
        sayBlackjackLines(data.messages);
      }
      return data;
    } catch (error) {
      console.warn('Pick numbers action failed', error);
      return null;
    }
  }, [controlHeaders, sayBlackjackLines, trackGameActivity]);

  const tickPickGames = useCallback(() => {
    if (!streamLiveRef.current || isFullyMuted()) return;
    if (gameActiveRef.current.pick3) {
      void postPickAction({ action: 'tick', game: 'pick3', username: 'elroy', displayName: 'Elroy' });
    }
    if (gameActiveRef.current.pick4) {
      void postPickAction({ action: 'tick', game: 'pick4', username: 'elroy', displayName: 'Elroy' });
    }
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
      if (!match) {
        void sayChat(`@${username} use !bet <amount> or !bet all`);
        return;
      }
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
    if (cmd === 'give') {
      const [, target = '', amount = ''] = rawMessage.trim().split(/\s+/);
      void postBlackjackAction({ action: 'give', username, displayName, target, betInput: amount });
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
    setWidgetTrivia(null);
    setWidgetTrack(null);
    setWidgetTables({ blackjack: false, roulette: false, pick3: false, pick4: false });
    triviaAskInFlightRef.current = false;
    streamLiveRef.current = false;
  }, []);

  const handleElroyMention = useCallback((
    username: string,
    displayName: string,
    message: string,
    isBroadcaster = false,
  ) => {
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
    // One viewer can't monopolize Elroy (or the Gemini/ElevenLabs budget) by spamming his name.
    const now = Date.now();
    const lastReplyAt = lastMentionReplyByUserRef.current.get(normalizedUser) ?? 0;
    if (!isBroadcaster) {
      if (now - lastReplyAt < MENTION_USER_COOLDOWN_MS) return;
      const recent = (mentionHistoryByUserRef.current.get(normalizedUser) ?? [])
        .filter((at) => now - at < MENTION_BURST_WINDOW_MS);
      if (recent.length >= MENTION_BURST_LIMIT) return;
      mentionHistoryByUserRef.current.set(normalizedUser, [...recent, now]);
    }
    lastMentionReplyByUserRef.current.set(normalizedUser, now);
    void queueBongLogic(buildMentionPrompt(username, message, isBroadcaster), username, {
      viewer: username,
      // The host typing to Elroy always gets voice; viewers share the normal voice cooldown.
      ...(isBroadcaster ? { voicePriority: 'celebration' as const, bypassVoiceCooldown: true } : {}),
    });
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

  const resolveChannelRewards = useCallback(async () => {
    try {
      const res = await fetch('/api/twitch/rewards', { headers: controlHeaders(), cache: 'no-store' });
      const data = await res.json() as { roast?: string; ask?: string; error?: string };
      rewardIdsRef.current = { roast: data.roast, ask: data.ask };
      if (data.error) console.info('Channel-point rewards:', data.error);
      else console.info('Channel-point rewards:', rewardIdsRef.current);
    } catch (error) {
      console.warn('Channel-point reward lookup failed', error);
    }
  }, [controlHeaders]);

  /** Returns true when the message was a Roast Me / Ask Elroy redemption and has been handled. */
  const tryHandleRewardRedemption = useCallback((
    tags: tmi.ChatUserstate,
    username: string,
    message: string,
  ) => {
    const rewardId = (tags as Record<string, string | undefined>)['custom-reward-id'];
    if (!rewardId) return false;
    const { roast, ask } = rewardIdsRef.current;
    if (rewardId !== roast && rewardId !== ask) return false;
    if (isFullyMuted()) {
      void sayChat(`@${username} Elroy's muted right now — ask the mods to refund your points.`);
      return true;
    }
    const prompt = rewardId === roast
      ? buildRoastRedeemPrompt(username, message)
      : buildAskRedeemPrompt(username, message);
    if (rewardId === roast) void playElroySfx('roast_sting');
    // Viewers paid for this — skip the usual voice cooldown.
    void queueBongLogic(prompt, username, {
      viewer: username,
      forceVoice: true,
      bypassVoiceCooldown: true,
      voicePriority: 'celebration',
    });
    return true;
  }, [buildAskRedeemPrompt, buildRoastRedeemPrompt, playElroySfx, queueBongLogic, sayChat]);

  const postSongRequestAction = useCallback(async (payload: SongRequestAction) => {
    try {
      const res = await fetch('/api/spotify/requests', {
        method: 'POST',
        headers: controlHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({})) as { messages?: string[] };
      for (const line of data.messages ?? []) {
        if (line.trim()) void sayChat(line);
      }
    } catch (error) {
      console.warn('Song request failed', error);
    }
  }, [controlHeaders, sayChat]);

  const announceTriviaSeason = useCallback(async (user: string) => {
    try {
      const res = await fetch('/api/trivia/season', { cache: 'no-store' });
      const data = await res.json() as { message?: string };
      if (!res.ok || !data.message) throw new Error('season lookup failed');
      void sayChat(`@${user} ${data.message}`);
    } catch (error) {
      console.warn('Trivia season command failed', error);
      void sayChat(`@${user} season standings unavailable right now.`);
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

      if (tryHandleRewardRedemption(t, username, m)) {
        rememberChatLine(username, m);
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
            handleElroyMention(username, displayName, m, isBroadcaster);
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
      const command = parseChatCommand(m);
      if (!command) return;
      if (isFullyMuted() && !COMMANDS_ALLOWED_WHILE_MUTED.has(command.id)) return;
      const isMod = t.mod === true || isBroadcaster;
      const arg = command.args.join(' ');

      switch (command.id) {
        case 'quota': return void queueBongLogic('', username, { isQuota: true });
        case 'leaderboard': return void announceTriviaLeaderboard(username);
        case 'season': return void announceTriviaSeason(username);
        case 'aboutme': return void announceAboutMe(username);
        case 'commands': return void announceCommandsLink(username);
        case 'trivia': return void handleTriviaRequest(username, m);
        case 'np': return void requestSpotifyComment(username);
        case 'sr': {
          const arg0 = command.args[0]?.toLowerCase();
          if (isMod && command.args.length === 1 && (arg0 === 'on' || arg0 === 'off')) {
            return void postSongRequestAction({ action: 'toggle', username, isMod, enabled: arg0 === 'on' });
          }
          const role = isMod ? 'mod' : t.badges?.vip ? 'vip' : t.subscriber || t.badges?.subscriber || t.badges?.founder ? 'sub' : 'viewer';
          return void postSongRequestAction({ action: 'request', username, displayName, role, query: arg });
        }
        case 'queue': return void postSongRequestAction({ action: 'list', username });
        case 'wrongsong': return void postSongRequestAction({ action: 'wrongsong', username, displayName });
        case 'srremove': return void postSongRequestAction({ action: 'remove', username, isMod, target: arg });
        case 'skip': return void postSongRequestAction({ action: 'skip', username, isMod });
        case 'srclear': return void postSongRequestAction({ action: 'clear', username, isMod });
        case 'clip': return void handleClipCommand(username);
        case 'poll': return void handlePollCommand(username, m, isMod);
        case 'stream': return void announceStreamMetadata(username);

        case 'bj': case 'bet': case 'hit': case 'stand': case 'double': case 'table':
        case 'chips': case 'dare': case 'loan': case 'debt': case 'bjtop': case 'bjstop': case 'give':
          return handleBlackjackCommand(command.id, username, displayName, normalizedChannel, isMod, m);

        case 'roulette': case 'rtable': case 'rstop': case 'rbet':
          return handleRouletteCommand(command.id, username, displayName, isMod, m);

        case 'pick3': case 'p3table': case 'p3stop': case 'p3bet':
          return handlePickCommand('pick3', command.id, username, displayName, isMod, m);
        case 'pick4': case 'p4table': case 'p4stop': case 'p4bet':
          return handlePickCommand('pick4', command.id, username, displayName, isMod, m);

        case 'ding':
          if (isMod) toggleDing(username);
          return;
        case 'voice':
          if (isMod) toggleVoice(username);
          return;
        case 'elroyoff':
          if (isMod) void stopBot(username);
          return;
        case 'volume': {
          if (!isMod) return;
          if (!arg) {
            void sayChat(`@${username} volume ${Math.round(volumeRef.current * 100)}%.`);
            return;
          }
          const deltaMatch = arg.match(/^([+-])(\d+)$/);
          if (deltaMatch) {
            const delta = (deltaMatch[1] === '+' ? 1 : -1) * Number(deltaMatch[2]) / 100;
            return setVolume(volumeRef.current + delta, username);
          }
          const level = Number(arg.replace(/%$/, ''));
          if (!Number.isFinite(level)) {
            void sayChat(`@${username} use !volume, !volume 50, or !volume +10 / -10.`);
            return;
          }
          return setVolume(level / 100, username);
        }
        default: {
          const unhandled: never = command.id;
          console.warn('Command has no handler', unhandled);
        }
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
        is_gift: false,
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

    try {
      await client.connect();
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
      void resolveChannelRewards();
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
      {showWidgets && isActive ? (
        <OverlayWidgets
          trivia={widgetTrivia}
          track={widgetTrack}
          tables={widgetTables}
          now={widgetNow}
        />
      ) : null}
      <div
        style={{
          display: !showHud && isActive ? 'none' : undefined,
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
            {runtimeHud.studio ? (
              <div style={{ color: '#C4B5FD', marginTop: '4px', fontSize: '12px' }}>
                Studio: {runtimeHud.studio}
              </div>
            ) : null}
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
          <>
            {showBubble && elroyBubble ? (
              <div
                key={elroyBubble.id}
                style={{
                  position: 'fixed',
                  top: 24,
                  right: 24,
                  maxWidth: 380,
                  background: 'rgba(12, 6, 24, 0.85)',
                  border: '2px solid #9146FF',
                  borderRadius: 14,
                  padding: '10px 14px',
                  fontSize: 17,
                  lineHeight: 1.35,
                  boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: '#C4B5FD', marginBottom: 3 }}>ELROY</div>
                {elroyBubble.text}
              </div>
            ) : null}
            {showCaptions && hostCaption ? (
              <div
                key={hostCaption.id}
                style={{
                  position: 'fixed',
                  left: '50%',
                  bottom: 40,
                  transform: 'translateX(-50%)',
                  maxWidth: 1100,
                  width: 'max-content',
                  background: 'rgba(0, 0, 0, 0.72)',
                  borderRadius: 10,
                  padding: '8px 18px',
                  fontSize: 30,
                  lineHeight: 1.3,
                  textAlign: 'center',
                  textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                }}
              >
                {hostCaption.text}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

const TRIVIA_CATEGORY_LABEL: Record<TriviaCategory, string> = {
  cannabis: '🌿 Cannabis trivia',
  freaky: '🔥 Freaky trivia',
  music90s: '🎵 90s music trivia',
};

const widgetCard: React.CSSProperties = {
  background: 'rgba(12, 6, 24, 0.88)',
  border: '2px solid #9146FF',
  borderRadius: 16,
  padding: '14px 18px',
  color: 'white',
  boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
  maxWidth: 520,
};

/** Viewer-facing cards (bottom-left). Hide with ?widgets=off on the OBS source URL. */
function OverlayWidgets({
  trivia,
  track,
  tables,
  now,
}: {
  trivia: { category: TriviaCategory; question: string; points: number; endsAt: number; winner?: string; answer?: string } | null;
  track: { name: string; artists: string; requestedBy?: string; requestsOff?: boolean } | null;
  tables: { blackjack: boolean; roulette: boolean; pick3: boolean; pick4: boolean };
  now: number;
}) {
  const openTables = [
    tables.blackjack ? '🃏 Blackjack — !bj' : '',
    tables.roulette ? '🎡 Roulette — !rbet' : '',
    tables.pick3 ? '🎲 Pick 3 — !p3bet' : '',
    tables.pick4 ? '🎲 Pick 4 — !p4bet' : '',
  ].filter(Boolean);
  const secondsLeft = trivia ? Math.max(0, Math.ceil((trivia.endsAt - now) / 1000)) : 0;
  const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  if (!trivia && !track && !openTables.length) return null;

  return (
    <div style={{ position: 'fixed', left: 32, bottom: 32, display: 'flex', flexDirection: 'column', gap: 12, zIndex: 900 }}>
      {trivia ? (
        <div style={widgetCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 16, color: '#C4B5FD', fontWeight: 700 }}>
            <span>{TRIVIA_CATEGORY_LABEL[trivia.category] ?? 'Trivia'} · {trivia.points} pt{trivia.points === 1 ? '' : 's'}</span>
            {trivia.winner ? null : <span style={{ fontVariantNumeric: 'tabular-nums', color: secondsLeft <= 60 ? '#FCA5A5' : '#FDE68A' }}>{clock}</span>}
          </div>
          <div style={{ fontSize: 24, lineHeight: 1.3, marginTop: 6, fontWeight: 600 }}>{trivia.question}</div>
          <div style={{ fontSize: 16, marginTop: 8, color: trivia.winner ? '#86EFAC' : 'rgba(255,255,255,0.7)' }}>
            {trivia.winner
              ? `🎉 ${trivia.winner} got it — ${trivia.answer}`
              : 'First correct answer in chat wins'}
          </div>
        </div>
      ) : null}
      {openTables.length ? (
        <div style={{ ...widgetCard, padding: '10px 16px', fontSize: 18, fontWeight: 600 }}>
          {openTables.map((line) => <div key={line}>{line}</div>)}
        </div>
      ) : null}
      {track ? (
        <div style={{ ...widgetCard, padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 22 }}>🎶</span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{track.name}</div>
            <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.7)' }}>{track.artists}</div>
            {track.requestedBy ? (
              <div style={{ fontSize: 14, color: '#C4B5FD', marginTop: 2 }}>requested by @{track.requestedBy.replace(/^@/, '')}</div>
            ) : (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                {track.requestsOff ? 'song requests off' : 'type !sr <song> to request'}
              </div>
            )}
          </div>
        </div>
      ) : null}
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
