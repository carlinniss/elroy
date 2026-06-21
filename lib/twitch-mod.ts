import {
  getBroadcasterId,
  getBroadcasterLogin,
  getBroadcasterTwitchCredentials,
  getModTwitchCredentials,
  getUserIdByLogin,
  twitchGet,
  twitchPost,
} from '@/lib/twitch';

export type ModCredentials = {
  token: string;
  clientId: string;
  moderatorId: string;
  moderatorLogin: string;
  broadcasterId: string;
  broadcasterLogin: string;
};

export { getModTwitchCredentials };

export function formatFollowTenure(followedAt: string): string {
  const ms = Date.now() - new Date(followedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just followed';
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return 'less than a day';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (remMonths === 0) return `${years} year${years === 1 ? '' : 's'}`;
  return `${years}y ${remMonths}mo`;
}

export async function getFollowInfo(username: string) {
  const creds = await getModTwitchCredentials();
  const broadcasterLogin = getBroadcasterLogin();
  if (!creds || !broadcasterLogin) return null;

  const userId = await getUserIdByLogin(username, creds.token, creds.clientId);
  if (!userId) return null;

  try {
    const data = await twitchGet(
      `/channels/followers?broadcaster_id=${creds.broadcasterId}&user_id=${userId}&moderator_id=${creds.moderatorId}`,
      creds.token,
      creds.clientId,
    );
    const entry = data.data?.[0] as { user_id?: string; user_login?: string; followed_at?: string } | undefined;
    if (!entry?.followed_at) return null;
    return {
      user_id: entry.user_id ?? userId,
      user_login: entry.user_login ?? username.toLowerCase(),
      followed_at: entry.followed_at,
      tenure: formatFollowTenure(entry.followed_at),
    };
  } catch {
    return null;
  }
}

export async function getChannelMetadata() {
  const broadcasterLogin = getBroadcasterLogin();
  const clientId = process.env.TWITCH_CLIENT_ID?.trim();
  const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();

  if (broadcasterLogin && clientId && clientSecret) {
    const { fetchStreamViaHelix } = await import('@/lib/twitch');
    const stream = await fetchStreamViaHelix(broadcasterLogin, clientId, clientSecret);
    if (stream.status === 'live') {
      return {
        is_live: true,
        title: stream.title ?? '',
        game_name: stream.game_name ?? '',
        game_id: stream.game_id ?? '',
        viewer_count: stream.viewer_count,
        started_at: stream.started_at ?? '',
      };
    }
  }

  const creds = await getModTwitchCredentials();
  if (!creds) return null;

  const channel = await twitchGet(
    `/channels?broadcaster_id=${creds.broadcasterId}`,
    creds.token,
    creds.clientId,
  );
  const info = channel.data?.[0] as {
    title?: string;
    game_name?: string;
    game_id?: string;
  } | undefined;

  return {
    is_live: false,
    title: info?.title ?? '',
    game_name: info?.game_name ?? '',
    game_id: info?.game_id ?? '',
    viewer_count: 0,
    started_at: '',
  };
}

export async function sendChatAnnouncement(message: string, color: 'primary' | 'blue' | 'green' | 'orange' | 'purple' = 'primary') {
  const creds = await getModTwitchCredentials();
  if (!creds) throw new Error('No mod Twitch credentials configured.');

  await twitchPost('/chat/announcements', creds.token, creds.clientId, {
    broadcaster_id: creds.broadcasterId,
    moderator_id: creds.moderatorId,
    message: message.slice(0, 500),
    color,
  });
}

export async function sendShoutout(toLogin: string) {
  const creds = await getModTwitchCredentials();
  if (!creds) throw new Error('No mod Twitch credentials configured.');

  const toBroadcasterId = await getBroadcasterId(toLogin, creds.token, creds.clientId);
  if (!toBroadcasterId) throw new Error(`Could not find Twitch user: ${toLogin}`);

  await twitchPost('/chat/shoutouts', creds.token, creds.clientId, {
    broadcaster_id: creds.broadcasterId,
    moderator_id: creds.moderatorId,
    to_broadcaster_id: toBroadcasterId,
  });
}

export async function createLiveClip() {
  const creds = await getModTwitchCredentials();
  if (!creds) throw new Error('No mod Twitch credentials configured.');

  const created = await twitchPost(
    `/clips?broadcaster_id=${creds.broadcasterId}`,
    creds.token,
    creds.clientId,
    {},
  ) as { data?: Array<{ id?: string; edit_url?: string }> };

  const clipId = created.data?.[0]?.id;
  const editUrl = created.data?.[0]?.edit_url;
  if (!clipId) throw new Error('Clip creation did not return an id.');

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1500 : 2000));
    const clips = await twitchGet(`/clips?id=${clipId}`, creds.token, creds.clientId);
    const clip = clips.data?.[0] as { url?: string; edit_url?: string } | undefined;
    if (clip?.url) {
      return { id: clipId, url: clip.url, edit_url: clip.edit_url ?? editUrl ?? '' };
    }
  }

  return {
    id: clipId,
    url: editUrl || `https://clips.twitch.tv/${clipId}`,
    edit_url: editUrl || '',
  };
}

export async function createChannelPoll(title: string, choices: string[], durationSeconds = 60) {
  const creds = await getModTwitchCredentials();
  if (!creds) throw new Error('No mod Twitch credentials configured.');

  const trimmedChoices = choices.map((c) => c.trim()).filter(Boolean).slice(0, 5);
  if (trimmedChoices.length < 2) throw new Error('Poll needs at least 2 choices.');

  const data = await twitchPost('/polls', creds.token, creds.clientId, {
    broadcaster_id: creds.broadcasterId,
    title: title.slice(0, 60),
    choices: trimmedChoices.map((choiceTitle) => ({ title: choiceTitle.slice(0, 25) })),
    duration: Math.min(1800, Math.max(15, durationSeconds)),
    channel_points_voting_enabled: false,
  }) as { data?: Array<{ id?: string; title?: string }> };

  const poll = data.data?.[0];
  if (!poll?.id) throw new Error('Poll creation failed.');
  return poll;
}

export async function banUserFromChannel(
  login: string,
  options: { userId?: string; reason?: string } = {},
) {
  const creds = await getModTwitchCredentials();
  if (!creds) throw new Error('No mod Twitch credentials configured.');

  const normalizedLogin = login.trim().replace(/^@/, '').toLowerCase();
  if (!normalizedLogin) throw new Error('login required');

  const userId = options.userId?.trim()
    || await getUserIdByLogin(normalizedLogin, creds.token, creds.clientId);
  if (!userId) throw new Error(`Could not find Twitch user: ${normalizedLogin}`);

  await twitchPost(
    `/moderation/bans?broadcaster_id=${creds.broadcasterId}&moderator_id=${creds.moderatorId}`,
    creds.token,
    creds.clientId,
    {
      data: {
        user_id: userId,
        reason: (options.reason || 'Auto-ban: offensive username').slice(0, 500),
      },
    },
  );

  return { login: normalizedLogin, userId };
}

export async function getModeratorIdForEventSub() {
  const creds = await getModTwitchCredentials();
  return creds?.moderatorId ?? null;
}

export async function getBroadcasterIdForEventSub() {
  const creds = await getModTwitchCredentials();
  if (creds?.broadcasterId) return creds.broadcasterId;
  const broadcaster = await getBroadcasterTwitchCredentials();
  const login = getBroadcasterLogin();
  if (!broadcaster || !login) return null;
  return getBroadcasterId(login, broadcaster.token, broadcaster.clientId);
}
