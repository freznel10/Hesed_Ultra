/**
 * Made-up MoneyWiz data in the exact shapes the MoneyWiz MCP returns
 * (see docs/moneywiz-mcp-output-reference.md). Used by tests and `npm run demo`.
 * None of these figures are real.
 */
import type { MoneyWizBudget, MoneyWizNames, MoneyWizRow } from "../../core/moneywiz";

const P = (amount: string) => ({ amount, currency: "PHP" });

/** Month "2026-10" → its Manila period as MoneyWiz reports it (local midnight in UTC). */
function period(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - 8 * 3600_000).toISOString().replace(".000", "");
  const end = new Date(Date.UTC(y, m, 1) - 8 * 3600_000).toISOString().replace(".000", "");
  return { periodStart: start, periodEndExclusive: end, screenPeriodStart: start, screenPeriodEnd: end };
}

const BUDGETS: [id: string, name: string, planned: string, category: string][] = [
  ["B-GROCERIES", "Groceries", "25000", "Food & Dining > Groceries"],
  ["B-DINING", "Dining Out", "12000", "Food & Dining > Restaurants"],
  ["B-MEDICAL", "Medical and Meds", "15000", "Health Care > Medical"],
  ["B-TRANSPORT", "Gas and Transport", "10000", "Auto & Transport > Gas & Fuel"],
  ["B-KIDS", "Kids School and Lessons", "18000", "Education > Tuition"],
  ["B-HOUSEHOLD", "Household", "8000", "Home > Supplies"],
];

/** used amounts per month: [Oct, Nov] */
const USED: Record<string, [string, string]> = {
  "B-GROCERIES": ["21450.75", "9120.4"],
  "B-DINING": ["14380", "3200"],
  "B-MEDICAL": ["5162.3", "5162.3"],
  "B-TRANSPORT": ["8790.5", "2950"],
  "B-KIDS": ["18000", "18000"],
  "B-HOUSEHOLD": ["4312.25", "1180"],
};

export function sampleBudgets(month: "2026-10" | "2026-11"): MoneyWizBudget[] {
  const i = month === "2026-10" ? 0 : 1;
  return BUDGETS.map(([id, name, planned, category], n) => {
    const used = USED[id][i];
    const remaining = (Math.round(Number(planned) * 100) - Math.round(Number(used) * 100)) / 100;
    return {
      id: `${id}:${86 + i}`,
      kind: "budget",
      name,
      text: { budgetType: "expense", timeZone: "Asia/Manila" },
      dates: period(month),
      money: {
        planned: P(planned), available: P(planned), used: P(used), remaining: P(String(remaining)),
        budgetsScreenAvailable: P(planned), budgetsScreenUsed: P(used), budgetsScreenRemaining: P(String(remaining)),
      },
      quantities: { daysLeft: month === "2026-11" ? "20" : "0", periodIndex: String(86 + i) },
      flags: { currentPeriod: month === "2026-11", repeating: true, carryover: false, exceeded: remaining < 0, low: false },
      references: { categoryIDs: [`C-${n}`] },
      referenceDetails: { categories: [{ id: `C-${n}`, name: category.split(" > ")[1] }] },
    } as MoneyWizBudget;
  });
}

export const sampleNames: MoneyWizNames = {
  category: {
    "C-0": "Food & Dining > Groceries", "C-1": "Food & Dining > Restaurants", "C-2": "Health Care > Medical",
    "C-3": "Auto & Transport > Gas & Fuel", "C-4": "Education > Tuition", "C-5": "Home > Supplies", "C-IN": "Income > Salary",
  },
  payee: { "P-1": "SM Supermarket Marikina", "P-2": "Festival Mall", "P-3": "Mercury Drug", "P-4": "Petron", "P-5": "Miriam College", "P-6": "Employer" },
  account: { "A-1": "BDO Savings" },
};

let n = 0;
const row = (date: string, kind: "expense" | "income", amount: string, cat: string, payee: string, memo = ""): MoneyWizRow => ({
  transactionID: `T-${++n}`,
  date,
  kind,
  isVoided: false,
  payeeID: payee,
  memo,
  booked: P(kind === "expense" ? `-${amount}` : amount),
  attributed: P(amount),
  allocations: [{ amount: kind === "expense" ? `-${amount}` : amount, categoryID: cat }],
});

export const sampleRows: MoneyWizRow[] = [
  row("2026-10-01T02:10:00Z", "income", "95000", "C-IN", "P-6", "October salary"),
  row("2026-10-03T08:30:00Z", "expense", "8450.25", "C-0", "P-1"),
  row("2026-10-10T11:15:00Z", "expense", "4380", "C-1", "P-2", "Family lunch"),
  row("2026-10-12T07:56:32Z", "expense", "3080", "C-2", "P-3"),
  row("2026-10-18T01:00:00Z", "expense", "2950.5", "C-3", "P-4"),
  row("2026-10-31T15:59:00Z", "expense", "1200", "C-5", "P-1", "Late on Oct 31 Manila time"),
  row("2026-10-31T16:30:00Z", "expense", "6120.4", "C-0", "P-1", "Early Nov 1 Manila time"),
  row("2026-11-05T09:00:00Z", "expense", "3200", "C-1", "P-2"),
  { ...row("2026-11-06T09:00:00Z", "expense", "999", "C-0", "P-1"), isVoided: true },
  { ...row("2026-11-07T09:00:00Z", "expense", "5000", "C-0", "P-1"), kind: "transfer" },
  {
    ...row("2026-11-08T03:00:00Z", "expense", "4000", "C-0", "P-1", "Split: groceries + household"),
    allocations: [{ amount: "-3000", categoryID: "C-0" }, { amount: "-1000", categoryID: "C-5" }],
  },
];
