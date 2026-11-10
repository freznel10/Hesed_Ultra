import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { ACTIVITY_TYPES, MEMBERS, PLACES } from "../core/family";
import * as schema from "./schema";

/** Insert the family, places and activity types if they are missing. Safe to run repeatedly. */
export async function seed(db: PgliteDatabase<typeof schema>) {
  await db
    .insert(schema.members)
    .values(MEMBERS.map((m) => ({ key: m.key, name: m.name, role: m.role, color: m.color, sprite: m.sprite })))
    .onConflictDoNothing();
  await db
    .insert(schema.places)
    .values(PLACES.map((p) => ({ key: p.key, name: p.name, sprite: p.sprite })))
    .onConflictDoNothing();
  for (const t of ACTIVITY_TYPES) {
    const place = t.place
      ? (await db.select().from(schema.places).where(eq(schema.places.key, t.place)))[0]
      : undefined;
    await db
      .insert(schema.activityTypes)
      .values({ key: t.key, name: t.name, defaultPlaceId: place?.id ?? null })
      .onConflictDoNothing();
  }
}
