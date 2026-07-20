export const DEFAULT_STREAMER_DISPLAY_NAME = 'DTLDabs';

export function getStreamerDisplayName(): string {
  const env: Partial<NodeJS.ProcessEnv> = typeof process !== 'undefined' ? process.env : {};
  return (
    env.NEXT_PUBLIC_STREAMER_DISPLAY_NAME?.trim()
    || env.STREAMER_DISPLAY_NAME?.trim()
    || env.TWITCH_BROADCASTER_LOGIN?.trim()
    || env.NEXT_PUBLIC_TWITCH_CHANNEL?.trim()
    || DEFAULT_STREAMER_DISPLAY_NAME
  ).replace(/^#/, '');
}
