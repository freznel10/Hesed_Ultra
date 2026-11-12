import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { record } from "./audit";
import { type Ctx, InputError } from "./context";

/**
 * Turning MoneyWiz MCP output into Hesed Ultra rows.
 *
 * Claude on the Mac reads MoneyWiz (budgets via read_financial_data, transactions via
 * list_transactions / inspect_result) and passes the records here unchanged. The parsing
 * is deliberately forgiving about extra fields and strict about the ones it uses.
 * See docs/moneywiz-sync.md and the "sync_moneywiz" MCP prompt.
 */

type Money = { amount?: string | number | null; currency?: string | null } | null | undefined;

/** "5162.3" → 516230 centavos, without floating-point rounding. Missing → null. */
export function moneyToCents(m: Money): number | null {
  if (!m || m.amount === null || m.amount === undefined || m.amount === "") return null;
  if (m.currency && m.currency !== "PHP") throw new InputError(`Only PHP amounts are supported (got ${m.currency})`);
  const s = String(m.amount).trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!match) throw new InputError(`Not an amount: "${s}"`);
  const [, minus, whole, frac = ""] = match;
  const third = Number(frac[2] ?? "0");
  let cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2)) + (third >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(cents)) throw new InputError(`Amount too large: "${s}"`);
  if (minus) cents = -cents;
  return cents;
}

/** A UTC instant → the calendar date in Manila (YYYY-MM-DD). */
export function manilaDate(instant: string, timeZone = "Asia/Manila"): string {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) throw new InputError(`Not a date: "${instant}"`);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// ---------------------------------------------------------------- budgets

export type MoneyWizBudget = {
  id: string;
  kind?: string;
  name: string;
  text?: { budgetType?: string; timeZone?: string };
  dates: { periodStart: string; periodEndExclusive: string };
  money: Record<string, Money>;
  flags?: { carryover?: boolean };
  referenceDetails?: { categories?: { id: string; name: string }[] };
};

export type ParsedBudget = {
  externalId: string;
  name: string;
  month: string;
  periodStart: string;
  periodEnd: string;
  plannedCents: number;
  availableCents: number;
  usedCents: number;
  remainingCents: number;
  carryover: boolean;
  categories: string[];
};

/**
 * Prefer the figures MoneyWiz's own Budgets screen shows; fall back to the plain ones.
 * The id is "<budget>:<periodIndex>"; the budget part identifies the budget across months.
 */
export function parseBudget(r: MoneyWizBudget): ParsedBudget | null {
  if (r.kind && r.kind !== "budget") return null;
  if (r.text?.budgetType && r.text.budgetType !== "expense") return null;
  if (!r.id || !r.name || !r.dates?.periodStart || !r.dates?.periodEndExclusive) {
    throw new InputError(`Budget record is missing id, name or dates: ${JSON.stringify(r).slice(0, 120)}`);
  }
  const pick = (screen: string, plain: string) => moneyToCents(r.money?.[screen]) ?? moneyToCents(r.money?.[plain]);
  const planned = moneyToCents(r.money?.planned);
  const available = pick("budgetsScreenAvailable", "available") ?? planned;
  const used = pick("budgetsScreenUsed", "used");
  if (available === null || used === null) throw new InputError(`Budget "${r.name}" has no available/used amounts`);
  const remaining = pick("budgetsScreenRemaining", "remaining") ?? available - used;
  return {
    externalId: r.id.split(":")[0],
    name: r.name.trim(),
    month: manilaDate(r.dates.periodStart, r.text?.timeZone).slice(0, 7),
    periodStart: new Date(r.dates.periodStart).toISOString(),
    periodEnd: new Date(r.dates.periodEndExclusive).toISOString(),
    plannedCents: planned ?? available,
    availableCents: available,
    usedCents: used,
    remainingCents: remaining,
    carryover: Boolean(r.flags?.carryover),
    categories: (r.referenceDetails?.categories ?? []).map((c) => c.name),
  };
}

export async function importBudgets(ctx: Ctx, records: MoneyWizBudget[]) {
  const parsed = records.map(parseBudget).filter((b): b is ParsedBudget => b !== null);
  let created = 0;
  let updated = 0;
  await ctx.db.transaction(async (tx) => {
    for (const b of parsed) {
      const where = and(eq(schema.budgetPeriods.source, "moneywiz"), eq(schema.budgetPeriods.externalId, b.externalId), eq(schema.budgetPeriods.month, b.month));
      const [before] = await tx.select().from(schema.budgetPeriods).where(where);
      const values = { ...b, syncedAt: new Date().toISOString() };
      if (before) {
        await tx.update(schema.budgetPeriods).set(values).where(eq(schema.budgetPeriods.id, before.id));
        updated++;
      } else {
        await tx.insert(schema.budgetPeriods).values({ source: "moneywiz", ...values });
        created++;
      }
    }
    if (parsed.length) await record(tx, ctx, "import", 0, "create", null, { kind: "moneywiz_budgets", created, updated });
  });
  const months = [...new Set(parsed.map((b) => b.month))].sort();
  return { budgets: parsed.length, created, updated, skipped: records.length - parsed.length, months };
}

// ---------------------------------------------------------------- transactions

export type MoneyWizRow = {
  transactionID: string;
  date: string;
  kind: string;
  isVoided?: boolean;
  payeeID?: string | null;
  memo?: string | null;
  booked?: Money;
  attributed?: Money;
  allocations?: { amount: string | number; categoryID?: string | null }[];
};
export type MoneyWizNames = { category?: Record<string, string>; payee?: Record<string, string>; account?: Record<string, string> };

const slug = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^\w\s>-]/g, "").replace(/\s*>\s*/g, "__").replace(/[\s-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "x";

/** Category key for a MoneyWiz category path, e.g. "Food & Dining > Groceries" → "mw:food_dining__groceries". */
export const categoryKey = (path: string) => `mw:${slug(path)}`;

export type ParsedTransaction = {
  externalId: string;
  date: string;
  kind: "expense" | "income";
  amountCents: number;
  categoryPath: string;
  payee: string;
  note: string;
};

/** One row per category split. Transfers, voided and zero rows are skipped. */
export function parseTransaction(row: MoneyWizRow, names: MoneyWizNames = {}): ParsedTransaction[] {
  if (row.isVoided) return [];
  if (row.kind !== "expense" && row.kind !== "income") return [];
  if (!row.transactionID || !row.date) throw new InputError("Transaction row is missing transactionID or date");
  const date = manilaDate(row.date);
  const payee = (row.payeeID && names.payee?.[row.payeeID]) || "";
  const note = (row.memo ?? "").trim().slice(0, 2000);
  const splits = row.allocations?.length ? row.allocations : [{ amount: moneyToCents(row.booked ?? row.attributed)! / 100, categoryID: null }];
  return splits
    .map((a, i) => {
      const cents = Math.abs(moneyToCents({ amount: String(a.amount) }) ?? 0);
      const path = (a.categoryID && names.category?.[a.categoryID]) || "Uncategorized";
      return {
        externalId: `moneywiz:${row.transactionID}${splits.length > 1 ? `#${i}` : ""}`,
        date,
        kind: row.kind as "expense" | "income",
        amountCents: cents,
        categoryPath: path,
        payee,
        note,
      };
    })
    .filter((t) => t.amountCents > 0);
}

export async function importTransactions(ctx: Ctx, rows: MoneyWizRow[], names: MoneyWizNames = {}) {
  const parsed = rows.flatMap((r) => parseTransaction(r, names));
  const result = await saveTransactions(ctx, parsed, "moneywiz_transactions");
  return { rows: rows.length, imported: parsed.length, ...result, skipped: rows.length - new Set(parsed.map((p) => p.externalId.split("#")[0])).size };
}

/**
 * Save parsed transactions: create new ones, update changed ones (matched by externalId),
 * and create any missing categories. Shared by the MoneyWiz MCP import and CSV upload.
 */
export async function saveTransactions(ctx: Ctx, parsed: ParsedTransaction[], kindLabel: string) {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  await ctx.db.transaction(async (tx) => {
    // make sure every category exists
    const paths = new Map(parsed.map((t) => [categoryKey(t.categoryPath) + t.kind, t]));
    for (const t of paths.values()) {
      const key = t.kind === "income" ? `${categoryKey(t.categoryPath)}:in` : categoryKey(t.categoryPath);
      await tx.insert(schema.categories).values({ key, name: t.categoryPath.slice(0, 120), kind: t.kind }).onConflictDoNothing();
    }
    const cats = await tx.select().from(schema.categories);
    const catId = (t: ParsedTransaction) => cats.find((c) => c.key === (t.kind === "income" ? `${categoryKey(t.categoryPath)}:in` : categoryKey(t.categoryPath)))!.id;

    const ids = parsed.map((t) => t.externalId);
    const existing: (typeof schema.transactions.$inferSelect)[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      existing.push(...(await tx.select().from(schema.transactions).where(inArray(schema.transactions.externalId, ids.slice(i, i + 500)))));
    }
    for (const t of parsed) {
      const values = { date: t.date, kind: t.kind, amountCents: t.amountCents, categoryId: catId(t), payee: t.payee.slice(0, 120), note: t.note };
      const before = existing.find((e) => e.externalId === t.externalId);
      if (!before) {
        await tx.insert(schema.transactions).values({ ...values, externalId: t.externalId, source: "import", createdBy: ctx.actor });
        created++;
      } else if (before.date !== values.date || before.amountCents !== values.amountCents || before.categoryId !== values.categoryId || before.payee !== values.payee || before.note !== values.note || before.kind !== values.kind) {
        await tx.update(schema.transactions).set(values).where(eq(schema.transactions.id, before.id));
        updated++;
      } else unchanged++;
    }
    if (parsed.length) await record(tx, ctx, "import", 0, "create", null, { kind: kindLabel, created, updated, unchanged });
  });
  return { created, updated, unchanged };
}

/** When MoneyWiz was last synced, for the status line. */
export async function lastSync(db: Db) {
  const [b] = await db.select({ at: sql<string | null>`max(${schema.budgetPeriods.syncedAt})` }).from(schema.budgetPeriods);
  return b?.at ?? null;
}
