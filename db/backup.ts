/**
 * Copy all data out of, or into, the database as one JSON file.
 *
 *   npm run export -- backup.json        save everything
 *   npm run import -- backup.json        load it into an EMPTY database
 *
 * To move your local data online: export locally, then run the import with
 * DATABASE_URL set to the online database's connection string.
 * The file contains PIN hashes and token hashes, so keep it private.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { getTableName, sql } from "drizzle-orm";
import { type Db, getDb, schema } from "./client";

// Parents before children, so references always point at rows that exist.
const TABLES = [
  schema.members, schema.places, schema.activityTypes, schema.categories,
  schema.activities, schema.activityMembers, schema.transactions, schema.budgets,
  schema.savingsGoals, schema.savingsEntries, schema.budgetPeriods, schema.sweeps, schema.auditLog, schema.apiTokens,
] as const;
const REFERENCE = new Set(["members", "places", "activity_types", "categories"]);

export async function exportAll(db: Db) {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) out[getTableName(t)] = await db.select().from(t);
  return out;
}

export async function importAll(db: Db, data: Record<string, any[]>) {
  await db.transaction(async (tx) => {
    for (const t of TABLES) {
      const name = getTableName(t);
      if (!REFERENCE.has(name)) {
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(t);
        if (n > 0) throw new Error(`Refusing to import: "${name}" already has ${n} rows. Import only into an empty database.`);
      }
    }
    // Replace the seeded reference rows so ids match the backup exactly.
    for (const t of [...TABLES].reverse()) if (REFERENCE.has(getTableName(t))) await tx.delete(t);
    for (const t of TABLES) {
      const rows = (data[getTableName(t)] ?? []).map((r) => {
        // JSON turned timestamps into text; turn the one Date-typed column back
        return "pinLockedUntil" in r && r.pinLockedUntil ? { ...r, pinLockedUntil: new Date(r.pinLockedUntil) } : r;
      });
      for (let i = 0; i < rows.length; i += 200) await tx.insert(t).values(rows.slice(i, i + 200));
      if ("id" in t) {
        const name = getTableName(t);
        await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('${name}', 'id'), coalesce((select max(id) from ${name}), 0) + 1, false)`));
      }
    }
  });
}

const [mode, file] = process.argv.slice(2);
if (mode === "export" || mode === "import") {
  if (!file) throw new Error(`Usage: npm run ${mode} -- <file.json>`);
  const db = await getDb();
  if (mode === "export") {
    const data = await exportAll(db);
    writeFileSync(file, JSON.stringify(data, null, 1));
    console.log(`Saved ${Object.values(data).reduce((n, r) => n + r.length, 0)} rows to ${file}`);
  } else {
    await importAll(db, JSON.parse(readFileSync(file, "utf8")));
    console.log(`Loaded ${file}`);
  }
  process.exit(0);
}
