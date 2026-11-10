import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { MIGRATIONS } from "./migrations";
import { seed } from "./seed-data";
import * as schema from "./schema";

/** The database as the rest of the code sees it; the same for both engines below. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The little each engine must provide to run migrations. */
type Runner = { exec(sql: string): Promise<unknown>; query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> };

async function migrate(run: Runner) {
  await run.exec(`CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`);
  const done = new Set((await run.query(`SELECT id FROM _migrations`)).rows.map((r) => r.id as string));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await run.exec("BEGIN");
    try {
      await run.exec(m.sql);
      await run.query(`INSERT INTO _migrations (id) VALUES ($1)`, [m.id]);
      await run.exec("COMMIT");
    } catch (err) {
      await run.exec("ROLLBACK");
      throw err;
    }
  }
}

/**
 * Local database: PGlite (Postgres compiled to WebAssembly). With a folder it is stored
 * on disk; with no argument it lives in memory (used by tests). Only one process can
 * open a folder at a time, which is why agents connect through the running app.
 */
export async function openDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  await migrate({ exec: (sql) => pg.exec(sql), query: (sql, params) => pg.query(sql, params) });
  const db = drizzle(pg, { schema }) as unknown as Db;
  await seed(db);
  return db;
}

/** Online database: a real Postgres server (Netlify DB / Neon, or any other) given by URL. */
export async function openPostgres(url: string): Promise<Db> {
  const { default: pg } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new pg.Pool({ connectionString: url, max: 3, ssl: local ? undefined : { rejectUnauthorized: true } });
  const client = await pool.connect();
  try {
    // One instance migrates at a time, even if several start together.
    await client.query("SELECT pg_advisory_lock(7437301)");
    await migrate({ exec: (sql) => client.query(sql), query: (sql, params) => client.query(sql, params) });
    const db = drizzle(pool, { schema }) as unknown as Db;
    await seed(db);
    return db;
  } finally {
    await client.query("SELECT pg_advisory_unlock(7437301)").catch(() => {});
    client.release();
  }
}

let ready: Promise<Db> | null = null;

/** The app's database, opened once per process: Postgres if a URL is set, else the local PGlite folder. */
export function getDb(): Promise<Db> {
  const url = process.env.NETLIFY_DATABASE_URL ?? process.env.DATABASE_URL;
  ready ??= url ? openPostgres(url) : openDb(resolve(process.env.PGLITE_DIR ?? ".data/pglite"));
  ready.catch(() => { ready = null; }); // let the next request retry after a failed start
  return ready;
}

export { schema };
