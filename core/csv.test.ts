import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../db/client";
import { service } from "./service";
import { guessDateOrder, normaliseCategory, parseAmount, parseDate, readCsv, splitCsv } from "./csv";
import { covers, refreshPlanPeriods } from "./plans";
import { budgetMonth, pendingLeftovers } from "./sweeps";

const SAMPLE = readFileSync(new URL("../db/fixtures/moneywiz-sample.csv", import.meta.url), "utf8");
const NOV_12 = new Date("2026-11-12T03:00:00Z");

describe("CSV pieces", () => {
  it("splits quoted fields, escaped quotes and newlines", () => {
    expect(splitCsv('a,"b, c","say ""hi""","two\nlines"\n1,2,3,4', ",")).toEqual([["a", "b, c", 'say "hi"', "two\nlines"], ["1", "2", "3", "4"]]);
  });
  it("reads amounts in common styles", () => {
    expect(parseAmount("-8,450.25")).toBe(-845025);
    expect(parseAmount("95,000.00")).toBe(9500000);
    expect(parseAmount("(1,234.50)")).toBe(-123450);
    expect(parseAmount("₱1,250")).toBe(125000);
    expect(parseAmount("PHP 99.9")).toBe(9990);
    expect(parseAmount("1.234,56")).toBe(123456);
    expect(parseAmount("−3,080.00")).toBe(-308000);
    expect(parseAmount("12,5")).toBe(1250);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
  it("reads dates in each order and rejects impossible ones", () => {
    expect(parseDate("10/03/2026", "MDY")).toBe("2026-10-03");
    expect(parseDate("10/03/2026", "DMY")).toBe("2026-03-10");
    expect(parseDate("2026-10-03", "MDY")).toBe("2026-10-03");
    expect(parseDate("Oct 3, 2026", "DMY")).toBe("2026-10-03");
    expect(parseDate("3 Oct 2026", "MDY")).toBe("2026-10-03");
    expect(parseDate("02/30/2026", "MDY")).toBeNull();
    expect(parseDate("10/03/26", "MDY")).toBe("2026-10-03");
  });
  it("guesses day/month order from the data", () => {
    expect(guessDateOrder(["10/03/2026", "10/28/2026"])).toEqual({ order: "MDY", sure: true });
    expect(guessDateOrder(["28/10/2026"])).toEqual({ order: "DMY", sure: true });
    expect(guessDateOrder(["01/02/2026"])).toEqual({ order: "MDY", sure: false });
  });
  it("normalises category paths", () => {
    expect(normaliseCategory("Food & Dining ► Groceries")).toBe("Food & Dining > Groceries");
    expect(normaliseCategory("Food:Groceries")).toBe("Food > Groceries");
    expect(normaliseCategory("")).toBe("Uncategorized");
  });
});

describe("reading a MoneyWiz-style export", () => {
  it("finds the columns, skips account rows, transfers and other currencies", () => {
    const r = readCsv(SAMPLE);
    expect(r.delimiter).toBe(",");
    expect(r.dateOrder).toBe("MDY");
    expect(r.dateOrderSure).toBe(true);
    expect(r.transactions).toHaveLength(9);
    expect(r.skipped).toMatchObject({ noDateOrAmount: 2, transfers: 2, otherCurrency: 1 });
    expect(r.from).toBe("2026-10-01");
    expect(r.to).toBe("2026-11-05");
    expect(r.transactions[0]).toMatchObject({ kind: "income", amountCents: 9500000, categoryPath: "Income > Salary", payee: "Employer", note: "October salary" });
    expect(r.categories).toContain("Food & Dining > Groceries");
    // two identical 7-Eleven snacks stay two transactions
    const snacks = r.transactions.filter((t) => t.payee === "7-Eleven");
    expect(snacks).toHaveLength(2);
    expect(new Set(snacks.map((s) => s.externalId)).size).toBe(2);
  });
  it("handles semicolons, decimal commas and separate debit/credit columns", () => {
    const r = readCsv("Datum;Date;Withdrawal;Deposit;Category;Payee\nx;28/10/2026;1.250,50;;Food;Store\nx;29/10/2026;;100,00;Food;Refund");
    expect(r.dateOrder).toBe("DMY");
    expect(r.transactions.map((t) => [t.date, t.kind, t.amountCents])).toEqual([["2026-10-28", "expense", 125050], ["2026-10-29", "income", 10000]]);
  });
  it("explains clearly when the file is not a usable export", () => {
    expect(() => readCsv("hello,world\n1,2")).toThrow(/Date column and an Amount column/);
  });
});

describe("uploading and budgeting from a CSV", () => {
  let db: Db;
  const dad = () => service(db, { key: "freznel", role: "parent" }, "app");
  beforeEach(async () => {
    db = await openDb();
  });

  it("previews without saving, imports once, and re-uploads without duplicates", async () => {
    const preview = await dad().csvPreview(SAMPLE);
    expect(preview).toMatchObject({ count: 9, from: "2026-10-01" });
    expect((await dad().monthTransactions("2026-10")).length).toBe(0);
    expect(await dad().csvImport(SAMPLE)).toMatchObject({ count: 9, created: 9 });
    expect(await dad().csvImport(SAMPLE)).toMatchObject({ created: 0, unchanged: 9 });
    expect((await dad().monthTransactions("2026-10")).length).toBe(6);
    await expect(service(db, { key: "ellie", role: "child" }, "app").csvImport(SAMPLE)).rejects.toThrow(/Only parents/);
  });

  it("builds monthly budgets from the plan and finds October's leftovers", async () => {
    await dad().csvImport(SAMPLE);
    const svc = dad();
    await svc.createPlan({ name: "Groceries", monthlyCents: 2500000, categories: ["Food & Dining > Groceries"], startMonth: "2026-10" });
    await svc.createPlan({ name: "Food out", monthlyCents: 300000, categories: ["Food & Dining > Restaurants"], startMonth: "2026-10" });
    await refreshPlanPeriods(db, NOV_12);
    const oct = await budgetMonth(db, "2026-10", NOV_12);
    const by = Object.fromEntries(oct.budgets.map((b) => [b.name, b]));
    // groceries: 8,450.25 + 12,000 − 450.25 refund = 20,000 used of 25,000
    expect(by["Groceries"]).toMatchObject({ usedCents: 2000000, remainingCents: 500000, sweepableCents: 500000, ended: true });
    expect(by["Food out"]).toMatchObject({ usedCents: 438000, remainingCents: -138000, status: "over" });
    expect((await pendingLeftovers(db, NOV_12)).totalCents).toBe(500000);
    // the picker lists only categories with spending: imported ones, not unused built-ins
    const { categories } = await svc.budgetPlans();
    expect(categories).toContain("Food & Dining > Groceries");
    expect(categories).not.toContain("Groceries");
    expect(categories).not.toContain("Income > Salary");
    // November is running; groceries so far = 2 × 180
    const nov = (await budgetMonth(db, "2026-11", NOV_12)).budgets.find((b) => b.name === "Groceries")!;
    expect(nov).toMatchObject({ usedCents: 36000, ended: false, sweepableCents: 0 });
  });

  it("keeps swept months when a plan changes or is removed", async () => {
    await dad().csvImport(SAMPLE);
    const svc = dad();
    const plan = await svc.createPlan({ name: "Groceries", monthlyCents: 2500000, categories: ["Food & Dining"], startMonth: "2026-10" });
    await refreshPlanPeriods(db, NOV_12);
    const goal = await svc.createGoal({ name: "Trip", targetCents: 10_000_000 });
    const oct = (await budgetMonth(db, "2026-10", NOV_12)).budgets[0];
    expect(oct.usedCents).toBe(2438000); // parent category covers groceries + restaurants
    const { sweep } = await import("./sweeps");
    await sweep({ db, actor: "freznel", source: "app" }, { budgetPeriodId: oct.id, goalId: goal.id }, NOV_12);
    await svc.updatePlan(plan.id, { startMonth: "2026-11" });
    await refreshPlanPeriods(db, NOV_12);
    expect((await budgetMonth(db, "2026-10", NOV_12)).budgets.map((b) => b.sweptCents)).toEqual([62000]);
    await svc.removePlan(plan.id);
    await refreshPlanPeriods(db, NOV_12);
    expect((await budgetMonth(db, "2026-11", NOV_12)).budgets).toEqual([]);
    expect((await budgetMonth(db, "2026-10", NOV_12)).budgets).toHaveLength(1); // swept month kept
    expect((await svc.goals())[0].sweptCents).toBe(62000);
  });

  it("matches categories and their subcategories only", () => {
    expect(covers(["Food & Dining"], "Food & Dining > Groceries")).toBe(true);
    expect(covers(["Food & Dining"], "Food & Dining")).toBe(true);
    expect(covers(["Food"], "Food & Dining > Groceries")).toBe(false);
  });
});
