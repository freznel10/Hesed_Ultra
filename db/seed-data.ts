import { eq } from "drizzle-orm";
import { ACTIVITY_TYPES, CATEGORIES, MEMBERS, PLACES } from "../core/family";
import * as schema from "./schema";

/** Insert the family, places and activity types if they are missing. Safe to run repeatedly. */
export async function seed(db: import("./client").Db) {
  await db
    .insert(schema.members)
    .values(MEMBERS.map((m) => ({ key: m.key, name: m.name, role: m.role, color: m.color, sprite: m.sprite })))
    .onConflictDoNothing();
  await db
    .insert(schema.places)
    .values(PLACES.map((p) => ({ key: p.key, name: p.name, sprite: p.sprite })))
    .onConflictDoNothing();
  await db
    .insert(schema.categories)
    .values(CATEGORIES.map((c) => ({ key: c.key, name: c.name, kind: c.kind })))
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
