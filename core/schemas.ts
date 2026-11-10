import { z } from "zod";

/**
 * Input shapes for everything that can be written. The app, the API and (later)
 * the MCP tools all validate with these, so the rules are the same everywhere.
 * People, places, activity types and categories are referred to by their key
 * ("ellie", "church", "piano", "groceries"), which is friendlier than ids.
 */

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  // round-trip so impossible dates like 2026-02-31 are rejected, not rolled into March
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "not a real date");
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM (24-hour)");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "use YYYY-MM");
const key = z.string().min(1);
/** Centavos. Capped at ₱10,000,000 to catch typos and unit mix-ups. */
const centavos = z.number().int().positive().max(1_000_000_000);

export const ActivityInput = z
  .object({
    date: day,
    type: key,
    members: z.array(key).min(1, "say who took part"),
    place: key.optional(),
    startTime: clock.optional(),
    endTime: clock.optional(),
    title: z.string().trim().max(120).optional(),
    note: z.string().trim().max(2000).default(""),
    mood: z.number().int().min(1).max(5).optional(),
  })
  .refine((a) => !a.startTime || !a.endTime || a.endTime > a.startTime, {
    message: "end time must be after start time",
    path: ["endTime"],
  });
export type ActivityInput = z.input<typeof ActivityInput>;

export const TransactionInput = z.object({
  date: day,
  kind: z.enum(["expense", "income"]).default("expense"),
  amountCents: centavos,
  category: key,
  member: key.optional(),
  payee: z.string().trim().max(120).default(""),
  note: z.string().trim().max(2000).default(""),
  activityId: z.number().int().positive().optional(),
});
export type TransactionInput = z.input<typeof TransactionInput>;

export const BudgetInput = z.object({
  month,
  category: key,
  limitCents: z.number().int().min(0).max(1_000_000_000),
});
export type BudgetInput = z.input<typeof BudgetInput>;

export const GoalInput = z.object({
  name: z.string().trim().min(1).max(80),
  targetCents: centavos,
  targetDate: day.optional(),
});
export type GoalInput = z.input<typeof GoalInput>;

export const SavingsEntryInput = z.object({
  goalId: z.number().int().positive(),
  date: day,
  /** Positive = deposit, negative = withdrawal. */
  amountCents: z.number().int().min(-1_000_000_000).max(1_000_000_000).refine((n) => n !== 0, "amount cannot be zero"),
  note: z.string().trim().max(2000).default(""),
});
export type SavingsEntryInput = z.input<typeof SavingsEntryInput>;

export const Month = month;
export const Day = day;
