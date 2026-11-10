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

  tool("list_goals", "Savings goals with progress.", {}, () => svc.goals(), true);
  tool("create_goal", "Create a savings goal.", { name: z.string(), target: pesos, target_date: date.optional() }, (a) =>
    svc.createGoal({ name: a.name, targetCents: toCents(a.target), targetDate: a.target_date }));
  tool("add_savings", "Put money into a savings goal, or take it out with a negative amount.", { goal_id: z.number().int(), date, amount: z.number().describe("Pesos. Positive = deposit, negative = withdrawal"), note: z.string().optional() }, (a) =>
    svc.addSavingsEntry({ goalId: a.goal_id, date: a.date, amountCents: toCents(a.amount), note: a.note ?? "" }));

  return server;
}
