import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { service } from "../core/service";
import { type Db, openDb } from "../db/client";
import { buildMcpServer } from "./tools";

let db: Db;
let client: Client;

async function connect(user: { key: string; role: "parent" | "child" }) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildMcpServer(service(db, { ...user, agent: "claude" }, "mcp")).connect(a);
  client = new Client({ name: "test", version: "1" });
  await client.connect(b);
}
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  return { isError: Boolean(res.isError), text: res.content[0].text, data: res.isError ? null : JSON.parse(res.content[0].text) };
};

beforeEach(async () => {
  db = await openDb();
  await connect({ key: "diane", role: "parent" });
});

describe("MCP tools", () => {
  it("lists the tools with descriptions", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["get_reference", "log_activity", "log_expense", "get_month_summary", "add_savings"]));
    expect(tools.every((t) => t.description)).toBe(true);
  });

  it("logs a day through tools and the app sees it", async () => {
    const ref = await call("get_reference");
    expect(ref.data.members.map((m: { key: string }) => m.key)).toContain("ellie");
    const a = await call("log_activity", { date: "2026-11-08", type: "dining_out", members: ["freznel", "diane", "ellie", "rafa"], place: "mall_festival", start_time: "12:00", end_time: "13:30" });
    expect(a.data).toMatchObject({ title: "Dining out", place: "mall_festival" });
    const t = await call("log_expense", { date: "2026-11-08", amount: 2350.5, category: "dining_out", payee: "Festival Mall", activity_id: a.data.id });
    expect(t.data).toMatchObject({ amount: "₱2,350.50", category: "dining_out" });
    expect(t.data.amountCents).toBeUndefined(); // agents only see pesos

    const app = service(db, { key: "diane", role: "parent" }, "app");
    const day = await app.day("2026-11-08");
    expect(day.activities).toHaveLength(1);
    expect(day.spentCents).toBe(235050);
    expect((await app.changes())[0]).toMatchObject({ actor: "claude (for diane)", source: "mcp" });
  });

  it("answers budget questions in pesos", async () => {
    await call("set_budget", { month: "2026-11", category: "groceries", limit: 10000 });
    await call("log_expense", { date: "2026-11-03", amount: 8500, category: "groceries" });
    const s = await call("get_month_summary", { month: "2026-11" });
    expect(s.data.categories[0]).toMatchObject({ category: "groceries", spent: "₱8,500.00", remaining: "₱1,500.00", status: "warning" });
  });

  it("handles savings", async () => {
    const g = await call("create_goal", { name: "Emergency fund", target: 100000 });
    await call("add_savings", { goal_id: g.data.id, date: "2026-11-01", amount: 5000 });
    const over = await call("add_savings", { goal_id: g.data.id, date: "2026-11-02", amount: -6000 });
    expect(over.isError).toBe(true);
    expect(over.text).toMatch(/only has ₱5,000.00 saved/);
    expect((await call("list_goals")).data[0]).toMatchObject({ saved: "₱5,000.00", percent: 5 });
  });

  it("returns clear errors instead of crashing", async () => {
    expect((await call("log_activity", { date: "2026-11-08", type: "surfing", members: ["ellie"] })).text).toMatch(/Unknown activity type/);
    expect((await call("log_activity", { date: "8 Nov", type: "piano", members: ["ellie"] })).text).toMatch(/YYYY-MM-DD/);
    expect((await call("delete_activity", { id: 1 })).isError).toBe(true); // confirm missing
    expect((await call("delete_activity", { id: 99, confirm: true })).text).toMatch(/No activity/);
  });

  it("applies a child's limits to an agent acting for a child", async () => {
    await connect({ key: "ellie", role: "child" });
    expect((await call("get_month_summary", { month: "2026-11" })).text).toMatch(/Only parents/);
    expect((await call("log_expense", { date: "2026-11-08", amount: 50, category: "allowance", member: "rafa" })).text).toMatch(/your own spending/);
    expect((await call("log_expense", { date: "2026-11-08", amount: 50, category: "allowance", member: "ellie" })).isError).toBe(false);
  });
});
