/**
 * Fill a SEPARATE database with made-up MoneyWiz budgets, transactions and goals, to see
 * the Budget and Savings screens before the first real sync. Never touches your real data:
 *
 *   npm run demo      (uses .data/demo, then starts the app on it)
 */
import { resolve } from "node:path";
import { createGoal, addSavingsEntry, listGoals } from "../core/finance";
import { importBudgets, importTransactions } from "../core/moneywiz";
import { budgetMonth, sweep } from "../core/sweeps";
import { openDb } from "./client";
import { sampleBudgets, sampleNames, sampleRows } from "./fixtures/moneywiz-sample";

const dir = resolve(process.env.PGLITE_DIR ?? ".data/demo");
if (!dir.includes("demo")) throw new Error(`Refusing to put demo data in ${dir}; use a folder with "demo" in its name`);
const db = await openDb(dir);
const ctx = { db, actor: "freznel", source: "import" as const };

if ((await listGoals(db)).length === 0) {
  await importBudgets(ctx, [...sampleBudgets("2026-10"), ...sampleBudgets("2026-11")]);
  await importTransactions(ctx, sampleRows, sampleNames);
  const ef = await createGoal(ctx, { name: "Emergency fund", targetCents: 30_000_000, targetDate: "2027-12-31", monthlyCents: 1_500_000 });
  const trip = await createGoal(ctx, { name: "Family trip", targetCents: 12_000_000, targetDate: "2027-04-30", monthlyCents: 1_500_000 });
  await createGoal(ctx, { name: "Kids' college", targetCents: 100_000_000, monthlyCents: 1_000_000 });
  await addSavingsEntry(ctx, { goalId: ef.id, date: "2026-09-30", amountCents: 9_000_000, note: "Opening balance" });
  await addSavingsEntry(ctx, { goalId: trip.id, date: "2026-10-31", amountCents: 3_000_000 });
  const oct = await budgetMonth(db, "2026-10");
  const med = oct.budgets.find((b) => b.name === "Medical and Meds")!;
  await sweep({ ...ctx, source: "app" }, { budgetPeriodId: med.id, goalId: ef.id, amountCents: 500_000 });
  console.log("Demo data ready in", dir);
} else {
  console.log("Demo data already in", dir);
}
process.exit(0);
