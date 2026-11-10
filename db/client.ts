import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { MIGRATIONS } from "./migrations";
import { seed } from "./seed-data";
import * as schema from "./schema";

export type Db = PgliteDatabase<typeof schema>;

/**
 * Open a database, apply pending migrations and seed the reference data.
 * With a folder it is stored on disk; with no argument it lives in memory (used by tests).
 * Production (Phase 6) will switch to Netlify DB / Neon when NETLIFY_DATABASE_URL is set.
 */
export async function openDb(dataDir?: string): Promise<Db> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  await pg.exec(`CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`);
  const done = new Set((await pg.query<{ id: string }>(`SELECT id FROM _migrations`)).rows.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await pg.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query(`INSERT INTO _migrations (id) VALUES ($1)`, [m.id]);
    });
  }
  const db = drizzle(pg, { schema });
  await seed(db);
  return db;
}

let ready: Promise<Db> | null = null;

/** The app's local database, opened once per process. */
export function getDb(): Promise<Db> {
  ready ??= openDb(resolve(process.env.PGLITE_DIR ?? ".data/pglite"));
  return ready;
}

export { schema };
