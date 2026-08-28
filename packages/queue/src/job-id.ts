import { createHash } from "node:crypto";

/** BullMQ custom job ids cannot contain `:`. */
export function bullJobId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
