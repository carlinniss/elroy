import crypto from 'crypto';

const CONTROL_SECRET_HEADER = 'x-overlay-control-secret';

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function timingSafeStringEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function requireOverlayControl(request: Request): Response | null {
  const expected = process.env.OVERLAY_CONTROL_SECRET?.trim();
  if (!expected) {
    return jsonError('OVERLAY_CONTROL_SECRET is not configured.', 503);
  }

  const provided = request.headers.get(CONTROL_SECRET_HEADER)?.trim() || '';
  if (!provided || !timingSafeStringEqual(provided, expected)) {
    return jsonError('Unauthorized overlay control request.', 401);
  }

  return null;
}
