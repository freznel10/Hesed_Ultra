import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { record } from "./audit";
import { type Ctx, InputError, lookup } from "./context";
import { ActivityInput, Day } from "./schemas";

export type Activity = typeof schema.activities.$inferSelect & { members: string[]; type: string; place: string | null };

/** Turn keys into ids and fill defaults (place from the activity type, title from its name). */
async function resolve(db: Pick<Db, "select">, raw: ActivityInput) {
  const input = ActivityInput.parse(raw);
  const type = await lookup.activityType(db, input.type);
  const place = input.place ? await lookup.place(db, input.place) : null;
  const members = await Promise.all([...new Set(input.members)].map((k) => lookup.member(db, k)));
  return {
    row: {
      date: input.date,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      typeId: type.id,
      placeId: place?.id ?? type.defaultPlaceId,
      title: input.title || type.name,
      note: input.note,
      mood: input.mood ?? null,
    },
    memberIds: members.map((m) => m.id),
  };
}

async function load(db: Pick<Db, "select">, ids: number[]): Promise<Activity[]> {
  if (!ids.length) return [];
  const rows = await db
    .select({ a: schema.activities, type: schema.activityTypes.key, place: schema.places.key })
    .from(schema.activities)
    .innerJoin(schema.activityTypes, eq(schema.activities.typeId, schema.activityTypes.id))
    .leftJoin(schema.places, eq(schema.activities.placeId, schema.places.id))
    .where(inArray(schema.activities.id, ids))
    .orderBy(asc(schema.activities.date), asc(schema.activities.startTime), asc(schema.activities.id));
  const who = await db
    .select({ activityId: schema.activityMembers.activityId, key: schema.members.key })
    .from(schema.activityMembers)
    .innerJoin(schema.members, eq(schema.activityMembers.memberId, schema.members.id))
    .where(inArray(schema.activityMembers.activityId, ids))
    .orderBy(asc(schema.members.id));
  return rows.map((r) => ({
    ...r.a,
    type: r.type,
    place: r.place,
    members: who.filter((w) => w.activityId === r.a.id).map((w) => w.key),
  }));
}

export async function getActivity(db: Pick<Db, "select">, id: number): Promise<Activity> {
  const [activity] = await load(db, [id]);
  if (!activity) throw new InputError(`No activity with id ${id}`);
  return activity;
}

export async function logActivity(ctx: Ctx, raw: ActivityInput): Promise<Activity> {
  return ctx.db.transaction(async (tx) => {
    const { row, memberIds } = await resolve(tx, raw);
    const [created] = await tx
      .insert(schema.activities)
      .values({ ...row, source: ctx.source, createdBy: ctx.actor })
      .returning({ id: schema.activities.id });
    await tx.insert(schema.activityMembers).values(memberIds.map((memberId) => ({ activityId: created.id, memberId })));
    const after = await getActivity(tx, created.id);
    await record(tx, ctx, "activity", created.id, "create", null, after);
    return after;
  });
}

export async function updateActivity(ctx: Ctx, id: number, raw: ActivityInput): Promise<Activity> {
  return ctx.db.transaction(async (tx) => {
    const before = await getActivity(tx, id);
    const { row, memberIds } = await resolve(tx, raw);
    await tx.update(schema.activities).set(row).where(eq(schema.activities.id, id));
    await tx.delete(schema.activityMembers).where(eq(schema.activityMembers.activityId, id));
    await tx.insert(schema.activityMembers).values(memberIds.map((memberId) => ({ activityId: id, memberId })));
    const after = await getActivity(tx, id);
    await record(tx, ctx, "activity", id, "update", before, after);
    return after;
  });
}

export async function deleteActivity(ctx: Ctx, id: number): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const before = await getActivity(tx, id);
    await tx.delete(schema.activities).where(eq(schema.activities.id, id));
    await record(tx, ctx, "activity", id, "delete", before, null);
  });
}

export async function listActivities(db: Db, date: string): Promise<Activity[]> {
  const ids = await db
    .select({ id: schema.activities.id })
    .from(schema.activities)
    .where(eq(schema.activities.date, Day.parse(date)));
  return load(db, ids.map((r) => r.id));
}
