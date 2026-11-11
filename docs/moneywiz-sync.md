# Syncing from MoneyWiz

MoneyWiz stays where you record spending and set budgets. Hesed Ultra copies the budgets and transactions in, then shows what each month left unspent so you can sweep it into savings goals.

The copying is done by Claude on your Mac, because only the Mac can reach MoneyWiz.

## One-time setup (on the Mac)

MoneyWiz's connector is installed in the **Claude desktop app**, so the sync runs there. Hesed Ultra is added to the desktop app alongside it.

1. Start Hesed Ultra and leave it running: `npm run dev` in the project folder.
2. Find your Node path. In Terminal, run `which node`. It prints something like `/opt/homebrew/bin/node`.
3. In the Claude desktop app, open **Settings → Developer → Edit Config**. That opens `~/Library/Application Support/Claude/claude_desktop_config.json`. Add a `hesed` entry inside `"mcpServers"`, using your Node path from step 2. Keep any entries already there:
   ```json
   {
     "mcpServers": {
       "hesed": {
         "command": "/opt/homebrew/bin/node",
         "args": ["/Volumes/T7 Shield/Projects/Hesed_Ultra/mcp/bridge.mjs"]
       }
     }
   }
   ```
4. Quit the Claude desktop app completely (Cmd+Q) and open it again. In a new chat, the tools menu should list both **hesed** and **MoneyWiz**.

`mcp/bridge.mjs` passes messages between the desktop app and the running Hesed Ultra at `http://localhost:5173/mcp`. If the app isn't running, Claude gets the message "Start it with npm run dev".

## Each sync

1. Make sure Hesed Ultra (`npm run dev`) and MoneyWiz are both open.
2. In a new chat in the Claude desktop app, ask:
   > Sync MoneyWiz into Hesed Ultra for the last 12 months.

   Claude calls `get_sync_instructions` on Hesed Ultra, then follows the steps: it reads each month's budgets and transactions from MoneyWiz, one call at a time, and passes them over unchanged. At the end it lists what was created or updated and which leftovers are ready to sweep.

Syncing again is always safe. Months already synced are updated to match MoneyWiz, and transactions are matched by their MoneyWiz ID, so nothing is duplicated.

**Claude Code instead of the desktop app:** this only works if MoneyWiz also offers a Claude Code connection (check MoneyWiz → Preferences). If it does, add Hesed Ultra with `claude mcp add --transport http hesed http://localhost:5173/mcp` and run `/mcp__hesed__sync_moneywiz 12`.

## What gets copied

| From MoneyWiz | Into Hesed Ultra |
|---|---|
| Expense budgets, per month: available, used, remaining (the Budgets-screen figures) | Budget tab, one card per budget |
| Expense and income transactions, split by category | Spending tab, and the day view |
| Transfers, voided transactions, income budgets | Skipped |

Categories are created automatically from MoneyWiz category paths (e.g. `Food & Dining > Groceries`).

## Sweeping

On the Budget tab, once a month is over, any budget with money left shows a **Sweep** button. Choose a goal and an amount (the default is everything left). The sweep is recorded as a deposit to that goal, marked as coming from the budget.

- A leftover can't be swept twice, and a month can't be swept before it ends.
- **Leave it** hides a leftover you've decided not to move. You can bring it back later.
- **Undo** on a sweep returns the money to "left over".
- If a late transaction later shrinks a leftover you already swept, the sweep stays and the card shows nothing more to sweep.

Sweeping only records the move in this app. Make the actual transfer in your bank, and in MoneyWiz if you track it there.

Claude can also sweep for you if you ask ("sweep October's leftovers into the Emergency fund"). It never sweeps on its own.

## Try it without MoneyWiz

```bash
npm run demo
```

This starts the app on a separate demo database (`.data/demo`) with made-up budgets, transactions and goals. Your real data is not touched.

## Troubleshooting

- **"Open MoneyWiz and ask again"**: MoneyWiz is closed. Open it and run the sync again.
- **No MoneyWiz tools in Claude Code**: MoneyWiz is connected to the desktop app, not Claude Code. Run the sync from the desktop app as described above.
- **No hesed tools in the desktop app**: check the config file is valid JSON, the Node path is right (`which node`), and you fully quit and reopened the app. Logs are in `~/Library/Logs/Claude/mcp-server-hesed.log`.
- **Empty results**: MoneyWiz calls were sent in parallel. Ask Claude to redo them one at a time; the sync prompt already says so.
- **"Only parents can import from MoneyWiz"**: the agent is acting as a child account. Locally it acts as Freznel unless `HESED_MCP_MEMBER` says otherwise.
- **A field or query is rejected**: the MoneyWiz connector may have changed. `docs/moneywiz-mcp-output-reference.md` records the shapes this was built against (contract version 0.9).
