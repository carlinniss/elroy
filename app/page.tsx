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
  const controlKey = searchParams.get('controlKey') || '';
  const [diagnostics, setDiagnostics] = useState({ chat: "...", speech: "...", sound: "...", quota: "..." });

  const clientRef = useRef<tmi.Client | null>(null);
  const gongEnabledRef = useRef(true);
  const voiceEnabledRef = useRef(true);
  const recentChatRef = useRef<Array<{ user: string; text: string }>>([]);
  const chatMessageCountRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const responseQueueRef = useRef<Promise<void>>(Promise.resolve());
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve());

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

  const overlayHeaders = useCallback((isJson = false): Record<string, string> => ({
    ...(isJson ? { "Content-Type": "application/json" } : {}),
    "x-overlay-control-secret": controlKey,
  }), [controlKey]);

  const sayChat = useCallback(async (message: string) => {
    const res = await fetch('/api/twitch/say', {
      method: 'POST',
      headers: overlayHeaders(true),
      body: JSON.stringify({ message }),
    });

    if (!res.ok) {
      throw new Error(`Twitch send failed: ${res.status}`);
    }
  }, [overlayHeaders]);

  const runDiagnostics = useCallback(async () => {
    try {
      const chat = await fetch('/api/chat', { method: 'POST', headers: overlayHeaders(true), body: JSON.stringify({ prompt: 'ping' }) });
      const speech = await fetch('/api/speech', { method: 'POST', headers: overlayHeaders(true), body: JSON.stringify({ text: 'ping' }) });
      const sound = await fetch('/sounds/bong.mp3');
      const quotaRes = await fetch('/api/quota', { headers: overlayHeaders() });
      const qData = await quotaRes.json();

      setDiagnostics({
        chat: chat.status === 200 ? "✅" : "❌",
        speech: speech.status === 200 ? "✅" : "❌",
        sound: sound.ok ? "✅" : "❌",
        quota: `${qData.remaining.toLocaleString()} left`
      });
    } catch (e) { console.error(e); }
  }, [overlayHeaders]);

  useEffect(() => { runDiagnostics(); }, [runDiagnostics]);
  useEffect(() => { gongEnabledRef.current = isGongOn; }, [isGongOn]);
  useEffect(() => { voiceEnabledRef.current = isVoiceOn; }, [isVoiceOn]);

  const speakNow = useCallback(async (text: string) => {
    try {
      const res = await fetch('/api/speech', { method: 'POST', headers: overlayHeaders(true), body: JSON.stringify({ text }) });
      const audioUrl = URL.createObjectURL(await res.blob());
      const audio = new Audio(audioUrl);
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
  }, [overlayHeaders]);

  const speak = useCallback((text: string) => {
    speechQueueRef.current = speechQueueRef.current
      .then(() => speakNow(text))
      .catch((e) => { console.error(e); });
    return speechQueueRef.current;
  }, [speakNow]);

  const processBongLogic = useCallback(async (input: string, user?: string, isQuota = false) => {
    try {
      if (isQuota) {
        const res = await fetch('/api/quota', { headers: overlayHeaders() });
        const d = await res.json();
        await sayChat(`@${user} I got ${d.remaining.toLocaleString()} chars until ${d.resetDate}.`);
        return;
      }
      const personalizationRule = user
        ? `- Personalize the response directly for ${user} by name (say their username naturally in the message).`
        : `- Keep it general for the whole chat, not aimed at one person.`;
      const fullPrompt = `${input}\n\nResponse requirements:\n- Make your response about 2x your normal length.\n- Aim for roughly 220-320 characters.\n- Keep the same OG personality and rhythm.\n${personalizationRule}`;
      const res = await fetch('/api/chat', { method: 'POST', headers: overlayHeaders(true), body: JSON.stringify({ prompt: fullPrompt }) });
      const data = await res.json();
      setLog(p => [{ text: data.text }, ...p].slice(0, 5));
      await sayChat(user ? `@${user} ${data.text}` : data.text);
      
      if (gongEnabledRef.current) {
        const rip = new Audio('/sounds/bong.mp3');
        await rip.play().catch(() => {});
      }
      const speechDelayMs = gongEnabledRef.current ? 1600 : 0;
      if (speechDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, speechDelayMs));
      }
      if (voiceEnabledRef.current) {
        await speak(data.text);
      }
      runDiagnostics();
    } catch (e) { console.error(e); }
  }, [overlayHeaders, runDiagnostics, sayChat, speak]);

  const queueBongLogic = useCallback((input: string, user?: string, isQuota = false) => {
    responseQueueRef.current = responseQueueRef.current
      .then(() => processBongLogic(input, user, isQuota))
      .catch((e) => { console.error(e); });
    return responseQueueRef.current;
  }, [processBongLogic]);

  const toggleGong = useCallback((user?: string) => {
    const nextState = !gongEnabledRef.current;
    gongEnabledRef.current = nextState;
    setIsGongOn(nextState);
    void sayChat(user ? `@${user} gong ${nextState ? 'on' : 'off'}.` : `gong ${nextState ? 'on' : 'off'}.`);
  }, [sayChat]);

  const setVoice = useCallback((enabled: boolean, user?: string) => {
    voiceEnabledRef.current = enabled;
    setIsVoiceOn(enabled);
    void sayChat(user ? `@${user} voice ${enabled ? 'on' : 'off'}.` : `voice ${enabled ? 'on' : 'off'}.`);
  }, [sayChat]);

  const stopBot = useCallback(async (announceUser?: string) => {
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
    setIsActive(false);
  }, [sayChat]);

  const startBot = async () => {
    if (isActive) return;
    const chan = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    const normalizedChannel = chan.toLowerCase().replace(/^#/, '');
    chatMessageCountRef.current = 0;
    const client = new tmi.Client({ channels: [chan] });
    client.on('message', (_c: string, t: tmi.ChatUserstate, m: string, s: boolean) => {
      if (s) return;
      const username = t.username || 'viewer';
      const normalizedUser = username.toLowerCase();
      const isBroadcaster = normalizedUser === normalizedChannel;

      if (!m.startsWith('!')) {
        rememberChatLine(username, m);
        const isWizebot = normalizedUser === 'wizebot';
        if (!isWizebot && !isBroadcaster) {
          chatMessageCountRef.current += 1;
          if (chatMessageCountRef.current >= 60) {
            chatMessageCountRef.current = 0;
            void queueBongLogic(buildChatAwarePrompt());
          }
        }
      }
      if (m.toLowerCase() === '!quota') return queueBongLogic('', t.username, true);
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
      if (m.toLowerCase() === '!voiceoff') {
        const isModerator = t.mod === true;
        if (isBroadcaster || isModerator) {
          return setVoice(false, t.username);
        }
        return;
      }
      if (m.toLowerCase() === '!voiceon') {
        const isModerator = t.mod === true;
        if (isBroadcaster || isModerator) {
          return setVoice(true, t.username);
        }
        return;
      }
      if (m.toLowerCase() === '!voicestatus') {
        const isModerator = t.mod === true;
        if (isBroadcaster || isModerator) {
          const state = voiceEnabledRef.current ? 'on' : 'off';
          void sayChat(`@${t.username} voice is ${state}.`);
        }
        return;
      }
      if (m.toLowerCase().startsWith('!ask')) {
        const delayMs = isSpeakingRef.current ? 60_000 : 120_000;
        return void setTimeout(() => {
          void queueBongLogic(m.slice(4), t.username);
        }, delayMs);
      }
    });
    await client.connect();
    clientRef.current = client;
    setIsActive(true);
    void sayChat('I AM ALIVE!');
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