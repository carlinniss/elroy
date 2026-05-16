const CONTROL_SECRET_HEADER = "x-overlay-control-secret";

export function requireOverlayAuth(req: Request): Response | null {
  const expectedSecret = process.env.OVERLAY_CONTROL_SECRET;

  if (!expectedSecret) {
    return new Response("Overlay control secret is not configured", { status: 500 });
  }

  const providedSecret = req.headers.get(CONTROL_SECRET_HEADER);

  if (providedSecret !== expectedSecret) {
    return new Response("Forbidden", { status: 403 });
  }

  return null;
}
