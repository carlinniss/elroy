export function getControlSecret() {
  return process.env.ELROY_CONTROL_SECRET?.trim() || '';
}

export function isControlAuthorized(request: Request) {
  const secret = getControlSecret();
  if (!secret) return true;

  const auth = request.headers.get('authorization')?.trim();
  if (auth === `Bearer ${secret}`) return true;

  return request.headers.get('x-elroy-control-secret')?.trim() === secret;
}
