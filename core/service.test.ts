import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../db/client";
import { checkPin, checkToken, createSession, createToken, listTokens, readSession, revokeToken, setPin } from "./auth";
import { Forbidden } from "./permissions";
import { service } from "./service";

let db: Db;
const diane = () => service(db, { key: "diane", role: "parent" }, "app");
const ellie = () => service(db, { key: "ellie", role: "child" }, "app");
const rafa = () => service(db, { key: "rafa", role: "child" }, "app");

beforeEach(async () => {
  db = await openDb();
});

describe("what children can and cannot do", () => {
  it("lets a child log and change their own activities only", async () => {
    const mine = await ellie().logActivity({ date: "2026-11-10", type: "piano", members: ["ellie"] });
    await ellie().updateActivity(mine.id, { date: "2026-11-10", type: "piano", members: ["ellie", "rafa"], mood: 4 });
    await expect(ellie().logActivity({ date: "2026-11-10", type: "work", members: ["freznel"] })).rejects.toThrow(Forbidden);
    const dads = await diane().logActivity({ date: "2026-11-10", type: "work", members: ["freznel"] });
    await expect(ellie().updateActivity(dads.id, { date: "2026-11-10", type: "work", members: ["ellie"] })).rejects.toThrow(Forbidden);
    await expect(ellie().deleteActivity(dads.id)).rejects.toThrow(Forbidden);
    // cannot remove herself to hand the activity to someone else
    await expect(ellie().updateActivity(mine.id, { date: "2026-11-10", type: "piano", members: ["rafa"] })).rejects.toThrow(Forbidden);
    await ellie().deleteActivity(mine.id);
  });

  it("keeps each child's spending private from the other, and budgets parent-only", async () => {
    const t = await ellie().logTransaction({ date: "2026-11-10", amountCents: 5000, category: "allowance", member: "ellie" });
    await diane().logTransaction({ date: "2026-11-10", amountCents: 900000, category: "groceries", member: "diane" });
    await expect(ellie().logTransaction({ date: "2026-11-10", amountCents: 100, category: "allowance", member: "rafa" })).rejects.toThrow(Forbidden);
    await expect(ellie().logTransaction({ date: "2026-11-10", amountCents: 100, category: "allowance" })).rejects.toThrow(Forbidden);
    await expect(rafa().deleteTransaction(t.id)).rejects.toThrow(Forbidden);

    expect((await ellie().day("2026-11-10")).transactions.map((x) => x.amountCents)).toEqual([5000]);
    expect((await rafa().day("2026-11-10")).transactions).toEqual([]);
    expect((await diane().day("2026-11-10")).spentCents).toBe(905000);
    expect((await rafa().calendar("2026-11")).days).toEqual([]);
    expect((await ellie().calendar("2026-11")).days[0].spentCents).toBe(5000);

    await expect(ellie().monthSummary("2026-11")).rejects.toThrow(Forbidden);
    await expect(ellie().setBudget({ month: "2026-11", category: "groceries", limitCents: 1 })).rejects.toThrow(Forbidden);
    await expect(ellie().createGoal({ name: "x", targetCents: 100 })).rejects.toThrow(Forbidden);
    await expect(ellie().changes()).rejects.toThrow(Forbidden);
    expect(await ellie().goals()).toEqual([]); // viewing goals is allowed
  });

  it("never exposes PIN data in the reference lists", async () => {
    await setPin(db, "ellie", "1234");
    const ref = await ellie().reference();
    expect(JSON.stringify(ref)).not.toMatch(/pinHash|pin_|pinFails/);
    expect(ref.members.map((m) => m.key)).toEqual(["freznel", "diane", "ellie", "rafa"]);
  });
});

describe("PINs, sessions and agent tokens", () => {
  it("checks PINs and locks after five wrong tries", async () => {
    await expect(checkPin(db, "ellie", "1234")).rejects.toThrow(/no PIN/);
    await expect(setPin(db, "ellie", "12")).rejects.toThrow(/4 to 8 digits/);
    await setPin(db, "ellie", "1234");
    expect(await checkPin(db, "ellie", "1234")).toEqual({ key: "ellie", role: "child" });
    for (let i = 0; i < 5; i++) await expect(checkPin(db, "ellie", "0000")).rejects.toThrow("Wrong PIN");
    await expect(checkPin(db, "ellie", "1234")).rejects.toThrow(/Too many/);
    const later = new Date(Date.now() + 6 * 60_000);
    expect((await checkPin(db, "ellie", "1234", later)).key).toBe("ellie");
  });

  it("lets a parent without a PIN in with the setup code, once", async () => {
    const code = "first-time-code";
    expect((await checkPin(db, "diane", code, new Date(), code)).key).toBe("diane");
    await expect(checkPin(db, "diane", "wrong-code", new Date(), code)).rejects.toThrow(/no PIN/);
    await expect(checkPin(db, "ellie", code, new Date(), code)).rejects.toThrow(/no PIN/); // children cannot use it
    await expect(checkPin(db, "diane", "short", new Date(), "short")).rejects.toThrow(/no PIN/); // too-short codes are ignored
    await setPin(db, "diane", "4821");
    await expect(checkPin(db, "diane", code, new Date(), code)).rejects.toThrow("Wrong PIN");
  });

  it("signs sessions and rejects tampered or expired ones", () => {
    const s = createSession("diane", "secret", 1000);
    expect(readSession(s, "secret", 2000)).toBe("diane");
    expect(readSession(s, "other-secret", 2000)).toBeNull();
    expect(readSession(s.replace("diane", "ellie"), "secret", 2000)).toBeNull();
    expect(readSession(s, "secret", 1000 + 31 * 86_400_000)).toBeNull();
    expect(readSession(undefined, "secret")).toBeNull();
    expect(readSession("garbage", "secret")).toBeNull();
  });

  it("creates, checks and revokes agent tokens, storing only a hash", async () => {
    const { token } = await createToken(db, "claude", "diane");
    expect(token).toMatch(/^hesed_/);
    expect(await checkToken(db, token)).toEqual({ key: "diane", role: "parent", agent: "claude" });
    expect(await checkToken(db, "hesed_wrong")).toBeNull();
    await expect(createToken(db, "claude", "diane")).rejects.toThrow(/already exists/);
    const [row] = await listTokens(db);
    expect(JSON.stringify(row)).not.toContain(token);
    await revokeToken(db, row.id);
    expect(await checkToken(db, token)).toBeNull();
  });

  it("labels agent changes in the audit log", async () => {
    const agent = service(db, { key: "diane", role: "parent", agent: "claude" }, "mcp");
    await agent.logTransaction({ date: "2026-11-10", amountCents: 100, category: "groceries" });
    expect((await diane().changes())[0]).toMatchObject({ actor: "claude (for diane)", source: "mcp" });
  });
});
