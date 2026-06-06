import { isControlAuthorized } from '@/lib/control-auth';
import { fetchShutElroyPowerUpId, getBroadcasterLogin } from '@/lib/twitch';

export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const broadcasterLogin = getBroadcasterLogin();
  const result = await fetchShutElroyPowerUpId();

  if (result.error && !result.shut_elroy_powerup_id) {
    const status = result.error.includes('not found') ? 404
      : result.error.includes('bits:read') || result.error.includes('broadcaster') ? 403
      : result.error.includes('Invalid') ? 401
      : result.error.includes('Missing') ? 503
      : 500;
    return Response.json({ broadcaster_login: broadcasterLogin, ...result }, { status });
  }

  return Response.json({
    broadcaster_login: broadcasterLogin,
    ...result,
    auto_detected: Boolean(result.shut_elroy_powerup_id),
  });
}
