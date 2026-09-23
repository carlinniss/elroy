import { getBroadcasterId, getBroadcasterLogin, getBroadcasterTwitchCredentials, twitchGet } from '@/lib/twitch';

/**
 * Channel-point rewards Elroy reacts to. Twitch only puts a redemption into chat (with a
 * custom-reward-id tag) when the reward REQUIRES the viewer to enter text, so both rewards
 * must be created with "Require Viewer to Enter Text" turned on.
 */
export type ElroyRewardKind = 'roast' | 'ask';

export const REWARD_TITLE_PATTERNS: Record<ElroyRewardKind, RegExp> = {
  roast: /roast\s*me/i,
  ask: /ask\s*elroy/i,
};

export type ElroyRewardMap = Partial<Record<ElroyRewardKind, string>> & {
  source: 'helix' | 'env' | 'none';
  error?: string;
};

function envRewardMap(): ElroyRewardMap {
  const roast = process.env.ELROY_REWARD_ROAST_ID?.trim();
  const ask = process.env.ELROY_REWARD_ASK_ID?.trim();
  return { roast: roast || undefined, ask: ask || undefined, source: roast || ask ? 'env' : 'none' };
}

/** Env IDs win; otherwise find rewards by title (needs channel:read:redemptions on TWITCH_OAUTH_TOKEN). */
export async function resolveElroyRewards(): Promise<ElroyRewardMap> {
  const fromEnv = envRewardMap();
  if (fromEnv.source === 'env') return fromEnv;

  const creds = await getBroadcasterTwitchCredentials();
  const login = getBroadcasterLogin();
  if (!creds || !login) return { source: 'none', error: 'Broadcaster token or channel not configured.' };
  if (!creds.scopes.includes('channel:read:redemptions') && !creds.scopes.includes('channel:manage:redemptions')) {
    return {
      source: 'none',
      error: 'TWITCH_OAUTH_TOKEN needs channel:read:redemptions to auto-detect rewards — or set ELROY_REWARD_ROAST_ID / ELROY_REWARD_ASK_ID.',
    };
  }

  try {
    const broadcasterId = await getBroadcasterId(login, creds.token, creds.clientId);
    if (!broadcasterId) return { source: 'none', error: `Channel not found: ${login}` };
    const data = await twitchGet(`/channel_points/custom_rewards?broadcaster_id=${broadcasterId}`, creds.token, creds.clientId);
    const rewards = (data.data ?? []) as Array<{ id: string; title: string; is_user_input_required?: boolean }>;
    const map: ElroyRewardMap = { source: 'helix' };
    for (const kind of Object.keys(REWARD_TITLE_PATTERNS) as ElroyRewardKind[]) {
      const match = rewards.find((reward) => REWARD_TITLE_PATTERNS[kind].test(reward.title));
      if (match) map[kind] = match.id;
    }
    return map;
  } catch (error) {
    return { source: 'none', error: error instanceof Error ? error.message : 'Reward lookup failed' };
  }
}
