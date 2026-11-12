import { useCallback, useEffect, useState } from "react";
import { api, type BudgetPlan, type CsvPreview, type CsvResult, type DateOrder } from "../api";
import { addMonths, formatPHP, niceMonth, parsePHP, today } from "../util";

const ORDER_LABEL: Record<DateOrder, string> = { MDY: "Month/Day/Year (10/28/2026)", DMY: "Day/Month/Year (28/10/2026)", YMD: "Year-Month-Day (2026-10-28)" };

/** Upload a MoneyWiz CSV export: read it, show what was found, then import on confirm. */
export function CsvUpload({ onImported }: { onImported: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [order, setOrder] = useState<DateOrder | undefined>();
  const [result, setResult] = useState<CsvResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function read(t: string, o?: DateOrder) {
    setBusy(true); setError(""); setResult(null);
    try { const p = await api.csvPreview(t, o); setPreview(p); setOrder(p.dateOrder); } catch (e) { setPreview(null); setError((e as Error).message); }
    setBusy(false);
  }
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const t = await f.text();
    setText(t);
    read(t);
    e.target.value = "";
  }
  async function commit() {
    if (!text) return;
    setBusy(true); setError("");
    try { setResult(await api.csvImport(text, order)); setPreview(null); setText(null); onImported(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  const sk = preview?.skipped;

  return (
    <div className="panel">
      <h3>Upload a MoneyWiz CSV</h3>
      <p className="small-note">In MoneyWiz on the Mac: <b>File → Export → CSV</b>, choose the accounts and dates, and save. Then pick the file here. Nothing is saved until you press Import. Uploading an overlapping export again is safe; transactions already here are skipped.</p>
      <label className="file">
        <input type="file" accept=".csv,text/csv" onChange={pick} />
        <span className="filebtn">⬆ Choose CSV file</span> {fileName && <span>{fileName}</span>}
      </label>
      {busy && <p>Reading…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {result && (
        <p className="ok">
          Imported {result.created} new and updated {result.updated} transactions{result.unchanged ? ` (${result.unchanged} were already here)` : ""}, {result.from} to {result.to}.
        </p>
      )}
      {preview && (
        <div className="preview">
          <p><b>{preview.count}</b> transactions from <b>{preview.from}</b> to <b>{preview.to}</b>: {formatPHP(preview.expenseCents)} spent, {formatPHP(preview.incomeCents)} received.</p>
          <label>Dates in this file are
            <select value={order} onChange={(e) => { const o = e.target.value as DateOrder; setOrder(o); read(text!, o); }}>
              {(Object.keys(ORDER_LABEL) as DateOrder[]).map((o) => <option key={o} value={o}>{ORDER_LABEL[o]}</option>)}
            </select>
          </label>
          {!preview.dateOrderSure && <p className="warn-text">▲ Every date in this file could be read either way. Check that the dates below look right.</p>}
          <table className="table">
            <tbody>
              {preview.sample.map((t, i) => (
                <tr key={i}><td>{t.date}</td><td>{t.payee}</td><td>{t.categoryPath}</td><td className={`amount ${t.kind}`}>{t.kind === "income" ? "+" : "−"}{formatPHP(t.amountCents)}</td></tr>
              ))}
            </tbody>
          </table>
          {sk && (sk.transfers + sk.otherCurrency + sk.badDate + sk.noDateOrAmount > 0) && (
            <small>
              Skipped: {[sk.transfers && `${sk.transfers} transfers between accounts`, sk.otherCurrency && `${sk.otherCurrency} in other currencies`, sk.badDate && `${sk.badDate} with unreadable dates`, sk.noDateOrAmount && `${sk.noDateOrAmount} account or summary rows`].filter(Boolean).join(", ")}.
            </small>
          )}
          <small>Columns used: {Object.entries(preview.columns).map(([k, v]) => `${k} = "${v}"`).join(", ")}</small>
          <div className="row">
            <button className="primary" onClick={commit} disabled={busy}>Import {preview.count} transactions</button>
            <button onClick={() => { setPreview(null); setText(null); setFileName(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Parent paths too, so "Food & Dining" can cover all of its subcategories. */
function withParents(categories: string[]) {
  const all = new Set<string>();
  for (const c of categories) {
    const parts = c.split(" > ");
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join(" > "));
  }
  return [...all].sort();
}

function PlanForm(props: { categories: string[]; plan?: BudgetPlan; onDone: () => void; onCancel?: () => void }) {
  const { categories, plan, onDone, onCancel } = props;
  const [name, setName] = useState(plan?.name ?? "");
  const [amount, setAmount] = useState(plan ? (plan.monthlyCents / 100).toFixed(0) : "");
  const [cats, setCats] = useState<string[]>(plan?.categories ?? []);
  const [start, setStart] = useState(plan?.startMonth ?? addMonths(today().slice(0, 7), -2));
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const options = withParents([...categories, ...cats]).filter((c) => !filter || c.toLowerCase().includes(filter.toLowerCase()));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const cents = parsePHP(amount);
    if (!name.trim() || !cents || cents <= 0) return setError("Give the budget a name and a monthly amount in pesos.");
    if (!cats.length) return setError("Pick at least one category.");
    try {
      const body = { name, monthlyCents: cents, categories: cats, startMonth: start };
      if (plan) await api.updatePlan(plan.id, body); else await api.createPlan(body);
      onDone();
    } catch (err) { setError((err as Error).message); }
  }
  return (
    <form className="planform" onSubmit={save}>
      <div className="row">
        <label>Budget name <input value={name} placeholder="e.g. Groceries" onChange={(e) => setName(e.target.value)} /></label>
        <label>Per month (₱) <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>Track from <input type="month" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      </div>
      <label>Categories it covers ({cats.length} chosen; a parent includes all its subcategories)
        <input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      <div className="catlist">
        {options.length === 0 && <small>No categories yet. Upload a CSV first.</small>}
        {options.map((c) => (
          <label key={c} className="check" style={{ paddingLeft: `${(c.split(" > ").length - 1) * 16}px` }}>
            <input type="checkbox" checked={cats.includes(c)} onChange={() => setCats(cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c])} />{" "}
            {c.includes(" > ") ? <><span className="parent-path">{c.split(" > ").slice(0, -1).join(" › ")} › </span>{c.split(" > ").at(-1)}</> : <b>{c}</b>}
          </label>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="primary">{plan ? "Save budget" : "Add budget"}</button>
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

/** The family's monthly budgets, kept in this app (needed when spending comes from CSV). */
export function BudgetPlans({ onChange, refreshKey }: { onChange: () => void; refreshKey: number }) {
  const [plans, setPlans] = useState<BudgetPlan[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { const r = await api.budgetPlans(); setPlans(r.plans); setCategories(r.categories); } catch (e) { setError((e as Error).message); }
  }, []);
  // reload after every CSV upload, so newly imported categories can be picked
  useEffect(() => { load(); }, [load, refreshKey]);
  const done = () => { setEditing(null); load(); onChange(); };

  return (
    <div className="panel">
      <h3>Monthly budgets</h3>
      <p className="small-note">Enter the budgets you keep in MoneyWiz. Each month, the app adds up the spending in each budget's categories (minus refunds) and shows what's left. Budgets synced straight from MoneyWiz through Claude appear too, and don't need entering here.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <table className="table">
        <tbody>
          {plans.map((p) => editing === p.id ? (
            <tr key={p.id}><td colSpan={4}><PlanForm categories={categories} plan={p} onDone={done} onCancel={() => setEditing(null)} /></td></tr>
          ) : (
            <tr key={p.id}>
              <td><b>{p.name}</b><small>{p.categories.join(", ")}</small></td>
              <td className="amount">{formatPHP(p.monthlyCents)}/mo</td>
              <td><small>from {niceMonth(p.startMonth)}</small></td>
              <td className="amount">
                <button onClick={() => setEditing(p.id)}>Edit</button>{" "}
                <button onClick={async () => { if (confirm(`Stop the "${p.name}" budget? Months you already swept from are kept.`)) { await api.removePlan(p.id); done(); } }}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {plans.length === 0 && editing !== "new" && <p className="empty">No budgets yet.</p>}
      {editing === "new" ? <PlanForm categories={categories} onDone={done} onCancel={() => setEditing(null)} /> : <button className="primary" onClick={() => setEditing("new")}>+ Add a budget</button>}
    </div>
  );
}
