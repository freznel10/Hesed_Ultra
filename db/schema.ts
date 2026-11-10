import { boolean, date, integer, jsonb, pgTable, primaryKey, serial, text, time, timestamp } from "drizzle-orm/pg-core";

// Mirrors db/migrations.ts. Keep the two in step when adding tables.

export const members = pgTable("members", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  role: text("role", { enum: ["parent", "child"] }).notNull(),
  color: text("color").notNull(),
  sprite: text("sprite"),
  active: boolean("active").notNull().default(true),
  pinHash: text("pin_hash"),
  pinFails: integer("pin_fails").notNull().default(0),
  pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true, mode: "date" }),
});

export const places = pgTable("places", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  sprite: text("sprite"),
});

export const activityTypes = pgTable("activity_types", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  defaultPlaceId: integer("default_place_id").references(() => places.id),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["expense", "income"] }).notNull(),
});

export const activities = pgTable("activities", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  startTime: time("start_time"),
  endTime: time("end_time"),
  typeId: integer("type_id").notNull().references(() => activityTypes.id),
  placeId: integer("place_id").references(() => places.id),
  title: text("title").notNull(),
  note: text("note").notNull().default(""),
  mood: integer("mood"),
  source: text("source").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const activityMembers = pgTable(
  "activity_members",
  {
    activityId: integer("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
    memberId: integer("member_id").notNull().references(() => members.id),
  },
  (t) => [primaryKey({ columns: [t.activityId, t.memberId] })],
);

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  kind: text("kind", { enum: ["expense", "income"] }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  categoryId: integer("category_id").notNull().references(() => categories.id),
  memberId: integer("member_id").references(() => members.id),
  payee: text("payee").notNull().default(""),
  note: text("note").notNull().default(""),
  activityId: integer("activity_id").references(() => activities.id, { onDelete: "set null" }),
  source: text("source").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const budgets = pgTable("budgets", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(),
  categoryId: integer("category_id").notNull().references(() => categories.id),
  limitCents: integer("limit_cents").notNull(),
});

export const savingsGoals = pgTable("savings_goals", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  targetCents: integer("target_cents").notNull(),
  targetDate: date("target_date", { mode: "string" }),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const savingsEntries = pgTable("savings_entries", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull().references(() => savingsGoals.id),
  date: date("date", { mode: "string" }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  note: text("note").notNull().default(""),
  source: text("source").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  actor: text("actor").notNull(),
  source: text("source").notNull(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id").notNull(),
  action: text("action", { enum: ["create", "update", "delete"] }).notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
});

export const apiTokens = pgTable("api_tokens", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  tokenHash: text("token_hash").notNull().unique(),
  memberId: integer("member_id").notNull().references(() => members.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
  revoked: boolean("revoked").notNull().default(false),
});
