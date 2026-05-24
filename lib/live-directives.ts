import { hasRedisStorage, redisCommand } from '@/lib/redis-rest';

const STORE_KEY = 'elroy:directives';
const MAX_STICKY = 8;
const MAX_NEXT = 5;
const MAX_PUSH = 3;
const MAX_TEXT = 600;

export type DirectiveKind = 'sticky' | 'next' | 'push';

export type LiveDirective = {
  id: string;
  text: string;
  kind: DirectiveKind;
  createdAt: number;
  chatOnly?: boolean;
  forceVoice?: boolean;
};

export type DirectiveSnapshot = {
  sticky: LiveDirective[];
  next: LiveDirective[];
  push: LiveDirective[];
};

type DirectiveStore = DirectiveSnapshot;

const globalStore = globalThis as typeof globalThis & {
  __elroyDirectives?: DirectiveStore;
};

function memoryStore(): DirectiveStore {
  if (!globalStore.__elroyDirectives) {
    globalStore.__elroyDirectives = { sticky: [], next: [], push: [] };
  }
  return globalStore.__elroyDirectives;
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function trimText(text: string) {
  return text.trim().slice(0, MAX_TEXT);
}

function parseStore(raw: unknown): DirectiveStore {
  if (!raw || typeof raw !== 'object') {
    return { sticky: [], next: [], push: [] };
  }
  const data = raw as Partial<DirectiveStore>;
  const normalize = (items: unknown, kind: DirectiveKind): LiveDirective[] => {
    if (!Array.isArray(items)) return [];
    return items
      .filter((item): item is LiveDirective => (
        Boolean(item)
        && typeof item === 'object'
        && typeof (item as LiveDirective).id === 'string'
        && typeof (item as LiveDirective).text === 'string'
      ))
      .map((item) => ({
        id: item.id,
        text: trimText(item.text),
        kind,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
        chatOnly: item.chatOnly === true,
        forceVoice: item.forceVoice === true,
      }))
      .filter((item) => item.text.length > 0);
  };

  return {
    sticky: normalize(data.sticky, 'sticky').slice(0, MAX_STICKY),
    next: normalize(data.next, 'next').slice(0, MAX_NEXT),
    push: normalize(data.push, 'push').slice(0, MAX_PUSH),
  };
}

async function readStore(): Promise<DirectiveStore> {
  if (hasRedisStorage()) {
    const raw = await redisCommand(['GET', STORE_KEY]);
    if (typeof raw === 'string' && raw.length > 0) {
      try {
        return parseStore(JSON.parse(raw));
      } catch {
        return { sticky: [], next: [], push: [] };
      }
    }
    return { sticky: [], next: [], push: [] };
  }
  return parseStore(memoryStore());
}

async function writeStore(store: DirectiveStore) {
  const normalized = parseStore(store);
  if (hasRedisStorage()) {
    await redisCommand(['SET', STORE_KEY, JSON.stringify(normalized)]);
    return normalized;
  }
  globalStore.__elroyDirectives = normalized;
  return normalized;
}

export function formatDirectiveInjection(sticky: string[], next: string[]) {
  const parts: string[] = [];
  if (sticky.length) {
    parts.push(
      'Broadcaster live direction (weave naturally into spontaneous content — do not quote verbatim):'
      + `\n${sticky.map((line) => `- ${line}`).join('\n')}`,
    );
  }
  if (next.length) {
    parts.push(
      'Immediate broadcaster instruction for THIS response (highest priority):'
      + `\n${next.map((line) => `- ${line}`).join('\n')}`,
    );
  }
  return parts.length ? `\n\n${parts.join('\n\n')}` : '';
}

export async function listDirectives(): Promise<DirectiveSnapshot> {
  return readStore();
}

export async function addDirective(
  kind: DirectiveKind,
  text: string,
  opts: { chatOnly?: boolean; forceVoice?: boolean } = {},
): Promise<LiveDirective | null> {
  const trimmed = trimText(text);
  if (!trimmed) return null;

  const store = await readStore();
  const directive: LiveDirective = {
    id: newId(),
    text: trimmed,
    kind,
    createdAt: Date.now(),
    chatOnly: opts.chatOnly,
    forceVoice: opts.forceVoice,
  };

  if (kind === 'sticky') {
    store.sticky = [directive, ...store.sticky.filter((item) => item.text !== trimmed)].slice(0, MAX_STICKY);
  } else if (kind === 'next') {
    store.next = [...store.next, directive].slice(-MAX_NEXT);
  } else {
    store.push = [...store.push, directive].slice(-MAX_PUSH);
  }

  await writeStore(store);
  return directive;
}

export async function removeDirective(kind: DirectiveKind, id: string) {
  const store = await readStore();
  store[kind] = store[kind].filter((item) => item.id !== id);
  await writeStore(store);
  return true;
}

export async function clearDirectives(kind?: DirectiveKind) {
  const store = await readStore();
  if (!kind) {
    await writeStore({ sticky: [], next: [], push: [] });
    return;
  }
  store[kind] = [];
  await writeStore(store);
}

export async function consumeNextDirectives(): Promise<LiveDirective[]> {
  const store = await readStore();
  const consumed = [...store.next];
  store.next = [];
  await writeStore(store);
  return consumed;
}

export async function ackPushDirective(id: string) {
  const store = await readStore();
  store.push = store.push.filter((item) => item.id !== id);
  await writeStore(store);
}
