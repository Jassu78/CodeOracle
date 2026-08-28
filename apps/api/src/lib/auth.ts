import type { IncomingMessage } from "node:http";
import type { Env } from "@codeoracle/config";

export function isAuthorized(req: IncomingMessage, env: Env): boolean {
  if (!env.API_TOKEN) return true;
  const header = req.headers.authorization;
  return header === `Bearer ${env.API_TOKEN}`;
}

export function unauthorizedBody(): { error: string } {
  return { error: "unauthorized — set Authorization: Bearer <API_TOKEN>" };
}
