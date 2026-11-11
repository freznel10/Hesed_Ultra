# MoneyWiz MCP tools: output reference

Observed on 2026-11-11 against MoneyWiz for Mac, contract version 0.9. All 11 tools were called read-only and all returned successfully. Field lists below are what the tools actually returned in that test; fields marked "not observed" come from the tool descriptions only.

Tool names are `moneywiz_<name>`. The server prefix depends on the host (in the test session it was `mcp__remote-devices__MoneyWiz__`; a local Claude Code install will typically expose `mcp__MoneyWiz__`).

## Things to know before calling

1. **MoneyWiz must be running on the Mac.** If it is closed, `open_context` fails with: `Open MoneyWiz and ask again. MoneyWiz must be open on this Mac.`
2. **Call the tools one at a time.** When five calls were sent in parallel, only the first returned a result; the other four came back empty ("This call has no result"). Each succeeded when re-run sequentially.
3. **Every response is wrapped** as `{"ok": true, "result": {...}}`. The sections below describe the contents of `result`.
4. **Money is a decimal string with a currency**, for example `{"amount": "3080", "currency": "PHP"}`. Missing values mean unknown, never zero.
5. **Dates are UTC instants** in the form `YYYY-MM-DDTHH:MM:SSZ`. Query `start` and `end` must be local midnight converted to UTC. For Asia/Manila that is `16:00:00Z` of the previous day (1 Oct Manila = `2026-09-30T16:00:00Z`). `end` is exclusive.
6. **An unfiltered query still needs a filter root:** `{"operation": "all", "field": null, "values": [], "children": []}`.
7. **Most results carry a `resultID`**, which is what `compare_results`, `inspect_result` and `show_chart` take as input.
8. **Contexts expire after 30 idle minutes.** The test context was granted the fields `category`, `financialDetails`, `memo`, `payee`, `tag`.

## 1. `open_context`

Input: none. Opens a session and returns the handle every other data tool needs.

| Field | Meaning |
|---|---|
| `contextID` | Session handle to pass to other tools |
| `accountIDs` | Array of every account ID the connection can read (33 in the test) |
| `capabilities` | Names of the available tools |
| `fields` | Data fields the connection is permitted to read |
| `defaultCurrency` | `PHP` in the test |
| `timeZone` | `Asia/Manila` in the test; use it as `query.timeZone` |
| `contractVersion` | `0.9` |
| `now`, `expiresAt` | Current time and context expiry (30 minutes later) |
| `snapshot` | `capturedAt`, `datasetID`, `id`, `incarnation`, `freshness`, `ratePolicy` |

## 2. `list_transactions`

Input: `contextID`, `limit` (1 to 100), `query`. Returns full-scope totals plus the first page of rows.

`result.analysis` has the same shape as the `analyze_transactions` result (section 3), plus `periodNotOver: true` when the range includes today.

`result.evidence`:

| Field | Meaning |
|---|---|
| `rows` | Transaction rows (shape below) |
| `names` | Lookup maps `account`, `category`, `payee`: ID to display name, for every ID on the page |
| `coverage` | `more_rows` when further pages exist |
| `nextCursor` | Cursor for the next page (pass to `inspect_result`) |
| `resultID` | ID of this result |

Row shape:

```json
{
  "transactionID": "FA50727F-...",
  "date": "2026-10-12T07:56:32Z",
  "kind": "expense",
  "status": "cleared",
  "isVoided": false,
  "accountID": "04121D97-...",
  "payeeID": "841f54e5...",
  "memo": "Haircut And Pedicure And Treatment",
  "tagIDs": [],
  "booked":     {"amount": "-3080", "currency": "PHP"},
  "attributed": {"amount": "3080",  "currency": "PHP"},
  "reported":   {"amount": "3080",  "currency": "PHP"},
  "allocations": [{"amount": "-3080", "categoryID": "D53C8CF8-..."}]
}
```

`booked` is signed (expenses negative). `attributed` and `reported` are positive for spending. `allocations` are the category split lines. `memo` is the transaction description followed by its notes.

## 3. `analyze_transactions`

Input: `contextID`, `query` (or `sourceResultID` plus `patches`), `patches` (use `[]` for a fresh query), `sourceResultID` (null for a fresh query). Returns totals for every matching transaction, optionally grouped.

| Field | Meaning |
|---|---|
| `resultID` | ID to feed into compare, inspect and chart |
| `totals` | `booked` (array, one entry per currency), `reported` (single amount in the reporting currency), `missingCurrencies` |
| `transactionCount`, `allocationCount` | Counts of matching transactions and split lines |
| `groups` | One entry per group: `id`, `label`, `totals` (same shape as above), `transactionCount` |
| `groupSumsMatchTotal`, `overlappingGroups` | Integrity flags for the grouping |
| `query` | Echo of the query as applied. Note `includeArchived: null` came back as `true` |
| `conversion` | `reportingCurrency`, `ratesAsOf`, `policy` (today's saved rates applied to every date) |
| `dataQuality` | `flaggedTransactions`, `byReason`, `excludedByReason`, `examples`, `legend`, `policy` |
| `semantics` | Plain-text rules on what the totals mean: `amountMeaning`, `pendingPolicy`, `transfers`, `exclusions`, `canInferCurrentBalance: false`, `guidance` |
| `coverage` | `all_matching_records` |
| `calculatedAt`, `snapshotID`, `contextID`, `accountingVersion`, `moneyPresentation`, `qualifyingReconciliationCount` | Metadata |

Group IDs with `grouping: "category"` look like `entity:<categoryID>`, and labels are category paths such as `Food & Dining > Groceries`. With `grouping: "none"`, `groups` is empty.

Test result (net spending, all accounts, grouped by category):

| Period | Total | Transactions | Groups |
|---|---|---|---|
| October 2026 | PHP 315,336.04 | 43 | 21 |
| September 2026 | PHP 210,082.73 | 31 | 16 |

## 4. `compare_results`

Input: `beforeResultID`, `afterResultID`, `axes` (the dimensions that intentionally differ: `dates` and/or `accounts`). No `contextID`.

| Field | Meaning |
|---|---|
| `totals` | Array with one entry per currency: `groupID: "total"`, `before`, `after`, `change`, `percentChange`, `currency` |
| `groups` | Same entry shape per group, keyed by `groupID`. Groups present in only one result appear with `"0"` on the other side |
| `notes` | Caveats, for example "The periods differ in length (30 vs 31 days); percent changes are not like for like." |
| `groupChangesAreAdditive`, `overlappingGroups` | Integrity flags |
| `percentages` | Rounding rule (6 decimal places, positive baseline only) |
| `resultID`, `beforeResultID`, `afterResultID`, `contextID` | IDs |

`percentChange` is omitted when the baseline is zero. Group entries carry IDs only, not labels; map them back through the source results' `groups[].label`.

Test result: October vs September total changed by PHP +105,253.31 (`percentChange` 50.100886).

## 5. `inspect_result`

Input: `resultID`, `groupID` (or null for the whole result), `cursor` (or null for the first page), `limit` (1 to 100). Pages through the transactions behind a result or one of its groups.

| Field | Meaning |
|---|---|
| `rows` | Same row shape as `list_transactions` |
| `names` | Same lookup maps (`account`, `category`, `payee`) |
| `coverage` | `end_of_result` when there are no more pages |
| `resultID` | The inspected result |

A next-page cursor was not observed because the test group had a single row. In the test, group `entity:506332_034` (Health Care > Dental) returned one PHP 52,000 expense.

## 6. `find_entities`

Input: `contextID`, `kind` (`account`, `category`, `payee`, `tag`, `group`), `text` (case-insensitive substring; empty lists the whole kind), `limit` (1 to 500), optional `offset`.

| Field | Meaning |
|---|---|
| `entities` | Matches sorted by name |
| `totalMatches` | Total number of matches |
| `truncated` | True when more matches exist than were returned |
| `nextOffset` | Offset for the next page |

Account entity shape:

```json
{
  "id": "439DE174-...",
  "kind": "account",
  "name": "...",
  "path": "...",
  "accountType": "checking",
  "currency": "PHP",
  "archived": false,
  "accountCount": 1
}
```

Other kinds were not tested. Per the tool description, categories also carry `categoryType` (expense or income) and a `Parent > Child` path, and groups carry `memberAccountIDs`.

Test result: `kind: "account"`, `text: "BDO"`, `limit: 3` returned 3 of 5 matches, with `truncated: true` and `nextOffset: 3`.

## 7. `read_financial_data`

Input: `contextID`, `request` with `domain` (`accounts`, `netWorth`, `holdings`, `investmentActivity`, `budgets`, `schedules`, `loans`), `accountIDs` (null for all), `start`, `end`, `includeArchived`, `limit`, `offset`. Only the `budgets` domain was tested.

| Field | Meaning |
|---|---|
| `data.records` | The records for the domain |
| `data.totalRecords` | Total available (13 budgets in the test) |
| `data.nextOffset` | Offset for the next page |
| `data.semantics` | Plain-text field definitions for the domain |
| `data.warnings` | Array of warnings (empty in the test) |
| `request` | Echo of the request as applied |
| `coverage`, `resultID`, `snapshot`, `contextID` | Metadata |

Budget record shape:

```json
{
  "id": "14A17663-...:87",
  "kind": "budget",
  "name": "Medical and Meds",
  "text": {"budgetType": "expense", "timeZone": "Asia/Manila"},
  "dates": {
    "periodStart": "2026-10-31T16:00:00Z",
    "periodEndExclusive": "2026-11-30T16:00:00Z",
    "screenPeriodStart": "2026-10-31T16:00:00Z",
    "screenPeriodEnd": "2026-11-30T16:00:00Z"
  },
  "money": {
    "planned":   {"amount": "15000",  "currency": "PHP"},
    "available": {"amount": "15000",  "currency": "PHP"},
    "used":      {"amount": "5162.3", "currency": "PHP"},
    "remaining": {"amount": "9837.7", "currency": "PHP"},
    "budgetsScreenAvailable": {"amount": "15000",  "currency": "PHP"},
    "budgetsScreenUsed":      {"amount": "5162.3", "currency": "PHP"},
    "budgetsScreenRemaining": {"amount": "9837.7", "currency": "PHP"}
  },
  "quantities": {"daysLeft": "20", "periodIndex": "87"},
  "flags": {
    "currentPeriod": true, "repeating": true, "carryover": false,
    "exceeded": false, "low": false,
    "includesCleared": true, "includesPending": true, "includesScheduled": false,
    "monitorsAccountsOutsideSelection": false
  },
  "references": {"categoryIDs": ["..."], "monitoredAccountIDs": ["..."]},
  "referenceDetails": {"categories": [{"id": "...", "name": "Medical"}]},
  "accountIDs": ["..."],
  "unavailable": {}
}
```

The `budgetsScreen*` figures are the ones MoneyWiz's own Budgets screen shows; the tool description says to report those for "how is my budget" questions. `planned` is the period allocation, `available` adds carryover and budget transfers, and `remaining` is `available` minus `used`.

## 8. `get_quote`

Input: `contextID`, `assetType` (`stock`, `crypto`, `currency`), `symbols` (up to 20), `currency`. This is the only tool that fetches live data.

| Field | Meaning |
|---|---|
| `quotes` | One entry per symbol |
| `source` | `MoneyWiz rates service` |
| `fetchedAt`, `policy`, `assetType`, `resultID`, `contextID` | Metadata |

Quote shape (currency):

```json
{
  "symbol": "USD",
  "company": "US Dollar",
  "currency": "PHP",
  "price": {"amount": "63.209994", "currency": "PHP"},
  "asOf": "2026-11-11T01:30:27Z",
  "fetchedAt": "2026-11-11T01:30:27Z",
  "cached": true
}
```

When `cached` is true, state how old the figure is. Stock quotes were not tested; per the tool description they add change, changePercent, open, high, low, volume and 52-week range.

## 9. `help`

Input: `englishQuestion`, optional `articleIDs`. No `contextID`. Searches the help center bundled with the app.

| Field | Meaning |
|---|---|
| `articles` | Up to 3 full articles: `id`, `title`, `group`, `url`, `text` (full body, can be long) |
| `relatedArticles` | Titles only: `id`, `title`, `group`, `url` |
| `settings` | Matching app settings: `id`, `title`, `path` (for example `Preferences › Info Cards`) |
| `coverage` | Match strength. The test question "How do I create a budget?" returned `weak` |
| `guidance` | Instructions on how to answer from the articles |
| `support` | `email` (hello@wiz.money), `emailLink`, `chatLink` (https://help.wiz.money), `chatInApp` |
| `platform`, `helpCenterCopy` | `Mac`, and the date of the bundled help copy (`2026-11-06`) |

To read a related article in full, call again with its ID in `articleIDs`.

## 10. `show_chart`

Input: `contextID`, `series` (each with `label`, `unit`, `points` of `x` and `y`, plus `currency`, `basedOn`, `method`), optional `kind` (`bar`, `horizontalBar`, `line`, `pie`, `table`) and `title`. Renders a chart in the host UI and returns the validated spec.

| Field | Meaning |
|---|---|
| `chart.chartID`, `chart.version` | Chart identity |
| `chart.kind`, `chart.title`, `chart.axis` | Final chart type (MoneyWiz may change it), title, axis type (`category` in the test) |
| `chart.x` | Resolved x-axis entries: `id` and human-readable `label` |
| `chart.series` | `label`, `unit`, `currency`, `values` (array aligned with `x`), `provenance` (`moneywiz` when values match the source result) |
| `chart.basedOn` | Source results: `resultID`, `kind`, `asOf` |
| `chart.warnings` | Validation warnings (empty in the test) |
| `shown` | Text confirming the chart was displayed to the user |

For `x`, pass the group IDs from the source result (for example `entity:506332_031`); the tool resolves them to labels. For `y`, copy the decimal strings exactly as returned.

## 11. `release_context`

Input: `contextID`. Returns `{"released": true}`. Optional, since contexts expire on their own.

## Typical call sequence

1. `open_context` to get `contextID`, `timeZone` and `defaultCurrency`.
2. `find_entities` if a name needs resolving to an ID.
3. `analyze_transactions` or `list_transactions` for transaction questions; `read_financial_data` for balances, budgets, schedules, holdings and loans.
4. `inspect_result` to page through the rows behind a total; `compare_results` for period-over-period.
5. `show_chart` if a visual helps, using the `resultID` values from step 3.

## Not covered by the test

- `read_financial_data` domains other than `budgets`
- `find_entities` kinds other than `account`
- `get_quote` for stocks and crypto
- `analyze_transactions` with `patches` against a prior result
- `inspect_result` pagination beyond the first page
- Any error responses other than the "app not open" case
