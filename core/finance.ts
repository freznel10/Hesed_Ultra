import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { record } from "./audit";
import { type Ctx, InputError, lookup } from "./context";
import { formatPHP } from "./money";
import { BudgetInput, Day, GoalInput, Month, SavingsEntryInput, TransactionInput } from "./schemas";

type Reader = Pick<Db, "select">;
export type Transaction = typeof schema.transactions.$inferSelect & { category: string; member: string | null };

// ---------------------------------------------------------------- transactions

async function resolveTransaction(db: Reader, raw: TransactionInput) {
  const input = TransactionInput.parse(raw);
  const category = await lookup.category(db, input.category);
  if (category.kind !== input.kind) {
    throw new InputError(`"${category.name}" is an ${category.kind} category, not ${input.kind}`);
  }
  const member = input.member ? await lookup.member(db, input.member) : null;
  if (input.activityId) {
    const [a] = await db.select({ id: schema.activities.id }).from(schema.activities).where(eq(schema.activities.id, input.activityId));
    if (!a) throw new InputError(`No activity with id ${input.activityId}`);
  }
  return {
    date: input.date,
    kind: input.kind,
    amountCents: input.amountCents,
    categoryId: category.id,
    memberId: member?.id ?? null,
    payee: input.payee,
    note: input.note,
    activityId: input.activityId ?? null,
  };
}

function selectTransactions(db: Reader) {
  return db
    .select({ t: schema.transactions, category: schema.categories.key, member: schema.members.key })
    .from(schema.transactions)
    .innerJoin(schema.categories, eq(schema.transactions.categoryId, schema.categories.id))
    .leftJoin(schema.members, eq(schema.transactions.memberId, schema.members.id));
}

const shape = (r: { t: typeof schema.transactions.$inferSelect; category: string; member: string | null }): Transaction => ({
  ...r.t,
  category: r.category,
  member: r.member,
});

export async function getTransaction(db: Reader, id: number): Promise<Transaction> {
  const [row] = await selectTransactions(db).where(eq(schema.transactions.id, id));
  if (!row) throw new InputError(`No transaction with id ${id}`);
  return shape(row);
}

export async function logTransaction(ctx: Ctx, raw: TransactionInput): Promise<Transaction> {
  return ctx.db.transaction(async (tx) => {
    const row = await resolveTransaction(tx, raw);
    const [created] = await tx
      .insert(schema.transactions)
      .values({ ...row, source: ctx.source, createdBy: ctx.actor })
      .returning({ id: schema.transactions.id });
    const after = await getTransaction(tx, created.id);
    await record(tx, ctx, "transaction", created.id, "create", null, after);
    return after;
  });
}

export async function updateTransaction(ctx: Ctx, id: number, raw: TransactionInput): Promise<Transaction> {
  return ctx.db.transaction(async (tx) => {
    const before = await getTransaction(tx, id);
    await tx.update(schema.transactions).set(await resolveTransaction(tx, raw)).where(eq(schema.transactions.id, id));
    const after = await getTransaction(tx, id);
    await record(tx, ctx, "transaction", id, "update", before, after);
    return after;
  });
}

export async function deleteTransaction(ctx: Ctx, id: number): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const before = await getTransaction(tx, id);
    await tx.delete(schema.transactions).where(eq(schema.transactions.id, id));
    await record(tx, ctx, "transaction", id, "delete", before, null);
  });
}

export async function listTransactions(db: Db, date: string): Promise<Transaction[]> {
  const rows = await selectTransactions(db)
    .where(eq(schema.transactions.date, Day.parse(date)))
    .orderBy(asc(schema.transactions.id));
  return rows.map(shape);
}

export async function listMonthTransactions(db: Db, month: string): Promise<Transaction[]> {
  const { from, to } = monthRange(month);
  const rows = await selectTransactions(db)
    .where(and(gte(schema.transactions.date, from), lt(schema.transactions.date, to)))
    .orderBy(asc(schema.transactions.date), asc(schema.transactions.id));
  return rows.map(shape);
}

// ---------------------------------------------------------------- budgets

/** Set (or change) the limit for one category in one month. A limit of 0 removes the budget. */
export async function setBudget(ctx: Ctx, raw: BudgetInput) {
  const input = BudgetInput.parse(raw);
  return ctx.db.transaction(async (tx) => {
    const category = await lookup.category(tx, input.category);
    if (category.kind !== "expense") throw new InputError("Budgets are for expense categories");
    const where = and(eq(schema.budgets.month, input.month), eq(schema.budgets.categoryId, category.id));
    const [before] = await tx.select().from(schema.budgets).where(where);
    if (input.limitCents === 0) {
      if (before) {
        await tx.delete(schema.budgets).where(eq(schema.budgets.id, before.id));
        await record(tx, ctx, "budget", before.id, "delete", before, null);
      }
      return null;
    }
    const [after] = before
      ? await tx.update(schema.budgets).set({ limitCents: input.limitCents }).where(eq(schema.budgets.id, before.id)).returning()
      : await tx.insert(schema.budgets).values({ month: input.month, categoryId: category.id, limitCents: input.limitCents }).returning();
    await record(tx, ctx, "budget", after.id, before ? "update" : "create", before, after);
    return after;
  });
}

export function monthRange(month: string) {
  const [y, m] = Month.parse(month).split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

export type MonthSummary = {
  month: string;
  incomeCents: number;
  spentCents: number;
  /** Income minus spending. */
  netCents: number;
  categories: {
    category: string;
    name: string;
    spentCents: number;
    /** null when no budget is set for this category this month. */
    limitCents: number | null;
    remainingCents: number | null;
    status: "none" | "ok" | "warning" | "over";
  }[];
};

/** Spending per category against its budget. "warning" starts at 80% of the limit. */
export async function getMonthSummary(db: Db, month: string): Promise<MonthSummary> {
  const { from, to } = monthRange(month);
  const inMonth = and(gte(schema.transactions.date, from), lt(schema.transactions.date, to));
  const totals = await db
    .select({
      categoryId: schema.transactions.categoryId,
      kind: schema.transactions.kind,
      total: sql<number>`sum(${schema.transactions.amountCents})::int`,
    })
    .from(schema.transactions)
    .where(inMonth)
    .groupBy(schema.transactions.categoryId, schema.transactions.kind);
  const limits = await db.select().from(schema.budgets).where(eq(schema.budgets.month, month));
  const cats = await db.select().from(schema.categories).orderBy(asc(schema.categories.id));

  const categories = cats
    .filter((c) => c.kind === "expense")
    .map((c) => {
      const spentCents = totals.find((t) => t.categoryId === c.id && t.kind === "expense")?.total ?? 0;
      const limitCents = limits.find((l) => l.categoryId === c.id)?.limitCents ?? null;
      const status: MonthSummary["categories"][number]["status"] =
        limitCents === null ? "none" : spentCents > limitCents ? "over" : spentCents >= limitCents * 0.8 ? "warning" : "ok";
      return {
        category: c.key,
        name: c.name,
        spentCents,
        limitCents,
        remainingCents: limitCents === null ? null : limitCents - spentCents,
        status,
      };
    })
    .filter((c) => c.spentCents > 0 || c.limitCents !== null);

  const sum = (kind: string) => totals.filter((t) => t.kind === kind).reduce((n, t) => n + t.total, 0);
  const incomeCents = sum("income");
  const spentCents = sum("expense");
  return { month, incomeCents, spentCents, netCents: incomeCents - spentCents, categories };
}

// ---------------------------------------------------------------- savings

export type Goal = typeof schema.savingsGoals.$inferSelect & {
  savedCents: number;
  remainingCents: number;
  /** 0–100, capped at 100. */
  percent: number;
};

export async function createGoal(ctx: Ctx, raw: GoalInput) {
  const input = GoalInput.parse(raw);
  return ctx.db.transaction(async (tx) => {
    const [goal] = await tx
      .insert(schema.savingsGoals)
      .values({ name: input.name, targetCents: input.targetCents, targetDate: input.targetDate ?? null })
      .returning();
    await record(tx, ctx, "savings_goal", goal.id, "create", null, goal);
    return goal;
  });
}

async function savedFor(db: Reader, goalId: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.savingsEntries.amountCents}), 0)::int` })
    .from(schema.savingsEntries)
    .where(eq(schema.savingsEntries.goalId, goalId));
  return row.total;
}

/** Deposit (positive) or withdraw (negative). A withdrawal cannot take a goal below zero. */
export async function addSavingsEntry(ctx: Ctx, raw: SavingsEntryInput) {
  const input = SavingsEntryInput.parse(raw);
  return ctx.db.transaction(async (tx) => {
    const [goal] = await tx.select().from(schema.savingsGoals).where(eq(schema.savingsGoals.id, input.goalId));
    if (!goal) throw new InputError(`No savings goal with id ${input.goalId}`);
    if (goal.archived) throw new InputError(`"${goal.name}" is archived`);
    const saved = await savedFor(tx, goal.id);
    if (saved + input.amountCents < 0) {
      throw new InputError(`"${goal.name}" only has ${formatPHP(saved)} saved, so ${formatPHP(-input.amountCents)} cannot be taken out`);
    }
    const [entry] = await tx
      .insert(schema.savingsEntries)
      .values({ ...input, source: ctx.source, createdBy: ctx.actor })
      .returning();
    await record(tx, ctx, "savings_entry", entry.id, "create", null, entry);
    return entry;
  });
}

export async function listGoals(db: Db): Promise<Goal[]> {
  const goals = await db.select().from(schema.savingsGoals).where(eq(schema.savingsGoals.archived, false)).orderBy(asc(schema.savingsGoals.id));
  return Promise.all(
    goals.map(async (g) => {
      const savedCents = await savedFor(db, g.id);
      return {
        ...g,
        savedCents,
        remainingCents: Math.max(0, g.targetCents - savedCents),
        percent: Math.min(100, Math.floor((savedCents / g.targetCents) * 100)),
      };
    }),
  );
}
