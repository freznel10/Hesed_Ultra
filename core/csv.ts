import { createHash } from "node:crypto";
import { InputError } from "./context";
import type { ParsedTransaction } from "./moneywiz";

/**
 * Reading a MoneyWiz CSV export (or most bank/app CSV exports).
 *
 * The exact layout depends on the MoneyWiz version and Mac settings, so this looks for
 * columns by name, works out the separator, date order and number style, and reports what
 * it decided so the person can check a preview before anything is saved.
 *
 * Rows skipped on purpose: account header/balance rows (no date or amount), transfers
 * between accounts, and amounts in other currencies.
 */

export type DateOrder = "MDY" | "DMY" | "YMD";

/** Split CSV text into rows of fields (RFC 4180 quoting; handles quoted newlines). */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const ALIASES: Record<string, string[]> = {
  date: ["date", "transaction date", "date posted"],
  time: ["time"],
  amount: ["amount", "value"],
  payee: ["payee", "merchant"],
  description: ["description", "name of transaction", "title"],
  category: ["category", "categories"],
  account: ["account", "account name"],
  transfer: ["transfers", "transfer", "transfer account", "to account"],
  currency: ["currency"],
  memo: ["memo", "notes", "note"],
  tags: ["tags", "tag"],
  withdrawal: ["withdrawal", "debit", "outflow", "money out"],
  deposit: ["deposit", "credit", "inflow", "money in"],
};

function findColumns(header: string[]) {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, " "));
  const col: Record<string, number> = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    const i = norm.findIndex((h) => names.includes(h));
    if (i >= 0) col[key] = i;
  }
  return col;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Parse a date in the given order. Also accepts ISO and "Nov 10, 2026" / "10 Nov 2026". */
export function parseDate(raw: string, order: DateOrder): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s))) {
    const [a, b, c] = [Number(match[1]), Number(match[2]), Number(match[3])];
    y = c < 100 ? 2000 + c : c;
    [m, d] = order === "DMY" ? [b, a] : [a, b];
  } else if ((match = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/.exec(s))) {
    [m, d, y] = [MONTHS.indexOf(match[1].toLowerCase()) + 1, Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2}) ([A-Za-z]{3})[a-z]*\.?,? (\d{4})/.exec(s))) {
    [d, m, y] = [Number(match[1]), MONTHS.indexOf(match[2].toLowerCase()) + 1, Number(match[3])];
  } else return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Work out day/month order from the data: a first number above 12 means day-first, and so on. */
export function guessDateOrder(samples: string[]): { order: DateOrder; sure: boolean } {
  let dayFirst = false;
  let monthFirst = false;
  for (const s of samples) {
    if (/^\d{4}[-/.]/.test(s.trim())) return { order: "YMD", sure: true };
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]/.exec(s.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[2]) > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return { order: "DMY", sure: true };
  if (monthFirst && !dayFirst) return { order: "MDY", sure: true };
  // Ambiguous (every day so far is 12 or less): Philippine Macs default to month first.
  return { order: "MDY", sure: !samples.some((s) => /^\d{1,2}[-/.]\d{1,2}[-/.]/.test(s.trim())) };
}

/** "−1,234.50", "(1,234.50)", "₱1 234,50", "PHP 99" → centavos. Null if not a number. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/[−‒–]/g, "-");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/PHP|₱|P(?=\d)|\s|'/gi, "");
  if (s.startsWith("-")) { negative = !negative; s = s.slice(1); }
  if (s.endsWith("-")) { negative = !negative; s = s.slice(0, -1); }
  s = s.replace(/^\+/, "");
  // Decimal comma ("1.234,56" or "12,5"): the last separator is a comma followed by 1–2 digits.
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2)) + (Number(frac[2] ?? "0") >= 5 ? 1 : 0);
  return negative ? -cents : cents;
}

/** "Food & Dining ► Groceries" / "Food:Groceries" → "Food & Dining > Groceries". */
export const normaliseCategory = (raw: string) =>
  raw.trim().replace(/\s*(?:►|▸|→|›|>|\\|:)\s*/g, " > ").replace(/\s+/g, " ") || "Uncategorized";

export type CsvPreview = {
  delimiter: string;
  columns: Record<string, string>;
  dateOrder: DateOrder;
  dateOrderSure: boolean;
  rows: number;
  transactions: ParsedTransaction[];
  skipped: { noDateOrAmount: number; transfers: number; otherCurrency: number; badDate: number; zero: number };
  from: string | null;
  to: string | null;
  incomeCents: number;
  expenseCents: number;
  categories: string[];
};

export function readCsv(text: string, opts: { dateOrder?: DateOrder } = {}): CsvPreview {
  let body = text.replace(/^﻿/, "");
  let delimiter: string | null = null;
  const sep = /^sep=(.)\r?\n/i.exec(body);
  if (sep) { delimiter = sep[1]; body = body.slice(sep[0].length); }

  // Find the header: the first line (of the first 20) that names a date and an amount column.
  const lines = body.split(/\r?\n/).slice(0, 20);
  let header: string[] | null = null;
  let headerLine = -1;
  for (const d of delimiter ? [delimiter] : [",", ";", "\t"]) {
    for (let i = 0; i < lines.length; i++) {
      const cells = splitCsv(lines[i], d)[0] ?? [];
      const c = findColumns(cells);
      if (c.date !== undefined && (c.amount !== undefined || c.withdrawal !== undefined)) { header = cells; headerLine = i; delimiter = d; break; }
    }
    if (header) break;
  }
  if (!header || !delimiter) {
    throw new InputError("Could not find the column names. The file needs at least a Date column and an Amount column. Is this a CSV export?");
  }
  const col = findColumns(header);
  const all = splitCsv(body, delimiter).slice(headerLine + 1);
  const get = (r: string[], k: string) => (col[k] !== undefined ? (r[col[k]] ?? "").trim() : "");

  const dated = all.filter((r) => get(r, "date"));
  const guess = guessDateOrder(dated.map((r) => get(r, "date")));
  const dateOrder = opts.dateOrder ?? guess.order;

  const skipped = { noDateOrAmount: 0, transfers: 0, otherCurrency: 0, badDate: 0, zero: 0 };
  const seen = new Map<string, number>();
  const transactions: ParsedTransaction[] = [];
  for (const r of all) {
    const rawDate = get(r, "date");
    let cents = col.amount !== undefined ? parseAmount(get(r, "amount")) : null;
    if (cents === null && (col.withdrawal !== undefined || col.deposit !== undefined)) {
      const out = parseAmount(get(r, "withdrawal")) ?? 0;
      const inn = parseAmount(get(r, "deposit")) ?? 0;
      cents = inn - Math.abs(out);
      if (!get(r, "withdrawal") && !get(r, "deposit")) cents = null;
    }
    if (!rawDate || cents === null) { skipped.noDateOrAmount++; continue; }
    if (get(r, "transfer")) { skipped.transfers++; continue; }
    const currency = get(r, "currency").toUpperCase();
    if (currency && currency !== "PHP" && currency !== "₱") { skipped.otherCurrency++; continue; }
    const date = parseDate(rawDate, dateOrder);
    if (!date) { skipped.badDate++; continue; }
    if (cents === 0) { skipped.zero++; continue; }

    const description = get(r, "description");
    const payee = get(r, "payee") || description;
    const memo = [description && description !== payee ? description : "", get(r, "memo")].filter(Boolean).join(" · ");
    const category = normaliseCategory(get(r, "category"));
    // Same account, day, time, amount, payee, text and category = same transaction, so
    // uploading overlapping exports never duplicates. Identical twins in one file are told
    // apart by their position among the twins.
    const key = [get(r, "account"), date, get(r, "time"), cents, payee, description, category, get(r, "memo")].join("|");
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    transactions.push({
      externalId: `csv:${createHash("sha1").update(key).digest("hex").slice(0, 20)}${n > 1 ? `#${n}` : ""}`,
      date,
      kind: cents < 0 ? "expense" : "income",
      amountCents: Math.abs(cents),
      categoryPath: category,
      payee: payee.slice(0, 120),
      note: memo.slice(0, 2000),
    });
  }

  const dates = transactions.map((t) => t.date).sort();
  const columns = Object.fromEntries(Object.entries(col).map(([k, i]) => [k, header![i]]));
  return {
    delimiter,
    columns,
    dateOrder,
    dateOrderSure: opts.dateOrder ? true : guess.sure,
    rows: all.length,
    transactions,
    skipped,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    incomeCents: transactions.filter((t) => t.kind === "income").reduce((n, t) => n + t.amountCents, 0),
    expenseCents: transactions.filter((t) => t.kind === "expense").reduce((n, t) => n + t.amountCents, 0),
    categories: [...new Set(transactions.map((t) => t.categoryPath))].sort(),
  };
}
