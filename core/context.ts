import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as schema from "../db/schema";

/** Who is making a change and through which door. Recorded on every row and in the audit log. */
export type Ctx = {
  db: Db;
  /** A member key ("diane") or an agent/token name ("claude"). */
  actor: string;
  source: "app" | "mcp" | "import";
};

/** Thrown for problems the caller can fix (unknown key, missing row). The API turns these into 4xx. */
export class InputError extends Error {}

type Executor = Pick<Db, "select">;

async function byKey<T extends { id: number }>(rows: Promise<T[]>, what: string, key: string): Promise<T> {
  const row = (await rows)[0];
  if (!row) throw new InputError(`Unknown ${what}: "${key}"`);
  return row;
}

export const lookup = {
  member: (db: Executor, key: string) =>
    byKey(db.select().from(schema.members).where(eq(schema.members.key, key)), "family member", key),
  place: (db: Executor, key: string) =>
    byKey(db.select().from(schema.places).where(eq(schema.places.key, key)), "place", key),
  activityType: (db: Executor, key: string) =>
    byKey(db.select().from(schema.activityTypes).where(eq(schema.activityTypes.key, key)), "activity type", key),
  category: (db: Executor, key: string) =>
    byKey(db.select().from(schema.categories).where(eq(schema.categories.key, key)), "category", key),
};
