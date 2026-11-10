import { describe, expect, it } from "vitest";
import { createToken, checkToken, setPin, checkPin } from "../core/auth";
import { service } from "../core/service";
import { exportAll, importAll } from "./backup";
import { openDb } from "./client";

describe("backup", () => {
  it("moves everything to an empty database and keeps working there", async () => {
    const a = await openDb();
    const svc = service(a, { key: "diane", role: "parent" }, "app");
    const act = await svc.logActivity({ date: "2026-11-08", type: "worship", members: ["diane", "ellie"] });
    await svc.logTransaction({ date: "2026-11-08", amountCents: 50000, category: "tithes", activityId: act.id });
    await svc.setBudget({ month: "2026-11", category: "groceries", limitCents: 100 });
    const goal = await svc.createGoal({ name: "Trip", targetCents: 1000 });
    await svc.addSavingsEntry({ goalId: goal.id, date: "2026-11-08", amountCents: 400 });
    await setPin(a, "diane", "4821");
    const { token } = await createToken(a, "claude", "diane");

    const data = JSON.parse(JSON.stringify(await exportAll(a))); // as it would be read back from a file
    const b = await openDb();
    await importAll(b, data);

    const moved = service(b, { key: "diane", role: "parent" }, "app");
    expect(await moved.day("2026-11-08")).toEqual(await svc.day("2026-11-08"));
    expect(await moved.goals()).toEqual(await svc.goals());
    expect(await moved.monthSummary("2026-11")).toEqual(await svc.monthSummary("2026-11"));
    expect((await checkPin(b, "diane", "4821")).key).toBe("diane");
    expect((await checkToken(b, token))?.agent).toBe("claude");
    // new rows get fresh ids after the imported ones
    const next = await moved.logActivity({ date: "2026-11-09", type: "piano", members: ["ellie"] });
    expect(next.id).toBe(act.id + 1);
    // importing again into a database that has data is refused
    await expect(importAll(b, data)).rejects.toThrow(/Refusing to import/);
  });
});
