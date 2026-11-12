#!/usr/bin/env node
/**
 * Lets apps that only start local MCP programs (like the Claude desktop app) talk to
 * Hesed Ultra's /mcp endpoint. It reads MCP messages on stdin, posts each to the app,
 * and writes the replies to stdout. No dependencies; plain Node 18+.
 *
 * If the app is not running on this computer, the bridge starts it (and stops it again
 * when the desktop app closes), so nobody has to run `npm run dev` first.
 *
 *   node mcp/bridge.mjs                       → http://localhost:5173/mcp
 *   HESED_URL=https://site/mcp HESED_TOKEN=… node mcp/bridge.mjs
 *
 * Logs go to stderr (and the started app's output to .data/server.log), never stdout.
 */
import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const URL_ = process.env.HESED_URL || "http://localhost:5173/mcp";
const TOKEN = process.env.HESED_TOKEN;
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1):5173\//.test(URL_);
const log = (...a) => process.stderr.write(`[hesed-bridge] ${a.join(" ")}\n`);

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const fail = (id, message) => id !== undefined && id !== null && send({ jsonrpc: "2.0", id, error: { code: -32000, message } });

const healthy = () => fetch(new URL("/api/health", URL_), { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);

let server = null;
let starting = null;
/** Make sure the app is up; start it from this project folder if it is not. */
function ensureRunning() {
  if (!LOCAL) return Promise.resolve(true);
  starting ??= (async () => {
    if (await healthy()) return true;
    mkdirSync(join(ROOT, ".data"), { recursive: true });
    const out = openSync(join(ROOT, ".data", "server.log"), "a");
    log("app not running; starting it");
    server = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js")], { cwd: ROOT, stdio: ["ignore", out, out] });
    server.on("exit", (code) => { log(`app stopped (${code})`); server = null; starting = null; });
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await healthy()) return true;
    }
    return false;
  })();
  return starting;
}

let queue = Promise.resolve();
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  // keep replies in order, one request at a time
  queue = queue.then(async () => {
    let msg;
    try { msg = JSON.parse(line); } catch { return log("ignored a line that is not JSON"); }
    try {
      if (!(await ensureRunning())) throw new Error("the app did not start; see .data/server.log");
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
      fail(msg.id, `Hesed Ultra could not be reached at ${URL_} (${err.message}).`);
    }
  });
});
const stop = () => { server?.kill(); process.exit(0); };
process.stdin.on("end", () => queue.then(stop));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
log(`relaying to ${URL_}`);
