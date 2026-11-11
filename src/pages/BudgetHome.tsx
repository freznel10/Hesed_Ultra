import { useCallback, useEffect, useState } from "react";
import { api, type BudgetLine, type BudgetOverview, type Goal } from "../api";
import type { AppContext } from "../App";
import { addMonths, formatPHP, niceMonth, parsePHP, today } from "../util";

const STATUS = {
  ok: { icon: "●", label: "On track" },
  low: { icon: "▲", label: "Running low" },
  over: { icon: "✖", label: "Over budget" },
} as const;

/**
 * One budget as a row of 20 blocks: spent blocks in the status colour, the leftover as
 * empty blocks, and anything already swept marked with a broom stripe. Every figure is
 * also written out, so colour is never the only signal.
 */
function BudgetBar({ b }: { b: BudgetLine }) {
  const total = Math.max(b.availableCents, b.usedCents, 1);
  const used = Math.min(20, Math.round((Math.min(b.usedCents, b.availableCents) / total) * 20));
  const over = b.usedCents > b.availableCents ? Math.max(1, Math.round(((b.usedCents - b.availableCents) / total) * 20)) : 0;
  const swept = Math.min(20 - used, Math.round((b.sweptCents / total) * 20));
  const blocks = Array.from({ length: 20 }, (_, i) => {
    if (i < used - over) return "used";
    if (i < used) return "over";
    if (i >= 20 - swept) return "swept";
    return "left";
  });
  return (
    <div className={`bbar ${b.status}`} title={`${formatPHP(b.usedCents)} used of ${formatPHP(b.availableCents)}`}>
      {blocks.map((k, i) => <i key={i} className={k} />)}
    </div>
  );
}

function SweepDialog(props: { line: BudgetLine; goals: Goal[]; onClose: () => void; onDone: () => void }) {
  const { line, goals, onClose, onDone } = props;
  const [goalId, setGoalId] = useState(goals[0]?.id ?? 0);
  const [amount, setAmount] = useState((line.sweepableCents / 100).toFixed(2));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  async function go(e: React.FormEvent) {
    e.preventDefault();
    const cents = parsePHP(amount);
    if (!cents || cents <= 0) return setError("Type an amount in pesos.");
    try {
      await api.sweep(line.id, goalId, cents === line.sweepableCents ? undefined : cents, note);
      onDone();
    } catch (err) { setError((err as Error).message); }
  }
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`Sweep ${line.name}`} onClick={onClose}>
      <form className="panel" onClick={(e) => e.stopPropagation()} onSubmit={go}>
        <h3>🧹 Sweep {line.name} · {niceMonth(line.month)}</h3>
        <p>{formatPHP(line.sweepableCents)} was left unspent. Where should it go?</p>
        {goals.length === 0 ? <p className="error">Add a savings goal first (Savings tab).</p> : (
          <>
            <label>Into goal
              <select value={goalId} onChange={(e) => setGoalId(Number(e.target.value))}>
                {goals.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.percent}%)</option>)}
              </select>
            </label>
            <div className="row">
              <label>Amount (₱) <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              <label>Note (optional) <input value={note} onChange={(e) => setNote(e.target.value)} /></label>
            </div>
          </>
        )}
        <p className="small-note">Remember to make the actual transfer in your bank and MoneyWiz too; this only records it here.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button className="primary" disabled={!goals.length}>Sweep {amount ? `₱${amount}` : ""}</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function BudgetCard(props: { b: BudgetLine; onSweep: (b: BudgetLine) => void; onChange: () => void; setError: (s: string) => void }) {
  const { b, onSweep, onChange, setError } = props;
  const st = b.remainingCents === 0 ? { icon: "■", label: "Used up" } : STATUS[b.status];
  const act = (fn: () => Promise<unknown>) => async () => { try { await fn(); onChange(); } catch (e) { setError((e as Error).message); } };
  return (
    <li className={`bcard ${b.ended && b.sweepableCents > 0 ? "has-left" : ""}`}>
      <div className="bhead">
        <b>{b.name}</b>
        <span className={`status ${b.status}`}><span aria-hidden>{st.icon}</span> {st.label}</span>
      </div>
      <BudgetBar b={b} />
      <div className="bnums">
        <span>{formatPHP(b.usedCents)} used of {formatPHP(b.availableCents)}</span>
        <span className="strong">{b.remainingCents >= 0 ? `${formatPHP(b.remainingCents)} left` : `${formatPHP(-b.remainingCents)} over`}</span>
      </div>
      {b.categories.length > 0 && <small>{b.categories.join(", ")}{b.carryover ? " · carries over in MoneyWiz" : ""}</small>}
      {b.sweeps.map((s) => (
        <small key={s.id} className="swept-line">
          🧹 {formatPHP(s.amountCents)} swept to {s.goal}{" "}
          <button className="link" onClick={act(() => (confirm("Take this sweep back?") ? api.undoSweep(s.id) : Promise.resolve()))}>undo</button>
        </small>
      ))}
      {b.ended && b.sweepableCents > 0 && (
        <div className="row">
          <button className="primary" onClick={() => onSweep(b)}>🧹 Sweep {formatPHP(b.sweepableCents)}</button>
          <button onClick={act(() => api.leaveAlone(b.id, true))}>Leave it</button>
        </div>
      )}
      {b.leftAlone && (
        <small>Left in the account. <button className="link" onClick={act(() => api.leaveAlone(b.id, false))}>Sweep it after all</button></small>
      )}
      {!b.ended && b.remainingCents > 0 && <small>Sweepable once {niceMonth(b.month)} ends, if still unspent.</small>}
    </li>
  );
}

/** Swept per month, as plain bars with the amount written on each. */
function SweepHistory({ history }: { history: BudgetOverview["history"] }) {
  if (!history.length) return null;
  const max = Math.max(...history.map((h) => h.sweptCents));
  return (
    <div className="panel">
      <h3>Swept into savings, by month</h3>
      <ul className="hbars">
        {history.map((h) => (
          <li key={h.month} title={`${niceMonth(h.month)}: ${formatPHP(h.sweptCents)}`}>
            <span className="hlabel">{niceMonth(h.month)}</span>
            <span className="htrack"><i style={{ width: `${Math.max(2, (h.sweptCents / max) * 100)}%` }} /></span>
            <span className="hval">{formatPHP(h.sweptCents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function BudgetHome({ ctx }: { ctx: AppContext }) {
  void ctx;
  const [month, setMonth] = useState(today().slice(0, 7));
  const [data, setData] = useState<BudgetOverview | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sweeping, setSweeping] = useState<BudgetLine | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setData(await api.budget(month)); setGoals(await api.goals()); setError(""); } catch (e) { setError((e as Error).message); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const cur = data?.current;
  const pendingByMonth = new Map<string, BudgetLine[]>();
  for (const b of data?.pending.budgets ?? []) pendingByMonth.set(b.month, [...(pendingByMonth.get(b.month) ?? []), b]);

  return (
    <section>
      {error && <p className="error" role="alert">{error}</p>}
      {data && !data.lastSync && (
        <div className="panel">
          <h3>No MoneyWiz data yet</h3>
          <p>Budgets come from MoneyWiz on your Mac. Add this app to the Claude desktop app (where MoneyWiz is connected) by following <code>docs/moneywiz-sync.md</code>. Then, with this app and MoneyWiz open, ask Claude: "Sync MoneyWiz into Hesed Ultra for the last 12 months."</p>
        </div>
      )}

      {data && data.pending.totalCents > 0 && (
        <div className="sweep-hero panel">
          <div className="coins" aria-hidden>{Array.from({ length: Math.min(12, Math.ceil(data.pending.totalCents / 500000)) }, (_, i) => <i key={i} />)}</div>
          <div className="grow">
            <small>Ready to sweep from finished months</small>
            <b className="hero-num">{formatPHP(data.pending.totalCents)}</b>
            {[...pendingByMonth.entries()].map(([m, list]) => (
              <div key={m} className="pending-month">
                <b>{niceMonth(m)}</b>
                {list.map((b) => (
                  <button key={b.id} className="chip" onClick={() => setSweeping(b)}>🧹 {b.name} {formatPHP(b.sweepableCents)}</button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="datebar">
        <button onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">◀</button>
        <h2>{niceMonth(month)}</h2>
        <button onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">▶</button>
        {month !== today().slice(0, 7) && <button onClick={() => setMonth(today().slice(0, 7))}>This month</button>}
        {data?.lastSync && <small className="sync">Synced from MoneyWiz {new Date(data.lastSync).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })}</small>}
      </div>

      {cur && cur.budgets.length === 0 && data?.lastSync && <p className="empty">No MoneyWiz budgets synced for {niceMonth(month)}.</p>}
      {cur && cur.budgets.length > 0 && (
        <>
          <div className="tiles">
            <div className="tile"><small>Budgeted</small><b>{formatPHP(cur.availableCents)}</b></div>
            <div className="tile"><small>Spent</small><b>{formatPHP(cur.usedCents)}</b></div>
            <div className="tile"><small>{cur.ended ? "Left unspent" : "Left so far"}</small><b>{formatPHP(cur.leftoverCents)}</b>{cur.overCents > 0 && <small>{formatPHP(cur.overCents)} over in other budgets</small>}</div>
            <div className="tile"><small>Swept to savings</small><b>{formatPHP(cur.sweptCents)}</b>{cur.sweepableCents > 0 && <small>{formatPHP(cur.sweepableCents)} still to sweep</small>}</div>
          </div>
          <div className="legend" aria-hidden>
            <span><i className="used" /> spent</span><span><i className="over" /> over</span><span><i className="left" /> left</span><span><i className="swept" /> swept</span>
          </div>
          <ul className="bgrid">
            {cur.budgets.map((b) => <BudgetCard key={b.id} b={b} onSweep={setSweeping} onChange={load} setError={setError} />)}
          </ul>
        </>
      )}

      {data && <SweepHistory history={data.history} />}
      {sweeping && <SweepDialog line={sweeping} goals={goals} onClose={() => setSweeping(null)} onDone={() => { setSweeping(null); load(); }} />}
    </section>
  );
}
