/** Injected at the app edge — keeps retrieval free of gateway imports. */
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
