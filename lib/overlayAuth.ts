import { timingSafeEqual } from "crypto";

const SECRET_HEADER = "x-overlay-control-secret";

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

export function requireOverlayAuth(req: Request): Response | null {
  const expectedSecret = process.env.OVERLAY_CONTROL_SECRET;
  if (!expectedSecret) {
    return new Response("Overlay control secret missing", { status: 500 });
  }

  const providedSecret = req.headers.get(SECRET_HEADER);
  if (!providedSecret || !safeEqual(providedSecret, expectedSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}
