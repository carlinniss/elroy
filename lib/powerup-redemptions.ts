export type PowerUpRedemptionRecord = {
  id: string;
  userLogin: string;
  userName: string;
  rewardId: string;
  rewardTitle: string;
  redeemedAt: string;
  receivedAt: number;
};

type Store = {
  redemptions: PowerUpRedemptionRecord[];
  seenIds: Set<string>;
};

const MAX = 100;

const globalStore = globalThis as typeof globalThis & { __elroyPowerUpRedemptions?: Store };

function getStore(): Store {
  if (!globalStore.__elroyPowerUpRedemptions) {
    globalStore.__elroyPowerUpRedemptions = { redemptions: [], seenIds: new Set() };
  }
  return globalStore.__elroyPowerUpRedemptions;
}

export function recordPowerUpRedemption(record: PowerUpRedemptionRecord): boolean {
  const store = getStore();
  if (store.seenIds.has(record.id)) return false;
  store.seenIds.add(record.id);
  store.redemptions.push(record);
  if (store.redemptions.length > MAX) {
    const removed = store.redemptions.splice(0, store.redemptions.length - MAX);
    for (const r of removed) store.seenIds.delete(r.id);
  }
  return true;
}

export function getPowerUpRedemptionsSince(sinceMs: number): PowerUpRedemptionRecord[] {
  return getStore().redemptions.filter((r) => r.receivedAt > sinceMs);
}
