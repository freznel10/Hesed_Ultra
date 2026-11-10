import { useCallback, useEffect, useState } from "react";
import { api, type Goal } from "../api";
import type { AppContext } from "../App";
import { formatPHP, parsePHP, today } from "../util";

/** A jar that fills in 12 chunky steps. */
function Jar({ percent }: { percent: number }) {
  const rows = Math.round((percent / 100) * 12);
  return (
    <div className="jar" role="img" aria-label={`${percent}% full`}>
      <div className="lid" />
      <div className="glass">{Array.from({ length: 12 }, (_, i) => <i key={i} className={12 - i <= rows ? "on" : ""} />)}</div>
    </div>
  );
}

function GoalCard(props: { goal: Goal; parent: boolean; onChange: () => void }) {
  const { goal, parent, onChange } = props;
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  async function move(sign: 1 | -1) {
    const cents = parsePHP(amount);
    if (!cents || cents <= 0) return setError("Type an amount in pesos.");
    try { await api.addSavings(goal.id, today(), sign * cents); setAmount(""); setError(""); onChange(); } catch (e) { setError((e as Error).message); }
  }
  return (
    <div className="goal panel">
      <Jar percent={goal.percent} />
      <b>{goal.name}</b>
      <span>{formatPHP(goal.savedCents)} of {formatPHP(goal.targetCents)}</span>
      <small>{goal.percent}% · {goal.remainingCents > 0 ? `${formatPHP(goal.remainingCents)} to go` : "Goal reached! 🎉"}{goal.targetDate ? ` · by ${goal.targetDate}` : ""}</small>
      {parent && (
        <div className="row">
          <input aria-label={`Amount for ${goal.name}`} inputMode="decimal" placeholder="₱ amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="primary" onClick={() => move(1)}>Add</button>
          <button onClick={() => move(-1)}>Take out</button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

export default function Savings({ ctx }: { ctx: AppContext }) {
  const parent = ctx.user.role === "parent";
  const [goals, setGoals] = useState<Goal[]>([]);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [by, setBy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => api.goals().then(setGoals).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const cents = parsePHP(target);
    if (!name.trim() || !cents || cents <= 0) return setError("Give the goal a name and a target amount in pesos.");
    try { await api.createGoal(name, cents, by || undefined); setName(""); setTarget(""); setBy(""); setError(""); load(); } catch (err) { setError((err as Error).message); }
  }

  return (
    <section>
      <h2>Savings goals</h2>
      {goals.length === 0 && <p className="empty">{parent ? "No goals yet. Add the first one below." : "No goals yet. Ask Mom or Dad to add one."}</p>}
      <div className="goals">{goals.map((g) => <GoalCard key={g.id} goal={g} parent={parent} onChange={load} />)}</div>
      {parent && (
        <form className="panel row" onSubmit={create}>
          <label>New goal <input value={name} placeholder="e.g. Family trip" onChange={(e) => setName(e.target.value)} /></label>
          <label>Target (₱) <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
          <label>By (optional) <input type="date" value={by} onChange={(e) => setBy(e.target.value)} /></label>
          <button className="primary">Add goal</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
