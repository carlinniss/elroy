'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { DirectiveKind, LiveDirective } from '@/lib/live-directives';

const SECRET_STORAGE_KEY = 'elroy-control-secret';

type DirectiveSnapshot = {
  sticky: LiveDirective[];
  next: LiveDirective[];
  push: LiveDirective[];
};

function authHeaders(secret: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${secret}`,
  };
}

function kindLabel(kind: DirectiveKind) {
  if (kind === 'sticky') return 'Sticky';
  if (kind === 'next') return 'Next response';
  return 'Push now';
}

export function ControlPanel({ initialSecret }: { initialSecret?: string }) {
  const [secret, setSecret] = useState('');
  const [savedSecret, setSavedSecret] = useState('');
  const [text, setText] = useState('');
  const [kind, setKind] = useState<DirectiveKind>('sticky');
  const [chatOnly, setChatOnly] = useState(false);
  const [forceVoice, setForceVoice] = useState(false);
  const [directives, setDirectives] = useState<DirectiveSnapshot>({ sticky: [], next: [], push: [] });
  const [status, setStatus] = useState('Enter your control secret to start.');
  const [busy, setBusy] = useState(false);
  const [spotifyStatus, setSpotifyStatus] = useState<{
    configured?: boolean;
    connected?: boolean;
    playing?: boolean;
    track?: { name: string; artists: string[] } | null;
  } | null>(null);

  useEffect(() => {
    const fromUrl = initialSecret?.trim();
    const stored = sessionStorage.getItem(SECRET_STORAGE_KEY)?.trim();
    const resolved = fromUrl || stored || '';
    if (!resolved) return;
    setSecret(resolved);
    setSavedSecret(resolved);
    sessionStorage.setItem(SECRET_STORAGE_KEY, resolved);
    if (fromUrl) {
      setStatus('Secret loaded from URL — ready to steer Elroy.');
    }
  }, [initialSecret]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/directives?t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json() as DirectiveSnapshot & { error?: string };
      if (!res.ok) {
        setStatus(data.error || 'Failed to load directives');
        return;
      }
      setDirectives({
        sticky: data.sticky ?? [],
        next: data.next ?? [],
        push: data.push ?? [],
      });
      setStatus(`Synced ${new Date().toLocaleTimeString()}`);
    } catch {
      setStatus('Could not reach Elroy');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 12_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const refreshSpotify = useCallback(async () => {
    try {
      const res = await fetch(`/api/spotify/status?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      setSpotifyStatus(await res.json());
    } catch {
      setSpotifyStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshSpotify();
    const timer = setInterval(() => { void refreshSpotify(); }, 15_000);
    return () => clearInterval(timer);
  }, [refreshSpotify]);

  const disconnectSpotify = async () => {
    if (!savedSecret) return;
    setBusy(true);
    try {
      const res = await fetch('/api/spotify/disconnect', {
        method: 'POST',
        headers: authHeaders(savedSecret),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setStatus(data.error || 'Spotify disconnect failed');
        return;
      }
      setStatus('Spotify disconnected.');
      await refreshSpotify();
    } finally {
      setBusy(false);
    }
  };

  const saveSecret = () => {
    const trimmed = secret.trim();
    if (!trimmed) return;
    sessionStorage.setItem(SECRET_STORAGE_KEY, trimmed);
    setSavedSecret(trimmed);
    setStatus('Secret saved for this browser session.');
  };

  const addDirective = async () => {
    if (!savedSecret) {
      setStatus('Save your control secret first.');
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;

    setBusy(true);
    try {
      const res = await fetch('/api/directives', {
        method: 'POST',
        headers: authHeaders(savedSecret),
        body: JSON.stringify({
          action: 'add',
          kind,
          text: trimmed,
          chatOnly: kind === 'push' ? chatOnly : undefined,
          forceVoice: kind === 'push' ? forceVoice : undefined,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setStatus(data.error === 'Unauthorized' ? 'Wrong control secret.' : (data.error || 'Add failed'));
        return;
      }
      setText('');
      setStatus(kind === 'push' ? 'Pushed — Elroy should respond within ~12s.' : 'Directive added.');
      await refresh();
    } catch {
      setStatus('Add failed');
    } finally {
      setBusy(false);
    }
  };

  const removeDirective = async (itemKind: DirectiveKind, id: string) => {
    if (!savedSecret) return;
    setBusy(true);
    try {
      const res = await fetch('/api/directives', {
        method: 'DELETE',
        headers: authHeaders(savedSecret),
        body: JSON.stringify({ kind: itemKind, id }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setStatus(data.error || 'Remove failed');
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const clearKind = async (itemKind: DirectiveKind) => {
    if (!savedSecret) return;
    setBusy(true);
    try {
      const res = await fetch('/api/directives', {
        method: 'POST',
        headers: authHeaders(savedSecret),
        body: JSON.stringify({ action: 'clear', kind: itemKind }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setStatus(data.error || 'Clear failed');
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const allItems: LiveDirective[] = [
    ...directives.sticky.map((item) => ({ ...item, kind: 'sticky' as const })),
    ...directives.next.map((item) => ({ ...item, kind: 'next' as const })),
    ...directives.push.map((item) => ({ ...item, kind: 'push' as const })),
  ].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <main style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 20px 48px' }}>
      <header style={{ marginBottom: '28px' }}>
        <p style={{ color: '#b794f6', fontSize: '13px', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
          Elroy broadcaster
        </p>
        <h1 style={{ margin: '8px 0 6px', fontSize: '32px', fontWeight: 700 }}>Live prompt control</h1>
        <p style={{ margin: 0, color: '#c4b5fd', lineHeight: 1.5 }}>
          Steer spontaneous content while you stream — sticky context, one-shot next lines, or push an immediate response.
        </p>
      </header>

      <section style={panelStyle}>
        <h2 style={headingStyle}>Access</h2>
        <p style={hintStyle}>
          Set <code style={codeStyle}>ELROY_CONTROL_SECRET</code> in Vercel to match your bookmark URL
          (e.g. <code style={codeStyle}>/control/dtl</code> → secret is <code style={codeStyle}>dtl</code>).
        </p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Control secret"
            style={inputStyle}
          />
          <button type="button" onClick={saveSecret} style={buttonStyle}>Save secret</button>
        </div>
      </section>

      <section style={panelStyle}>
        <h2 style={headingStyle}>Add directive</h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {(['sticky', 'next', 'push'] as DirectiveKind[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setKind(option)}
              style={{
                ...chipStyle,
                background: kind === option ? '#9146FF' : 'rgba(255,255,255,0.08)',
                borderColor: kind === option ? '#b794f6' : 'rgba(255,255,255,0.12)',
              }}
            >
              {kindLabel(option)}
            </button>
          ))}
        </div>
        <p style={hintStyle}>
          {kind === 'sticky' && 'Stays active until you remove it. Elroy weaves this into banter, check-ins, and mentions.'}
          {kind === 'next' && 'Used once on Elroy\'s very next AI response, then cleared.'}
          {kind === 'push' && 'Fires immediately — Elroy responds now (within the next poll cycle).'}
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Roast chat for calling it 'L Roy' again. Mention we're doing a blunt review segment."
          rows={4}
          style={{ ...inputStyle, width: '100%', resize: 'vertical', marginBottom: '12px' }}
        />
        {kind === 'push' && (
          <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
            <label style={labelStyle}>
              <input type="checkbox" checked={chatOnly} onChange={(e) => setChatOnly(e.target.checked)} />
              Chat only (no voice)
            </label>
            <label style={labelStyle}>
              <input type="checkbox" checked={forceVoice} onChange={(e) => setForceVoice(e.target.checked)} />
              Force voice if live
            </label>
          </div>
        )}
        <button type="button" onClick={() => { void addDirective(); }} disabled={busy || !text.trim()} style={primaryButtonStyle}>
          {kind === 'push' ? 'Push to Elroy now' : 'Add directive'}
        </button>
      </section>

      <section style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h2 style={{ ...headingStyle, marginBottom: 0 }}>Active directives</h2>
          <span style={{ color: '#a78bfa', fontSize: '13px' }}>{status}</span>
        </div>
        {allItems.length === 0 ? (
          <p style={{ ...hintStyle, marginTop: '16px' }}>Nothing queued yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {allItems.map((item) => (
              <li key={item.id} style={itemStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
                  <div>
                    <span style={badgeStyle}>{kindLabel(item.kind)}</span>
                    <p style={{ margin: '8px 0 0', lineHeight: 1.45 }}>{item.text}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { void removeDirective(item.kind, item.id); }}
                    disabled={busy || !savedSecret}
                    style={ghostButtonStyle}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {allItems.length > 0 && savedSecret && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
            {(['sticky', 'next', 'push'] as DirectiveKind[]).map((option) => (
              <button key={option} type="button" onClick={() => { void clearKind(option); }} disabled={busy} style={ghostButtonStyle}>
                Clear all {kindLabel(option).toLowerCase()}
              </button>
            ))}
          </div>
        )}
      </section>

      <section style={panelStyle}>
        <h2 style={headingStyle}>Spotify (now playing)</h2>
        <p style={hintStyle}>
          Connect the stream account so Elroy comments when tracks change — trivia, smoke/sex ratings, hot takes.
          Add redirect URI <code style={codeStyle}>/api/spotify/callback</code> in your Spotify Developer app.
        </p>
        {spotifyStatus?.configured === false && (
          <p style={hintStyle}>Set <code style={codeStyle}>SPOTIFY_CLIENT_ID</code> and <code style={codeStyle}>SPOTIFY_CLIENT_SECRET</code> in Vercel.</p>
        )}
        {spotifyStatus?.connected ? (
          <>
            <p style={{ margin: '0 0 12px', color: '#86efac' }}>Connected</p>
            {spotifyStatus.playing && spotifyStatus.track ? (
              <p style={{ margin: '0 0 12px', lineHeight: 1.45 }}>
                Now: <strong>{spotifyStatus.track.name}</strong>
                {' '}— {spotifyStatus.track.artists.join(', ') || 'Unknown artist'}
              </p>
            ) : (
              <p style={{ margin: '0 0 12px', color: '#c4b5fd' }}>Nothing playing right now.</p>
            )}
            <button type="button" onClick={() => { void disconnectSpotify(); }} disabled={busy || !savedSecret} style={ghostButtonStyle}>
              Disconnect Spotify
            </button>
          </>
        ) : spotifyStatus?.configured !== false ? (
          <button
            type="button"
            disabled={!savedSecret}
            style={primaryButtonStyle}
            onClick={() => {
              if (!savedSecret) return;
              window.location.href = `/api/spotify/auth?secret=${encodeURIComponent(savedSecret)}`;
            }}
          >
            Connect Spotify account
          </button>
        ) : null}
        {!savedSecret && (
          <p style={{ ...hintStyle, marginTop: '12px' }}>Save your control secret above first.</p>
        )}
      </section>

      <p style={{ ...hintStyle, marginTop: '20px' }}>
        Overlay must be running for push/next and Spotify reactions. Sticky notes sync every ~12 seconds.
      </p>
    </main>
  );
}

const panelStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(145, 70, 255, 0.35)',
  borderRadius: '16px',
  padding: '20px',
  marginBottom: '16px',
};

const headingStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: '18px',
  fontWeight: 600,
};

const hintStyle: React.CSSProperties = {
  margin: '0 0 12px',
  color: '#c4b5fd',
  fontSize: '14px',
  lineHeight: 1.5,
};

const codeStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  padding: '2px 6px',
  borderRadius: '4px',
  fontSize: '13px',
};

const inputStyle: React.CSSProperties = {
  flex: '1 1 220px',
  minWidth: '200px',
  padding: '10px 12px',
  borderRadius: '10px',
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(0,0,0,0.4)',
  color: '#fff',
  fontSize: '15px',
};

const buttonStyle: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: '10px',
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.08)',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#9146FF',
  borderColor: '#b794f6',
};

const ghostButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  fontSize: '13px',
  padding: '6px 10px',
};

const chipStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: '999px',
  border: '1px solid',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 600,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '14px',
  color: '#ddd6fe',
};

const itemStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '12px',
  padding: '12px 14px',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#e9d5ff',
  background: 'rgba(145, 70, 255, 0.25)',
  padding: '3px 8px',
  borderRadius: '999px',
};
