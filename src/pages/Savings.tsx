import { useCallback, useEffect, useState } from "react";
import { api, type Goal } from "../api";
import type { AppContext } from "../App";
import { formatPHP, niceMonth, parsePHP, today } from "../util";

/**
 * A jar filling in 16 chunky rows. Money from monthly saving sits at the bottom in gold,
 * money swept from budget leftovers stacks on top in teal. Amounts are written beside it.
 */
function Jar({ goal }: { goal: Goal }) {
  const rows = 16;
  const own = goal.savedCents - goal.sweptCents;
  const t = Math.max(1, goal.targetCents);
  // any money at all shows at least one row, so a small sweep is never invisible
  const rowsFor = (cents: number) => (cents > 0 ? Math.max(1, Math.round((cents / t) * rows)) : 0);
  const ownRows = Math.min(rows, rowsFor(Math.max(0, own)));
  const sweptRows = Math.min(rows - ownRows, rowsFor(goal.sweptCents));
  return (
    <div className="jar big" role="img" aria-label={`${goal.percent}% of target`}>
      <div className="lid" />
      <div className="glass">
        {Array.from({ length: rows }, (_, i) => {
          const fromBottom = rows - 1 - i;
          const cls = fromBottom < ownRows ? "own" : fromBottom < ownRows + sweptRows ? "swept" : "";
          return <i key={i} className={cls} />;
        })}
      </div>
      <span className="pct">{goal.percent}%</span>
    </div>
  );
}

const PACE = {
  done: { icon: "★", label: "Reached" },
  on_track: { icon: "●", label: "On pace" },
  behind: { icon: "▲", label: "Behind plan" },
  no_plan: { icon: "○", label: "No monthly plan" },
} as const;

function GoalCard(props: { goal: Goal; parent: boolean; onChange: () => void }) {
  const { goal, parent, onChange } = props;
  const [amount, setAmount] = useState("");
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: goal.name, target: (goal.targetCents / 100).toFixed(0), date: goal.targetDate ?? "", monthly: goal.monthlyCents ? (goal.monthlyCents / 100).toFixed(0) : "" });
  const [error, setError] = useState("");
  const p = goal.pace;
  const own = goal.savedCents - goal.sweptCents;

  async function move(sign: 1 | -1) {
    const cents = parsePHP(amount);
    if (!cents || cents <= 0) return setError("Type an amount in pesos.");
    try { await api.addSavings(goal.id, today(), sign * cents); setAmount(""); setError(""); onChange(); } catch (e) { setError((e as Error).message); }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const target = parsePHP(f.target);
    const monthly = f.monthly.trim() ? parsePHP(f.monthly) : null;
    if (!target || target <= 0 || (f.monthly.trim() && (!monthly || monthly <= 0))) return setError("Target and monthly amounts are in pesos.");
    try { await api.updateGoal(goal.id, { name: f.name, targetCents: target, targetDate: f.date || null, monthlyCents: monthly }); setEditing(false); setError(""); onChange(); } catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="goal panel">
      <div className="goal-top">
        <Jar goal={goal} />
        <div className="goal-facts">
          <b className="goal-name">{goal.name}</b>
          <span className="hero-num">{formatPHP(goal.savedCents)}</span>
          <small>of {formatPHP(goal.targetCents)}{goal.targetDate ? ` by ${niceMonth(goal.targetDate.slice(0, 7))}` : ""}</small>
          <ul className="keyed">
            <li><i className="own" /> Saved directly: {formatPHP(Math.max(0, own))}</li>
            <li><i className="swept" /> Swept from budgets: {formatPHP(goal.sweptCents)}</li>
          </ul>
        </div>
      </div>
      <div className={`pace ${p.status}`}>
        <b><span aria-hidden>{PACE[p.status].icon}</span> {PACE[p.status].label}</b>
        {p.status !== "done" && (
          <small>
            {goal.monthlyCents ? `Plan: ${formatPHP(goal.monthlyCents)}/month. ` : ""}
            {p.neededPerMonthCents !== null ? `Needs ${formatPHP(p.neededPerMonthCents)}/month for ${p.monthsLeft} month${p.monthsLeft === 1 ? "" : "s"}. ` : ""}
            {p.projectedMonth ? `At plan, reached ${niceMonth(p.projectedMonth)}.` : ""}
            {p.status === "no_plan" && !p.neededPerMonthCents ? "Add a target date or monthly amount to track pace." : ""}
          </small>
        )}
      </div>
      {parent && !editing && (
        <div className="row">
          <input aria-label={`Amount for ${goal.name}`} inputMode="decimal" placeholder="₱ amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="primary" onClick={() => move(1)}>Add</button>
          <button onClick={() => move(-1)}>Take out</button>
          <button onClick={() => setEditing(true)}>Edit plan</button>
        </div>
      )}
      {editing && (
        <form className="row" onSubmit={save}>
          <label>Name <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Target (₱) <input inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
          <label>By <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label>Monthly (₱) <input inputMode="decimal" value={f.monthly} placeholder="optional" onChange={(e) => setF({ ...f, monthly: e.target.value })} /></label>
          <button className="primary">Save</button>
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
          <button type="button" onClick={async () => { if (confirm(`Archive "${goal.name}"? It will be hidden; its history stays.`)) { await api.updateGoal(goal.id, { archived: true }); onChange(); } }}>Archive</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

export default function Savings({ ctx }: { ctx: AppContext }) {
  const parent = ctx.user.role === "parent";
  const [goals, setGoals] = useState<Goal[]>([]);
  const [f, setF] = useState({ name: "", target: "", by: "", monthly: "" });
  const [error, setError] = useState("");

  const load = useCallback(() => api.goals().then(setGoals).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const cents = parsePHP(f.target);
    const monthly = f.monthly.trim() ? parsePHP(f.monthly) : undefined;
    if (!f.name.trim() || !cents || cents <= 0) return setError("Give the goal a name and a target amount in pesos.");
    try { await api.createGoal(f.name, cents, f.by || undefined, monthly ?? undefined); setF({ name: "", target: "", by: "", monthly: "" }); setError(""); load(); } catch (err) { setError((err as Error).message); }
  }

  const saved = goals.reduce((n, g) => n + g.savedCents, 0);
  const target = goals.reduce((n, g) => n + g.targetCents, 0);
  const swept = goals.reduce((n, g) => n + g.sweptCents, 0);
  const planned = goals.reduce((n, g) => n + (g.pace.status === "done" ? 0 : g.monthlyCents ?? 0), 0);
  const needed = goals.reduce((n, g) => n + (g.pace.neededPerMonthCents ?? 0), 0);

  return (
    <section>
      <h2>Savings plan</h2>
      {goals.length > 0 && (
        <div className="tiles">
          <div className="tile"><small>Saved across goals</small><b>{formatPHP(saved)}</b><small>of {formatPHP(target)}</small></div>
          <div className="tile"><small>From budget sweeps</small><b>{formatPHP(swept)}</b></div>
          <div className="tile"><small>Planned per month</small><b>{formatPHP(planned)}</b>{needed > 0 && <small>{needed > planned ? `${formatPHP(needed - planned)} short of` : "covers"} the {formatPHP(needed)} needed for target dates</small>}</div>
        </div>
      )}
      {goals.length === 0 && <p className="empty">{parent ? "No goals yet. Add your savings plan's goals below, or ask Claude to add them." : "No goals yet."}</p>}
      <div className="goals">{goals.map((g) => <GoalCard key={g.id} goal={g} parent={parent} onChange={load} />)}</div>
      {parent && (
        <form className="panel row" onSubmit={create}>
          <h3>New goal</h3>
          <label>Name <input value={f.name} placeholder="e.g. Emergency fund" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Target (₱) <input inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
          <label>By (optional) <input type="date" value={f.by} onChange={(e) => setF({ ...f, by: e.target.value })} /></label>
          <label>Monthly plan (₱, optional) <input inputMode="decimal" value={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.value })} /></label>
          <button className="primary">Add goal</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
