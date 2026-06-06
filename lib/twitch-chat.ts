import tmi from 'tmi.js';

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

function oauthPassword(token: string) {
  const trimmed = token.trim();
  return /^oauth:/i.test(trimmed) ? trimmed : `oauth:${trimmed}`;
}

function getChatCredentials() {
  const channel = stripChannelPrefix(process.env.NEXT_PUBLIC_TWITCH_CHANNEL || '');
  const username = stripChannelPrefix(
    process.env.TWITCH_BOT_USERNAME
      || process.env.TWITCH_BOT_LOGIN
      || process.env.NEXT_PUBLIC_TWITCH_CHANNEL
      || '',
  );
  const token = process.env.TWITCH_BOT_OAUTH_TOKEN || process.env.TWITCH_OAUTH_TOKEN || '';

  if (!channel || !username || !token.trim()) return null;
  return { channel, username, token: oauthPassword(token) };
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

async function getConnectedClient() {
  const creds = getChatCredentials();
  if (!creds) {
    throw new Error('Set TWITCH_BOT_OAUTH_TOKEN (or TWITCH_OAUTH_TOKEN) and NEXT_PUBLIC_TWITCH_CHANNEL.');
  }

  const cacheKey = `${creds.username}:${creds.channel}`;
  const state = chatState();
  if (state.client && state.cacheKey === cacheKey) {
    return { client: state.client, channel: creds.channel };
  }

  if (!state.connecting || state.cacheKey !== cacheKey) {
    state.cacheKey = cacheKey;
    state.connecting = (async () => {
      const client = new tmi.Client({
        connection: { reconnect: true, secure: true },
        identity: {
          username: creds.username,
          password: creds.token,
        },
        channels: [creds.channel],
      });
      await client.connect();
      state.client = client;
      return client;
    })();
  }

  const client = await state.connecting;
  return { client, channel: creds.channel };
}

export async function sendTwitchChatMessage(message: string) {
  const text = message.trim();
  if (!text) return;

  try {
    const { client, channel } = await getConnectedClient();
    await client.say(channel, text);
  } catch (error) {
    await resetClient();
    const { client, channel } = await getConnectedClient();
    await client.say(channel, text);
  }
}
