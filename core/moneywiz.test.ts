import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../db/client";
import { sampleBudgets, sampleNames, sampleRows } from "../db/fixtures/moneywiz-sample";
import type { Ctx } from "./context";
import { listGoals, listMonthTransactions, createGoal, addSavingsEntry } from "./finance";
import { categoryKey, importBudgets, importTransactions, manilaDate, moneyToCents, parseBudget } from "./moneywiz";
import { budgetMonth, leaveAlone, pace, pendingLeftovers, sweep, sweepHistory, undoSweep, updateGoal } from "./sweeps";

let db: Db;
let ctx: Ctx;
const NOV_11 = new Date("2026-11-11T03:00:00Z");
const DEC_02 = new Date("2026-12-02T03:00:00Z");

beforeEach(async () => {
  db = await openDb();
  ctx = { db, actor: "freznel", source: "app" };
});

describe("reading MoneyWiz values", () => {
  it("converts decimal strings to centavos exactly", () => {
    expect(moneyToCents({ amount: "5162.3", currency: "PHP" })).toBe(516230);
    expect(moneyToCents({ amount: "-3080", currency: "PHP" })).toBe(-308000);
    expect(moneyToCents({ amount: "0.1" })).toBe(10);
    expect(moneyToCents({ amount: "315336.04" })).toBe(31533604);
    expect(moneyToCents({ amount: "63.209994" })).toBe(6321);
    expect(moneyToCents({ amount: "1.005" })).toBe(101);
    expect(moneyToCents(null)).toBeNull();
    expect(moneyToCents({ amount: null })).toBeNull();
    expect(() => moneyToCents({ amount: "12", currency: "USD" })).toThrow(/Only PHP/);
    expect(() => moneyToCents({ amount: "1e5" })).toThrow(/Not an amount/);
  });

  it("puts UTC instants on the right Manila day", () => {
    expect(manilaDate("2026-09-30T16:00:00Z")).toBe("2026-10-01");
    expect(manilaDate("2026-10-31T15:59:00Z")).toBe("2026-10-31");
    expect(manilaDate("2026-10-31T16:00:00Z")).toBe("2026-11-01");
  });

  it("reads a budget record as in the reference sample", () => {
    const b = parseBudget(sampleBudgets("2026-11").find((x) => x.name === "Medical and Meds")!)!;
    expect(b).toMatchObject({ externalId: "B-MEDICAL", month: "2026-11", plannedCents: 1500000, usedCents: 516230, remainingCents: 983770, categories: ["Medical"] });
    expect(parseBudget({ ...sampleBudgets("2026-11")[0], text: { budgetType: "income" } })).toBeNull();
  });

  it("prefers the Budgets-screen figures when they differ", () => {
    const r = sampleBudgets("2026-10")[0];
    const b = parseBudget({ ...r, money: { ...r.money, available: { amount: "30000" }, budgetsScreenAvailable: { amount: "25000" } } })!;
    expect(b.availableCents).toBe(2500000);
  });
});

describe("importing", () => {
  it("imports budgets for two months and updates on re-sync", async () => {
    expect(await importBudgets(ctx, [...sampleBudgets("2026-10"), ...sampleBudgets("2026-11")])).toMatchObject({ budgets: 12, created: 12, updated: 0, months: ["2026-10", "2026-11"] });
    const again = await importBudgets(ctx, sampleBudgets("2026-11"));
    expect(again).toMatchObject({ created: 0, updated: 6 });
    const nov = await budgetMonth(db, "2026-11", NOV_11);
    expect(nov.budgets).toHaveLength(6);
    expect(nov.ended).toBe(false);
  });

  it("imports transactions once, splitting categories and skipping transfers and voids", async () => {
    const first = await importTransactions(ctx, sampleRows, sampleNames);
    expect(first).toMatchObject({ created: 10, updated: 0, unchanged: 0 });
    const second = await importTransactions(ctx, sampleRows, sampleNames);
    expect(second).toMatchObject({ created: 0, unchanged: 10 });

    const oct = await listMonthTransactions(db, "2026-10");
    expect(oct.map((t) => t.date).at(-1)).toBe("2026-10-31"); // 15:59Z is still Oct 31 in Manila
    expect(oct.find((t) => t.kind === "income")).toMatchObject({ amountCents: 9500000, category: "mw:income__salary:in", payee: "Employer" });
    const nov = await listMonthTransactions(db, "2026-11");
    expect(nov.map((t) => t.amountCents).sort((a, b) => a - b)).toEqual([100000, 300000, 320000, 612040]);
    expect(nov.find((t) => t.amountCents === 100000)?.category).toBe(categoryKey("Home > Supplies"));

    // an edit in MoneyWiz flows through on the next import
    const edited = sampleRows.map((r) => (r.transactionID === "T-3" ? { ...r, allocations: [{ amount: "-4500", categoryID: "C-1" }] } : r));
    expect(await importTransactions(ctx, edited, sampleNames)).toMatchObject({ updated: 1, unchanged: 9 });
  });
});

describe("sweeping leftovers", () => {
  beforeEach(async () => {
    await importBudgets(ctx, [...sampleBudgets("2026-10"), ...sampleBudgets("2026-11")]);
  });

  it("shows what October left over and what can be swept", async () => {
    const oct = await budgetMonth(db, "2026-10", NOV_11);
    expect(oct.ended).toBe(true);
    const by = Object.fromEntries(oct.budgets.map((b) => [b.name, b]));
    expect(by["Groceries"]).toMatchObject({ remainingCents: 354925, sweepableCents: 354925, status: "low" }); // 14% left
    expect(by["Medical and Meds"].status).toBe("ok");
    expect(by["Dining Out"]).toMatchObject({ remainingCents: -238000, sweepableCents: 0, status: "over" });
    expect(by["Kids School and Lessons"].sweepableCents).toBe(0); // used up exactly
    // leftovers are not cancelled by overspending elsewhere
    expect(oct.leftoverCents).toBe(354925 + 983770 + 120950 + 368775);
    expect(oct.overCents).toBe(238000);
    // November is still running, so nothing to sweep yet
    expect((await budgetMonth(db, "2026-11", NOV_11)).sweepableCents).toBe(0);
    expect((await pendingLeftovers(db, NOV_11)).totalCents).toBe(oct.leftoverCents);
  });

  it("sweeps into a goal, partly then fully, and never twice", async () => {
    const goal = await createGoal(ctx, { name: "Emergency fund", targetCents: 30_000_000 });
    const groceries = (await budgetMonth(db, "2026-10", NOV_11)).budgets.find((b) => b.name === "Groceries")!;

    const part = await sweep(ctx, { budgetPeriodId: groceries.id, goalId: goal.id, amountCents: 200000 }, NOV_11);
    expect(part).toMatchObject({ amountCents: 200000, leftCents: 154925, goal: "Emergency fund" });
    await expect(sweep(ctx, { budgetPeriodId: groceries.id, goalId: goal.id, amountCents: 200000 }, NOV_11)).rejects.toThrow("Only ₱1,549.25 is left");
    const rest = await sweep(ctx, { budgetPeriodId: groceries.id, goalId: goal.id }, NOV_11);
    expect(rest.amountCents).toBe(154925);
    await expect(sweep(ctx, { budgetPeriodId: groceries.id, goalId: goal.id }, NOV_11)).rejects.toThrow(/Nothing left/);

    const [g] = await listGoals(db, "2026-11-11");
    expect(g).toMatchObject({ savedCents: 354925, sweptCents: 354925 });
    expect(await sweepHistory(db)).toEqual([{ month: "2026-10", sweptCents: 354925 }]);
    const line = (await budgetMonth(db, "2026-10", NOV_11)).budgets.find((b) => b.name === "Groceries")!;
    expect(line.sweeps.map((s) => s.amountCents)).toEqual([200000, 154925]);
  });

  it("refuses running months, overspent budgets and archived goals", async () => {
    const goal = await createGoal(ctx, { name: "Trip", targetCents: 100000 });
    const nov = (await budgetMonth(db, "2026-11", NOV_11)).budgets[0];
    await expect(sweep(ctx, { budgetPeriodId: nov.id, goalId: goal.id }, NOV_11)).rejects.toThrow(/still running/);
    // ...but once November is over it can be swept
    expect((await sweep(ctx, { budgetPeriodId: nov.id, goalId: goal.id, amountCents: 100 }, DEC_02)).amountCents).toBe(100);
    const dining = (await budgetMonth(db, "2026-10", NOV_11)).budgets.find((b) => b.name === "Dining Out")!;
    await expect(sweep(ctx, { budgetPeriodId: dining.id, goalId: goal.id }, NOV_11)).rejects.toThrow(/Nothing left/);
    await updateGoal(ctx, goal.id, { archived: true });
    const med = (await budgetMonth(db, "2026-10", NOV_11)).budgets.find((b) => b.name === "Medical and Meds")!;
    await expect(sweep(ctx, { budgetPeriodId: med.id, goalId: goal.id }, NOV_11)).rejects.toThrow(/archived/);
  });

  it("re-syncing after a sweep keeps the sweep and caps what is left", async () => {
    const goal = await createGoal(ctx, { name: "Trip", targetCents: 10_000_000 });
    const med = (await budgetMonth(db, "2026-10", NOV_11)).budgets.find((b) => b.name === "Medical and Meds")!;
    await sweep(ctx, { budgetPeriodId: med.id, goalId: goal.id, amountCents: 900000 }, NOV_11);
    // a late October medical bill shows up in MoneyWiz: only ₱5,000 really left
    const late = sampleBudgets("2026-10").map((b) => (b.name === "Medical and Meds" ? { ...b, money: { ...b.money, budgetsScreenUsed: { amount: "10000" }, budgetsScreenRemaining: { amount: "5000" } } } : b));
    await importBudgets(ctx, late);
    const after = (await budgetMonth(db, "2026-10", NOV_11)).budgets.find((b) => b.name === "Medical and Meds")!;
    expect(after).toMatchObject({ remainingCents: 500000, sweptCents: 900000, sweepableCents: 0 });
  });

  it("undoes a sweep and can leave a leftover alone", async () => {
    const goal = await createGoal(ctx, { name: "Trip", targetCents: 10_000_000 });
    const hh = (await budgetMonth(db, "2026-10", NOV_11)).budgets.find((b) => b.name === "Household")!;
    const s = await sweep(ctx, { budgetPeriodId: hh.id, goalId: goal.id }, NOV_11);
    // cannot undo if the money has since been taken out of the goal
    await addSavingsEntry(ctx, { goalId: goal.id, date: "2026-11-11", amountCents: -s.amountCents });
    await expect(undoSweep(ctx, s.id)).rejects.toThrow(/cannot be taken back/);
    await addSavingsEntry(ctx, { goalId: goal.id, date: "2026-11-11", amountCents: s.amountCents });
    await undoSweep(ctx, s.id);
    expect((await listGoals(db))[0].sweptCents).toBe(0);
    expect((await budgetMonth(db, "2026-10", NOV_11)).budgets.find((b) => b.name === "Household")!.sweepableCents).toBe(368775);

    await leaveAlone(ctx, hh.id, true);
    expect((await pendingLeftovers(db, NOV_11)).budgets.map((b) => b.name)).not.toContain("Household");
    await expect(sweep(ctx, { budgetPeriodId: hh.id, goalId: goal.id }, NOV_11)).rejects.toThrow(/leave it/);
    await leaveAlone(ctx, hh.id, false);
    expect((await pendingLeftovers(db, NOV_11)).budgets.map((b) => b.name)).toContain("Household");
  });
});

describe("savings plan pace", () => {
  it("works out what is needed per month and whether the plan keeps up", () => {
    const goal = { targetCents: 12_000_000, targetDate: "2027-10-31", monthlyCents: 1_000_000 };
    // Nov 2026 → Oct 2027 is 12 months to save in; ₱120,000 left needs ₱10,000/month
    expect(pace(goal, 0, "2026-11-11")).toEqual({ monthsLeft: 12, neededPerMonthCents: 1_000_000, projectedMonth: "2027-10", status: "on_track" });
    expect(pace({ ...goal, monthlyCents: 900_000 }, 0, "2026-11-11").status).toBe("behind");
    expect(pace(goal, 12_000_000, "2026-11-11").status).toBe("done");
    expect(pace({ ...goal, targetDate: null }, 6_000_000, "2026-11-11")).toMatchObject({ monthsLeft: null, projectedMonth: "2027-04", status: "on_track" });
    expect(pace({ ...goal, monthlyCents: null }, 0, "2026-11-11")).toMatchObject({ neededPerMonthCents: 1_000_000, status: "no_plan" });
    // a past target date still asks for the whole remainder this month
    expect(pace(goal, 0, "2028-01-05")).toMatchObject({ monthsLeft: 1, neededPerMonthCents: 12_000_000, status: "behind" });
  });

  it("is included when listing goals", async () => {
    await createGoal(ctx, { name: "Emergency fund", targetCents: 12_000_000, targetDate: "2027-10-31", monthlyCents: 1_000_000 });
    expect((await listGoals(db, "2026-11-11"))[0].pace.status).toBe("on_track");
  });
});
