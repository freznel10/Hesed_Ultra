import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { record } from "./audit";
import { type Ctx, InputError } from "./context";
import { Month } from "./schemas";

/**
 * Budgets kept in this app, for when transactions come from a CSV export (which has no
 * budgets). Each plan is "₱X a month for these categories". For every month from its
 * start to now, it becomes a budget_periods row with source "plan", so leftovers and
 * sweeping work exactly as they do for budgets synced from MoneyWiz.
 */

const manilaMonth = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" }).format(d).slice(0, 7);
const shift = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
/** Manila midnight on the 1st, as an ISO instant. */
const monthStart = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1) - 8 * 3600_000).toISOString();
};

/** Does a transaction's category belong to the plan? Exact match or any subcategory. */
export const covers = (planCategories: string[], category: string) =>
  planCategories.some((p) => category === p || category.startsWith(`${p} > `));

export const PlanInput = z.object({
  name: z.string().trim().min(1).max(80),
  monthlyCents: z.number().int().positive().max(1_000_000_000),
  categories: z.array(z.string().trim().min(1)).min(1, "pick at least one category"),
  /** First month to track. Defaults to two months ago. */
  startMonth: Month.optional(),
});
export type PlanInput = z.input<typeof PlanInput>;

export async function createPlan(ctx: Ctx, raw: PlanInput, now = new Date()) {
  const input = PlanInput.parse(raw);
  const startMonth = input.startMonth ?? shift(manilaMonth(now), -2);
  const plan = await ctx.db.transaction(async (tx) => {
    const [row] = await tx.insert(schema.budgetPlans).values({ ...input, categories: [...new Set(input.categories)], startMonth }).returning();
    await record(tx, ctx, "budget_plan", row.id, "create", null, row);
    return row;
  });
  await refreshPlanPeriods(ctx.db, now);
  return plan;
}

export async function updatePlan(ctx: Ctx, id: number, raw: Partial<PlanInput>, now = new Date()) {
  const input = PlanInput.partial().parse(raw);
  const plan = await ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.budgetPlans).where(eq(schema.budgetPlans.id, id));
    if (!before || before.archived) throw new InputError(`No budget with id ${id}`);
    const [after] = await tx
      .update(schema.budgetPlans)
      .set({ ...input, ...(input.categories ? { categories: [...new Set(input.categories)] } : {}) })
      .where(eq(schema.budgetPlans.id, id))
      .returning();
    await record(tx, ctx, "budget_plan", id, "update", before, after);
    return after;
  });
  await refreshPlanPeriods(ctx.db, now);
  return plan;
}

/** Stop a budget. Months already swept from stay, so the savings history is kept. */
export async function removePlan(ctx: Ctx, id: number, now = new Date()) {
  await ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.budgetPlans).where(eq(schema.budgetPlans.id, id));
    if (!before || before.archived) throw new InputError(`No budget with id ${id}`);
    await tx.update(schema.budgetPlans).set({ archived: true }).where(eq(schema.budgetPlans.id, id));
    await record(tx, ctx, "budget_plan", id, "delete", before, null);
  });
  await refreshPlanPeriods(ctx.db, now);
}

export function listPlans(db: Pick<Db, "select">) {
  return db.select().from(schema.budgetPlans).where(eq(schema.budgetPlans.archived, false)).orderBy(asc(schema.budgetPlans.name));
}

/**
 * Expense categories that actually have spending, for the category picker. Built-in
 * starter categories nobody has used are left out, so they cannot be confused with the
 * imported ones (e.g. "Groceries" vs "Food & Dining > Groceries").
 */
export async function knownCategories(db: Db) {
  const rows = await db
    .selectDistinct({ name: schema.categories.name })
    .from(schema.categories)
    .innerJoin(schema.transactions, eq(schema.transactions.categoryId, schema.categories.id))
    .where(eq(schema.transactions.kind, "expense"))
    .orderBy(asc(schema.categories.name));
  return rows.map((r) => r.name);
}

/**
 * Recompute every plan's monthly figures from the transactions. Refunds (money coming
 * back in a covered category) reduce what was used. Months a plan no longer covers are
 * removed unless something was swept from them.
 */
export async function refreshPlanPeriods(db: Db, now = new Date()) {
  const plans = await db.select().from(schema.budgetPlans);
  const thisMonth = manilaMonth(now);
  const totals = await db
    .select({
      month: sql<string>`to_char(${schema.transactions.date}, 'YYYY-MM')`,
      category: schema.categories.name,
      kind: schema.transactions.kind,
      cents: sql<number>`sum(${schema.transactions.amountCents})::int`,
    })
    .from(schema.transactions)
    .innerJoin(schema.categories, eq(schema.transactions.categoryId, schema.categories.id))
    .groupBy(sql`1`, schema.categories.name, schema.transactions.kind);

  await db.transaction(async (tx) => {
    const existing = await tx.select().from(schema.budgetPeriods).where(eq(schema.budgetPeriods.source, "plan"));
    const swept = new Set((await tx.select({ id: schema.sweeps.budgetPeriodId }).from(schema.sweeps)).map((r) => r.id));
    const keep = new Set<number>();

    for (const plan of plans.filter((p) => !p.archived)) {
      for (let m = plan.startMonth; m <= thisMonth; m = shift(m, 1)) {
        const mine = totals.filter((t) => t.month === m && covers(plan.categories, t.category));
        const spent = mine.filter((t) => t.kind === "expense").reduce((n, t) => n + t.cents, 0);
        const refunds = mine.filter((t) => t.kind === "income").reduce((n, t) => n + t.cents, 0);
        const used = Math.max(0, spent - refunds);
        const values = {
          name: plan.name,
          periodStart: monthStart(m),
          periodEnd: monthStart(shift(m, 1)),
          plannedCents: plan.monthlyCents,
          availableCents: plan.monthlyCents,
          usedCents: used,
          remainingCents: plan.monthlyCents - used,
          categories: plan.categories,
          syncedAt: new Date().toISOString(),
        };
        const found = existing.find((e) => e.externalId === `plan:${plan.id}` && e.month === m);
        if (found) {
          keep.add(found.id);
          await tx.update(schema.budgetPeriods).set(values).where(eq(schema.budgetPeriods.id, found.id));
        } else {
          await tx.insert(schema.budgetPeriods).values({ source: "plan", externalId: `plan:${plan.id}`, month: m, ...values });
        }
      }
    }
    const drop = existing.filter((e) => !keep.has(e.id) && !swept.has(e.id) && !plans.some((p) => !p.archived && `plan:${p.id}` === e.externalId && e.month >= p.startMonth && e.month <= thisMonth)).map((e) => e.id);
    if (drop.length) await tx.delete(schema.budgetPeriods).where(and(eq(schema.budgetPeriods.source, "plan"), inArray(schema.budgetPeriods.id, drop)));
  });
}
