const jsonHeaders = { "Content-Type": "application/json" };

export function requireOverlayAuth(req: Request): Response | null {
  const expectedSecret = process.env.OVERLAY_CONTROL_SECRET;

  if (!expectedSecret) {
    return new Response(JSON.stringify({ error: "Overlay control secret is not configured" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  if (req.headers.get("x-overlay-control-secret") !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  return null;
}
