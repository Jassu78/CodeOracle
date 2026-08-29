export type Session = { userId: string; issuedAt: number };

const COOKIE_NAME = "co_session";

/** Sign + set session cookie — HMAC in production; fixture uses opaque token. */
export function writeSessionCookie(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${COOKIE_NAME}=${payload}; Path=/; HttpOnly; SameSite=Lax`;
}

export function readSessionCookie(header: string | undefined): Session | null {
  if (!header) return null;
  const part = header.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE_NAME}=`));
  if (!part) return null;
  try {
    const raw = part.slice(COOKIE_NAME.length + 1);
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Session;
  } catch {
    return null;
  }
}
