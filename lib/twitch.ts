const TWITCH_API = 'https://api.twitch.tv/helix';

let appTokenCache: { token: string; expiresAt: number } | null = null;

export function normalizeToken(token: string) {
  return token.replace(/^oauth:/i, '');
}

export const SHUT_ELROY_POWERUP_TITLE = /shut\s+elroy\s+up/i;

/** Stream/broadcaster lookups — use streamer's login, not the bot account. */
export function getBroadcasterLogin() {
  const login = process.env.TWITCH_BROADCASTER_LOGIN || process.env.NEXT_PUBLIC_TWITCH_CHANNEL;
  return login?.replace(/^#/, '').toLowerCase();
}

export function getTwitchCredentials() {
  const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL?.replace(/^#/, '').toLowerCase();
  const token = process.env.TWITCH_OAUTH_TOKEN || process.env.NEXT_PUBLIC_TWITCH_OAUTH_TOKEN;
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!channel || !token || !clientId) return null;
  return { channel, token, clientId };
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

export async function getBroadcasterId(channel: string, token: string, clientId: string) {
  const users = await twitchGet(`/users?login=${encodeURIComponent(channel)}`, token, clientId);
  return users.data?.[0]?.id as string | undefined;
}

export type ShutElroyPowerUpLookup = {
  shut_elroy_powerup_id: string | null;
  shut_elroy_title: string | null;
  powerups: Array<{ id: string; title: string; bits: number }>;
  error?: string;
};

/** Resolve "shut elroy up" custom power-up ID from Twitch Helix (no env var). */
export async function fetchShutElroyPowerUpId(): Promise<ShutElroyPowerUpLookup> {
  const creds = getTwitchCredentials();
  const broadcasterLogin = getBroadcasterLogin();
  if (!creds || !broadcasterLogin) {
    return {
      shut_elroy_powerup_id: null,
      shut_elroy_title: null,
      powerups: [],
      error: 'Missing TWITCH_CLIENT_ID, channel login, or OAuth token.',
    };
  }

  const { token, clientId } = creds;
  try {
    const validate = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${normalizeToken(token)}` },
    });
    if (!validate.ok) {
      return {
        shut_elroy_powerup_id: null,
        shut_elroy_title: null,
        powerups: [],
        error: 'Invalid OAuth token.',
      };
    }
    const { user_id: tokenUserId, scopes } = await validate.json();
    const scopeList = typeof scopes === 'string' ? scopes.split(/[,\s]+/) : [];
    if (!scopeList.includes('bits:read')) {
      return {
        shut_elroy_powerup_id: null,
        shut_elroy_title: null,
        powerups: [],
        error: 'OAuth token needs bits:read scope (broadcaster account).',
      };
    }

    const broadcasterId = await getBroadcasterId(broadcasterLogin, token, clientId);
    if (!broadcasterId) {
      return {
        shut_elroy_powerup_id: null,
        shut_elroy_title: null,
        powerups: [],
        error: `Channel not found: ${broadcasterLogin}`,
      };
    }

    if (tokenUserId !== broadcasterId) {
      return {
        shut_elroy_powerup_id: null,
        shut_elroy_title: null,
        powerups: [],
        error: 'OAuth token must be the broadcaster account for power-up lookup.',
      };
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
