"use client";

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import tmi from 'tmi.js';

function BongContent() {
  const [isActive, setIsActive] = useState(false);
  const [log, setLog] = useState<any[]>([]);
  const [isGongOn, setIsGongOn] = useState(true);
  const searchParams = useSearchParams();
  const [diagnostics, setDiagnostics] = useState({ chat: "...", speech: "...", sound: "...", quota: "..." });

  const clientRef = useRef<tmi.Client | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const gongEnabledRef = useRef(true);
  const recentChatRef = useRef<Array<{ user: string; text: string }>>([]);

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

  const speak = async (text: string) => {
    try {
      const res = await fetch('/api/speech', { method: 'POST', body: JSON.stringify({ text }) });
      const audio = new Audio(URL.createObjectURL(await res.blob()));
      await audio.play();
    } catch (e) { console.warn("Audio blocked"); }
  };

  const processBongLogic = useCallback(async (input: string, user?: string, isQuota = false) => {
    try {
      if (isQuota) {
        const res = await fetch('/api/quota');
        const d = await res.json();
        clientRef.current?.say(process.env.NEXT_PUBLIC_TWITCH_CHANNEL!, `@${user} I got ${d.remaining.toLocaleString()} chars until ${d.resetDate}.`);
        return;
      }
      const fullPrompt = `${input}\n\nResponse requirements:\n- Make your response about 2x your normal length.\n- Aim for roughly 220-320 characters.\n- Keep the same OG personality and rhythm.`;
      const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ prompt: fullPrompt }) });
      const data = await res.json();
      setLog(p => [{ text: data.text }, ...p].slice(0, 5));
      clientRef.current?.say(process.env.NEXT_PUBLIC_TWITCH_CHANNEL!, user ? `@${user} ${data.text}` : data.text);
      
      if (gongEnabledRef.current) {
        const rip = new Audio('/sounds/bong.mp3');
        await rip.play().catch(() => {});
      }
      setTimeout(() => speak(data.text), gongEnabledRef.current ? 1600 : 0);
      runDiagnostics();
    } catch (e) { console.error(e); }
  }, [runDiagnostics]);

  const startAutoCommentary = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      processBongLogic(buildChatAwarePrompt());
      startAutoCommentary();
    }, Math.random() * (300000 - 180000) + 180000); // 3-5 mins
  }, [buildChatAwarePrompt, processBongLogic]);

  const toggleGong = useCallback((user?: string) => {
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    const nextState = !gongEnabledRef.current;
    gongEnabledRef.current = nextState;
    setIsGongOn(nextState);
    clientRef.current?.say(channel, user ? `@${user} gong ${nextState ? 'on' : 'off'}.` : `gong ${nextState ? 'on' : 'off'}.`);
  }, []);

  const stopBot = useCallback(async (announceUser?: string) => {
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL!;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
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
    const client = new tmi.Client({ identity: { username: chan, password: process.env.NEXT_PUBLIC_TWITCH_OAUTH_TOKEN! }, channels: [chan] });
    client.on('message', (_c: string, t: tmi.ChatUserstate, m: string, s: boolean) => {
      if (s) return;
      const username = t.username || 'viewer';
      if (!m.startsWith('!')) {
        rememberChatLine(username, m);
      }
      if (m.toLowerCase() === '!quota') return processBongLogic('', t.username, true);
      if (m.toLowerCase() === '!gong') {
        const normalizedUser = (t.username || '').toLowerCase();
        const isBroadcaster = normalizedUser === normalizedChannel;
        const isModerator = t.mod === true;
        if (isBroadcaster || isModerator) {
          return toggleGong(t.username);
        }
        return;
      }
      if (m.toLowerCase() === '!elroyoff') {
        const normalizedUser = (t.username || '').toLowerCase();
        const isBroadcaster = normalizedUser === normalizedChannel;
        const isModerator = t.mod === true;
        if (isBroadcaster || isModerator) {
          return void stopBot(t.username);
        }
        return;
      }
      if (m.toLowerCase().startsWith('!ask')) return processBongLogic(m.slice(4), t.username);
    });
    await client.connect();
    clientRef.current = client;
    setIsActive(true);
    startAutoCommentary();
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