import { useCallback, useState } from "react";

const [, setDiagnostics] = useState({
  chat: "❌",
  speech: "❌",
  sound: "❌",
  quota: "❌ Error",
});

const runDiagnostics = useCallback(async () => {
  try {
    const [chat, speech, sound, quotaRes] = await Promise.all([
      fetch('/api/chat', { method: 'POST', body: JSON.stringify({ prompt: 'ping' }) }),
      fetch('/api/speech', { method: 'POST', body: JSON.stringify({ text: 'ping' }) }),
      fetch('/sounds/bong.mp3'),
      fetch('/api/quota')
    ]);

    // SAFE PARSING: Check if response is OK before calling .json()
    let qData = { remaining: 0 };
    if (quotaRes.ok) {
      try {
        qData = await quotaRes.json();
      } catch (e) { console.error("Quota JSON invalid"); }
    }

    setDiagnostics({
      chat: chat.status === 200 ? "✅" : "❌",
      speech: speech.status === 200 ? "✅" : "❌",
      sound: sound.ok ? "✅" : "❌",
      quota: qData.remaining ? `${qData.remaining.toLocaleString()} left` : "❌ Error"
    });
  } catch (e) { 
    console.error("Diagnosis complete failure:", e); 
  }
}, []);