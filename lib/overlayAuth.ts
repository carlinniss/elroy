import { timingSafeEqual } from "crypto";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireOverlayAuth(req: Request) {
  const expectedSecret = process.env.OVERLAY_CONTROL_SECRET;

  if (!expectedSecret) {
    console.error("OVERLAY_CONTROL_SECRET is not configured");
    return new Response("Overlay control secret is not configured", { status: 500 });
  }

  const suppliedSecret = req.headers.get("x-overlay-control-secret") || "";
  if (!safeEqual(suppliedSecret, expectedSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}
