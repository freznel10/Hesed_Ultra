import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Config } from "@netlify/functions";
import { checkToken } from "../../core/auth";
import { lookup } from "../../core/context";
import { assertSafe, loginRequired, Misconfigured } from "../../core/mode";
import type { User } from "../../core/permissions";
import { service } from "../../core/service";
import { getDb, type Db } from "../../db/client";
import { buildMcpServer } from "../../mcp/tools";

/**
 * MCP endpoint for Claude and other agents, at /mcp.
 *
 * Online: needs "Authorization: Bearer <token>" with a token a parent
 * created in Settings. The agent acts as that parent.
 * Local: no token needed. The agent acts as the member named in
 * HESED_MCP_MEMBER, or the first parent.
 */
const deny = (status: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }), { status, headers: { "content-type": "application/json" } });

async function agentFor(req: Request, db: Db): Promise<User | null> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) return checkToken(db, bearer);
  if (loginRequired()) return null;
  const member = await lookup.member(db, process.env.HESED_MCP_MEMBER ?? "freznel").catch(() => null);
  return member ? { key: member.key, role: member.role, agent: "claude" } : null;
}

export default async (req: Request) => {
  if (req.method !== "POST") return deny(405, "Use POST");
  try {
    assertSafe();
  } catch (err) {
    return deny(503, (err as Misconfigured).message);
  }
  const db = await getDb();
  const user = await agentFor(req, db);
  if (!user) return deny(401, "A valid agent token is required");
  // Stateless: a fresh server per request, answered as plain JSON.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await buildMcpServer(service(db, user, "mcp")).connect(transport);
  return transport.handleRequest(req);
};

export const config: Config = { path: "/mcp" };
