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
  const recentChatRef = useRef<Array<{ user: string; text: string }>>([]);
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
    recentChatRef.current = [{ user, text: normalized }, ...recentChatRef.current].slice(0, 12);
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
    setIsActive(false);
  }, []);

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
    await client.connect();
    clientRef.current = client;
    setIsActive(true);
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