const SHUT_ELROY_POWERUP_PATTERN = /shut\s+elroy\s+up(\s+for\s+10\s+minutes?)?/i;

export type ShutElroyPowerUpTags = Record<string, string | undefined>;

export function isShutElroyPowerUpRedemption(
  message: string,
  tags: ShutElroyPowerUpTags,
  cachedPowerUpId = '',
) {
  const tagId =
    tags['custom-reward-id']
    || tags['power-up-id']
    || tags['msg-param-powerup-id']
    || '';
  const cachedId = cachedPowerUpId.trim();

  if (cachedId) {
    return tagId === cachedId;
  }

  if (!SHUT_ELROY_POWERUP_PATTERN.test(message)) return false;

  return Boolean(
    tags['power-up-id']
    || tags['msg-param-powerup-id'],
  );
}
