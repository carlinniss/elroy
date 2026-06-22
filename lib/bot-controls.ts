import { hasRedisStorage, redisCommand } from '@/lib/redis-rest';

const STORE_KEY = 'elroy:bot-controls';
const MAX_COMMANDS = 8;

export type BotControlsSettings = {
  voiceEnabled?: boolean;
  dingEnabled?: boolean;
  volume?: number;
};

export type BotControlCommandType = 'disconnect';

export type BotControlCommand = {
  id: string;
  type: BotControlCommandType;
  createdAt: number;
};

export type BotControlsSnapshot = {
  revision: number;
  settings: BotControlsSettings;
  commands: BotControlCommand[];
  updatedAt: number;
};

type BotControlsStore = BotControlsSnapshot;

const globalStore = globalThis as typeof globalThis & {
  __elroyBotControls?: BotControlsStore;
};

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultStore(): BotControlsStore {
  return {
    revision: 0,
    settings: {},
    commands: [],
    updatedAt: 0,
  };
}

function parseStore(raw: unknown): BotControlsStore {
  if (!raw || typeof raw !== 'object') return defaultStore();
  const data = raw as Partial<BotControlsStore>;
  const settings: BotControlsSettings = {};
  if (typeof data.settings?.voiceEnabled === 'boolean') {
    settings.voiceEnabled = data.settings.voiceEnabled;
  }
  if (typeof data.settings?.dingEnabled === 'boolean') {
    settings.dingEnabled = data.settings.dingEnabled;
  }
  if (typeof data.settings?.volume === 'number' && Number.isFinite(data.settings.volume)) {
    settings.volume = Math.min(1, Math.max(0, data.settings.volume));
  }

  const commands = Array.isArray(data.commands)
    ? data.commands.filter((item): item is BotControlCommand => (
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as BotControlCommand).id === 'string'
      && (item as BotControlCommand).type === 'disconnect'
      && typeof (item as BotControlCommand).createdAt === 'number'
    )).slice(-MAX_COMMANDS)
    : [];

  return {
    revision: typeof data.revision === 'number' && Number.isFinite(data.revision)
      ? Math.max(0, Math.floor(data.revision))
      : 0,
    settings,
    commands,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
  };
}

async function readStore(): Promise<BotControlsStore> {
  if (hasRedisStorage()) {
    const raw = await redisCommand(['GET', STORE_KEY]);
    if (typeof raw === 'string' && raw.length > 0) {
      try {
        return parseStore(JSON.parse(raw));
      } catch {
        return defaultStore();
      }
    }
    return defaultStore();
  }
  if (!globalStore.__elroyBotControls) {
    globalStore.__elroyBotControls = defaultStore();
  }
  return parseStore(globalStore.__elroyBotControls);
}

async function writeStore(store: BotControlsStore) {
  const normalized = parseStore(store);
  if (hasRedisStorage()) {
    await redisCommand(['SET', STORE_KEY, JSON.stringify(normalized)]);
    return normalized;
  }
  globalStore.__elroyBotControls = normalized;
  return normalized;
}

export async function getBotControls(): Promise<BotControlsSnapshot> {
  return readStore();
}

export async function updateBotControls(settings: BotControlsSettings): Promise<BotControlsSnapshot> {
  const store = await readStore();
  const nextSettings: BotControlsSettings = { ...store.settings };
  if (typeof settings.voiceEnabled === 'boolean') {
    nextSettings.voiceEnabled = settings.voiceEnabled;
  }
  if (typeof settings.dingEnabled === 'boolean') {
    nextSettings.dingEnabled = settings.dingEnabled;
  }
  if (typeof settings.volume === 'number' && Number.isFinite(settings.volume)) {
    nextSettings.volume = Math.min(1, Math.max(0, settings.volume));
  }

  const updated: BotControlsStore = {
    ...store,
    revision: store.revision + 1,
    settings: nextSettings,
    updatedAt: Date.now(),
  };
  return writeStore(updated);
}

export async function queueBotControlCommand(type: BotControlCommandType): Promise<BotControlsSnapshot> {
  const store = await readStore();
  const command: BotControlCommand = {
    id: newId(),
    type,
    createdAt: Date.now(),
  };
  const updated: BotControlsStore = {
    ...store,
    revision: store.revision + 1,
    commands: [...store.commands, command].slice(-MAX_COMMANDS),
    updatedAt: Date.now(),
  };
  return writeStore(updated);
}

export async function ackBotControlCommands(commandIds: string[]): Promise<BotControlsSnapshot> {
  if (!commandIds.length) return readStore();
  const ids = new Set(commandIds);
  const store = await readStore();
  const updated: BotControlsStore = {
    ...store,
    commands: store.commands.filter((item) => !ids.has(item.id)),
    updatedAt: Date.now(),
  };
  return writeStore(updated);
}
