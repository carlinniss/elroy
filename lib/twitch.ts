const TWITCH_API = 'https://api.twitch.tv/helix';

let appTokenCache: { token: string; expiresAt: number } | null = null;

/** Bare access token for Helix / validate (oauth: prefix optional in env). */
export function normalizeToken(token: string) {
  return token.trim().replace(/^oauth:/i, '');
}

/** IRC password for tmi.js — adds oauth: when env value omits it. */
export function ircOAuthPassword(token: string) {
  const bare = normalizeToken(token);
  return bare ? `oauth:${bare}` : '';
}

export function readTwitchEnvToken(raw?: string) {
  const trimmed = raw?.trim() || '';
  return trimmed ? normalizeToken(trimmed) : '';
}

export const SHUT_ELROY_POWERUP_TITLE = /shut\s+elroy\s+up/i;

/** Stream/broadcaster lookups — use streamer's login, not the bot account. */
export function getBroadcasterLogin() {
  const login = process.env.TWITCH_BROADCASTER_LOGIN || process.env.NEXT_PUBLIC_TWITCH_CHANNEL;
  return login?.replace(/^#/, '').toLowerCase();
}

export function getTwitchCredentials() {
  const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL?.replace(/^#/, '').toLowerCase();
  const token = readTwitchEnvToken(process.env.TWITCH_BOT_OAUTH_TOKEN)
    || readTwitchEnvToken(process.env.TWITCH_OAUTH_TOKEN);
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!channel || !token) return null;
  return { channel, token, clientId: clientId ?? '' };
}

export type ValidatedUserCredentials = {
  channel: string;
  token: string;
  clientId: string;
  userId: string;
  login: string;
  scopes: string[];
  tokenSource: 'TWITCH_OAUTH_TOKEN';
};

export async function validateOAuthToken(token: string) {
  const res = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${normalizeToken(token)}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const scopes = typeof data.scopes === 'string'
    ? data.scopes.split(/[,\s]+/).filter(Boolean)
    : Array.isArray(data.scopes) ? data.scopes : [];
  return {
    clientId: data.client_id as string,
    userId: data.user_id as string,
    login: data.login as string,
    scopes,
  };
}

async function validateChannelToken(
  token: string | undefined,
  tokenSource: ValidatedUserCredentials['tokenSource'],
): Promise<ValidatedUserCredentials | null> {
  const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL?.replace(/^#/, '').toLowerCase();
  const bareToken = readTwitchEnvToken(token);
  if (!channel || !bareToken) return null;
  const validated = await validateOAuthToken(bareToken);
  if (!validated?.clientId) return null;
  return {
    channel,
    token: bareToken,
    clientId: validated.clientId,
    userId: validated.userId,
    login: validated.login,
    scopes: validated.scopes,
    tokenSource,
  };
}

export type TwitchChatTokenCandidate = {
  token: string;
  clientId: string;
  userId: string;
  login: string;
  scopes: string[];
  source: 'TWITCH_BOT_OAUTH_TOKEN' | 'TWITCH_OAUTH_TOKEN';
};

export type TwitchChatSendStatus = {
  ok: boolean;
  error?: string;
  hint?: string;
  tokenLogin?: string;
  tokenSource?: string;
  speakerLogins?: string[];
  configuredUsername?: string;
  scopes?: string[];
  hasBotToken: boolean;
  hasBroadcasterToken: boolean;
  canHelix: boolean;
  canIrc: boolean;
};

/** Broadcaster/server token only — never the public bot token. */
export async function getBroadcasterTwitchCredentials() {
  return validateChannelToken(process.env.TWITCH_OAUTH_TOKEN, 'TWITCH_OAUTH_TOKEN');
}

export async function resolveTwitchChatTokenCandidates(): Promise<TwitchChatTokenCandidate[]> {
  const candidates: TwitchChatTokenCandidate[] = [];
  const botToken = readTwitchEnvToken(process.env.TWITCH_BOT_OAUTH_TOKEN);
  const broadcasterToken = readTwitchEnvToken(process.env.TWITCH_OAUTH_TOKEN);

  if (botToken) {
    const validated = await validateOAuthToken(botToken);
    if (validated) {
      candidates.push({
        token: botToken,
        clientId: validated.clientId,
        userId: validated.userId,
        login: validated.login,
        scopes: validated.scopes,
        source: 'TWITCH_BOT_OAUTH_TOKEN',
      });
    }
  }

  if (broadcasterToken && broadcasterToken !== botToken) {
    const validated = await validateOAuthToken(broadcasterToken);
    if (validated) {
      candidates.push({
        token: broadcasterToken,
        clientId: validated.clientId,
        userId: validated.userId,
        login: validated.login,
        scopes: validated.scopes,
        source: 'TWITCH_OAUTH_TOKEN',
      });
    }
  }

  return candidates;
}

export async function sendHelixChatMessage(message: string, candidate: TwitchChatTokenCandidate) {
  const broadcasterLogin = getBroadcasterLogin();
  if (!broadcasterLogin) {
    throw new Error('Missing NEXT_PUBLIC_TWITCH_CHANNEL.');
  }

  const broadcasterId = await getBroadcasterId(broadcasterLogin, candidate.token, candidate.clientId);
  if (!broadcasterId) {
    throw new Error(`Channel not found: ${broadcasterLogin}`);
  }

  const res = await fetch(`${TWITCH_API}/chat/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${normalizeToken(candidate.token)}`,
      'Client-Id': candidate.clientId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      broadcaster_id: broadcasterId,
      sender_id: candidate.userId,
      message: message.slice(0, 500),
    }),
  });

  const data = await res.json().catch(() => ({})) as {
    message?: string;
    data?: Array<{ is_sent?: boolean; drop_reason?: { message?: string } }>;
  };

  if (!res.ok) {
    throw new Error(data.message || `Helix chat ${res.status}`);
  }

  const sent = data.data?.[0];
  if (sent?.is_sent === false) {
    throw new Error(sent.drop_reason?.message || 'Helix chat message dropped');
  }
}

export async function inspectTwitchChatSend(): Promise<TwitchChatSendStatus> {
  const broadcasterLogin = getBroadcasterLogin();
  const hasBotToken = Boolean(readTwitchEnvToken(process.env.TWITCH_BOT_OAUTH_TOKEN));
  const hasBroadcasterToken = Boolean(readTwitchEnvToken(process.env.TWITCH_OAUTH_TOKEN));
  const empty = {
    hasBotToken,
    hasBroadcasterToken,
    canHelix: false,
    canIrc: false,
  };

  if (!broadcasterLogin) {
    return {
      ...empty,
      ok: false,
      error: 'Missing NEXT_PUBLIC_TWITCH_CHANNEL.',
    };
  }

  if (!hasBotToken && !hasBroadcasterToken) {
    return {
      ...empty,
      ok: false,
      error: 'No Twitch chat token on server.',
      hint: 'Add TWITCH_BOT_OAUTH_TOKEN in Vercel (paste token only — oauth: prefix optional).',
    };
  }

  const candidates = await resolveTwitchChatTokenCandidates();
  if (!candidates.length) {
    return {
      ...empty,
      ok: false,
      error: 'Twitch token is invalid or expired.',
      hint: 'Regenerate the bot token and redeploy Vercel.',
    };
  }

  const configuredUsername = process.env.TWITCH_BOT_USERNAME?.trim().toLowerCase()
    || process.env.TWITCH_BOT_LOGIN?.trim().toLowerCase()
    || '';
  const primary = candidates[0];
  const canHelix = candidates.some((candidate) => candidate.scopes.includes('user:write:chat'));
  const canIrc = candidates.some((candidate) => candidate.scopes.includes('chat:write'));

  if (
    configuredUsername
    && primary.source === 'TWITCH_BOT_OAUTH_TOKEN'
    && configuredUsername !== primary.login
  ) {
    return {
      ...empty,
      ok: false,
      error: `TWITCH_BOT_USERNAME is "${configuredUsername}" but token is for "${primary.login}".`,
      hint: `Set TWITCH_BOT_USERNAME=${primary.login} or remove it.`,
      tokenLogin: primary.login,
      tokenSource: primary.source,
      configuredUsername,
      canHelix,
      canIrc,
    };
  }

  if (!canHelix && !canIrc) {
    return {
      ...empty,
      ok: false,
      error: `Token for ${primary.login} lacks chat scopes.`,
      hint: 'Regenerate with chat:write at twitchapps.com/tmi.',
      tokenLogin: primary.login,
      tokenSource: primary.source,
      scopes: primary.scopes,
      canHelix,
      canIrc,
    };
  }

  const speakerLogins = [...new Set(candidates.map((candidate) => candidate.login.toLowerCase()))];

  return {
    ok: true,
    tokenLogin: primary.login,
    tokenSource: primary.source,
    speakerLogins,
    hasBotToken,
    hasBroadcasterToken,
    canHelix,
    canIrc,
  };
}

/** User OAuth creds with Client ID taken from the token (fixes Client ID mismatch). */
export async function getUserTwitchCredentials(): Promise<ValidatedUserCredentials | null> {
  return getBroadcasterTwitchCredentials();
}

export function getAppCredentials() {
  const clientId = process.env.TWITCH_CLIENT_ID?.trim();
  const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** App creds for EventSub — client ID from env or broadcaster token; secret required. */
export async function resolveEventSubAppCredentials(): Promise<
  | { clientId: string; clientSecret: string }
  | { error: string; hint?: string }
> {
  const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();
  if (!clientSecret) {
    return {
      error: 'TWITCH_CLIENT_SECRET is required for EventSub webhooks.',
      hint: 'Twitch Developer Console → your app → Client Secret. TWITCH_CLIENT_ID is optional if TWITCH_OAUTH_TOKEN is from the same app.',
    };
  }

  const envClientId = process.env.TWITCH_CLIENT_ID?.trim();
  if (envClientId) {
    return { clientId: envClientId, clientSecret };
  }

  const creds = await getBroadcasterTwitchCredentials();
  if (creds?.clientId) {
    return { clientId: creds.clientId, clientSecret };
  }

  return {
    error: 'Set TWITCH_CLIENT_ID or TWITCH_OAUTH_TOKEN so we can identify your Twitch app.',
    hint: 'Twitch Developer Console → your app → Client ID.',
  };
}

export async function getAppAccessToken(clientId: string, clientSecret: string) {
  if (appTokenCache && Date.now() < appTokenCache.expiresAt - 60_000) {
    return appTokenCache.token;
  }
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`App token ${res.status}: ${body}`);
  }
  const data = await res.json();
  appTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return appTokenCache.token;
}

export async function twitchGet(path: string, token: string, clientId: string) {
  const res = await fetch(`${TWITCH_API}${path}`, {
    headers: {
      Authorization: `Bearer ${normalizeToken(token)}`,
      'Client-Id': clientId,
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twitch API ${res.status}: ${body}`);
  }
  return res.json();
}

export async function twitchPost(path: string, token: string, clientId: string, body: unknown) {
  const res = await fetch(`${TWITCH_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${normalizeToken(token)}`,
      'Client-Id': clientId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const message = typeof data === 'object' && data && 'message' in data
      ? String((data as { message?: string }).message)
      : text || `Twitch API ${res.status}`;
    throw new Error(message);
  }
  return data;
}

export async function getBroadcasterId(channel: string, token: string, clientId: string) {
  const users = await twitchGet(`/users?login=${encodeURIComponent(channel)}`, token, clientId);
  return users.data?.[0]?.id as string | undefined;
}

export async function getUserIdByLogin(login: string, token: string, clientId: string) {
  return getBroadcasterId(login.replace(/^@/, '').toLowerCase(), token, clientId);
}

export type ModTwitchCredentials = {
  token: string;
  clientId: string;
  moderatorId: string;
  moderatorLogin: string;
  broadcasterId: string;
  broadcasterLogin: string;
};

/** Mod-capable token: bot first, then broadcaster. */
export async function getModTwitchCredentials(): Promise<ModTwitchCredentials | null> {
  const broadcasterLogin = getBroadcasterLogin();
  if (!broadcasterLogin) return null;

  const candidates = await resolveTwitchChatTokenCandidates();
  const broadcaster = await getBroadcasterTwitchCredentials();
  const tokenCandidates: Array<{ token: string; clientId: string; userId: string; login: string }> = [];

  for (const candidate of candidates) {
    tokenCandidates.push({
      token: candidate.token,
      clientId: candidate.clientId,
      userId: candidate.userId,
      login: candidate.login,
    });
  }

  if (broadcaster && !tokenCandidates.some((entry) => entry.userId === broadcaster.userId)) {
    tokenCandidates.push({
      token: broadcaster.token,
      clientId: broadcaster.clientId,
      userId: broadcaster.userId,
      login: broadcaster.login,
    });
  }

  for (const candidate of tokenCandidates) {
    const broadcasterId = await getBroadcasterId(broadcasterLogin, candidate.token, candidate.clientId);
    if (!broadcasterId) continue;
    return {
      token: candidate.token,
      clientId: candidate.clientId,
      moderatorId: candidate.userId,
      moderatorLogin: candidate.login,
      broadcasterId,
      broadcasterLogin,
    };
  }

  return null;
}

export type ShutElroyPowerUpLookup = {
  shut_elroy_powerup_id: string | null;
  shut_elroy_title: string | null;
  powerups: Array<{ id: string; title: string; bits: number }>;
  error?: string;
  hint?: string;
  token_login?: string;
  token_source?: string;
  scopes?: string[];
};

/** Resolve "shut elroy up" custom power-up ID from Twitch Helix (no env var). */
export async function fetchShutElroyPowerUpId(): Promise<ShutElroyPowerUpLookup> {
  const creds = await getBroadcasterTwitchCredentials();
  const broadcasterLogin = getBroadcasterLogin();
  const debug = (extra: Partial<ShutElroyPowerUpLookup> = {}) => ({
    shut_elroy_powerup_id: null as string | null,
    shut_elroy_title: null as string | null,
    powerups: [] as ShutElroyPowerUpLookup['powerups'],
    ...extra,
  });

  if (!broadcasterLogin) {
    return debug({ error: 'Missing NEXT_PUBLIC_TWITCH_CHANNEL or TWITCH_BROADCASTER_LOGIN.' });
  }

  if (!creds) {
    return debug({
      error: 'TWITCH_OAUTH_TOKEN is not set on the server. Add your broadcaster token to Vercel (not the bot token).',
      hint: 'Vercel → Settings → Environment Variables → TWITCH_OAUTH_TOKEN = token from dtldabs with bits:read (oauth: optional).',
    });
  }

  const { token, clientId, userId: tokenUserId, scopes, login, tokenSource } = creds;
  try {
    if (!scopes.includes('bits:read')) {
      return debug({
        error: 'Broadcaster token (TWITCH_OAUTH_TOKEN) needs bits:read scope.',
        token_login: login,
        token_source: tokenSource,
        scopes,
        hint: 'Regenerate token logged in as dtldabs with bits:read at https://twitchtokengenerator.com/',
      });
    }

    const broadcasterId = await getBroadcasterId(broadcasterLogin, token, clientId);
    if (!broadcasterId) {
      return debug({ error: `Channel not found: ${broadcasterLogin}`, token_login: login, token_source: tokenSource });
    }

    if (tokenUserId !== broadcasterId) {
      return debug({
        error: `TWITCH_OAUTH_TOKEN must be dtldabs (got ${login}).`,
        token_login: login,
        token_source: tokenSource,
        scopes,
      });
    }

    const helix = await twitchGet(`/bits/custom_power_ups?broadcaster_id=${broadcasterId}`, token, clientId);
    const powerups = (helix.data ?? []).map((entry: { id: string; title: string; bits: number }) => ({
      id: entry.id,
      title: entry.title,
      bits: entry.bits,
    }));
    const match = powerups.find((p: { id: string; title: string }) =>
      SHUT_ELROY_POWERUP_TITLE.test(p.title),
    );

    return {
      shut_elroy_powerup_id: match?.id ?? null,
      shut_elroy_title: match?.title ?? null,
      powerups,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Power-up fetch failed';
    return {
      shut_elroy_powerup_id: null,
      shut_elroy_title: null,
      powerups: [],
      error: message,
    };
  }
}

export type StreamStatusResult = {
  status: 'live' | 'offline';
  viewer_count: number | null;
  source: 'twitch' | 'decapi';
  title?: string;
  game_name?: string;
  game_id?: string;
  started_at?: string;
};

/** Helix live check — only needs Client ID + Secret (no user OAuth). */
export async function fetchStreamViaHelix(
  login: string,
  clientId: string,
  clientSecret: string,
): Promise<StreamStatusResult> {
  const token = await getAppAccessToken(clientId, clientSecret);
  const broadcasterId = await getBroadcasterId(login, token, clientId);
  if (!broadcasterId) {
    throw new Error(`Broadcaster not found: ${login}`);
  }
  const streams = await twitchGet(`/streams?user_id=${broadcasterId}`, token, clientId);
  const stream = streams.data?.[0];
  if (!stream) {
    return { status: 'offline', viewer_count: 0, source: 'twitch' };
  }
  return {
    status: 'live',
    viewer_count: stream.viewer_count ?? 0,
    source: 'twitch',
    title: stream.title ?? '',
    game_name: stream.game_name ?? '',
    game_id: stream.game_id ?? '',
    started_at: stream.started_at ?? '',
  };
}

function parseDecapiViewerCount(raw: string) {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (
    !trimmed ||
    lower.includes('offline') ||
    lower.includes('not found') ||
    lower.includes('invalid') ||
    lower.includes('error')
  ) {
    return { live: false, count: 0 };
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return { live: true, count: parsed };
  }
  return { live: false, count: null };
}

async function fetchDecapiText(path: string, timeoutMs = 8_000) {
  const cacheBust = `_=${Date.now()}`;
  const url = `https://decapi.me/twitch/${path}${path.includes('?') ? '&' : '?'}${cacheBust}`;
  const res = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return (await res.text()).trim();
}

/** Public fallback — no Client ID or OAuth (third-party DecAPI). */
export async function fetchStreamViaDecapi(login: string): Promise<StreamStatusResult> {
  const encoded = encodeURIComponent(login);

  const viewersRaw = await fetchDecapiText(`viewercount/${encoded}`, 8_000);
  const viewers = parseDecapiViewerCount(viewersRaw);

  if (!viewers.live) {
    return { status: 'offline', viewer_count: 0, source: 'decapi' };
  }

  let title: string | undefined;
  try {
    const statusRaw = await fetchDecapiText(`status/${encoded}`, 8_000);
    const lower = statusRaw.toLowerCase();
    if (statusRaw && !lower.includes('offline') && !lower.includes('not found')) {
      title = statusRaw;
    }
  } catch {
    // title is optional decoration only
  }

  return {
    status: 'live',
    viewer_count: viewers.count ?? 0,
    source: 'decapi',
    title,
  };
}
