import { hasRedisStorage, redisCommand } from '@/lib/redis-rest';
import { mentionsElroy } from '@/lib/elroy-mention';

const STORE_KEY = 'elroy:studio';
const MAX_HOST_SPEECH_ITEMS = 10;
const DUPLICATE_HOST_SPEECH_WINDOW_MS = 45_000;

export type StudioSettings = {
  silenceTailMs: number;
  energyThreshold: number;
  minSpeechMs: number;
  ingestStaleMs: number;
};

export type StudioInputSource = 'broadcast';

export type StudioHostSpeech = {
  id: string;
  text: string;
  at: number;
  mentionsElroy: boolean;
};

export type StudioSnapshot = {
  revision: number;
  listening: boolean;
  inputSource: StudioInputSource;
  streamerSpeaking: boolean;
  lastSpeechAt: number;
  recentHostSpeech: StudioHostSpeech[];
  latestHostMention: StudioHostSpeech | null;
  lastIngestAt: number;
  listenerAlive: boolean;
  settings: StudioSettings;
  updatedAt: number;
};

type StudioStore = {
  revision: number;
  listening: boolean;
  inputSource: StudioInputSource;
  streamerSpeaking: boolean;
  lastSpeechAt: number;
  recentHostSpeech: StudioHostSpeech[];
  lastIngestAt: number;
  settings: StudioSettings;
  updatedAt: number;
};

export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  silenceTailMs: 1500,
  energyThreshold: 0.025,
  minSpeechMs: 200,
  ingestStaleMs: 5000,
};

const globalStore = globalThis as typeof globalThis & {
  __elroyStudio?: StudioStore;
};

function defaultStore(): StudioStore {
  return {
    revision: 0,
    listening: false,
    inputSource: 'broadcast',
    streamerSpeaking: false,
    lastSpeechAt: 0,
    recentHostSpeech: [],
    lastIngestAt: 0,
    settings: { ...DEFAULT_STUDIO_SETTINGS },
    updatedAt: 0,
  };
}

function clampSettings(raw: Partial<StudioSettings> | undefined): StudioSettings {
  const base = { ...DEFAULT_STUDIO_SETTINGS };
  if (!raw) return base;
  if (typeof raw.silenceTailMs === 'number' && Number.isFinite(raw.silenceTailMs)) {
    base.silenceTailMs = Math.min(8000, Math.max(300, Math.round(raw.silenceTailMs)));
  }
  if (typeof raw.energyThreshold === 'number' && Number.isFinite(raw.energyThreshold)) {
    base.energyThreshold = Math.min(0.2, Math.max(0.005, raw.energyThreshold));
  }
  if (typeof raw.minSpeechMs === 'number' && Number.isFinite(raw.minSpeechMs)) {
    base.minSpeechMs = Math.min(2000, Math.max(80, Math.round(raw.minSpeechMs)));
  }
  if (typeof raw.ingestStaleMs === 'number' && Number.isFinite(raw.ingestStaleMs)) {
    base.ingestStaleMs = Math.min(30_000, Math.max(2000, Math.round(raw.ingestStaleMs)));
  }
  return base;
}

function parseStore(raw: unknown): StudioStore {
  if (!raw || typeof raw !== 'object') return defaultStore();
  const data = raw as Partial<StudioStore>;
  return {
    revision: typeof data.revision === 'number' && Number.isFinite(data.revision)
      ? Math.max(0, Math.floor(data.revision))
      : 0,
    listening: data.listening === true,
    inputSource: 'broadcast',
    streamerSpeaking: data.streamerSpeaking === true,
    lastSpeechAt: typeof data.lastSpeechAt === 'number' ? data.lastSpeechAt : 0,
    recentHostSpeech: Array.isArray(data.recentHostSpeech)
      ? data.recentHostSpeech
        .filter((entry): entry is StudioHostSpeech => Boolean(
          entry
          && typeof entry === 'object'
          && typeof (entry as StudioHostSpeech).id === 'string'
          && typeof (entry as StudioHostSpeech).text === 'string'
          && typeof (entry as StudioHostSpeech).at === 'number',
        ))
        .map((entry) => ({
          ...entry,
          text: entry.text.replace(/\s+/g, ' ').trim().slice(0, 500),
          mentionsElroy: entry.mentionsElroy === true || mentionsElroy(entry.text),
        }))
        .filter((entry) => entry.text.length > 0)
        .slice(-MAX_HOST_SPEECH_ITEMS)
      : [],
    lastIngestAt: typeof data.lastIngestAt === 'number' ? data.lastIngestAt : 0,
    settings: clampSettings(data.settings),
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
  };
}

function normalizeHostSpeechText(text: string) {
  return text
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isSameHostSpeechTopic(a: string, b: string) {
  if (a === b) return true;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return shorter.length >= 24 && longer.includes(shorter);
}

function isDuplicateHostSpeech(
  recent: StudioHostSpeech[],
  text: string,
  now: number,
) {
  const normalized = normalizeHostSpeechText(text);
  if (!normalized) return true;
  return recent.some((entry) => {
    if (now - entry.at > DUPLICATE_HOST_SPEECH_WINDOW_MS) return false;
    return isSameHostSpeechTopic(normalizeHostSpeechText(entry.text), normalized);
  });
}

async function readStore(): Promise<StudioStore> {
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
  if (!globalStore.__elroyStudio) {
    globalStore.__elroyStudio = defaultStore();
  }
  return parseStore(globalStore.__elroyStudio);
}

async function writeStore(store: StudioStore): Promise<StudioStore> {
  const normalized = parseStore(store);
  if (hasRedisStorage()) {
    await redisCommand(['SET', STORE_KEY, JSON.stringify(normalized)]);
    return normalized;
  }
  globalStore.__elroyStudio = normalized;
  return normalized;
}

export function buildStudioSnapshot(store: StudioStore, now = Date.now()): StudioSnapshot {
  const listenerAlive = store.listening
    && store.lastIngestAt > 0
    && now - store.lastIngestAt < store.settings.ingestStaleMs;
  const recentHostSpeech = store.recentHostSpeech
    .filter((entry) => now - entry.at < 5 * 60_000)
    .slice(-MAX_HOST_SPEECH_ITEMS);
  const latestHostMention = [...recentHostSpeech].reverse().find((entry) => entry.mentionsElroy) ?? null;
  return {
    revision: store.revision,
    listening: store.listening,
    inputSource: store.inputSource,
    streamerSpeaking: listenerAlive ? store.streamerSpeaking : false,
    lastSpeechAt: store.lastSpeechAt,
    recentHostSpeech,
    latestHostMention,
    lastIngestAt: store.lastIngestAt,
    listenerAlive,
    settings: store.settings,
    updatedAt: store.updatedAt,
  };
}

export async function getStudioSnapshot(): Promise<StudioSnapshot> {
  return buildStudioSnapshot(await readStore());
}

export type StudioIngestPayload = {
  listening?: boolean;
  inputSource?: StudioInputSource;
  streamerSpeaking?: boolean;
  lastSpeechAt?: number;
  hostTranscript?: string;
};

export async function ingestStudio(payload: StudioIngestPayload): Promise<StudioSnapshot> {
  const store = await readStore();
  const now = Date.now();
  const updated: StudioStore = {
    ...store,
    revision: store.revision + 1,
    lastIngestAt: now,
    updatedAt: now,
  };

  if (typeof payload.listening === 'boolean') {
    updated.listening = payload.listening;
    if (!payload.listening) {
      updated.streamerSpeaking = false;
    }
  }
  if (payload.inputSource === 'broadcast') {
    updated.inputSource = payload.inputSource;
  }
  if (typeof payload.streamerSpeaking === 'boolean') {
    updated.streamerSpeaking = payload.streamerSpeaking;
  }
  if (typeof payload.lastSpeechAt === 'number' && Number.isFinite(payload.lastSpeechAt)) {
    updated.lastSpeechAt = payload.lastSpeechAt;
  } else if (payload.streamerSpeaking === true) {
    updated.lastSpeechAt = now;
  }
  if (typeof payload.hostTranscript === 'string') {
    const text = payload.hostTranscript.replace(/\s+/g, ' ').trim();
    if (text && !isDuplicateHostSpeech(updated.recentHostSpeech, text, now)) {
      updated.recentHostSpeech = [
        ...updated.recentHostSpeech,
        {
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          text: text.slice(0, 500),
          at: now,
          mentionsElroy: mentionsElroy(text),
        },
      ].slice(-MAX_HOST_SPEECH_ITEMS);
    }
  }

  return buildStudioSnapshot(await writeStore(updated), now);
}

export async function updateStudioSettings(
  settings: Partial<StudioSettings>,
): Promise<StudioSnapshot> {
  const store = await readStore();
  const updated: StudioStore = {
    ...store,
    revision: store.revision + 1,
    settings: clampSettings({ ...store.settings, ...settings }),
    updatedAt: Date.now(),
  };
  return buildStudioSnapshot(await writeStore(updated));
}
