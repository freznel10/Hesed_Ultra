import { useCallback, useEffect, useState } from "react";
import { api, type MonthSummary, type Transaction } from "../api";
import type { AppContext } from "../App";
import { addMonths, formatPHP, niceMonth } from "../util";

export default function Budget(props: { ctx: AppContext; date: string }) {
  const { ctx } = props;
  const parent = ctx.user.role === "parent";
  const [month, setMonth] = useState(props.date.slice(0, 7));
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { const m = await api.month(month); setSummary(m.summary); setTxns(m.transactions); setError(""); } catch (e) { setError((e as Error).message); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

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
          <h3>By category</h3>
          {summary.categories.length === 0 && <p className="empty">No spending this month yet.</p>}
          <table className="table">
            <tbody>
              {summary.categories.map((c) => (
                <tr key={c.category}><td>{c.name}</td><td className="amount">{formatPHP(c.spentCents)}</td></tr>
              ))}
            </tbody>
          </table>
          <small>Budgets and leftovers are on the Budget tab, from MoneyWiz.</small>
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
