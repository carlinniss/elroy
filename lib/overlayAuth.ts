const OVERLAY_SECRET_HEADER = "x-overlay-control-secret";

function hasValidSecret(provided: string | null, expected: string) {
  return provided === expected;
}

export function requireOverlayAuth(req: Request) {
  const expectedSecret = process.env.OVERLAY_CONTROL_SECRET;

  if (!expectedSecret) {
    return Response.json({ error: "Overlay auth is not configured" }, { status: 500 });
  }

  if (!hasValidSecret(req.headers.get(OVERLAY_SECRET_HEADER), expectedSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
