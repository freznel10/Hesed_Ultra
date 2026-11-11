import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { record } from "./audit";
import { type Ctx, InputError } from "./context";
import { formatPHP } from "./money";
import { Day, Month } from "./schemas";

/**
 * Sweeping: when a month is over, money left in a MoneyWiz budget can be moved, by hand,
 * into a savings goal. Each sweep creates a savings entry, so goal totals include it, and
 * the same leftover can never be swept twice.
 */

type Reader = Pick<Db, "select">;

export type BudgetLine = typeof schema.budgetPeriods.$inferSelect & {
  sweptCents: number;
  /** Leftover not yet swept (0 if overspent or the month is still running). */
  sweepableCents: number;
  ended: boolean;
  status: "ok" | "low" | "over";
  sweeps: { id: number; goalId: number; goal: string; amountCents: number; createdAt: string }[];
};

async function sweepsFor(db: Reader, periodIds: number[]) {
  if (!periodIds.length) return [];
  return db
    .select({ id: schema.sweeps.id, periodId: schema.sweeps.budgetPeriodId, goalId: schema.sweeps.goalId, goal: schema.savingsGoals.name, amountCents: schema.sweeps.amountCents, createdAt: schema.sweeps.createdAt })
    .from(schema.sweeps)
    .innerJoin(schema.savingsGoals, eq(schema.sweeps.goalId, schema.savingsGoals.id))
    .where(sql`${schema.sweeps.budgetPeriodId} in ${periodIds}`)
    .orderBy(asc(schema.sweeps.id));
}

function shape(p: typeof schema.budgetPeriods.$inferSelect, swept: Awaited<ReturnType<typeof sweepsFor>>, now: Date): BudgetLine {
  const mine = swept.filter((s) => s.periodId === p.id);
  const sweptCents = mine.reduce((n, s) => n + s.amountCents, 0);
  const ended = new Date(p.periodEnd) <= now;
  const status = p.remainingCents < 0 ? "over" : p.availableCents > 0 && p.remainingCents < p.availableCents * 0.2 ? "low" : "ok";
  return {
    ...p,
    sweptCents,
    sweepableCents: ended && !p.leftAlone ? Math.max(0, p.remainingCents - sweptCents) : 0,
    ended,
    status,
    sweeps: mine.map(({ periodId: _, ...s }) => s),
  };
}

/** Every MoneyWiz budget for one month, with what has been swept from it. */
export async function budgetMonth(db: Reader, month: string, now = new Date()) {
  const periods = await db.select().from(schema.budgetPeriods).where(eq(schema.budgetPeriods.month, Month.parse(month))).orderBy(asc(schema.budgetPeriods.name));
  const swept = await sweepsFor(db, periods.map((p) => p.id));
  const lines = periods.map((p) => shape(p, swept, now));
  const sum = (f: (l: BudgetLine) => number) => lines.reduce((n, l) => n + f(l), 0);
  return {
    month,
    ended: lines.length > 0 && lines.every((l) => l.ended),
    availableCents: sum((l) => l.availableCents),
    usedCents: sum((l) => l.usedCents),
    /** Positive leftovers only; overspending in one budget does not cancel savings in another. */
    leftoverCents: sum((l) => Math.max(0, l.remainingCents)),
    overCents: sum((l) => Math.max(0, -l.remainingCents)),
    sweptCents: sum((l) => l.sweptCents),
    sweepableCents: sum((l) => l.sweepableCents),
    budgets: lines,
  };
}

/** Leftovers from finished months that have not been swept or left alone yet, newest first. */
export async function pendingLeftovers(db: Reader, now = new Date()) {
  const periods = await db
    .select()
    .from(schema.budgetPeriods)
    .where(and(lte(schema.budgetPeriods.periodEnd, now.toISOString()), eq(schema.budgetPeriods.leftAlone, false), sql`${schema.budgetPeriods.remainingCents} > 0`))
    .orderBy(desc(schema.budgetPeriods.month), asc(schema.budgetPeriods.name));
  const swept = await sweepsFor(db, periods.map((p) => p.id));
  const lines = periods.map((p) => shape(p, swept, now)).filter((l) => l.sweepableCents > 0);
  return { totalCents: lines.reduce((n, l) => n + l.sweepableCents, 0), budgets: lines };
}

export const SweepInput = z.object({
  budgetPeriodId: z.number().int().positive(),
  goalId: z.number().int().positive(),
  /** Omit to sweep everything that is left. */
  amountCents: z.number().int().positive().max(1_000_000_000).optional(),
  note: z.string().trim().max(500).default(""),
});
export type SweepInput = z.input<typeof SweepInput>;

export async function sweep(ctx: Ctx, raw: SweepInput, now = new Date()) {
  const input = SweepInput.parse(raw);
  return ctx.db.transaction(async (tx) => {
    // lock the budget row so two sweeps at once cannot both take the same leftover
    const [period] = await tx.select().from(schema.budgetPeriods).where(eq(schema.budgetPeriods.id, input.budgetPeriodId)).for("update");
    if (!period) throw new InputError(`No budget with id ${input.budgetPeriodId}`);
    const line = shape(period, await sweepsFor(tx, [period.id]), now);
    if (!line.ended) throw new InputError(`${period.name} for ${period.month} is still running; sweep it after the month ends`);
    if (period.leftAlone) throw new InputError(`${period.name} for ${period.month} was marked "leave it"; undo that first`);
    if (line.sweepableCents <= 0) throw new InputError(`Nothing left to sweep from ${period.name} for ${period.month}`);
    const amount = input.amountCents ?? line.sweepableCents;
    if (amount > line.sweepableCents) {
      throw new InputError(`Only ${formatPHP(line.sweepableCents)} is left to sweep from ${period.name} for ${period.month}`);
    }
    const [goal] = await tx.select().from(schema.savingsGoals).where(eq(schema.savingsGoals.id, input.goalId));
    if (!goal) throw new InputError(`No savings goal with id ${input.goalId}`);
    if (goal.archived) throw new InputError(`"${goal.name}" is archived`);

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
    const [entry] = await tx
      .insert(schema.savingsEntries)
      .values({ goalId: goal.id, date: today, amountCents: amount, note: `Swept from ${period.name} (${period.month})${input.note ? ` · ${input.note}` : ""}`, source: ctx.source, createdBy: ctx.actor })
      .returning();
    const [row] = await tx
      .insert(schema.sweeps)
      .values({ budgetPeriodId: period.id, goalId: goal.id, savingsEntryId: entry.id, amountCents: amount, note: input.note, source: ctx.source, createdBy: ctx.actor })
      .returning();
    await record(tx, ctx, "sweep", row.id, "create", null, { ...row, budget: period.name, month: period.month, goal: goal.name });
    return { ...row, budget: period.name, month: period.month, goal: goal.name, leftCents: line.sweepableCents - amount };
  });
}

/** Undo a sweep: the money goes back to "left over" and leaves the goal. */
export async function undoSweep(ctx: Ctx, sweepId: number) {
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.sweeps).where(eq(schema.sweeps.id, sweepId));
    if (!row) throw new InputError(`No sweep with id ${sweepId}`);
    const [{ saved }] = await tx
      .select({ saved: sql<number>`coalesce(sum(${schema.savingsEntries.amountCents}), 0)::int` })
      .from(schema.savingsEntries)
      .where(eq(schema.savingsEntries.goalId, row.goalId));
    if (saved - row.amountCents < 0) {
      throw new InputError(`The goal only has ${formatPHP(saved)} now, so this ${formatPHP(row.amountCents)} sweep cannot be taken back`);
    }
    await tx.delete(schema.sweeps).where(eq(schema.sweeps.id, sweepId));
    await tx.delete(schema.savingsEntries).where(eq(schema.savingsEntries.id, row.savingsEntryId));
    await record(tx, ctx, "sweep", sweepId, "delete", row, null);
  });
}

/** Mark a leftover as "leave it in the account" (or undo that), so it stops showing as sweepable. */
export async function leaveAlone(ctx: Ctx, budgetPeriodId: number, value: boolean) {
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.budgetPeriods).where(eq(schema.budgetPeriods.id, budgetPeriodId));
    if (!before) throw new InputError(`No budget with id ${budgetPeriodId}`);
    const [after] = await tx.update(schema.budgetPeriods).set({ leftAlone: value }).where(eq(schema.budgetPeriods.id, budgetPeriodId)).returning();
    await record(tx, ctx, "budget_period", budgetPeriodId, "update", { leftAlone: before.leftAlone }, { leftAlone: value });
    return after;
  });
}

/** Total swept per month (by the month the money was left over in), oldest first. */
export async function sweepHistory(db: Reader) {
  return db
    .select({ month: schema.budgetPeriods.month, sweptCents: sql<number>`sum(${schema.sweeps.amountCents})::int` })
    .from(schema.sweeps)
    .innerJoin(schema.budgetPeriods, eq(schema.sweeps.budgetPeriodId, schema.budgetPeriods.id))
    .groupBy(schema.budgetPeriods.month)
    .orderBy(asc(schema.budgetPeriods.month));
}

// ---------------------------------------------------------------- savings plan

export type Pace = {
  /** Whole months from now until the target date (at least 1), or null with no date. */
  monthsLeft: number | null;
  /** What has to go in each month from now on to reach the target on time. */
  neededPerMonthCents: number | null;
  /** If the planned monthly amount keeps going in, when the goal is reached (YYYY-MM). */
  projectedMonth: string | null;
  status: "done" | "on_track" | "behind" | "no_plan";
};

const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const fromIndex = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;

export function pace(goal: { targetCents: number; targetDate: string | null; monthlyCents: number | null }, savedCents: number, today: string): Pace {
  const remaining = goal.targetCents - savedCents;
  if (remaining <= 0) return { monthsLeft: 0, neededPerMonthCents: 0, projectedMonth: today.slice(0, 7), status: "done" };
  // count the current month as one to save in, through the target month
  const monthsLeft = goal.targetDate ? Math.max(1, monthIndex(goal.targetDate) - monthIndex(today) + 1) : null;
  const neededPerMonthCents = monthsLeft ? Math.ceil(remaining / monthsLeft) : null;
  const projectedMonth = goal.monthlyCents ? fromIndex(monthIndex(today) + Math.ceil(remaining / goal.monthlyCents) - 1) : null;
  let status: Pace["status"] = "no_plan";
  if (goal.monthlyCents && neededPerMonthCents !== null) status = goal.monthlyCents >= neededPerMonthCents ? "on_track" : "behind";
  else if (goal.monthlyCents) status = "on_track";
  return { monthsLeft, neededPerMonthCents, projectedMonth, status };
}

export const GoalUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  targetCents: z.number().int().positive().max(1_000_000_000).optional(),
  targetDate: Day.nullable().optional(),
  monthlyCents: z.number().int().positive().max(1_000_000_000).nullable().optional(),
  archived: z.boolean().optional(),
});
export type GoalUpdate = z.input<typeof GoalUpdate>;

export async function updateGoal(ctx: Ctx, id: number, raw: GoalUpdate) {
  const input = GoalUpdate.parse(raw);
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.savingsGoals).where(eq(schema.savingsGoals.id, id));
    if (!before) throw new InputError(`No savings goal with id ${id}`);
    const [after] = await tx.update(schema.savingsGoals).set(input).where(eq(schema.savingsGoals.id, id)).returning();
    await record(tx, ctx, "savings_goal", id, "update", before, after);
    return after;
  });
}
