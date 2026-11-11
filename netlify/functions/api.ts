import type { Config } from "@netlify/functions";
import { ZodError } from "zod";
import { checkPin, createSession, createToken, listTokens, readSession, revokeToken, setPin } from "../../core/auth";
import { InputError, lookup } from "../../core/context";
import { assertSafe, loginRequired, Misconfigured, sessionSecret } from "../../core/mode";
import { can, Forbidden, type User } from "../../core/permissions";
import { service, type Service } from "../../core/service";
import { getDb, type Db } from "../../db/client";

/**
 * The web app's API. Thin by design: work out who is asking, then call core/service.
 *
 * Who is asking:
 *  - Local use: the app says who is using it in the x-member header (the "Who's here?"
 *    picker). No PIN needed on your own machine.
 *  - Online: a signed cookie from logging in with a PIN. See core/mode.ts.
 */
const COOKIE = "hesed_session";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

class Unauthorized extends Error {}

async function whoIs(req: Request, db: Db): Promise<User | null> {
  let key: string | null;
  const SECRET = sessionSecret();
  if (loginRequired() && SECRET) {
    const cookie = req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
    key = readSession(cookie?.slice(COOKIE.length + 1), SECRET);
  } else {
    key = req.headers.get("x-member");
  }
  if (!key) return null;
  const member = await lookup.member(db, key).catch(() => null);
  return member?.active ? { key: member.key, role: member.role } : null;
}

type Handler = (c: { svc: Service; db: Db; body: any; params: string[]; user: User }) => unknown;
const num = (s: string) => {
  const n = Number(s);
  if (!Number.isInteger(n)) throw new InputError("Bad id");
  return n;
};

const routes: [method: string, pattern: RegExp, handler: Handler][] = [
  ["GET", /^\/reference$/, ({ svc }) => svc.reference()],
  ["GET", /^\/day\/([\d-]+)$/, ({ svc, params }) => svc.day(params[0])],
  ["GET", /^\/calendar\/([\d-]+)$/, ({ svc, params }) => svc.calendar(params[0])],
  ["POST", /^\/activities$/, ({ svc, body }) => svc.logActivity(body)],
  ["PUT", /^\/activities\/(\d+)$/, ({ svc, body, params }) => svc.updateActivity(num(params[0]), body)],
  ["DELETE", /^\/activities\/(\d+)$/, ({ svc, params }) => svc.deleteActivity(num(params[0]))],
  ["POST", /^\/transactions$/, ({ svc, body }) => svc.logTransaction(body)],
  ["PUT", /^\/transactions\/(\d+)$/, ({ svc, body, params }) => svc.updateTransaction(num(params[0]), body)],
  ["DELETE", /^\/transactions\/(\d+)$/, ({ svc, params }) => svc.deleteTransaction(num(params[0]))],
  ["GET", /^\/month\/([\d-]+)$/, async ({ svc, params }) => ({
    summary: svc.user.role === "parent" ? await svc.monthSummary(params[0]) : null,
    transactions: await svc.monthTransactions(params[0]),
  })],
  ["PUT", /^\/budgets$/, ({ svc, body }) => svc.setBudget(body)],
  ["GET", /^\/goals$/, ({ svc }) => svc.goals()],
  ["POST", /^\/goals$/, ({ svc, body }) => svc.createGoal(body)],
  ["POST", /^\/savings$/, ({ svc, body }) => svc.addSavingsEntry(body)],
  ["GET", /^\/changes$/, ({ svc }) => svc.changes(100)],
  ["PUT", /^\/goals\/(\d+)$/, ({ svc, body, params }) => svc.updateGoal(num(params[0]), body)],
  ["GET", /^\/budget\/([\d-]+)$/, ({ svc, params }) => svc.budgetOverview(params[0])],
  ["POST", /^\/sweeps$/, ({ svc, body }) => svc.sweep(body)],
  ["DELETE", /^\/sweeps\/(\d+)$/, ({ svc, params }) => svc.undoSweep(num(params[0]))],
  ["PUT", /^\/budget-periods\/(\d+)\/leave-alone$/, ({ svc, body, params }) => svc.leaveAlone(num(params[0]), Boolean(body?.value))],
  ["POST", /^\/import\/moneywiz$/, async ({ svc, body }) => ({
    budgets: Array.isArray(body?.budgets) ? await svc.importMoneyWizBudgets(body.budgets) : null,
    transactions: Array.isArray(body?.rows) ? await svc.importMoneyWizTransactions(body.rows, body.names ?? {}) : null,
  })],
  ["PUT", /^\/members\/([\w-]+)\/pin$/, async ({ db, user, body, params }) => {
    if (params[0] !== user.key) can.parentOnly(user, "set someone else's PIN");
    await setPin(db, params[0], String(body?.pin ?? ""));
    return { ok: true };
  }],
  ["GET", /^\/tokens$/, ({ db, user }) => (can.parentOnly(user, "manage agent tokens"), listTokens(db))],
  ["POST", /^\/tokens$/, ({ db, user, body }) => (can.parentOnly(user, "manage agent tokens"), createToken(db, String(body?.name ?? ""), String(body?.member ?? user.key)))],
  ["DELETE", /^\/tokens\/(\d+)$/, async ({ db, user, params }) => {
    can.parentOnly(user, "manage agent tokens");
    await revokeToken(db, num(params[0]));
    return { ok: true };
  }],
];

export default async (req: Request) => {
  const path = new URL(req.url).pathname.replace(/^\/api/, "") || "/";
  try {
    assertSafe();
    const SECRET = sessionSecret();
    const db = await getDb();
    const body = req.method === "GET" || req.method === "DELETE" ? undefined : await req.json().catch(() => ({}));

    // --- endpoints that work before signing in
    if (path === "/health") return json({ ok: true, time: new Date().toISOString() });
    if (path === "/session" && req.method === "GET") {
      const user = await whoIs(req, db);
      const { members } = await service(db, { key: "", role: "child" }, "app").reference();
      return json({ loginRequired: loginRequired(), user, members });
    }
    if (path === "/login" && req.method === "POST") {
      if (!SECRET) throw new InputError("Logging in is only needed online");
      const user = await checkPin(db, String(body?.member ?? ""), String(body?.pin ?? ""), new Date(), process.env.SETUP_CODE);
      const cookie = `${COOKIE}=${createSession(user.key, SECRET)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`;
      return json({ user }, 200, { "set-cookie": cookie });
    }
    if (path === "/logout" && req.method === "POST") {
      return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
    }

    // --- everything else needs to know who is asking
    const user = await whoIs(req, db);
    if (!user) throw new Unauthorized();
    for (const [method, pattern, handler] of routes) {
      const m = req.method === method && path.match(pattern);
      if (m) return json((await handler({ svc: service(db, user, "app"), db, body, params: m.slice(1), user })) ?? { ok: true });
    }
    return json({ error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof Misconfigured) return json({ error: err.message }, 503);
    if (err instanceof Unauthorized) return json({ error: "Please sign in" }, 401);
    if (err instanceof Forbidden) return json({ error: err.message }, 403);
    if (err instanceof InputError) return json({ error: err.message }, 400);
    if (err instanceof ZodError) {
      return json({ error: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, 400);
    }
    console.error(err);
    return json({ error: "Something went wrong on the server" }, 500);
  }
};

export const config: Config = { path: "/api/*" };
