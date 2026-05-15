import { timingSafeEqual } from "crypto";

const SECRET_HEADER = "x-overlay-control-secret";

function safeCompare(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

export function requireOverlayAuth(req: Request) {
  const expectedSecret = process.env.OVERLAY_CONTROL_SECRET;
  const providedSecret = req.headers.get(SECRET_HEADER);

  if (!expectedSecret || !providedSecret || !safeCompare(providedSecret, expectedSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}
