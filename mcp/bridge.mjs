#!/usr/bin/env node
/**
 * Lets apps that only start local MCP programs (like the Claude desktop app) talk to
 * Hesed Ultra's /mcp endpoint. It reads MCP messages on stdin, posts each to the running
 * app, and writes the replies to stdout. No dependencies; plain Node 18+.
 *
 *   node mcp/bridge.mjs                       → http://localhost:5173/mcp
 *   HESED_URL=https://site/mcp HESED_TOKEN=… node mcp/bridge.mjs
 *
 * The app must be running (npm run dev). Logs go to stderr, never stdout.
 */
import { createInterface } from "node:readline";

const URL_ = process.env.HESED_URL || "http://localhost:5173/mcp";
const TOKEN = process.env.HESED_TOKEN;
const log = (...a) => process.stderr.write(`[hesed-bridge] ${a.join(" ")}\n`);

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const fail = (id, message) => id !== undefined && id !== null && send({ jsonrpc: "2.0", id, error: { code: -32000, message } });

let queue = Promise.resolve();
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  // keep replies in order, one request at a time
  queue = queue.then(async () => {
    let msg;
    try { msg = JSON.parse(line); } catch { return log("ignored a line that is not JSON"); }
    try {
      const res = await fetch(URL_, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
        body: line,
      });
      const text = await res.text();
      if (!text.trim()) return; // notifications get no reply
      const body = JSON.parse(text);
      for (const m of Array.isArray(body) ? body : [body]) send(m);
    } catch (err) {
      log(`could not reach ${URL_}: ${err.message}`);
      fail(msg.id, `Hesed Ultra is not reachable at ${URL_}. Start it with "npm run dev" in the project folder, then try again.`);
    }
  });
});
process.stdin.on("end", () => queue.then(() => process.exit(0)));
log(`relaying to ${URL_}`);
