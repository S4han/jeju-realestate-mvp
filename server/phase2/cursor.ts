// Signed evidence-page cursors (API_SPEC): the client cannot alter the filter, version or position.
import { createHmac, timingSafeEqual } from "node:crypto";

export type CursorPayload = { a: string; ar: number | "all"; p: number; v: string; d: string; i: string };

export const MIN_SECRET_LENGTH = 32;

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function encodeCursor(payload: CursorPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

// Returns null for anything malformed or not signed with this secret.
export function decodeCursor(cursor: string, secret: string): CursorPayload | null {
  const [body, mac, extra] = cursor.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const ok =
      typeof p.a === "string" && (p.ar === "all" || Number.isInteger(p.ar)) && Number.isInteger(p.p) &&
      typeof p.v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.d) && /^\d{1,18}$/.test(p.i);
    return ok ? p : null;
  } catch {
    return null;
  }
}
