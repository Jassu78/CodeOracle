export function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(\S+)\s*$/i);
  if (!match?.[1]) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export function assertBearerPresent(authorization: string | undefined): string {
  const token = extractBearerToken(authorization);
  if (!token) {
    throw new Error("missing or empty bearer token");
  }
  return token;
}
