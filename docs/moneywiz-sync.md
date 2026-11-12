# Getting MoneyWiz data in

There are two ways. **Uploading a CSV is the simple one**; syncing through Claude also brings MoneyWiz's budgets in automatically.

## Option A: upload a CSV (no setup)

1. In MoneyWiz on the Mac: **File → Export → CSV**. Pick the accounts and the date range (all time is fine) and save the file.
2. In Hesed Ultra, on the **Budget** tab, press **⬆ Upload CSV** and choose the file. Check the preview: the number of transactions, the date range, and that the dates read correctly (switch the date order if they don't). Then press **Import**.
3. The export has no budgets, so add them once under **✎ Monthly budgets**: a name, the monthly amount (as set in MoneyWiz), and the categories it covers. Ticking a parent such as "Food & Dining" covers all its subcategories. "Track from" is the first month to check for leftovers.

Each month, the app adds up the spending in each budget's categories, minus refunds, and shows what's left. Finished months with money left appear under **Ready to sweep**.

To update, export again and upload. Overlapping exports are fine: transactions already in the app are recognised and skipped. Skipped on purpose: transfers between your own accounts, amounts in other currencies, and the account header rows MoneyWiz puts in the file.

Use one option or the other for transactions, not both: the two routes identify transactions differently, so using both would count spending twice.

## Option B: sync through Claude

MoneyWiz stays where you record spending and set budgets. Hesed Ultra copies the budgets and transactions in, then shows what each month left unspent so you can sweep it into savings goals.

The copying is done by Claude on your Mac, because only the Mac can reach MoneyWiz.

## One-time setup (on the Mac)

MoneyWiz's connector lives in the **Claude desktop app**, so the sync runs there. In Terminal:

```bash
cd "/Volumes/T7 Shield/Projects/Hesed_Ultra"
git pull && npm run setup
```

Then quit the Claude desktop app with **Cmd+Q** and open it again. That's all.

`npm run setup` installs what the app needs and adds Hesed Ultra to the desktop app's config file (`~/Library/Application Support/Claude/claude_desktop_config.json`). It keeps everything already there and saves a backup first. Running it again is harmless.

You don't need to start Hesed Ultra yourself. When Claude needs it, `mcp/bridge.mjs` starts it in the background and stops it when the desktop app closes.

## Each sync

With MoneyWiz open, ask in a new chat in the Claude desktop app:

> Sync MoneyWiz into Hesed Ultra for the last 12 months.

or, for everything MoneyWiz has:

> Sync MoneyWiz into Hesed Ultra for all time.

Claude reads each month's budgets and transactions from MoneyWiz, one call at a time, a calendar year per request, and imports them. Years before your MoneyWiz data starts just come back empty. At the end it lists the leftovers ready to sweep.

To see the result, double-click **Open Hesed Ultra.command** in the project folder. It opens the app in your browser, or just opens the page if Claude already started it.

Syncing again is always safe. Months already synced are updated to match MoneyWiz, and transactions are matched by their MoneyWiz ID, so nothing is duplicated.

**Claude Code instead of the desktop app:** this only works if MoneyWiz also offers a Claude Code connection. If it does, add Hesed Ultra with `claude mcp add --transport http hesed http://localhost:5173/mcp` (with the app running) and run `/mcp__hesed__sync_moneywiz 12`.

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
- **No hesed tools in the desktop app**: run `npm run setup` again, then fully quit (Cmd+Q) and reopen the app. Logs are in `~/Library/Logs/Claude/mcp-server-hesed.log`, and the app's own output is in `.data/server.log`.
- **"Port 5173 is already in use"** when starting it yourself: it's already running (Claude probably started it). Just open http://localhost:5173.
- **Empty results**: MoneyWiz calls were sent in parallel. Ask Claude to redo them one at a time; the sync prompt already says so.
- **"Only parents can import from MoneyWiz"**: the agent is acting as a child account. Locally it acts as Freznel unless `HESED_MCP_MEMBER` says otherwise.
- **A field or query is rejected**: the MoneyWiz connector may have changed. `docs/moneywiz-mcp-output-reference.md` records the shapes this was built against (contract version 0.9).
