import { asc } from "drizzle-orm";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import * as activities from "./activities";
import { recentChanges } from "./audit";
import type { Ctx } from "./context";
import * as finance from "./finance";
import * as mw from "./moneywiz";
import * as sw from "./sweeps";
import { can, type User } from "./permissions";
import type { ActivityInput, BudgetInput, GoalInput, SavingsEntryInput, TransactionInput } from "./schemas";

/**
 * Everything a signed-in person or agent can do, with permission checks applied.
 * The web API and the MCP server both go through this, so the rules never differ.
 */
export function service(db: Db, user: User, source: Ctx["source"]) {
  const ctx: Ctx = { db, actor: user.agent ? `${user.agent} (for ${user.key})` : user.key, source };

  return {
    user,

    /** Lists needed to fill in forms: who, where, what, and spending categories. */
    async reference() {
      const members = await db
        .select({ key: schema.members.key, name: schema.members.name, role: schema.members.role, color: schema.members.color, sprite: schema.members.sprite })
        .from(schema.members)
        .orderBy(asc(schema.members.id));
      const places = await db.select().from(schema.places).orderBy(asc(schema.places.id));
      const types = await db
        .select({ key: schema.activityTypes.key, name: schema.activityTypes.name, defaultPlaceId: schema.activityTypes.defaultPlaceId })
        .from(schema.activityTypes)
        .orderBy(asc(schema.activityTypes.id));
      const categories = await db.select().from(schema.categories).orderBy(asc(schema.categories.id));
      return {
        members,
        places: places.map((p) => ({ key: p.key, name: p.name, sprite: p.sprite })),
        activityTypes: types.map((t) => ({ key: t.key, name: t.name, defaultPlace: places.find((p) => p.id === t.defaultPlaceId)?.key ?? null })),
        categories: categories.map((c) => ({ key: c.key, name: c.name, kind: c.kind })),
      };
    },

    async day(date: string) {
      const acts = await activities.listActivities(db, date);
      const txns = (await finance.listTransactions(db, date)).filter((t) => can.seeTransaction(user, t.member));
      const spentCents = txns.filter((t) => t.kind === "expense").reduce((n, t) => n + t.amountCents, 0);
      return { date, activities: acts, transactions: txns, spentCents };
    },

    /** One entry per day of the month that has anything logged. */
    async calendar(month: string) {
      const { from, to } = finance.monthRange(month);
      const acts = await activities.listActivitiesBetween(db, from, to);
      const txns = (await finance.listMonthTransactions(db, month)).filter((t) => can.seeTransaction(user, t.member));
      const days = new Map<string, { date: string; activities: { type: string; place: string | null; members: string[] }[]; spentCents: number }>();
      const day = (date: string) => {
        if (!days.has(date)) days.set(date, { date, activities: [], spentCents: 0 });
        return days.get(date)!;
      };
      for (const a of acts) day(a.date).activities.push({ type: a.type, place: a.place, members: a.members });
      for (const t of txns) if (t.kind === "expense") day(t.date).spentCents += t.amountCents;
      return { month, days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)) };
    },

    async logActivity(input: ActivityInput) {
      can.writeActivity(user, input.members ?? []);
      return activities.logActivity(ctx, input);
    },
    async updateActivity(id: number, input: ActivityInput) {
      can.writeActivity(user, input.members ?? [], (await activities.getActivity(db, id)).members);
      return activities.updateActivity(ctx, id, input);
    },
    async deleteActivity(id: number) {
      const existing = await activities.getActivity(db, id);
      can.writeActivity(user, existing.members, existing.members);
      return activities.deleteActivity(ctx, id);
    },

    async logTransaction(input: TransactionInput) {
      can.writeTransaction(user, input.member);
      return finance.logTransaction(ctx, input);
    },
    async updateTransaction(id: number, input: TransactionInput) {
      can.writeTransaction(user, input.member, (await finance.getTransaction(db, id)).member);
      return finance.updateTransaction(ctx, id, input);
    },
    async deleteTransaction(id: number) {
      const existing = await finance.getTransaction(db, id);
      can.writeTransaction(user, existing.member, existing.member);
      return finance.deleteTransaction(ctx, id);
    },

    async monthSummary(month: string) {
      can.parentOnly(user, "see the family budget");
      return finance.getMonthSummary(db, month);
    },
    async monthTransactions(month: string) {
      return (await finance.listMonthTransactions(db, month)).filter((t) => can.seeTransaction(user, t.member));
    },
    async setBudget(input: BudgetInput) {
      can.parentOnly(user, "change budgets");
      return finance.setBudget(ctx, input);
    },

    goals: () => finance.listGoals(db),
    async createGoal(input: GoalInput) {
      can.parentOnly(user, "create savings goals");
      return finance.createGoal(ctx, input);
    },
    async addSavingsEntry(input: SavingsEntryInput) {
      can.parentOnly(user, "move savings");
      return finance.addSavingsEntry(ctx, input);
    },

    async updateGoal(id: number, input: sw.GoalUpdate) {
      can.parentOnly(user, "change savings goals");
      return sw.updateGoal(ctx, id, input);
    },

    // ---- MoneyWiz budgets and sweeping (parents only)
    async budgetMonth(month: string) {
      can.parentOnly(user, "see the family budget");
      return sw.budgetMonth(db, month);
    },
    async budgetOverview(month: string) {
      can.parentOnly(user, "see the family budget");
      const [current, pending, history, lastSync] = await Promise.all([sw.budgetMonth(db, month), sw.pendingLeftovers(db), sw.sweepHistory(db), mw.lastSync(db)]);
      return { current, pending, history, lastSync };
    },
    async pendingLeftovers() {
      can.parentOnly(user, "see the family budget");
      return sw.pendingLeftovers(db);
    },
    async sweep(input: sw.SweepInput) {
      can.parentOnly(user, "sweep leftovers");
      return sw.sweep(ctx, input);
    },
    async undoSweep(id: number) {
      can.parentOnly(user, "undo sweeps");
      return sw.undoSweep(ctx, id);
    },
    async leaveAlone(budgetPeriodId: number, value: boolean) {
      can.parentOnly(user, "change leftovers");
      return sw.leaveAlone(ctx, budgetPeriodId, value);
    },
    async importMoneyWizBudgets(records: mw.MoneyWizBudget[]) {
      can.parentOnly(user, "import from MoneyWiz");
      return mw.importBudgets({ ...ctx, source: "import" }, records);
    },
    async importMoneyWizTransactions(rows: mw.MoneyWizRow[], names: mw.MoneyWizNames) {
      can.parentOnly(user, "import from MoneyWiz");
      return mw.importTransactions({ ...ctx, source: "import" }, rows, names);
    },

    async changes(limit?: number) {
      can.parentOnly(user, "see the change log");
      return recentChanges(db, limit);
    },
  };
}

export type Service = ReturnType<typeof service>;
