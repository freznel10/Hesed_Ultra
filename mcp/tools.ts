import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, ZodError } from "zod";
import { InputError } from "../core/context";
import { formatPHP } from "../core/money";
import type { Service } from "../core/service";

/**
 * The tools Claude (or any MCP agent) can use. Each one calls core/service, the same
 * code the web app uses, so the same checks and the same change log apply.
 *
 * Money is given and shown in pesos here (1250.5 = ₱1,250.50); it is stored as centavos.
 */
const date = z.string().describe("Date as YYYY-MM-DD");
const month = z.string().describe("Month as YYYY-MM");
const pesos = z.number().positive().describe("Amount in Philippine pesos, e.g. 1250.50");
const toCents = (p: number) => Math.round(p * 100);

const activityFields = {
  date,
  type: z.string().describe("Activity type key from get_reference, e.g. worship, piano, dining_out"),
  members: z.array(z.string()).describe("Keys of the family members who took part, e.g. ['ellie','rafa']"),
  place: z.string().optional().describe("Place key from get_reference. Omit to use the activity's usual place"),
  start_time: z.string().optional().describe("HH:MM, 24-hour"),
  end_time: z.string().optional().describe("HH:MM, 24-hour"),
  title: z.string().optional().describe("Short title. Omit to use the activity type's name"),
  note: z.string().optional(),
  mood: z.number().int().min(1).max(5).optional().describe("1 (bad) to 5 (great)"),
};
type ActivityArgs = { date: string; type: string; members: string[]; place?: string; start_time?: string; end_time?: string; title?: string; note?: string; mood?: number };
const activityInput = (a: ActivityArgs) => ({
  date: a.date, type: a.type, members: a.members, place: a.place, startTime: a.start_time, endTime: a.end_time, title: a.title, note: a.note ?? "", mood: a.mood,
});

const moneyFields = {
  date,
  amount: pesos,
  category: z.string().describe("Category key from get_reference, e.g. groceries, dining_out"),
  member: z.string().optional().describe("Key of the family member this belongs to. Omit for the whole family"),
  payee: z.string().optional().describe("Store or person paid"),
  note: z.string().optional(),
  activity_id: z.number().int().optional().describe("Id of that day's activity this goes with, so it shows in the scene"),
};
type MoneyArgs = { date: string; amount: number; category: string; member?: string; payee?: string; note?: string; activity_id?: number };
const moneyInput = (kind: "expense" | "income", a: MoneyArgs) => ({
  date: a.date, kind, amountCents: toCents(a.amount), category: a.category, member: a.member, payee: a.payee ?? "", note: a.note ?? "", activityId: a.activity_id,
});

const confirm = z.literal(true).describe("Must be true. Deleting cannot be undone from here");

/** Add a readable peso string next to every *Cents number so agents do not misread centavos. */
function withPesos(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withPesos);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.endsWith("Cents") && typeof v === "number") out[k.replace(/Cents$/, "")] = formatPHP(v);
      else out[k] = withPesos(v);
    }
    return out;
  }
  return value;
}

export function buildMcpServer(svc: Service) {
  const server = new McpServer({ name: "hesed-ultra", version: "0.1.0" });

  const tool = <S extends z.ZodRawShape>(name: string, description: string, shape: S, run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>, readOnly = false) =>
    server.registerTool(name, { description, inputSchema: shape, annotations: { readOnlyHint: readOnly } }, (async (args: z.infer<z.ZodObject<S>>) => {
      try {
        const result = await run(args);
        return { content: [{ type: "text" as const, text: JSON.stringify(withPesos(result ?? { ok: true }), null, 2) }] };
      } catch (err) {
        const message =
          err instanceof ZodError ? err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")
          : err instanceof InputError ? err.message
          : null;
        if (message === null) throw err;
        return { isError: true, content: [{ type: "text" as const, text: message }] };
      }
    }) as never);

  tool("get_reference", "List the family members, places, activity types and spending categories, with the keys to use in other tools. Call this first.", {}, () => svc.reference(), true);
  tool("get_day", "Everything logged for one day: activities and money.", { date }, (a) => svc.day(a.date), true);
  tool("get_calendar", "Which days of a month have activities or spending.", { month }, (a) => svc.calendar(a.month), true);

  tool("log_activity", "Record something the family did.", activityFields, (a) => svc.logActivity(activityInput(a)));
  tool("update_activity", "Replace an activity's details. Send every field, not just the changed ones.", { id: z.number().int(), ...activityFields }, (a) => svc.updateActivity(a.id, activityInput(a)));
  tool("delete_activity", "Delete an activity.", { id: z.number().int(), confirm }, (a) => svc.deleteActivity(a.id));

  tool("log_expense", "Record money spent.", moneyFields, (a) => svc.logTransaction(moneyInput("expense", a)));
  tool("log_income", "Record money received.", moneyFields, (a) => svc.logTransaction(moneyInput("income", a)));
  tool("update_transaction", "Replace a money entry's details. Send every field.", { id: z.number().int(), kind: z.enum(["expense", "income"]), ...moneyFields }, (a) => svc.updateTransaction(a.id, moneyInput(a.kind, a)));
  tool("delete_transaction", "Delete a money entry.", { id: z.number().int(), confirm }, (a) => svc.deleteTransaction(a.id));

  tool("get_month_summary", "Income, spending and each category against its budget for a month.", { month }, (a) => svc.monthSummary(a.month), true);
  tool("list_month_transactions", "Every money entry in a month.", { month }, (a) => svc.monthTransactions(a.month), true);
  tool("set_budget", "Set the monthly limit for a spending category. A limit of 0 removes the budget.", { month, category: z.string(), limit: z.number().min(0).describe("Monthly limit in pesos") }, (a) =>
    svc.setBudget({ month: a.month, category: a.category, limitCents: toCents(a.limit) }));

  tool("list_goals", "Savings goals with progress, how much came from sweeps, and whether the monthly plan is on pace for the target date.", {}, () => svc.goals(), true);
  tool("create_goal", "Create a savings goal, optionally with its planned monthly contribution.", { name: z.string(), target: pesos, target_date: date.optional(), monthly: pesos.optional().describe("Planned monthly contribution in pesos") }, (a) =>
    svc.createGoal({ name: a.name, targetCents: toCents(a.target), targetDate: a.target_date, monthlyCents: a.monthly === undefined ? undefined : toCents(a.monthly) }));
  tool("update_goal", "Change a savings goal: name, target, target date, planned monthly contribution, or archive it. Send only what changes; null clears a date or monthly plan.", {
    goal_id: z.number().int(), name: z.string().optional(), target: pesos.optional(),
    target_date: date.nullable().optional(), monthly: z.number().positive().nullable().optional().describe("Pesos per month, or null to clear"), archived: z.boolean().optional(),
  }, (a) => svc.updateGoal(a.goal_id, {
    name: a.name, targetCents: a.target === undefined ? undefined : toCents(a.target), targetDate: a.target_date,
    monthlyCents: a.monthly === undefined || a.monthly === null ? a.monthly : toCents(a.monthly), archived: a.archived,
  }));

  // ---- MoneyWiz budgets and sweeping
  tool("import_moneywiz_budgets", "Save MoneyWiz budgets into Hesed Ultra. Pass data.records from MoneyWiz read_financial_data (domain \"budgets\") exactly as returned. Safe to repeat: existing months are updated.", {
    records: z.array(z.record(z.string(), z.any())).describe("data.records from moneywiz_read_financial_data, unchanged"),
  }, (a) => svc.importMoneyWizBudgets(a.records as never));
  tool("import_moneywiz_transactions", "Save MoneyWiz transactions into Hesed Ultra. Pass evidence.rows and evidence.names from MoneyWiz list_transactions or inspect_result exactly as returned. Safe to repeat: rows already imported are updated, not duplicated.", {
    rows: z.array(z.record(z.string(), z.any())).describe("evidence.rows (or rows from inspect_result), unchanged"),
    names: z.object({ category: z.record(z.string(), z.string()).optional(), payee: z.record(z.string(), z.string()).optional(), account: z.record(z.string(), z.string()).optional() }).describe("evidence.names, unchanged"),
  }, (a) => svc.importMoneyWizTransactions(a.rows as never, a.names));
  tool("get_budget_month", "MoneyWiz budgets for a month: available, used, left over, already swept, and what can still be swept.", { month }, (a) => svc.budgetMonth(a.month), true);
  tool("get_leftovers", "Leftover budget money from finished months that has not been swept or left alone yet.", {}, () => svc.pendingLeftovers(), true);
  tool("sweep_leftover", "Move leftover money from a finished month's budget into a savings goal. Only do this when the user asks. Omit amount to sweep all that is left.", {
    budget_id: z.number().int().describe("id from get_leftovers or get_budget_month"), goal_id: z.number().int(), amount: pesos.optional(), note: z.string().optional(),
  }, (a) => svc.sweep({ budgetPeriodId: a.budget_id, goalId: a.goal_id, amountCents: a.amount === undefined ? undefined : toCents(a.amount), note: a.note ?? "" }));
  tool("undo_sweep", "Take back a sweep: the money returns to \"left over\" and leaves the goal.", { sweep_id: z.number().int(), confirm }, (a) => svc.undoSweep(a.sweep_id));
  tool("add_savings", "Put money into a savings goal, or take it out with a negative amount.", { goal_id: z.number().int(), date, amount: z.number().describe("Pesos. Positive = deposit, negative = withdrawal"), note: z.string().optional() }, (a) =>
    svc.addSavingsEntry({ goalId: a.goal_id, date: a.date, amountCents: toCents(a.amount), note: a.note ?? "" }));

  // Same text as the sync_moneywiz prompt, as a tool: apps that do not show MCP prompts
  // (or a plain "sync MoneyWiz" request) can fetch the steps this way.
  tool("get_sync_instructions", "Step-by-step instructions to copy MoneyWiz budgets and transactions into Hesed Ultra. Call this when asked to sync MoneyWiz, then follow the steps exactly using the MoneyWiz tools.", {
    months: z.number().int().min(1).max(24).optional().describe("How many months back, including this one (default 3)"),
  }, async (a) => ({ instructions: syncInstructions(a.months ?? 3) }), true);

  server.registerPrompt(
    "sync_moneywiz",
    {
      title: "Sync from MoneyWiz",
      description: "Copy budgets and transactions from MoneyWiz (on this Mac) into Hesed Ultra.",
      argsSchema: { months: z.string().optional().describe("How many months back, including this one (default 3)") },
    },
    ({ months }) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: syncInstructions(Number(months) || 3) } }] }),
  );

  return server;
}

/** Step-by-step instructions for an agent that has both the MoneyWiz and Hesed Ultra tools. */
export function syncInstructions(months = 3, today = new Date()) {
  const ym = (offset: number) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  // Manila midnight on the 1st, in UTC, is 16:00Z on the last day of the previous month.
  const bound = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, 1) - 8 * 3600_000).toISOString().replace(".000Z", "Z");
  };
  const list = Array.from({ length: months }, (_, i) => ym(i - months + 1));
  const ranges = list.map((m) => `- ${m}: start ${bound(m)}, end ${bound(ym(list.indexOf(m) - months + 2))}`).join("\n");
  return `Sync MoneyWiz into Hesed Ultra for these months (Manila time; end is exclusive):
${ranges}

Rules: MoneyWiz must be open on this Mac. Call MoneyWiz tools ONE AT A TIME, never in parallel (parallel calls come back empty). Pass MoneyWiz output to the Hesed Ultra tools unchanged; do not convert amounts or dates yourself.

1. Call moneywiz_open_context. Keep the contextID.
2. Budgets, for each month above: call moneywiz_read_financial_data with request {domain: "budgets", accountIDs: null, start, end, includeArchived: false, limit: 100, offset: 0}. If data.nextOffset is set, call again with that offset. Pass every data.records array to hesed import_moneywiz_budgets.
3. Transactions, for each month above: call moneywiz_list_transactions with limit 100 and query {start, end, timeZone: "Asia/Manila", filter: {operation: "all", field: null, values: [], children: []}}. Pass evidence.rows and evidence.names to hesed import_moneywiz_transactions. While evidence.coverage is "more_rows", call moneywiz_inspect_result with resultID = evidence.resultID, groupID null, cursor = the nextCursor, limit 100, and import those rows and names too.
4. Call moneywiz_release_context.
5. Call hesed get_leftovers and report, in pesos: each month synced (budgets created/updated, transactions created/updated), then the leftovers waiting to be swept. Do not sweep anything unless the user asks.

If a MoneyWiz call fails or a query shape is rejected, stop and show the exact error rather than guessing.`;
}
