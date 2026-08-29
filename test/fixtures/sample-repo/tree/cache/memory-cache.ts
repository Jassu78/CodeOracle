const store = new Map<string, string>();

export function lookupCached(key: string, compute: (k: string) => string): string {
  const hit = store.get(key);
  if (hit !== undefined) return hit;
  const value = compute(key);
  store.set(key, value);
  return value;
}

export function cacheSize(): number {
  return store.size;
}

export function clearCache(): void {
  store.clear();
}
