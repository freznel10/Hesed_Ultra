import { boolean, integer, pgTable, serial, text } from "drizzle-orm/pg-core";

// Mirrors db/migrations.ts. Keep the two in step when adding tables.

export const members = pgTable("members", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  role: text("role", { enum: ["parent", "child"] }).notNull(),
  color: text("color").notNull(),
  sprite: text("sprite"),
  active: boolean("active").notNull().default(true),
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
