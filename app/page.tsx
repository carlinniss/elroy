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
  const lastElroyResponseRef = useRef(0);
  const responseQueueRef = useRef<Promise<void>>(Promise.resolve());
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve());

  const SHUT_UP_DURATION_MS = 8 * 60 * 1000;
  const MENTION_COOLDOWN_MS = 45_000;
  const COMEBACK_COOLDOWN_MS = 3 * 60 * 1000;
  const COMEBACK_CHANCE = 0.22;
  const CELEBRATION_COOLDOWN_MS = 25_000;
  const FOLLOWER_POLL_MS = 45_000;
  const STREAM_CHECKIN_MS = 10 * 60 * 1000;

  const lastCelebrationRef = useRef(0);
  const knownFollowerIdsRef = useRef<Set<string>>(new Set());
  const followersInitializedRef = useRef(false);
  const followerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamCheckinRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mentionsElroy = (text: string) => /\belroy\b/i.test(text);

  const isShutUpCommand = (text: string) => {
    const lower = text.toLowerCase();
    if (!mentionsElroy(lower)) return false;
    return /\b(shut\s*up|be\s*quiet|stfu|stop\s*talking|zip\s*it|can\s*you\s*not|go\s*away|leave\s*us\s*alone|silence|shush)\b/.test(lower);
  };

  const isSilenced = () => Date.now() < silencedUntilRef.current;

  const canRespondToElroy = (cooldownMs: number) =>
    Date.now() - lastElroyResponseRef.current >= cooldownMs;

  const rememberChatLine = useCallback((user: string, text: string) => {
    const normalized = text.trim();
    if (!normalized) return;
    const now = Date.now();
    recentChatRef.current = [
      { user, text: normalized, at: now },
      ...recentChatRef.current.filter((entry) => now - entry.at < STREAM_CHECKIN_MS),
    ].slice(0, 80);
  }, []);

  const buildChatAwarePrompt = useCallback(() => {
    const recent = recentChatRef.current.slice(0, 8);
    if (!recent.length) {
      return "No one is chatting yet. Drop a longer, welcoming OG check-in and invite chat to ask a question.";
    }
    const lines = recent.map((entry) => `- ${entry.user}: ${entry.text}`).join("\n");
    return `Use the recent Twitch chat to make a topical OG comment (not random). Reference the vibe, themes, or jokes from these messages:\n${lines}\nKeep it natural and conversational for stream chat.`;
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
    return `Someone brought you up in Twitch chat. ${user} said: "${message}"\n\nRecent chat:\n${context}\n\nRespond in character to what they're saying about you — answer the vibe, joke, or question naturally for stream chat.`;
  }, []);

  const buildFollowPrompt = useCallback((user: string) =>
    `${user} just followed the Twitch channel. Welcome them with a warm, hype OG hello — make them feel seen and glad they joined the community.`, []);

  const buildSubPrompt = useCallback((user: string, details: string) =>
    `${user} just subscribed to the channel! ${details} Celebrate them in your OG style — genuine gratitude, stream hype, make them feel legendary.`, []);

  const buildBitsPrompt = useCallback((user: string, details: string) =>
    `${user} just cheered ${details} in chat! Celebrate the support with enthusiastic OG energy and thank them by name.`, []);

  const buildStreamCheckinPrompt = useCallback((viewerCount: number | null, isLive: boolean) => {
    const cutoff = Date.now() - STREAM_CHECKIN_MS;
    const recent = recentChatRef.current.filter((entry) => entry.at >= cutoff);
    const lines = recent.length
      ? recent.map((entry) => `- ${entry.user}: ${entry.text}`).join('\n')
      : '(chat has been quiet)';
    const viewerLine =
      isLive && viewerCount != null
        ? `The stream is LIVE with ${viewerCount} viewers right now.`
        : !isLive
          ? 'The stream appears offline.'
          : 'Viewer count is unavailable — still do a check-in.';
    return `10-minute stream check-in.\n${viewerLine}\n\nRecent chat (last ~10 minutes):\n${lines}\n\nGive one OG check-in that:\n- Naturally mentions how many people are watching (use the viewer count above when available).\n- Picks the single most interesting, funny, or engaging chatter from the list and shouts them out BY USERNAME — reference what they said that stood out.\n- If chat was quiet, hype the lurkers anyway without inventing usernames.\n- Only name chatters who appear in the list above.`;
  }, []);

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
    opts: { isQuota?: boolean; forceVoice?: boolean } = {},
  ) => {
    try {
      if (opts.isQuota) {
        const res = await fetch('/api/quota');
        const d = await res.json();
        clientRef.current?.say(process.env.NEXT_PUBLIC_TWITCH_CHANNEL!, `@${user} I got ${d.remaining.toLocaleString()} chars until ${d.resetDate}.`);
        return;
      }
      const personalizationRule = user
        ? `- Personalize the response directly for ${user} by name (say their username naturally in the message).`
        : `- Keep it general for the whole chat, not aimed at one person.`;
      const fullPrompt = `${input}\n\nResponse requirements:\n- Make your response about 2x your normal length.\n- Aim for roughly 220-320 characters.\n- Keep the same OG personality and rhythm.\n${personalizationRule}`;
      const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ prompt: fullPrompt }) });
      const data = await res.json();
      setLog(p => [{ text: data.text }, ...p].slice(0, 5));
      clientRef.current?.say(process.env.NEXT_PUBLIC_TWITCH_CHANNEL!, user ? `@${user} ${data.text}` : data.text);
      lastElroyResponseRef.current = Date.now();

      if (gongEnabledRef.current) {
        const rip = new Audio('/sounds/bong.mp3');
        rip.volume = volumeRef.current;
        await rip.play().catch(() => {});
      }
      const speechDelayMs = gongEnabledRef.current ? 1600 : 0;
      if (speechDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, speechDelayMs));
      }
      if (opts.forceVoice || voiceEnabledRef.current) {
        await speak(data.text);
      }
      runDiagnostics();
    } catch (e) { console.error(e); }
  }, [runDiagnostics]);

  const queueBongLogic = useCallback((
    input: string,
    user?: string,
    opts: { isQuota?: boolean; forceVoice?: boolean } = {},
  ) => {
    responseQueueRef.current = responseQueueRef.current
      .then(() => processBongLogic(input, user, opts))
      .catch((e) => { console.error(e); });
    return responseQueueRef.current;
  }, [processBongLogic]);

  const enterSilence = useCallback(() => {
    silencedUntilRef.current = Date.now() + SHUT_UP_DURATION_MS;
    voiceEnabledRef.current = false;
    setIsVoiceOn(false);
  }, []);

  const canCelebrate = () => Date.now() - lastCelebrationRef.current >= CELEBRATION_COOLDOWN_MS;

  const celebrate = useCallback((kind: 'follow' | 'sub' | 'bits', username: string, extra = '') => {
    if (!canCelebrate()) return;
    lastCelebrationRef.current = Date.now();
    const prompt =
      kind === 'follow' ? buildFollowPrompt(username)
      : kind === 'sub' ? buildSubPrompt(username, extra)
      : buildBitsPrompt(username, extra);
    void queueBongLogic(prompt, username, { forceVoice: true });
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

  const runStreamCheckin = useCallback(async () => {
    if (isSilenced()) return;
    let viewerCount: number | null = null;
    let isLive = false;
    try {
      const res = await fetch('/api/twitch/stream');
      const data = await res.json();
      if (res.ok) {
        isLive = Boolean(data.is_live);
        if (typeof data.viewer_count === 'number') viewerCount = data.viewer_count;
      }
    } catch (e) {
      console.warn('Stream check-in failed', e);
    }
    void queueBongLogic(buildStreamCheckinPrompt(viewerCount, isLive));
  }, [buildStreamCheckinPrompt, queueBongLogic]);

  const startStreamCheckins = useCallback(() => {
    if (streamCheckinRef.current) return;
    streamCheckinRef.current = setInterval(() => {
      void runStreamCheckin();
    }, STREAM_CHECKIN_MS);
  }, [runStreamCheckin]);

  const stopStreamCheckins = useCallback(() => {
    if (streamCheckinRef.current) {
      clearInterval(streamCheckinRef.current);
      streamCheckinRef.current = null;
    }
  }, []);

  const handleElroyMention = useCallback((username: string, message: string) => {
    if (isSilenced()) {
      if (!canRespondToElroy(COMEBACK_COOLDOWN_MS) || Math.random() >= COMEBACK_CHANCE) return;
      void queueBongLogic(buildComebackPrompt(username, message), username, { forceVoice: true });
      return;
    }
    if (!canRespondToElroy(MENTION_COOLDOWN_MS)) return;
    void queueBongLogic(buildMentionPrompt(username, message), username);
  }, [buildComebackPrompt, buildMentionPrompt, queueBongLogic]);

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
    stopStreamCheckins();
    setIsActive(false);
  }, [stopFollowerPolling, stopStreamCheckins]);

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

      const isWizebot = normalizedUser === 'wizebot';
      const isBotAccount = normalizedUser === normalizedChannel;

      if (!m.startsWith('!')) {
        rememberChatLine(username, m);

        if (!isBotAccount && !isWizebot) {
          if (isShutUpCommand(m)) {
            enterSilence();
            return;
          }

          if (mentionsElroy(m)) {
            handleElroyMention(username, m);
          } else if (!isSilenced() && !isBroadcaster) {
            chatMessageCountRef.current += 1;
            if (chatMessageCountRef.current >= 60) {
              chatMessageCountRef.current = 0;
              void queueBongLogic(buildChatAwarePrompt());
            }
          }
        }
      }
      if (m.toLowerCase() === '!quota') return queueBongLogic('', t.username, { isQuota: true });
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
    startFollowerPolling();
    startStreamCheckins();
    clientRef.current?.say(chan, 'I AM ALIVE!');
    const startupDelayMs = gongEnabledRef.current ? 1600 : 0;
    if (voiceEnabledRef.current) {
      void setTimeout(() => {
        void speak('I AM ALIVE!');
      }, startupDelayMs);
    }
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