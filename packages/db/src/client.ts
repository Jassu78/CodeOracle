import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index";

export type Database = PostgresJsDatabase<typeof schema>;

const poolByUrl = new Map<string, Database>();

/**
 * Returns a shared Drizzle client per DATABASE_URL (one pool per process).
 * Avoids opening a new postgres.js pool on every BullMQ job.
 */
export function createDb(databaseUrl: string): Database {
  const existing = poolByUrl.get(databaseUrl);
  if (existing) return existing;

  const client = postgres(databaseUrl, { max: 5 });
  const db = drizzle(client, { schema });
  poolByUrl.set(databaseUrl, db);
  return db;
}
