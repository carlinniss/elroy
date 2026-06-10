import tmi from 'tmi.js';
import {
  ircOAuthPassword,
  resolveTwitchChatTokenCandidates,
  sendHelixChatMessage,
  type TwitchChatTokenCandidate,
} from '@/lib/twitch';

const IRC_CONNECT_TIMEOUT_MS = 12_000;

type TwitchChatClientState = {
  client: tmi.Client | null;
  connecting: Promise<tmi.Client> | null;
  cacheKey: string;
};

const globalStore = globalThis as typeof globalThis & {
  __elroyTwitchChat?: TwitchChatClientState;
};

function chatState(): TwitchChatClientState {
  if (!globalStore.__elroyTwitchChat) {
    globalStore.__elroyTwitchChat = {
      client: null,
      connecting: null,
      cacheKey: '',
    };
  }
  return globalStore.__elroyTwitchChat;
}

function stripChannelPrefix(channel: string) {
  return channel.trim().replace(/^#/, '').toLowerCase();
}

function configuredBotUsername() {
  return process.env.TWITCH_BOT_USERNAME?.trim().toLowerCase()
    || process.env.TWITCH_BOT_LOGIN?.trim().toLowerCase()
    || '';
}

function usernameMismatch(candidate: TwitchChatTokenCandidate) {
  const configured = configuredBotUsername();
  return Boolean(
    configured
    && candidate.source === 'TWITCH_BOT_OAUTH_TOKEN'
    && configured !== candidate.login,
  );
}

async function resetClient() {
  const state = chatState();
  const client = state.client;
  state.client = null;
  state.connecting = null;
  state.cacheKey = '';

  if (client) {
    try {
      await client.disconnect();
    } catch {
      // The connection may already be closed; the next send will reconnect.
    }
  }
}

async function connectIrcClient(candidate: TwitchChatTokenCandidate) {
  const channel = stripChannelPrefix(process.env.NEXT_PUBLIC_TWITCH_CHANNEL || '');
  if (!channel) {
    throw new Error('Missing NEXT_PUBLIC_TWITCH_CHANNEL.');
  }

  const cacheKey = `${candidate.login}:${channel}:${candidate.source}`;
  const state = chatState();
  if (state.client && state.cacheKey === cacheKey) {
    return { client: state.client, channel };
  }

  if (!state.connecting || state.cacheKey !== cacheKey) {
    state.cacheKey = cacheKey;
    state.connecting = (async () => {
      const client = new tmi.Client({
        connection: { reconnect: true, secure: true },
        identity: {
          username: candidate.login,
          password: ircOAuthPassword(candidate.token),
        },
        channels: [channel],
      });

      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('IRC connect timed out')), IRC_CONNECT_TIMEOUT_MS);
        }),
      ]);

      state.client = client;
      return client;
    })();
  }

  const client = await state.connecting;
  return { client, channel };
}

async function sendIrcChatMessage(message: string, candidate: TwitchChatTokenCandidate) {
  try {
    const { client, channel } = await connectIrcClient(candidate);
    await client.say(channel, message);
  } catch (error) {
    await resetClient();
    const { client, channel } = await connectIrcClient(candidate);
    await client.say(channel, message);
    if (error instanceof Error) {
      console.warn('IRC chat recovered after reconnect', error.message);
    }
  }
}

export async function sendTwitchChatMessage(message: string) {
  const text = message.trim();
  if (!text) return;

  const candidates = await resolveTwitchChatTokenCandidates();
  if (!candidates.length) {
    throw new Error('Set TWITCH_BOT_OAUTH_TOKEN (or TWITCH_OAUTH_TOKEN) and NEXT_PUBLIC_TWITCH_CHANNEL.');
  }

  const errors: string[] = [];

  for (const candidate of candidates) {
    if (usernameMismatch(candidate)) {
      errors.push(
        `TWITCH_BOT_USERNAME (${configuredBotUsername()}) does not match token login (${candidate.login})`,
      );
      continue;
    }
    if (!candidate.scopes.includes('user:write:chat')) continue;
    try {
      await sendHelixChatMessage(text, candidate);
      return;
    } catch (error) {
      errors.push(`Helix (${candidate.login}): ${error instanceof Error ? error.message : 'failed'}`);
    }
  }

  for (const candidate of candidates) {
    if (usernameMismatch(candidate)) continue;
    if (!candidate.scopes.includes('chat:write')) continue;
    try {
      await sendIrcChatMessage(text, candidate);
      return;
    } catch (error) {
      errors.push(`IRC (${candidate.login}): ${error instanceof Error ? error.message : 'failed'}`);
    }
  }

  throw new Error(errors.join(' | ') || 'No Twitch token could send chat.');
}
