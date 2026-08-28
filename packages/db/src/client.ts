import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index";

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Creates a Drizzle client. Callers pass in an already-validated
 * DATABASE_URL from @codeoracle/config — this package does not read
 * process.env directly, keeping it framework/env-source agnostic.
 */
export function createDb(databaseUrl: string): Database {
  const client = postgres(databaseUrl, { max: 10 });
  return drizzle(client, { schema });
}
