import { cacheSize } from "../cache/memory-cache.js";

export type HealthStatus = {
  ok: true;
  cacheEntries: number;
  poolMax: number;
};

export function buildHealthStatus(poolMax: number): HealthStatus {
  return { ok: true, cacheEntries: cacheSize(), poolMax };
}
