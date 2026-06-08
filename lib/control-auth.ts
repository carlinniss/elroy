export function getControlSecret() {
  return process.env.ELROY_CONTROL_SECRET?.trim() || '';
}

export function controlAuthHeaders(secret: string, extra: Record<string, string> = {}) {
  const trimmed = secret.trim();
  if (!trimmed) return extra;
  return {
    ...extra,
    Authorization: `Bearer ${trimmed}`,
    'x-elroy-control-secret': trimmed,
  };
}

export function isControlAuthorized(request: Request) {
  const secret = getControlSecret();
  if (!secret) return true;

  const auth = request.headers.get('authorization')?.trim();
  if (auth === `Bearer ${secret}`) return true;

  return request.headers.get('x-elroy-control-secret')?.trim() === secret;
}
