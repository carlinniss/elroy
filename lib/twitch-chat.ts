import tmi from 'tmi.js';

type ChatClientState = {
  client: tmi.Client | null;
  connectPromise: Promise<void> | null;
  key: string;
};

const globalChat = globalThis as typeof globalThis & { __elroyChatClient?: ChatClientState };

function getState(): ChatClientState {
  if (!globalChat.__elroyChatClient) {
    globalChat.__elroyChatClient = { client: null, connectPromise: null, key: '' };
  }
  return globalChat.__elroyChatClient;
}

function formatIrcPassword(token: string) {
  return token.startsWith('oauth:') ? token : `oauth:${token}`;
}

function getChatConfig() {
  const channel = process.env.NEXT_PUBLIC_TWITCH_CHANNEL?.replace(/^#/, '').trim().toLowerCase();
  const username = (process.env.TWITCH_BOT_USERNAME || channel)?.replace(/^#/, '').trim().toLowerCase();
  const token = process.env.TWITCH_BOT_OAUTH_TOKEN || process.env.TWITCH_OAUTH_TOKEN;

  if (!channel) throw new Error('NEXT_PUBLIC_TWITCH_CHANNEL is not configured.');
  if (!username) throw new Error('TWITCH_BOT_USERNAME or NEXT_PUBLIC_TWITCH_CHANNEL is not configured.');
  if (!token?.trim()) throw new Error('TWITCH_BOT_OAUTH_TOKEN or TWITCH_OAUTH_TOKEN is not configured.');

  return {
    channel,
    username,
    password: formatIrcPassword(token.trim()),
  };
}

async function getChatClient() {
  const config = getChatConfig();
  const key = `${config.username}:${config.channel}:${config.password}`;
  const state = getState();

  if (state.client && state.key === key) {
    if (state.connectPromise) await state.connectPromise;
    return { client: state.client, channel: config.channel };
  }

  if (state.client) {
    await state.client.disconnect().catch(() => undefined);
  }

  const client = new tmi.Client({
    identity: {
      username: config.username,
      password: config.password,
    },
    channels: [config.channel],
  });

  state.client = client;
  state.key = key;
  state.connectPromise = client.connect()
    .then(() => undefined)
    .catch((error) => {
      if (state.client === client) {
        state.client = null;
        state.connectPromise = null;
        state.key = '';
      }
      throw error;
    });

  await state.connectPromise;
  return { client, channel: config.channel };
}

export async function sendTwitchChatMessage(message: string) {
  const trimmed = message.trim();
  if (!trimmed) throw new Error('Message is empty.');

  const { client, channel } = await getChatClient();
  await client.say(channel, trimmed.slice(0, 500));
}
