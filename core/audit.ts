import { desc } from "drizzle-orm";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import type { Ctx } from "./context";

export type Entity = "activity" | "transaction" | "budget" | "savings_goal" | "savings_entry" | "budget_period" | "budget_plan" | "sweep" | "import";

/** Record one change. Call it inside the same database transaction as the change itself. */
export async function record(
  tx: Pick<Db, "insert">,
  ctx: Pick<Ctx, "actor" | "source">,
  entity: Entity,
  entityId: number,
  action: "create" | "update" | "delete",
  before: unknown,
  after: unknown,
) {
  await tx.insert(schema.auditLog).values({
    actor: ctx.actor,
    source: ctx.source,
    entity,
    entityId,
    action,
    before: before ?? null,
    after: after ?? null,
  });
}

export function recentChanges(db: Db, limit = 50) {
  return db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.id)).limit(limit);
}
