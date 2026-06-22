'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { DirectiveKind, LiveDirective } from '@/lib/live-directives';
import type { BotControlsSnapshot } from '@/lib/bot-controls';
import { BOT_COMMAND_SECTIONS } from '@/lib/bot-commands';
import { describeVoiceQuotaTier, voiceQuotaTierFromRemaining } from '@/lib/voice-quota';

const SECRET_STORAGE_KEY = 'elroy-control-secret';

type TabId = 'prompts' | 'bot' | 'spotify' | 'setup';

type DirectiveSnapshot = {
  sticky: LiveDirective[];
  next: LiveDirective[];
  push: LiveDirective[];
};

type AuthState = 'checking' | 'authorized' | 'missing' | 'unauthorized';

type QuotaSnapshot = {
  remaining: number;
  resetDate?: string;
  label: string;
  tier: string;
  error?: boolean;
  subscriptionStatus?: string;
  voiceBlocked?: boolean;
};

const QUOTA_POLL_MS = 2 * 60_000;
const CONTROLS_POLL_MS = 12_000;
const CONTROL_PANEL_ACTOR = 'control-panel';

const MOD_COMMAND_SECTION = BOT_COMMAND_SECTIONS.find((section) => section.id === 'mod');

function authHeaders(secret: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${secret}`,
  };
}

function kindLabel(kind: DirectiveKind) {
  if (kind === 'sticky') return 'Sticky';
  if (kind === 'next') return 'Next';
  return 'Push';
}

export function ControlPanel({ initialSecret }: { initialSecret?: string }) {
  const [tab, setTab] = useState<TabId>('prompts');
  const [secret, setSecret] = useState('');
  const [savedSecret, setSavedSecret] = useState('');
  const [authState, setAuthState] = useState<AuthState>('checking');
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
  const [quotaStatus, setQuotaStatus] = useState<QuotaSnapshot | null>(null);
  const [botControls, setBotControls] = useState({
    voiceEnabled: true,
    dingEnabled: true,
    volume: 85,
  });
  const [pollTitle, setPollTitle] = useState('');
  const [pollChoices, setPollChoices] = useState(['', '']);

  const verifySecret = useCallback(async (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed) return false;
    try {
      const res = await fetch('/api/control/verify', {
        headers: authHeaders(trimmed),
        cache: 'no-store',
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fromUrl = initialSecret?.trim();
      const stored = sessionStorage.getItem(SECRET_STORAGE_KEY)?.trim();
      const resolved = fromUrl || stored || '';
      if (!resolved) {
        if (!cancelled) setAuthState('missing');
        return;
      }

      if (!cancelled) {
        setSecret(resolved);
        setStatus(fromUrl ? 'Verifying secret from URL…' : 'Verifying saved secret…');
      }

      const ok = await verifySecret(resolved);
      if (cancelled) return;

      if (!ok) {
        sessionStorage.removeItem(SECRET_STORAGE_KEY);
        setSavedSecret('');
        setAuthState('unauthorized');
        setStatus('Wrong control secret.');
        return;
      }

      sessionStorage.setItem(SECRET_STORAGE_KEY, resolved);
      setSavedSecret(resolved);
      setAuthState('authorized');
      setStatus(fromUrl ? 'Secret verified from URL.' : 'Secret verified.');
    })();

    return () => {
      cancelled = true;
    };
  }, [initialSecret, verifySecret]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/directives?t=${Date.now()}`, {
        cache: 'no-store',
        headers: authHeaders(savedSecret),
      });
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
  }, [savedSecret]);

  useEffect(() => {
    if (authState !== 'authorized') return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 12_000);
    return () => clearInterval(timer);
  }, [authState, refresh]);

  const refreshSpotify = useCallback(async () => {
    try {
      const res = await fetch(`/api/spotify/status?t=${Date.now()}`, {
        cache: 'no-store',
        headers: authHeaders(savedSecret),
      });
      if (!res.ok) return;
      setSpotifyStatus(await res.json());
    } catch {
      setSpotifyStatus(null);
    }
  }, [savedSecret]);

  useEffect(() => {
    if (authState !== 'authorized') return;
    void refreshSpotify();
    const timer = setInterval(() => { void refreshSpotify(); }, 15_000);
    return () => clearInterval(timer);
  }, [authState, refreshSpotify]);

  const refreshQuota = useCallback(async () => {
    if (!savedSecret) return;
    try {
      const res = await fetch(`/api/quota?t=${Date.now()}`, {
        cache: 'no-store',
        headers: authHeaders(savedSecret),
      });
      const data = await res.json() as {
        remaining?: number;
        resetDate?: string;
        error?: boolean;
        subscriptionStatus?: string;
        voiceBlocked?: boolean;
        voiceBlockReason?: string;
      };
      if (!res.ok || data.error) {
        setQuotaStatus({
          remaining: 0,
          label: 'Quota lookup failed — check ELEVENLABS_API_KEY in Vercel.',
          tier: 'error',
          error: true,
        });
        return;
      }
      const remaining = Number(data.remaining) || 0;
      const tier = voiceQuotaTierFromRemaining(remaining);
      const voiceBlocked = data.voiceBlocked === true;
      setQuotaStatus({
        remaining,
        resetDate: data.resetDate,
        label: voiceBlocked
          ? (data.voiceBlockReason || `Subscription ${data.subscriptionStatus || 'blocked'} — TTS disabled`)
          : describeVoiceQuotaTier(tier, remaining),
        tier: voiceBlocked ? 'depleted' : tier.tier,
        subscriptionStatus: data.subscriptionStatus,
        voiceBlocked,
      });
    } catch {
      setQuotaStatus({
        remaining: 0,
        label: 'Could not reach quota API.',
        tier: 'error',
        error: true,
      });
    }
  }, [savedSecret]);

  useEffect(() => {
    if (authState !== 'authorized') return;
    void refreshQuota();
    const timer = setInterval(() => { void refreshQuota(); }, QUOTA_POLL_MS);
    return () => clearInterval(timer);
  }, [authState, refreshQuota]);

  const applyBotControlsSnapshot = useCallback((snapshot: BotControlsSnapshot) => {
    setBotControls({
      voiceEnabled: snapshot.settings.voiceEnabled ?? true,
      dingEnabled: snapshot.settings.dingEnabled ?? true,
      volume: Math.round((snapshot.settings.volume ?? 0.85) * 100),
    });
  }, []);

  const refreshBotControls = useCallback(async () => {
    if (!savedSecret) return;
    try {
      const res = await fetch(`/api/bot/controls?t=${Date.now()}`, {
        cache: 'no-store',
        headers: authHeaders(savedSecret),
      });
      if (!res.ok) return;
      applyBotControlsSnapshot(await res.json() as BotControlsSnapshot);
    } catch {
      /* ignore */
    }
  }, [applyBotControlsSnapshot, savedSecret]);

  useEffect(() => {
    if (authState !== 'authorized') return;
    void refreshBotControls();
    const timer = setInterval(() => { void refreshBotControls(); }, CONTROLS_POLL_MS);
    return () => clearInterval(timer);
  }, [authState, refreshBotControls]);

  const patchBotControls = useCallback(async (
    settings: Partial<{ voiceEnabled: boolean; dingEnabled: boolean; volume: number }>,
  ) => {
    if (!savedSecret) return false;
    setBusy(true);
    try {
      const payload: Record<string, boolean | number> = {};
      if (typeof settings.voiceEnabled === 'boolean') payload.voiceEnabled = settings.voiceEnabled;
      if (typeof settings.dingEnabled === 'boolean') payload.dingEnabled = settings.dingEnabled;
      if (typeof settings.volume === 'number') {
        payload.volume = Math.min(1, Math.max(0, settings.volume / 100));
      }
      const res = await fetch('/api/bot/controls', {
        method: 'POST',
        headers: authHeaders(savedSecret),
        body: JSON.stringify({ settings: payload }),
      });
      const data = await res.json() as BotControlsSnapshot & { error?: string };
      if (!res.ok) {
        setStatus(data.error || 'Bot controls update failed');
        return false;
      }
      applyBotControlsSnapshot(data);
      setStatus('Bot controls updated — overlay applies within ~12s.');
      return true;
    } catch {
      setStatus('Could not update bot controls');
      return false;
    } finally {
      setBusy(false);
    }
  }, [applyBotControlsSnapshot, savedSecret]);

  const queueBotDisconnect = useCallback(async () => {
    if (!savedSecret) return;
    if (!window.confirm('Disconnect Elroy from chat? (Same as !elroyoff)')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/bot/controls', {
        method: 'POST',
        headers: authHeaders(savedSecret),
        body: JSON.stringify({ command: 'disconnect' }),
      });
      const data = await res.json() as BotControlsSnapshot & { error?: string };
      if (!res.ok) {
        setStatus(data.error || 'Disconnect command failed');
        return;
      }
      applyBotControlsSnapshot(data);
      setStatus('Disconnect queued — overlay should stop within ~12s.');
    } catch {
      setStatus('Could not queue disconnect');
    } finally {
      setBusy(false);
    }
  }, [applyBotControlsSnapshot, savedSecret]);

  const createClip = useCallback(async () => {
    if (!savedSecret) return;
    setBusy(true);
    try {
      const res = await fetch('/api/twitch/clip', {
        method: 'POST',
        headers: authHeaders(savedSecret),
      });
      const data = await res.json() as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !data.ok) {
        setStatus(data.error || 'Clip failed');
        return;
      }
      setStatus(data.url ? `Clip created: ${data.url}` : 'Clip created.');
    } catch {
      setStatus('Clip request failed');
    } finally {
      setBusy(false);
    }
  }, [savedSecret]);

  const createPoll = useCallback(async () => {
    if (!savedSecret) return;
    const title = pollTitle.trim();
    const choices = pollChoices.map((choice) => choice.trim()).filter(Boolean);
    if (!title) {
      setStatus('Poll needs a question.');
      return;
    }
    if (choices.length < 2) {
      setStatus('Poll needs at least two choices.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/twitch/poll', {
        method: 'POST',
        headers: authHeaders(savedSecret),
        body: JSON.stringify({ title, choices, duration: 90 }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setStatus(data.error || 'Poll failed');
        return;
      }
      setPollTitle('');
      setPollChoices(['', '']);
      setStatus('Channel poll started (90s).');
    } catch {
      setStatus('Poll request failed');
    } finally {
      setBusy(false);
    }
  }, [pollChoices, pollTitle, savedSecret]);

  const stopGameTable = useCallback(async (
    endpoint: string,
    body: Record<string, unknown>,
    label: string,
  ) => {
    if (!savedSecret) return;
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders(savedSecret),
        body: JSON.stringify(body),
      });
      const data = await res.json() as { ok?: boolean; messages?: string[]; error?: string };
      if (!res.ok || !data.ok) {
        setStatus(data.error || `${label} stop failed`);
        return;
      }
      const line = data.messages?.[0];
      setStatus(line || `${label} stopped.`);
    } catch {
      setStatus(`${label} stop request failed`);
    } finally {
      setBusy(false);
    }
  }, [savedSecret]);

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

  const saveSecret = async () => {
    const trimmed = secret.trim();
    if (!trimmed) return;
    setBusy(true);
    setStatus('Verifying control secret…');
    const ok = await verifySecret(trimmed);
    if (!ok) {
      sessionStorage.removeItem(SECRET_STORAGE_KEY);
      setSavedSecret('');
      setAuthState('unauthorized');
      setStatus('Wrong control secret.');
      setBusy(false);
      return;
    }
    sessionStorage.setItem(SECRET_STORAGE_KEY, trimmed);
    setSavedSecret(trimmed);
    setAuthState('authorized');
    setStatus('Secret verified and saved for this browser session.');
    setBusy(false);
  };

  const addDirective = async () => {
    if (!savedSecret) {
      setStatus('Save your control secret first (Setup tab).');
      setTab('setup');
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

  const queueCount =
    directives.sticky.length + directives.next.length + directives.push.length;

  const allItems: LiveDirective[] = [
    ...directives.sticky.map((item) => ({ ...item, kind: 'sticky' as const })),
    ...directives.next.map((item) => ({ ...item, kind: 'next' as const })),
    ...directives.push.map((item) => ({ ...item, kind: 'push' as const })),
  ].sort((a, b) => b.createdAt - a.createdAt);

  if (authState !== 'authorized') {
    return (
      <div style={pageStyle}>
        <header style={topBarStyle}>
          <div>
            <p style={eyebrowStyle}>Elroy broadcaster</p>
            <h1 style={titleStyle}>Control</h1>
          </div>
          <p style={statusPillStyle}>
            {authState === 'checking' ? 'Checking access…' : authState === 'missing' ? 'Secret required' : 'Access denied'}
          </p>
        </header>

        <section style={panelStyle}>
          <h2 style={headingStyle}>Admin access</h2>
          <p style={hintStyle}>
            Enter the control secret to unlock this page.
          </p>
          <div style={rowStyle}>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Control secret"
              style={inputStyle}
            />
            <button
              type="button"
              onClick={() => { void saveSecret(); }}
              disabled={busy || !secret.trim()}
              style={buttonStyle}
            >
              Unlock
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <header style={topBarStyle}>
        <div>
          <p style={eyebrowStyle}>Elroy broadcaster</p>
          <h1 style={titleStyle}>Control</h1>
        </div>
        <p style={statusPillStyle}>{status}</p>
      </header>

      {!savedSecret && (
        <div style={bannerStyle}>
          Save your control secret under <strong>Setup</strong> before adding prompts or Spotify.
        </div>
      )}

      <nav style={tabRowStyle} aria-label="Control sections">
        {([
          { id: 'prompts' as const, label: 'Prompts', badge: queueCount || undefined },
          { id: 'bot' as const, label: 'Bot' },
          { id: 'spotify' as const, label: 'Spotify', badge: spotifyStatus?.connected ? '●' : undefined },
          { id: 'setup' as const, label: 'Setup' },
        ]).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            style={{
              ...tabStyle,
              background: tab === item.id ? '#9146FF' : 'rgba(255,255,255,0.08)',
              borderColor: tab === item.id ? '#b794f6' : 'rgba(255,255,255,0.12)',
            }}
          >
            {item.label}
            {item.badge !== undefined && (
              <span style={tabBadgeStyle}>{item.badge}</span>
            )}
          </button>
        ))}
      </nav>

      <section style={quotaPanelStyle(quotaStatus?.tier, quotaStatus?.error)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <h2 style={{ ...headingStyle, marginBottom: 0 }}>Voice quota</h2>
          <button
            type="button"
            onClick={() => { void refreshQuota(); }}
            disabled={busy || !savedSecret}
            style={ghostButtonStyle}
          >
            Refresh
          </button>
        </div>
        {!quotaStatus ? (
          <p style={{ ...hintStyle, marginTop: '10px', marginBottom: 0 }}>Loading ElevenLabs quota…</p>
        ) : quotaStatus.error ? (
          <p style={{ ...warnStyle, marginTop: '10px', marginBottom: 0 }}>{quotaStatus.label}</p>
        ) : (
          <>
            <p style={quotaNumberStyle(quotaStatus.tier)}>
              {quotaStatus.remaining.toLocaleString()} characters left
              {quotaStatus.subscriptionStatus && quotaStatus.subscriptionStatus !== 'active' ? (
                <span style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#fca5a5', marginTop: '4px' }}>
                  Subscription: {quotaStatus.subscriptionStatus.replace(/_/g, ' ')}
                </span>
              ) : null}
            </p>
            <p style={{ ...hintStyle, marginBottom: quotaStatus.resetDate ? '6px' : 0 }}>
              {quotaStatus.label}
            </p>
            {quotaStatus.resetDate ? (
              <p style={{ ...hintStyle, marginBottom: 0, fontSize: '13px' }}>
                Resets {quotaStatus.resetDate}
              </p>
            ) : null}
          </>
        )}
      </section>

      {tab === 'setup' && (
        <section style={panelStyle}>
          <h2 style={headingStyle}>Access secret</h2>
          <p style={hintStyle}>
            Match <code style={codeStyle}>ELROY_CONTROL_SECRET</code> in Vercel to your bookmark
            (e.g. <code style={codeStyle}>/control/dtl</code> → secret <code style={codeStyle}>dtl</code>).
          </p>
          <div style={rowStyle}>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Control secret"
              style={inputStyle}
            />
            <button type="button" onClick={() => { void saveSecret(); }} style={buttonStyle}>Save</button>
          </div>

          <h3 style={subheadingStyle}>While streaming</h3>
          <ul style={checklistStyle}>
            <li>OBS overlay open with bot <strong>ignited</strong></li>
            <li>Push / next directives land within ~12s</li>
            <li>Spotify reactions need you <strong>live on Twitch</strong></li>
          </ul>

          <h3 style={subheadingStyle}>Spotify env (Vercel)</h3>
          <ul style={checklistStyle}>
            <li><code style={codeStyle}>SPOTIFY_CLIENT_ID</code></li>
            <li><code style={codeStyle}>SPOTIFY_CLIENT_SECRET</code></li>
            <li>Redirect: <code style={codeStyle}>/api/spotify/callback</code></li>
          </ul>
        </section>
      )}

      {tab === 'prompts' && (
        <>
          <section style={panelStyle}>
            <h2 style={headingStyle}>New directive</h2>
            <div style={rowStyle}>
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
              {kind === 'sticky' && 'Stays until removed — woven into banter and mentions.'}
              {kind === 'next' && 'Used once on Elroy\'s next AI line, then cleared.'}
              {kind === 'push' && 'Fires immediately on the next overlay poll (~12s).'}
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Steer Elroy: topics, roasts, segment ideas…"
              rows={3}
              style={{ ...inputStyle, width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
            />
            {kind === 'push' && (
              <div style={{ ...rowStyle, marginTop: '10px' }}>
                <label style={labelStyle}>
                  <input type="checkbox" checked={chatOnly} onChange={(e) => setChatOnly(e.target.checked)} />
                  Chat only
                </label>
                <label style={labelStyle}>
                  <input type="checkbox" checked={forceVoice} onChange={(e) => setForceVoice(e.target.checked)} />
                  Force voice
                </label>
              </div>
            )}
            <button
              type="button"
              onClick={() => { void addDirective(); }}
              disabled={busy || !text.trim()}
              style={{ ...primaryButtonStyle, marginTop: '12px', width: '100%' }}
            >
              {kind === 'push' ? 'Push now' : 'Add directive'}
            </button>
          </section>

          <section style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ ...headingStyle, marginBottom: 0 }}>Queue ({queueCount})</h2>
              <button type="button" onClick={() => { void refresh(); }} disabled={busy} style={ghostButtonStyle}>
                Refresh
              </button>
            </div>
            {allItems.length === 0 ? (
              <p style={{ ...hintStyle, marginTop: '12px' }}>Nothing queued.</p>
            ) : (
              <ul style={queueListStyle}>
                {allItems.map((item) => (
                  <li key={item.id} style={itemStyle}>
                    <div style={itemRowStyle}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <span style={badgeStyle}>{kindLabel(item.kind)}</span>
                        <p style={itemTextStyle}>{item.text}</p>
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
              <div style={{ ...rowStyle, marginTop: '12px' }}>
                {(['sticky', 'next', 'push'] as DirectiveKind[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => { void clearKind(option); }}
                    disabled={busy}
                    style={ghostButtonStyle}
                  >
                    Clear {kindLabel(option).toLowerCase()}
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {tab === 'bot' && (
        <>
          <section style={panelStyle}>
            <h2 style={headingStyle}>Audio & voice</h2>
            <p style={hintStyle}>
              Same as <code style={codeStyle}>!voice</code>, <code style={codeStyle}>!ding</code>, and{' '}
              <code style={codeStyle}>!volume</code> in chat. Changes apply on the OBS overlay within ~12s.
            </p>
            <div style={controlGridStyle}>
              <div style={controlRowStyle}>
                <span style={controlLabelStyle}>Voice (TTS)</span>
                <button
                  type="button"
                  disabled={busy || !savedSecret}
                  style={toggleButtonStyle(botControls.voiceEnabled)}
                  onClick={() => {
                    void patchBotControls({ voiceEnabled: !botControls.voiceEnabled });
                  }}
                >
                  {botControls.voiceEnabled ? 'On' : 'Off'}
                </button>
              </div>
              <div style={controlRowStyle}>
                <span style={controlLabelStyle}>Bong ding</span>
                <button
                  type="button"
                  disabled={busy || !savedSecret}
                  style={toggleButtonStyle(botControls.dingEnabled)}
                  onClick={() => {
                    void patchBotControls({ dingEnabled: !botControls.dingEnabled });
                  }}
                >
                  {botControls.dingEnabled ? 'On' : 'Off'}
                </button>
              </div>
              <div style={{ ...controlRowStyle, alignItems: 'center' }}>
                <span style={controlLabelStyle}>Volume ({botControls.volume}%)</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={botControls.volume}
                  disabled={busy || !savedSecret}
                  onChange={(e) => {
                    setBotControls((prev) => ({ ...prev, volume: Number(e.target.value) }));
                  }}
                  onMouseUp={(e) => {
                    void patchBotControls({ volume: Number((e.target as HTMLInputElement).value) });
                  }}
                  onTouchEnd={(e) => {
                    void patchBotControls({ volume: Number((e.target as HTMLInputElement).value) });
                  }}
                  style={{ flex: 1, minWidth: '140px' }}
                />
              </div>
            </div>
          </section>

          <section style={panelStyle}>
            <h2 style={headingStyle}>Session</h2>
            <p style={hintStyle}>Same as <code style={codeStyle}>!elroyoff</code> — disconnects the overlay bot.</p>
            <button
              type="button"
              disabled={busy || !savedSecret}
              style={{ ...buttonStyle, borderColor: 'rgba(252, 165, 165, 0.55)', color: '#fecaca' }}
              onClick={() => { void queueBotDisconnect(); }}
            >
              Disconnect Elroy
            </button>
          </section>

          <section style={panelStyle}>
            <h2 style={headingStyle}>Production</h2>
            <div style={controlGridStyle}>
              <button
                type="button"
                disabled={busy || !savedSecret}
                style={ghostButtonStyle}
                onClick={() => { void createClip(); }}
              >
                Create clip (!clip)
              </button>
            </div>
            <p style={{ ...hintStyle, marginTop: '14px' }}>Channel poll (!poll)</p>
            <input
              type="text"
              value={pollTitle}
              onChange={(e) => setPollTitle(e.target.value)}
              placeholder="Poll question"
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: '8px' }}
            />
            {pollChoices.map((choice, index) => (
              <input
                key={`poll-choice-${index}`}
                type="text"
                value={choice}
                onChange={(e) => {
                  const next = [...pollChoices];
                  next[index] = e.target.value;
                  setPollChoices(next);
                }}
                placeholder={`Choice ${index + 1}`}
                style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: '8px' }}
              />
            ))}
            <div style={rowStyle}>
              <button
                type="button"
                disabled={busy || pollChoices.length >= 5}
                style={ghostButtonStyle}
                onClick={() => setPollChoices((prev) => [...prev, ''])}
              >
                Add choice
              </button>
              <button
                type="button"
                disabled={busy || !savedSecret}
                style={primaryButtonStyle}
                onClick={() => { void createPoll(); }}
              >
                Start poll
              </button>
            </div>
          </section>

          <section style={panelStyle}>
            <h2 style={headingStyle}>Stop games</h2>
            <p style={hintStyle}>Mod cancel/refund — same as !bjstop, !rstop, !p3stop, !p4stop.</p>
            <div style={rowStyle}>
              <button
                type="button"
                disabled={busy || !savedSecret}
                style={ghostButtonStyle}
                onClick={() => {
                  void stopGameTable('/api/blackjack/action', {
                    action: 'stop',
                    username: CONTROL_PANEL_ACTOR,
                    isMod: true,
                  }, 'Blackjack');
                }}
              >
                Stop blackjack
              </button>
              <button
                type="button"
                disabled={busy || !savedSecret}
                style={ghostButtonStyle}
                onClick={() => {
                  void stopGameTable('/api/roulette/action', {
                    action: 'stop',
                    username: CONTROL_PANEL_ACTOR,
                    isMod: true,
                  }, 'Roulette');
                }}
              >
                Stop roulette
              </button>
              <button
                type="button"
                disabled={busy || !savedSecret}
                style={ghostButtonStyle}
                onClick={() => {
                  void stopGameTable('/api/pick-numbers/action', {
                    action: 'stop',
                    game: 'pick3',
                    username: CONTROL_PANEL_ACTOR,
                    isMod: true,
                  }, 'Pick 3');
                }}
              >
                Stop Pick 3
              </button>
              <button
                type="button"
                disabled={busy || !savedSecret}
                style={ghostButtonStyle}
                onClick={() => {
                  void stopGameTable('/api/pick-numbers/action', {
                    action: 'stop',
                    game: 'pick4',
                    username: CONTROL_PANEL_ACTOR,
                    isMod: true,
                  }, 'Pick 4');
                }}
              >
                Stop Pick 4
              </button>
            </div>
          </section>

          {MOD_COMMAND_SECTION ? (
            <section style={panelStyle}>
              <h2 style={headingStyle}>Mod commands reference</h2>
              <ul style={checklistStyle}>
                {MOD_COMMAND_SECTION.commands.map((cmd) => (
                  <li key={cmd.command}>
                    <strong>{cmd.command}</strong>
                    {cmd.aliases?.length ? ` (${cmd.aliases.join(', ')})` : ''}
                    {' — '}
                    {cmd.description}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {tab === 'spotify' && (
        <section style={panelStyle}>
          <h2 style={headingStyle}>Now playing</h2>
          <p style={hintStyle}>
            Elroy comments when tracks change (live stream + overlay running). Chat: <code style={codeStyle}>!np</code>
          </p>

          {spotifyStatus?.configured === false && (
            <p style={warnStyle}>Add Spotify client ID/secret in Vercel, then redeploy.</p>
          )}

          {spotifyStatus?.connected ? (
            <div style={spotifyCardStyle}>
              <p style={{ margin: 0, color: '#86efac', fontWeight: 600 }}>Connected</p>
              {spotifyStatus.playing && spotifyStatus.track ? (
                <p style={{ margin: '10px 0 0', lineHeight: 1.45 }}>
                  <strong>{spotifyStatus.track.name}</strong>
                  <br />
                  <span style={{ color: '#c4b5fd' }}>
                    {spotifyStatus.track.artists.join(', ') || 'Unknown artist'}
                  </span>
                </p>
              ) : (
                <p style={{ margin: '10px 0 0', color: '#c4b5fd' }}>Nothing playing — start Spotify on this account.</p>
              )}
              <div style={{ ...rowStyle, marginTop: '14px' }}>
                <button
                  type="button"
                  onClick={() => { void refreshSpotify(); }}
                  disabled={busy}
                  style={ghostButtonStyle}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => { void disconnectSpotify(); }}
                  disabled={busy || !savedSecret}
                  style={ghostButtonStyle}
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : spotifyStatus?.configured !== false ? (
            <button
              type="button"
              disabled={!savedSecret}
              style={{ ...primaryButtonStyle, width: '100%' }}
              onClick={() => {
                if (!savedSecret) {
                  setTab('setup');
                  return;
                }
                window.location.href = `/api/spotify/auth?secret=${encodeURIComponent(savedSecret)}`;
              }}
            >
              Connect Spotify
            </button>
          ) : null}

          {!savedSecret && (
            <p style={{ ...hintStyle, marginTop: '12px' }}>Save your secret on the Setup tab first.</p>
          )}

          <details style={{ marginTop: '16px' }}>
            <summary style={summaryStyle}>Test without going live</summary>
            <p style={hintStyle}>
              Control panel and <code style={codeStyle}>/api/spotify/status</code> show the current track anytime.
              Chat reactions need a live Twitch stream and the overlay ignited.
            </p>
          </details>
        </section>
      )}

      <footer style={footerStyle}>
        Overlay must be running for push, next, and Spotify chat lines.
      </footer>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: '640px',
  margin: '0 auto',
  padding: '20px 16px 32px',
  paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
};

const topBarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
  marginBottom: '16px',
};

const eyebrowStyle: React.CSSProperties = {
  color: '#b794f6',
  fontSize: '12px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  margin: 0,
};

const titleStyle: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: '28px',
  fontWeight: 700,
};

const statusPillStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  color: '#ddd6fe',
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '999px',
  padding: '6px 10px',
  maxWidth: '48%',
  textAlign: 'right',
  lineHeight: 1.35,
};

const bannerStyle: React.CSSProperties = {
  background: 'rgba(145, 70, 255, 0.2)',
  border: '1px solid rgba(183, 148, 246, 0.45)',
  borderRadius: '12px',
  padding: '10px 14px',
  marginBottom: '14px',
  fontSize: '14px',
  lineHeight: 1.45,
};

const tabRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  marginBottom: '16px',
  position: 'sticky',
  top: 0,
  zIndex: 2,
  padding: '8px 0',
  background: 'linear-gradient(160deg, #0f0a1a 0%, #1a1030 70%)',
};

const tabStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px 8px',
  borderRadius: '10px',
  border: '1px solid',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '14px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
};

const tabBadgeStyle: React.CSSProperties = {
  fontSize: '11px',
  background: 'rgba(0,0,0,0.25)',
  borderRadius: '999px',
  padding: '1px 6px',
};

const panelStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(145, 70, 255, 0.35)',
  borderRadius: '16px',
  padding: '16px',
  marginBottom: '14px',
};

const headingStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: '17px',
  fontWeight: 600,
};

const subheadingStyle: React.CSSProperties = {
  margin: '16px 0 8px',
  fontSize: '14px',
  fontWeight: 600,
  color: '#e9d5ff',
};

const hintStyle: React.CSSProperties = {
  margin: '0 0 12px',
  color: '#c4b5fd',
  fontSize: '14px',
  lineHeight: 1.5,
};

const warnStyle: React.CSSProperties = {
  ...hintStyle,
  color: '#fcd34d',
};

const codeStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  padding: '2px 6px',
  borderRadius: '4px',
  fontSize: '13px',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
  alignItems: 'center',
};

const inputStyle: React.CSSProperties = {
  flex: '1 1 180px',
  minWidth: 0,
  padding: '10px 12px',
  borderRadius: '10px',
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(0,0,0,0.4)',
  color: '#fff',
  fontSize: '16px',
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

const queueListStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: '12px 0 0',
  maxHeight: 'min(50vh, 420px)',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const itemStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '12px',
  padding: '10px 12px',
};

const itemRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '10px',
  alignItems: 'flex-start',
};

const itemTextStyle: React.CSSProperties = {
  margin: '6px 0 0',
  lineHeight: 1.45,
  wordBreak: 'break-word',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#e9d5ff',
  background: 'rgba(145, 70, 255, 0.25)',
  padding: '3px 8px',
  borderRadius: '999px',
};

const spotifyCardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(134, 239, 172, 0.25)',
  borderRadius: '12px',
  padding: '14px',
};

const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  color: '#ddd6fe',
  fontSize: '14px',
  fontWeight: 600,
};

const checklistStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '20px',
  color: '#c4b5fd',
  fontSize: '14px',
  lineHeight: 1.6,
};

const footerStyle: React.CSSProperties = {
  marginTop: '8px',
  fontSize: '13px',
  color: '#a78bfa',
  textAlign: 'center',
  lineHeight: 1.45,
};

function quotaPanelStyle(tier?: string, error?: boolean): React.CSSProperties {
  const border =
    error || tier === 'depleted' || tier === 'critical'
      ? 'rgba(252, 165, 165, 0.45)'
      : tier === 'low' || tier === 'moderate'
        ? 'rgba(252, 211, 77, 0.45)'
        : 'rgba(134, 239, 172, 0.35)';
  return {
    ...panelStyle,
    borderColor: border,
    marginBottom: '14px',
  };
}

function quotaNumberStyle(tier: string): React.CSSProperties {
  const color =
    tier === 'depleted' || tier === 'critical'
      ? '#fca5a5'
      : tier === 'low' || tier === 'moderate'
        ? '#fcd34d'
        : '#86efac';
  return {
    margin: '10px 0 6px',
    fontSize: '22px',
    fontWeight: 700,
    color,
    lineHeight: 1.2,
  };
}

const controlGridStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const controlRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
};

const controlLabelStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#e9d5ff',
};

function toggleButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    ...buttonStyle,
    minWidth: '72px',
    background: enabled ? 'rgba(134, 239, 172, 0.18)' : 'rgba(255,255,255,0.06)',
    borderColor: enabled ? 'rgba(134, 239, 172, 0.45)' : 'rgba(255,255,255,0.12)',
    color: enabled ? '#bbf7d0' : '#d1d5db',
  };
}
