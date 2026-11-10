import type { Config } from "@netlify/functions";
import { getDb, schema } from "../../db/client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req: Request) => {
  const path = new URL(req.url).pathname.replace(/^\/api/, "") || "/";
  try {
    const db = await getDb();
    if (path === "/health") {
      const members = await db.select().from(schema.members);
      return json({ ok: true, db: "pglite", members: members.length, time: new Date().toISOString() });
    }
    if (path === "/members") return json(await db.select().from(schema.members));
    if (path === "/places") return json(await db.select().from(schema.places));
    if (path === "/activity-types") return json(await db.select().from(schema.activityTypes));
    return json({ error: "not found" }, 404);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err) }, 500);
  }
};

export const config: Config = { path: "/api/*" };
