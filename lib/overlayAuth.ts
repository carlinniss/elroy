export const OVERLAY_CONTROL_HEADER = "x-overlay-control-secret";

const json = (body: unknown, init: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

export function requireOverlayControl(req: Request): Response | null {
  const expected = process.env.OVERLAY_CONTROL_SECRET;

  if (!expected) {
    return json({ error: "Overlay control secret is not configured" }, { status: 500 });
  }

  const actual = req.headers.get(OVERLAY_CONTROL_HEADER);
  if (actual !== expected) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
