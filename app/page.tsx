"use client";

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import tmi from 'tmi.js';

function BongContent() {
  const [isActive, setIsActive] = useState(false);
  const [log, setLog] = useState<any[]>([]);
  const searchParams = useSearchParams();
  const [diagnostics, setDiagnostics] = useState({
    chatRoute: "Testing...",
    speechRoute: "Testing...",
    bongSound: "Testing..."
  });

  const clientRef = useRef<tmi.Client | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. DIAGNOSTICS
  useEffect(() => {
    async function runDiagnostics() {
      const results = { ...diagnostics };
      try {
        const res = await fetch('/api/chat', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'ping' }) 
        });
        results.chatRoute = res.status === 200 ? "✅ 200 OK" : `❌ ${res.status}`;
      } catch (e) { results.chatRoute = "❌ Error"; }

      try {
        const res = await fetch('/api/speech', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'ping' }) 
        });
        results.speechRoute = res.status === 200 ? "✅ 200 OK" : `❌ ${res.status}`;
      } catch (e) { results.speechRoute = "❌ Error"; }

      try {
        const res = await fetch('/sounds/bong.mp3');
        results.bongSound = res.ok ? "✅ Found" : "❌ 404";
      } catch (e) { results.bongSound = "❌ Error"; }

      setDiagnostics(results);
    }
    runDiagnostics();
  }, []);

  const speak = async (text: string) => {
    try {
      const res = await fetch('/api/speech', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }) 
      });
      const blob = await res.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      await audio.play();
    } catch (err) { console.error("Voice Error:", err); }
  };

  const processBongLogic = useCallback(async (input: string, username?: string) => {
    try {
      const chatRes = await fetch('/api/chat', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: input }) 
      });
      const data = await chatRes.json();
      setLog(prev => [{ text: data.text }, ...prev].slice(0, 5));

      if (clientRef.current) {
        const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL || '';
        clientRef.current.say(channel, username ? `@${username} ${data.text}` : data.text);
      }

      const rip = new Audio('/sounds/bong.mp3');
      await rip.play();
      setTimeout(() => speak(data.text), 1600);
    } catch (e) { console.error("Bong Logic Error:", e); }
  }, []);

  const startAutonomousTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const randomTime = Math.floor(Math.random() * (300000 - 180000 + 1) + 180000);
    timerRef.current = setTimeout(() => {
      processBongLogic("Give the stream a random piece of OG 710 wisdom or a sassy remark about life.");
      startAutonomousTimer();
    }, randomTime);
  }, [processBongLogic]);

  const startBot = async () => {
    if (isActive) return;
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL || '';
    const token = process.env.NEXT_PUBLIC_TWITCH_OAUTH_TOKEN || '';
    const client = new tmi.Client({ identity: { username: channel, password: token }, channels: [channel] });

    client.on('message', (chan, tags, message, self) => {
      if (self || !message.toLowerCase().startsWith('!ask')) return;
      processBongLogic(message.slice(4), tags.username);
    });

    await client.connect();
    clientRef.current = client;
    setIsActive(true);
    startAutonomousTimer();
  };

  // AUTO-START LOGIC: If URL has ?autostart=true, fire the bot immediately
  useEffect(() => {
    if (searchParams.get('autostart') === 'true') {
      startBot();
    }
  }, [searchParams]);

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', padding: '60px', color: 'white', backgroundColor: 'transparent', fontFamily: 'sans-serif' }}>
      {!isActive && (
        <div style={{ position: 'fixed', top: 20, right: 20, background: 'rgba(0,0,0,0.9)', padding: '20px', borderRadius: '15px', border: '2px solid #9146FF', zIndex: 1000, fontSize: '18px' }}>
          <div style={{ color: '#9146FF', fontWeight: '900', marginBottom: '10px', textTransform: 'uppercase' }}>🔧 System Check</div>
          <div>Brain: {diagnostics.chatRoute}</div>
          <div>Voice: {diagnostics.speechRoute}</div>
          <div>Sound: {diagnostics.bongSound}</div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        {!isActive ? (
          <button onClick={startBot} style={{ padding: '50px 100px', backgroundColor: '#9146FF', color: 'white', fontSize: '50px', fontWeight: '900', borderRadius: '30px', cursor: 'pointer', border: 'none' }}>
            IGNITE BONG
          </button>
        ) : (
          <div style={{ width: '800px', display: 'flex', flexDirection: 'column-reverse', gap: '25px' }}>
            {log.map((e, i) => (
              <div key={i} style={{ background: 'rgba(0,0,0,0.95)', padding: '35px', borderRadius: '25px', borderLeft: '12px solid #9146FF', fontSize: '36px', fontWeight: 'bold', animation: 'slideIn 0.3s ease-out' }}>
                {e.text}
              </div>
            ))}
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes slideIn { from { transform: translateX(-50px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `}</style>
    </div>
  );
}

// Main component with Suspense boundary for Vercel/Next.js
export default function BongOverlay() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <BongContent />
    </Suspense>
  );
}
