#!/usr/bin/env node
/**
 * Add Hesed Ultra to the Claude desktop app (macOS), without using its Settings screen.
 *
 *   npm run desktop:add
 *
 * Edits ~/Library/Application Support/Claude/claude_desktop_config.json: keeps everything
 * already there, adds or updates only the "hesed" entry, and saves a backup first.
 * Then quit the Claude desktop app (Cmd+Q) and open it again.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const configPath = process.env.CLAUDE_DESKTOP_CONFIG || join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
const bridge = resolve(dirname(fileURLToPath(import.meta.url)), "..", "mcp", "bridge.mjs");

let config = {};
if (existsSync(configPath)) {
  const text = readFileSync(configPath, "utf8");
  try {
    config = text.trim() ? JSON.parse(text) : {};
  } catch {
    console.error(`Could not read ${configPath}: it is not valid JSON. Nothing was changed.`);
    process.exit(1);
  }
  const backup = `${configPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(configPath, backup);
  console.log(`Backup saved: ${backup}`);
} else {
  mkdirSync(dirname(configPath), { recursive: true });
}

config.mcpServers ??= {};
const before = JSON.stringify(config.mcpServers.hesed ?? null);
// process.execPath is the full path of the Node running this script, so the desktop app
// does not depend on Terminal's PATH to find it.
config.mcpServers.hesed = { command: process.execPath, args: [bridge] };
writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

console.log(before === JSON.stringify(config.mcpServers.hesed) ? "Hesed Ultra was already set up; nothing changed." : "Hesed Ultra added to the Claude desktop app.");
console.log(`  config: ${configPath}`);
console.log(`  node:   ${process.execPath}`);
console.log(`  bridge: ${bridge}`);
console.log(`Other entries kept: ${Object.keys(config.mcpServers).filter((k) => k !== "hesed").join(", ") || "(none)"}`);
console.log("\nNext: quit the Claude desktop app with Cmd+Q and open it again. That's all: Claude starts Hesed Ultra by itself when it needs it.");
