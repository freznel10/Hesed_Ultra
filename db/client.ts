import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { MIGRATIONS } from "./migrations";
import { seed } from "./seed-data";
import * as schema from "./schema";

/**
 * Local database: PGlite (Postgres compiled to WebAssembly), stored on disk.
 * Production (Phase 6) will switch to Netlify DB / Neon when NETLIFY_DATABASE_URL is set.
 */
const dataDir = resolve(process.env.PGLITE_DIR ?? ".data/pglite");

let ready: Promise<ReturnType<typeof drizzle<typeof schema>>> | null = null;

async function open() {
  mkdirSync(dataDir, { recursive: true });
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

export function getDb() {
  ready ??= open();
  return ready;
}

export { schema };
