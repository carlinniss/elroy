"use client";

import React, { useState, useEffect } from 'react';
import tmi from 'tmi.js';

export default function BongOverlay() {
  const [isActive, setIsActive] = useState(false);
  const [log, setLog] = useState<any[]>([]);
  const [diagnostics, setDiagnostics] = useState({
    chatRoute: "Testing...",
    speechRoute: "Testing...",
    bongSound: "Testing..."
  });

  // DIAGNOSTIC CHECKER - Runs on page load
  useEffect(() => {
    async function runDiagnostics() {
      const results = { ...diagnostics };

      // 1. Test Chat API
      try {
        const res = await fetch('/api/chat', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'ping' }) 
        });
        results.chatRoute = res.status === 200 ? "✅ 200 OK" : `❌ ${res.status}`;
      } catch (e) { results.chatRoute = "❌ Error"; }

      // 2. Test Speech API
      try {
        const res = await fetch('/api/speech', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'ping' }) 
        });
        results.speechRoute = res.status === 200 ? "✅ 200 OK" : `❌ ${res.status}`;
      } catch (e) { results.speechRoute = "❌ Error"; }

      // 3. Test Bong Audio File in /public/sounds/
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
      if (!res.ok) throw new Error(`Speech API returned ${res.status}`);
      const blob = await res.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      await audio.play();
    } catch (err) { 
      console.error("Voice Error:", err); 
    }
  };

  const startBot = async () => {
    const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL || '';
    const token = process.env.NEXT_PUBLIC_TWITCH_OAUTH_TOKEN || '';
    
    const client = new tmi.Client({
      identity: { username: channel, password: token },
      channels: [channel]
    });

    client.on('message', async (chan, tags, message, self) => {
      // Ignore the bot's own messages and messages that don't start with !ask
      if (self || !message.toLowerCase().startsWith('!ask')) return;

      try {
        const chatRes = await fetch('/api/chat', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: message.slice(4) }) 
        });
        const data = await chatRes.json();

        // 1. Update the Overlay UI
        setLog(prev => [{ text: data.text }, ...prev].slice(0, 5));

        // 2. REPLY TO USER IN TWITCH CHAT
        client.say(chan, `@${tags.username} ${data.text}`);

        // 3. Play the Bong Rip sound
        const rip = new Audio('/sounds/bong.mp3');
        await rip.play();

        // 4. Wait for rip to finish (approx 1.6s) before speaking via ElevenLabs
        setTimeout(() => speak(data.text), 1600);

      } catch (e) { 
        console.error("Bong Logic Error:", e); 
      }
    });

    await client.connect();
    setIsActive(true);
  };

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', padding: '60px', color: 'white', backgroundColor: 'transparent', fontFamily: 'sans-serif' }}>
      
      {/* SYSTEM CHECK PANEL */}
      <div style={{ position: 'fixed', top: 20, right: 20, background: 'rgba(0,0,0,0.9)', padding: '20px', borderRadius: '15px', border: '2px solid #9146FF', zIndex: 1000, fontSize: '18px' }}>
        <div style={{ color: '#9146FF', fontWeight: '900', marginBottom: '10px', textTransform: 'uppercase' }}>🔧 System Check</div>
        <div style={{ marginBottom: '5px' }}>Brain (/api/chat): <span style={{ fontWeight: 'bold' }}>{diagnostics.chatRoute}</span></div>
        <div style={{ marginBottom: '5px' }}>Voice (/api/speech): <span style={{ fontWeight: 'bold' }}>{diagnostics.speechRoute}</span></div>
        <div style={{ marginBottom: '10px' }}>Sound (/sounds/bong.mp3): <span style={{ fontWeight: 'bold' }}>{diagnostics.bongSound}</span></div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        {!isActive ? (
          <button onClick={startBot} style={{ padding: '50px 100px', backgroundColor: '#9146FF', color: 'white', fontSize: '50px', fontWeight: '900', borderRadius: '30px', cursor: 'pointer', border: 'none', boxShadow: '0 0 80px rgba(145,70,255,0.6)' }}>
            IGNITE BONG
          </button>
        ) : (
          <div style={{ width: '800px', display: 'flex', flexDirection: 'column-reverse', gap: '25px' }}>
            {log.map((e, i) => (
              <div key={i} style={{ background: 'rgba(0,0,0,0.95)', padding: '35px', borderRadius: '25px', borderLeft: '12px solid #9146FF', fontSize: '36px', fontWeight: 'bold', boxShadow: '10px 10px 30px rgba(0,0,0,0.5)', animation: 'slideIn 0.3s ease-out' }}>
                {e.text}
              </div>
            ))}
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes slideIn {
          from { transform: translateX(-50px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}