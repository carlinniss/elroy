"use client";

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import tmi from 'tmi.js';

function BongContent() {
  const [isActive, setIsActive] = useState(false);
  const [log, setLog] = useState<any[]>([]);
  const [isGongOn, setIsGongOn] = useState(true);
  const [isVoiceOn, setIsVoiceOn] = useState(true);
  const searchParams = useSearchParams();
  const [diagnostics, setDiagnostics] = useState({ chat: "...", speech: "...", sound: "...", quota: "..." });

  const DEFAULT_VOLUME = 0.85;
  const clientRef = useRef<tmi.Client | null>(null);
  const gongEnabledRef = useRef(true);
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
  const FOLLOWER_POLL_MS = 45_000;
  const STREAM_CHECKIN_MS = 15 * 60 * 1000;
  const STREAM_POLL_MS = 60_000;
  const CHAT_ACTIVITY_MESSAGE_THRESHOLD = 90;
  const CHAT_ACTIVITY_CHANCE = 0.55;
  const SESSION_CHAT_MAX = 600;
  const SESSION_STORAGE_KEY = 'elroy-stream-session';

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
  const streamCheckinRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamLiveRef = useRef(false);
  const sessionChatRef = useRef<Array<{ user: string; text: string; at: number }>>([]);
  const streamStartedAtRef = useRef<number | null>(null);
  const shutElroyPowerUpIdRef = useRef<string | null>(null);
  const powerupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRedemptionPollRef = useRef(Date.now());
  const processedRedemptionIdsRef = useRef<Set<string>>(new Set());
  const powerupStorageWarnedRef = useRef(false);
  const POWERUP_POLL_MS = 2_000;

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
    const cooldown = priority === 'celebration' ? CELEBRATION_VOICE_COOLDOWN_MS : VOICE_COOLDOWN_MS;
    return Date.now() - lastElroyVoiceRef.current >= cooldown;
  };

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
    postMuteCountdown();
    muteCountdownRef.current = setInterval(() => {
      postMuteCountdown();
    }, 60_000);
  }, [postMuteCountdown, stopMuteCountdown]);

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
      }));
    } catch (e) {
      console.warn('Session save failed', e);
    }
  }, []);

  const clearStreamSession = useCallback(() => {
    sessionChatRef.current = [];
    streamStartedAtRef.current = null;
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* ignore */ }
    }
  }, []);

  const restoreStreamSession = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { startedAt?: number; messages?: Array<{ user: string; text: string; at: number }> };
      if (parsed.startedAt && Array.isArray(parsed.messages)) {
        streamStartedAtRef.current = parsed.startedAt;
        sessionChatRef.current = parsed.messages.slice(0, SESSION_CHAT_MAX);
      }
    } catch (e) {
      console.warn('Session restore failed', e);
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
    return `Use the recent Twitch chat to make ONE short topical comment (1-2 sentences). Reference the vibe from these messages:\n${lines}\nDo not force a rhyme.`;
  }, []);

  const runDiagnostics = useCallback(async () => {
    try {
      const chat = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ prompt: 'ping' }) });
      const speech = await fetch('/api/speech', { method: 'POST', body: JSON.stringify({ text: 'ping' }) });
      const sound = await fetch('/sounds/bong.mp3');
      const quotaRes = await fetch('/api/quota');
      const qData = await quotaRes.json();

      setDiagnostics({
        chat: chat.status === 200 ? "✅" : "❌",
        speech: speech.status === 200 ? "✅" : "❌",
        sound: sound.ok ? "✅" : "❌",
        quota: `${qData.remaining.toLocaleString()} left`
      });
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { runDiagnostics(); }, [runDiagnostics]);
  useEffect(() => { gongEnabledRef.current = isGongOn; }, [isGongOn]);
  useEffect(() => { voiceEnabledRef.current = isVoiceOn; }, [isVoiceOn]);

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
      .catch((e) => { console.error(e); });
    return speechQueueRef.current;
  }, []);

  const buildMentionPrompt = useCallback((user: string, message: string) => {
    const recent = recentChatRef.current.slice(0, 6);
    const context = recent.length
      ? recent.map((entry) => `- ${entry.user}: ${entry.text}`).join('\n')
      : '(no other recent lines)';
    return `Someone brought you up in Twitch chat. ${user} said: "${message}"\n\nRecent chat:\n${context}\n\nRespond in character — one or two short sentences max for stream chat.`;
  }, []);

  const buildLRoyRoastPrompt = useCallback((user: string, message: string) => {
    const recent = recentChatRef.current.slice(0, 6);
    const context = recent.length
      ? recent.map((entry) => `- ${entry.user}: ${entry.text}`).join('\n')
      : '(no other recent lines)';
    return `${user} called you "L Roy" in Twitch chat (wrong name — you are ELROY, not L Roy): "${message}"\n\nRecent chat:\n${context}\n\nRoast ${user} by username for the misname. One or two short sentences — funny, crusty, playful not cruel.`;
  }, []);

  const buildFollowPrompt = useCallback((user: string) =>
    `${user} just followed the Twitch channel. Welcome them with a warm, hype OG hello — make them feel seen and glad they joined the community.`, []);

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

    return `10-minute stream check-in.\n${viewerLine}\n\nRecent chat (last ~20 minutes):\n${lines}\n\nOne short check-in (2-3 sentences max):\n- Mention viewer count only if provided above.\n- Shout out ONE interesting chatter by username if the list has good material.\n- Only name chatters from the list above.`;
  }, []);

  const buildStreamGreetingPrompt = useCallback((viewerCount: number | null, cannabisFact: string) => {
    const viewers = viewerCount != null ? `About ${viewerCount} viewers are here.` : 'Stream just went live.';
    return `The Twitch stream just went LIVE. ${viewers}\n\nGive a hype stream-start greeting with VOICE energy. You MUST open with exactly "I AM ALIVE!" as the first words, then welcome chat and weave in this cannabis fact naturally: "${cannabisFact}"\nKeep it fun, OG, and welcoming.`;
  }, []);

  const buildStreamGoodbyePrompt = useCallback(() =>
    'The Twitch stream just ended. Give a short, sincere goodbye to chat — thank everyone for hanging out. Chat-only, no voice. One message.', []);

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
    return `You were trying to stay quiet, but chat kept talking about you. ${user} said: "${message}"\n\nRecent chat:\n${context}\n\nSnap back with one funny, crusty call-out — you're annoyed they couldn't let you chill. Roast ${user} by name; keep it playful, not cruel.`;
  }, []);

  const processBongLogic = useCallback(async (
    input: string,
    user?: string,
    opts: {
      isQuota?: boolean;
      forceVoice?: boolean;
      chatOnly?: boolean;
      skipGong?: boolean;
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
      const voiceAllowed = !voiceSilenced && (
        opts.bypassVoiceCooldown || canUseVoice(voicePriority)
      );
      const willUseVoice = Boolean(
        streamLiveRef.current
        && !opts.chatOnly
        && voiceAllowed
        && (opts.forceVoice || voiceEnabledRef.current),
      );

      const personalizationRule = user
        ? `- Personalize the response directly for ${user} by name (say their username naturally in the message).`
        : `- Keep it general for the whole chat, not aimed at one person.`;
      const lengthRule = willUseVoice
        ? '- Keep it SHORT for voice: one or two sentences, roughly 80-160 characters.'
        : '- Chat only (no voice): 1-3 sentences, up to ~220 characters. Be expressive — chat is free.';
      const fullPrompt = `${input}\n\nResponse requirements:\n${lengthRule}\n- Keep the same OG personality and rhythm.\n${personalizationRule}`;
      const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ prompt: fullPrompt }) });
      const data = await res.json();
      setLog(p => [{ text: data.text }, ...p].slice(0, 5));
      clientRef.current?.say(process.env.NEXT_PUBLIC_TWITCH_CHANNEL!, user ? `@${user} ${data.text}` : data.text);
      lastElroyChatRef.current = Date.now();

      if (willUseVoice) {
        lastElroyVoiceRef.current = Date.now();
        const playGong = gongEnabledRef.current && !opts.skipGong;
        if (playGong) {
          const rip = new Audio('/sounds/bong.mp3');
          rip.volume = volumeRef.current;
          await rip.play().catch(() => {});
        }
        const speechDelayMs = playGong ? 1600 : 0;
        if (speechDelayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, speechDelayMs));
        }
        await speak(data.text);
      }
      runDiagnostics();
    } catch (e) { console.error(e); }
  }, [runDiagnostics, speak]);

  const queueBongLogic = useCallback((
    input: string,
    user?: string,
    opts: {
      isQuota?: boolean;
      forceVoice?: boolean;
      chatOnly?: boolean;
      skipGong?: boolean;
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

  const celebrate = useCallback((kind: 'follow' | 'sub' | 'bits', username: string, extra = '') => {
    if (!streamLiveRef.current || isFullyMuted() || !canCelebrate(kind)) return;
    if (kind === 'follow' && !canRespondInChat(FOLLOW_CELEBRATION_COOLDOWN_MS)) return;
    lastCelebrationRef.current = Date.now();
    const prompt =
      kind === 'follow' ? buildFollowPrompt(username)
      : kind === 'sub' ? buildSubPrompt(username, extra)
      : buildBitsPrompt(username, extra);
    void queueBongLogic(prompt, username, {
      forceVoice: true,
      bypassChatCooldown: kind !== 'follow',
      voicePriority: kind === 'follow' ? 'normal' : 'celebration',
    });
  }, [buildBitsPrompt, buildFollowPrompt, buildSubPrompt, queueBongLogic]);

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
      void queueBongLogic(buildStreamGreetingPrompt(viewerCount, randomCannabisFact()), undefined, {
        forceVoice: true,
        bypassChatCooldown: true,
        bypassVoiceCooldown: true,
      });
    }
    persistStreamSession();
  }, [buildStreamGreetingPrompt, persistStreamSession, queueBongLogic]);

  const onStreamEnded = useCallback(() => {
    const summaryPrompt = buildStreamSummaryPrompt();
    responseQueueRef.current = responseQueueRef.current
      .then(() => processBongLogic(buildStreamGoodbyePrompt(), undefined, {
        chatOnly: true,
        skipGong: true,
        bypassChatCooldown: true,
      }))
      .then(() => processBongLogic(summaryPrompt, undefined, {
        chatOnly: true,
        skipGong: true,
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

  const runStreamCheckin = useCallback(async () => {
    if (isSilenced() || !streamLiveRef.current) return;
    const { streamStatus, viewerCount } = await fetchStreamStatus();
    void queueBongLogic(buildStreamCheckinPrompt(viewerCount, streamStatus), undefined, { chatOnly: true });
  }, [buildStreamCheckinPrompt, fetchStreamStatus, queueBongLogic]);

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
  }, [pollStreamLive, runStreamCheckin]);

  const stopStreamMonitoring = useCallback(() => {
    if (streamPollRef.current) {
      clearInterval(streamPollRef.current);
      streamPollRef.current = null;
    }
    if (streamCheckinRef.current) {
      clearInterval(streamCheckinRef.current);
      streamCheckinRef.current = null;
    }
    streamLiveRef.current = false;
  }, []);

  const handleElroyMention = useCallback((username: string, message: string) => {
    if (isFullyMuted()) return;
    if (isSilenced()) {
      if (!streamLiveRef.current || !canRespondInChat(COMEBACK_COOLDOWN_MS) || Math.random() >= COMEBACK_CHANCE) return;
      void queueBongLogic(buildComebackPrompt(username, message), username, { chatOnly: true });
      return;
    }
    if (!canRespondInChat(MENTION_COOLDOWN_MS)) return;
    void queueBongLogic(buildMentionPrompt(username, message), username);
  }, [buildComebackPrompt, buildMentionPrompt, queueBongLogic]);

  const handleLRoyMisname = useCallback((username: string, message: string) => {
    if (isFullyMuted()) return;
    if (isSilenced()) {
      if (!streamLiveRef.current || !canRespondInChat(COMEBACK_COOLDOWN_MS) || Math.random() >= COMEBACK_CHANCE) return;
      void queueBongLogic(buildLRoyRoastPrompt(username, message), username, { chatOnly: true });
      return;
    }
    if (!canRespondInChat(MENTION_COOLDOWN_MS)) return;
    void queueBongLogic(buildLRoyRoastPrompt(username, message), username);
  }, [buildLRoyRoastPrompt, queueBongLogic]);

  const toggleGong = useCallback((user?: string) => {
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    const nextState = !gongEnabledRef.current;
    gongEnabledRef.current = nextState;
    setIsGongOn(nextState);
    clientRef.current?.say(channel, user ? `@${user} gong ${nextState ? 'on' : 'off'}.` : `gong ${nextState ? 'on' : 'off'}.`);
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

  const stopBot = useCallback(async (announceUser?: string) => {
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
    stopStreamMonitoring();
    stopMuteCountdown();
    setIsActive(false);
  }, [stopFollowerPolling, stopPowerupRedemptionPolling, stopStreamMonitoring, stopMuteCountdown]);

  const startBot = async () => {
    if (isActive) return;
    const chan = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    const normalizedChannel = chan.toLowerCase().replace(/^#/, '');
    chatMessageCountRef.current = 0;
    const client = new tmi.Client({ identity: { username: chan, password: process.env.NEXT_PUBLIC_TWITCH_OAUTH_TOKEN! }, channels: [chan] });
    client.on('message', (_c: string, t: tmi.ChatUserstate, m: string, s: boolean) => {
      if (s) return;
      const username = t.username || 'viewer';
      const normalizedUser = username.toLowerCase();
      const isBroadcaster = normalizedUser === normalizedChannel;

      if (isShutElroyPowerUpRedemption(m, t)) {
        enterFullMute(username);
        return;
      }

      const isWizebot = normalizedUser === 'wizebot';
      const isBotAccount = normalizedUser === normalizedChannel;

      if (!m.startsWith('!')) {
        rememberChatLine(username, m);

        if (!isBotAccount && !isWizebot) {
          if (isShutUpCommand(m)) {
            enterSilence();
            return;
          }

          if (misnamesElroyAsLRoy(m)) {
            handleLRoyMisname(username, m);
          } else if (mentionsElroy(m)) {
            handleElroyMention(username, m);
          } else if (streamLiveRef.current && !isFullyMuted() && !isSilenced() && !isBroadcaster) {
            chatMessageCountRef.current += 1;
            if (
              chatMessageCountRef.current >= CHAT_ACTIVITY_MESSAGE_THRESHOLD
              && Math.random() < CHAT_ACTIVITY_CHANCE
            ) {
              chatMessageCountRef.current = 0;
              void queueBongLogic(buildChatAwarePrompt(), undefined, { chatOnly: true });
            }
          }
        }
      }
      if (m.toLowerCase() === '!quota') {
        if (isFullyMuted()) return;
        return queueBongLogic('', t.username, { isQuota: true });
      }
      if (m.toLowerCase() === '!gong') {
        const isModerator = t.mod === true;
        if (isBroadcaster || isModerator) {
          return toggleGong(t.username);
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
      celebrate('bits', username, detail);
    });

    await client.connect();
    clientRef.current = client;
    setIsActive(true);
    client.say(chan, `Elroy initiated. ${randomCannabisFact()}`);
    restoreStreamSession();
    const foundPowerUp = await resolveShutElroyPowerUpId();
    if (foundPowerUp) {
      void ensureEventSubSubscription();
      startPowerupRedemptionPolling();
    }
    startFollowerPolling();
    startStreamMonitoring();
  };

  useEffect(() => { if (searchParams.get('autostart') === 'true') startBot(); }, [searchParams]);
  return (
    <div style={{ height: '100vh', padding: '60px', color: 'white', backgroundColor: 'transparent', fontFamily: 'sans-serif' }}>
      {!isActive && (
        <div style={{ position: 'fixed', top: 20, right: 20, background: 'rgba(0,0,0,0.9)', padding: '20px', borderRadius: '15px', border: '2px solid #9146FF' }}>
          <div>Brain: {diagnostics.chat} | Voice: {diagnostics.speech} | Sound: {diagnostics.sound}</div>
          <div style={{ color: '#00FF00', marginTop: '5px' }}>Quota: {diagnostics.quota}</div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        {!isActive ? (
          <button onClick={startBot} style={{ padding: '40px 80px', background: '#9146FF', borderRadius: '20px', fontSize: '40px', fontWeight: 'bold', color: 'white', cursor: 'pointer' }}>IGNITE BONG</button>
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