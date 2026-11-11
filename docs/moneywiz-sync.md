# Syncing from MoneyWiz

MoneyWiz stays where you record spending and set budgets. Hesed Ultra copies the budgets and transactions in, then shows what each month left unspent so you can sweep it into savings goals.

The copying is done by Claude on your Mac, because only the Mac can reach MoneyWiz.

## One-time setup (on the Mac)

1. Start Hesed Ultra: `npm run dev` in the project folder.
2. Connect it to Claude Code:
   ```bash
   claude mcp add --transport http hesed http://localhost:5173/mcp
   ```
3. Check the MoneyWiz connector is also available in Claude Code (`/mcp` lists both `hesed` and `MoneyWiz`).

## Each sync

1. Open MoneyWiz (it must be running).
2. In Claude Code, type:
   ```
   /mcp__hesed__sync_moneywiz
   ```
   It covers this month and the two before. For more, give a number, e.g. `/mcp__hesed__sync_moneywiz 6`.
3. Claude reads each month's budgets and transactions from MoneyWiz, one call at a time, and passes them to Hesed Ultra unchanged. At the end it lists what was created or updated and which leftovers are ready to sweep.

Syncing again is always safe. Months already synced are updated to match MoneyWiz, and transactions are matched by their MoneyWiz ID, so nothing is duplicated.

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
- **Empty results**: MoneyWiz calls were sent in parallel. Ask Claude to redo them one at a time; the sync prompt already says so.
- **"Only parents can import from MoneyWiz"**: the agent is acting as a child account. Locally it acts as Freznel unless `HESED_MCP_MEMBER` says otherwise.
- **A field or query is rejected**: the MoneyWiz connector may have changed. `docs/moneywiz-mcp-output-reference.md` records the shapes this was built against (contract version 0.9).
