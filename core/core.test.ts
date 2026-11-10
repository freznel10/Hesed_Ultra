import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../db/client";
import { deleteActivity, listActivities, logActivity, updateActivity } from "./activities";
import { recentChanges } from "./audit";
import { type Ctx, InputError } from "./context";
import {
  addSavingsEntry,
  createGoal,
  deleteTransaction,
  getMonthSummary,
  listGoals,
  listTransactions,
  logTransaction,
  setBudget,
  updateTransaction,
} from "./finance";

let db: Db;
let app: Ctx;
let agent: Ctx;

beforeEach(async () => {
  db = await openDb(); // fresh in-memory database per test
  app = { db, actor: "diane", source: "app" };
  agent = { db, actor: "claude", source: "mcp" };
});

describe("activities", () => {
  it("logs an activity with defaults from its type", async () => {
    const a = await logActivity(app, { date: "2026-11-08", type: "worship", members: ["freznel", "diane", "ellie", "rafa"] });
    expect(a).toMatchObject({ title: "Worship", place: "church", type: "worship", source: "app", createdBy: "diane" });
    expect(a.members).toEqual(["freznel", "diane", "ellie", "rafa"]);
  });

  it("lists a day in time order and keeps other days out", async () => {
    await logActivity(app, { date: "2026-11-10", type: "piano", members: ["ellie"], startTime: "16:00", endTime: "17:00" });
    await logActivity(app, { date: "2026-11-10", type: "school", members: ["ellie", "rafa"], startTime: "07:30" });
    await logActivity(app, { date: "2026-11-11", type: "work", members: ["freznel"] });
    const day = await listActivities(db, "2026-11-10");
    expect(day.map((a) => a.type)).toEqual(["school", "piano"]);
  });

  it("updates and deletes, replacing the member list", async () => {
    const a = await logActivity(app, { date: "2026-11-10", type: "dining_out", members: ["freznel"], place: "mall_sm_aura" });
    const b = await updateActivity(agent, a.id, { date: "2026-11-10", type: "dining_out", members: ["diane", "rafa"], place: "mall_festival", mood: 5 });
    expect(b).toMatchObject({ id: a.id, place: "mall_festival", mood: 5, members: ["diane", "rafa"] });
    await deleteActivity(app, a.id);
    expect(await listActivities(db, "2026-11-10")).toEqual([]);
  });

  it("rejects bad input", async () => {
    await expect(logActivity(app, { date: "2026-11-10", type: "surfing", members: ["ellie"] })).rejects.toThrow(InputError);
    await expect(logActivity(app, { date: "2026-11-10", type: "piano", members: ["lola"] })).rejects.toThrow(/family member/);
    await expect(logActivity(app, { date: "2026-11-10", type: "piano", members: [] })).rejects.toThrow();
    await expect(logActivity(app, { date: "10/11/2026", type: "piano", members: ["ellie"] })).rejects.toThrow();
    await expect(logActivity(app, { date: "2026-02-31", type: "piano", members: ["ellie"] })).rejects.toThrow(/real date/);
    await expect(
      logActivity(app, { date: "2026-11-10", type: "piano", members: ["ellie"], startTime: "17:00", endTime: "16:00" }),
    ).rejects.toThrow(/end time/);
    await expect(deleteActivity(app, 999)).rejects.toThrow(InputError);
  });
});

describe("transactions and budgets", () => {
  it("logs, updates and deletes a transaction", async () => {
    const t = await logTransaction(app, { date: "2026-11-10", amountCents: 125000, category: "groceries", member: "diane", payee: "SM Marikina" });
    expect(t).toMatchObject({ kind: "expense", amountCents: 125000, category: "groceries", member: "diane" });
    const u = await updateTransaction(app, t.id, { date: "2026-11-10", amountCents: 130000, category: "groceries" });
    expect(u).toMatchObject({ amountCents: 130000, member: null });
    expect(await listTransactions(db, "2026-11-10")).toHaveLength(1);
    await deleteTransaction(app, t.id);
    expect(await listTransactions(db, "2026-11-10")).toHaveLength(0);
  });

  it("rejects wrong amounts and mismatched categories", async () => {
    const base = { date: "2026-11-10", category: "groceries" };
    await expect(logTransaction(app, { ...base, amountCents: 0 })).rejects.toThrow();
    await expect(logTransaction(app, { ...base, amountCents: -5 })).rejects.toThrow();
    await expect(logTransaction(app, { ...base, amountCents: 12.5 })).rejects.toThrow();
    await expect(logTransaction(app, { ...base, amountCents: 100, kind: "income" })).rejects.toThrow(/expense category/);
    await expect(logTransaction(app, { ...base, amountCents: 100, activityId: 42 })).rejects.toThrow(/No activity/);
  });

  it("keeps a transaction when its linked activity is deleted", async () => {
    const a = await logActivity(app, { date: "2026-11-10", type: "dining_out", members: ["freznel"] });
    const t = await logTransaction(app, { date: "2026-11-10", amountCents: 250000, category: "dining_out", activityId: a.id });
    await deleteActivity(app, a.id);
    expect((await listTransactions(db, "2026-11-10"))[0]).toMatchObject({ id: t.id, activityId: null });
  });

  it("summarises a month against budgets", async () => {
    await setBudget(app, { month: "2026-11", category: "groceries", limitCents: 1_000_000 });
    await setBudget(app, { month: "2026-11", category: "dining_out", limitCents: 500_000 });
    await setBudget(app, { month: "2026-11", category: "transport", limitCents: 300_000 });
    await logTransaction(app, { date: "2026-11-01", amountCents: 400_000, category: "groceries" });
    await logTransaction(app, { date: "2026-11-30", amountCents: 450_000, category: "groceries" }); // 85% → warning
    await logTransaction(app, { date: "2026-11-15", amountCents: 600_000, category: "dining_out" }); // over
    await logTransaction(app, { date: "2026-11-15", amountCents: 50_000, category: "health" }); // no budget
    await logTransaction(app, { date: "2026-11-15", amountCents: 9_000_000, category: "salary", kind: "income" });
    await logTransaction(app, { date: "2026-10-31", amountCents: 999_999, category: "groceries" }); // other months
    await logTransaction(app, { date: "2026-12-01", amountCents: 999_999, category: "groceries" });

    const s = await getMonthSummary(db, "2026-11");
    expect(s).toMatchObject({ incomeCents: 9_000_000, spentCents: 1_500_000, netCents: 7_500_000 });
    const by = Object.fromEntries(s.categories.map((c) => [c.category, c]));
    expect(by.groceries).toMatchObject({ spentCents: 850_000, remainingCents: 150_000, status: "warning" });
    expect(by.dining_out).toMatchObject({ remainingCents: -100_000, status: "over" });
    expect(by.transport).toMatchObject({ spentCents: 0, status: "ok" });
    expect(by.health).toMatchObject({ limitCents: null, status: "none" });
    expect(by.tuition).toBeUndefined(); // nothing spent, no budget → not listed
  });

  it("changes and removes a budget", async () => {
    await setBudget(app, { month: "2026-11", category: "groceries", limitCents: 100 });
    await setBudget(app, { month: "2026-11", category: "groceries", limitCents: 200 });
    expect((await getMonthSummary(db, "2026-11")).categories[0].limitCents).toBe(200);
    await setBudget(app, { month: "2026-11", category: "groceries", limitCents: 0 });
    expect((await getMonthSummary(db, "2026-11")).categories).toEqual([]);
    await expect(setBudget(app, { month: "2026-11", category: "salary", limitCents: 100 })).rejects.toThrow(/expense/);
    await expect(setBudget(app, { month: "2026-13", category: "groceries", limitCents: 100 })).rejects.toThrow();
  });

  it("handles December when working out the month range", async () => {
    await logTransaction(app, { date: "2026-12-31", amountCents: 100, category: "groceries" });
    await logTransaction(app, { date: "2027-01-01", amountCents: 999, category: "groceries" });
    expect((await getMonthSummary(db, "2026-12")).spentCents).toBe(100);
  });
});

describe("savings", () => {
  it("tracks progress and blocks overdrawing", async () => {
    const goal = await createGoal(app, { name: "Emergency fund", targetCents: 10_000_000 });
    await addSavingsEntry(app, { goalId: goal.id, date: "2026-11-01", amountCents: 2_500_000 });
    await addSavingsEntry(agent, { goalId: goal.id, date: "2026-11-05", amountCents: -500_000, note: "car repair" });
    const [g] = await listGoals(db);
    expect(g).toMatchObject({ savedCents: 2_000_000, remainingCents: 8_000_000, percent: 20 });
    await expect(addSavingsEntry(app, { goalId: goal.id, date: "2026-11-06", amountCents: -2_000_001 })).rejects.toThrow("only has ₱20,000.00 saved");
    await expect(addSavingsEntry(app, { goalId: goal.id, date: "2026-11-06", amountCents: 0 })).rejects.toThrow();
    await expect(addSavingsEntry(app, { goalId: 99, date: "2026-11-06", amountCents: 100 })).rejects.toThrow(InputError);
  });

  it("caps percent at 100 when a goal is exceeded", async () => {
    const goal = await createGoal(app, { name: "Piano", targetCents: 1000 });
    await addSavingsEntry(app, { goalId: goal.id, date: "2026-11-01", amountCents: 1500 });
    expect((await listGoals(db))[0]).toMatchObject({ percent: 100, remainingCents: 0 });
  });
});

describe("audit log", () => {
  it("records who changed what, with before and after", async () => {
    const t = await logTransaction(app, { date: "2026-11-10", amountCents: 100, category: "groceries" });
    await updateTransaction(agent, t.id, { date: "2026-11-10", amountCents: 250, category: "groceries" });
    await deleteTransaction(agent, t.id);
    const log = await recentChanges(db);
    expect(log.map((l) => [l.action, l.actor, l.source])).toEqual([
      ["delete", "claude", "mcp"],
      ["update", "claude", "mcp"],
      ["create", "diane", "app"],
    ]);
    expect(log[1].before).toMatchObject({ amountCents: 100 });
    expect(log[1].after).toMatchObject({ amountCents: 250 });
    expect(log[0].after).toBeNull();
  });

  it("writes nothing when a change fails", async () => {
    await expect(logTransaction(app, { date: "2026-11-10", amountCents: 100, category: "nope" })).rejects.toThrow();
    await expect(logActivity(app, { date: "2026-11-10", type: "piano", members: ["ellie", "nobody"] })).rejects.toThrow();
    expect(await recentChanges(db)).toEqual([]);
    expect(await listActivities(db, "2026-11-10")).toEqual([]);
  });
});
