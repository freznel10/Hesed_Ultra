import { useCallback, useEffect, useState } from "react";
import { api, type MonthSummary, type Transaction } from "../api";
import type { AppContext } from "../App";
import { addMonths, formatPHP, niceMonth, parsePHP } from "../util";

/** A chunky progress bar made of 20 blocks. */
export function PixelBar(props: { value: number; max: number; status: string }) {
  const blocks = Math.min(20, Math.round((props.value / Math.max(1, props.max)) * 20));
  return (
    <div className={`bar ${props.status}`} role="img" aria-label={`${Math.round((props.value / Math.max(1, props.max)) * 100)}% used`}>
      {Array.from({ length: 20 }, (_, i) => <i key={i} className={i < blocks ? "on" : ""} />)}
    </div>
  );
}

export default function Budget(props: { ctx: AppContext; date: string }) {
  const { ctx } = props;
  const parent = ctx.user.role === "parent";
  const [month, setMonth] = useState(props.date.slice(0, 7));
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [cat, setCat] = useState("");
  const [limit, setLimit] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { const m = await api.month(month); setSummary(m.summary); setTxns(m.transactions); setError(""); } catch (e) { setError((e as Error).message); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  async function saveBudget(e: React.FormEvent) {
    e.preventDefault();
    const cents = limit.trim() === "" ? 0 : parsePHP(limit);
    if (!cat || cents === null || cents < 0) return setError("Pick a category and type a monthly limit in pesos (leave empty to remove).");
    try { await api.setBudget(month, cat, cents); setLimit(""); setCat(""); await load(); } catch (err) { setError((err as Error).message); }
  }

  const catName = (key: string) => ctx.reference.categories.find((c) => c.key === key)?.name ?? key;
  const who = (key: string | null) => ctx.reference.members.find((m) => m.key === key)?.name;
  const mine = txns.filter((t) => t.kind === "expense").reduce((n, t) => n + t.amountCents, 0);

  return (
    <section>
      <div className="datebar">
        <button onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">◀</button>
        <h2>{niceMonth(month)}</h2>
        <button onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">▶</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {summary ? (
        <>
          <div className="tiles">
            <div className="tile"><small>Received</small><b className="income">{formatPHP(summary.incomeCents)}</b></div>
            <div className="tile"><small>Spent</small><b>{formatPHP(summary.spentCents)}</b></div>
            <div className="tile"><small>Left over</small><b className={summary.netCents < 0 ? "over-text" : "income"}>{formatPHP(summary.netCents)}</b></div>
          </div>
          <h3>Budgets</h3>
          {summary.categories.length === 0 && <p className="empty">No spending or budgets this month yet.</p>}
          <ul className="list budgets">
            {summary.categories.map((c) => (
              <li key={c.category}>
                <div className="grow">
                  <b>{c.name}</b>
                  {c.limitCents !== null
                    ? <><PixelBar value={c.spentCents} max={c.limitCents} status={c.status} />
                        <small>{formatPHP(c.spentCents)} of {formatPHP(c.limitCents)} · {c.remainingCents! >= 0 ? `${formatPHP(c.remainingCents!)} left` : `${formatPHP(-c.remainingCents!)} over`}</small></>
                    : <small>{formatPHP(c.spentCents)} spent · no budget set</small>}
                </div>
              </li>
            ))}
          </ul>
          <form className="panel row" onSubmit={saveBudget}>
            <label>Set a budget for
              <select value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">Choose…</option>
                {ctx.reference.categories.filter((c) => c.kind === "expense").map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              </select>
            </label>
            <label>Monthly limit (₱) <input inputMode="decimal" value={limit} placeholder="empty = remove" onChange={(e) => setLimit(e.target.value)} /></label>
            <button className="primary">Save budget</button>
          </form>
        </>
      ) : (
        <div className="tiles"><div className="tile"><small>I spent this month</small><b>{formatPHP(mine)}</b></div></div>
      )}

      <h3>{parent ? "Everything this month" : "My spending this month"}</h3>
      {txns.length === 0 && <p className="empty">Nothing logged this month.</p>}
      <table className="table">
        <tbody>
          {txns.map((t) => (
            <tr key={t.id}>
              <td>{t.date.slice(5)}</td>
              <td>{catName(t.category)}</td>
              <td>{t.payee}</td>
              <td>{who(t.member)}</td>
              <td className={`amount ${t.kind}`}>{t.kind === "income" ? "+" : "−"}{formatPHP(t.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
