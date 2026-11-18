import "server-only";
import postgres from "postgres";
import { env } from "./env";

declare global {
  var __filesignSql: postgres.Sql | undefined;
}

export function sql(): postgres.Sql {
  if (!globalThis.__filesignSql) {
    globalThis.__filesignSql = postgres(env().DATABASE_URL, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
      // Compatible with transaction-mode poolers (Neon/Supabase pgbouncer).
      prepare: false,
      onnotice: () => {},
    });
  }
  return globalThis.__filesignSql;
}
