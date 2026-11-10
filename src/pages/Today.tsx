import { useCallback, useEffect, useState } from "react";
import { api, type Activity, type ActivityInput, type Day, type Goal, type Transaction, type TransactionInput } from "../api";
import type { AppContext } from "../App";
import DayScene from "../scene/DayScene";
import { addDays, formatPHP, niceDate, parsePHP, shortTime, today } from "../util";

const ICON: Record<string, string> = {
  dining_out: "🍽️", piano: "🎹", worship: "🙌", cleaning: "🧹", school: "🏫", studying: "📚",
  work: "💼", shopping: "🛍️", play: "🎮", travel: "🚗",
};
const MOODS = ["😢", "😕", "😐", "🙂", "😄"];

const blankActivity = (date: string, me: string): ActivityInput => ({ date, type: "", members: [me], note: "" });

function ActivityForm(props: { ctx: AppContext; date: string; editing: Activity | null; onSaved: () => void; onCancel: () => void }) {
  const { ctx, date, editing, onSaved, onCancel } = props;
  const { reference, me } = ctx;
  const [f, setF] = useState<ActivityInput>(blankActivity(date, me.key));
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    setF(editing
      ? { date: editing.date, type: editing.type, members: editing.members, place: editing.place ?? undefined, title: editing.title,
          startTime: shortTime(editing.startTime) || undefined, endTime: shortTime(editing.endTime) || undefined, note: editing.note, mood: editing.mood ?? undefined }
      : blankActivity(date, me.key));
  }, [editing, date, me.key]);

  const type = reference.activityTypes.find((t) => t.key === f.type);
  const toggle = (key: string) => setF({ ...f, members: f.members.includes(key) ? f.members.filter((k) => k !== key) : [...f.members, key] });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.type) return setError("Pick what you did first.");
    const input = { ...f, date, title: f.title?.trim() || undefined, place: f.place || undefined, startTime: f.startTime || undefined, endTime: f.endTime || undefined };
    try {
      if (editing) await api.updateActivity(editing.id, input); else await api.logActivity(input);
      setF(blankActivity(date, me.key)); setError(""); onSaved();
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <form className="panel" onSubmit={save}>
      <h3>{editing ? "Change activity" : "What did you do?"}</h3>
      <div className="chips big">
        {reference.activityTypes.map((t) => (
          <button type="button" key={t.key} className={f.type === t.key ? "chip on" : "chip"} onClick={() => setF({ ...f, type: t.key, place: t.defaultPlace ?? undefined })}>
            <span aria-hidden>{ICON[t.key] ?? "⭐"}</span> {t.name}
          </button>
        ))}
      </div>
      <label>Who?</label>
      <div className="chips">
        {reference.members.map((m) => (
          <button type="button" key={m.key} className={f.members.includes(m.key) ? "chip on" : "chip"} onClick={() => toggle(m.key)}>{m.name}</button>
        ))}
      </div>
      <div className="row">
        <label>Where
          <select value={f.place ?? ""} onChange={(e) => setF({ ...f, place: e.target.value || undefined })}>
            <option value="">{type?.defaultPlace ? "Usual place" : "Nowhere in particular"}</option>
            {reference.places.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </label>
        <label>From <input type="time" value={f.startTime ?? ""} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></label>
        <label>To <input type="time" value={f.endTime ?? ""} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></label>
      </div>
      <label>Note <input value={f.note ?? ""} placeholder="Anything to remember?" onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      <label>How was it?</label>
      <div className="chips">
        {MOODS.map((face, i) => (
          <button type="button" key={i} aria-label={`Mood ${i + 1} of 5`} className={f.mood === i + 1 ? "chip on" : "chip"} onClick={() => setF({ ...f, mood: f.mood === i + 1 ? undefined : i + 1 })}>{face}</button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="primary">{editing ? "Save changes" : "Add activity"}</button>
        {editing && <button type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function MoneyForm(props: { ctx: AppContext; date: string; activities: Activity[]; editing: Transaction | null; onSaved: () => void; onCancel: () => void }) {
  const { ctx, date, activities, editing, onSaved, onCancel } = props;
  const { reference, me, user } = ctx;
  const parent = user.role === "parent";
  const blank = { amount: "", kind: "expense" as "expense" | "income", category: "", member: me.key, payee: "", note: "", activityId: "" };
  const [f, setF] = useState(blank);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    setF(editing
      ? { amount: (editing.amountCents / 100).toFixed(2), kind: editing.kind, category: editing.category, member: editing.member ?? "", payee: editing.payee, note: editing.note, activityId: editing.activityId ? String(editing.activityId) : "" }
      : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, date]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = parsePHP(f.amount);
    if (!amountCents || amountCents <= 0) return setError("Type an amount in pesos, like 250 or 1,250.50.");
    if (!f.category) return setError("Pick a category.");
    const input: TransactionInput = { date, kind: f.kind, amountCents, category: f.category, member: f.member || undefined, payee: f.payee, note: f.note, activityId: f.activityId ? Number(f.activityId) : undefined };
    try {
      if (editing) await api.updateTransaction(editing.id, input); else await api.logTransaction(input);
      setF(blank); setError(""); onSaved();
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <form className="panel" onSubmit={save}>
      <h3>{editing ? "Change entry" : parent ? "Money in or out" : "What did you spend?"}</h3>
      {parent && (
        <div className="chips">
          {(["expense", "income"] as const).map((k) => (
            <button type="button" key={k} className={f.kind === k ? "chip on" : "chip"} onClick={() => setF({ ...f, kind: k, category: "" })}>{k === "expense" ? "Spent" : "Received"}</button>
          ))}
        </div>
      )}
      <div className="row">
        <label>Amount (₱) <input inputMode="decimal" value={f.amount} placeholder="0.00" onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label>Category
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option value="">Choose…</option>
            {reference.categories.filter((c) => c.kind === f.kind).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        </label>
        {parent && (
          <label>Who
            <select value={f.member} onChange={(e) => setF({ ...f, member: e.target.value })}>
              <option value="">Family</option>
              {reference.members.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="row">
        <label>Paid to <input value={f.payee} placeholder="Store or person" onChange={(e) => setF({ ...f, payee: e.target.value })} /></label>
        <label>Goes with
          <select value={f.activityId} onChange={(e) => setF({ ...f, activityId: e.target.value })}>
            <option value="">No activity</option>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="primary">{editing ? "Save changes" : "Add"}</button>
        {editing && <button type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

export default function Today(props: { ctx: AppContext; date: string; setDate: (d: string) => void }) {
  const { ctx, date, setDate } = props;
  const { reference, user } = ctx;
  const [day, setDay] = useState<Day | null>(null);
  const [goal, setGoal] = useState<Goal | undefined>();
  const [editA, setEditA] = useState<Activity | null>(null);
  const [editT, setEditT] = useState<Transaction | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setDay(await api.day(date)); setGoal((await api.goals())[0]); setError(""); } catch (err) { setError((err as Error).message); }
  }, [date]);
  useEffect(() => { setEditA(null); setEditT(null); load(); }, [load]);

  const name = (key: string) => reference.members.find((m) => m.key === key)?.name ?? key;
  const place = (key: string | null) => reference.places.find((p) => p.key === key)?.name;
  const canEditA = (a: Activity) => user.role === "parent" || a.members.includes(user.key);
  const remove = async (fn: () => Promise<unknown>, what: string) => {
    if (!confirm(`Delete this ${what}?`)) return;
    try { await fn(); await load(); } catch (err) { setError((err as Error).message); }
  };

  return (
    <section>
      <div className="datebar">
        <button onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">◀</button>
        <h2>{niceDate(date)}</h2>
        <button onClick={() => setDate(addDays(date, 1))} aria-label="Next day">▶</button>
        {date !== today() && <button onClick={() => setDate(today())}>Today</button>}
        <input type="date" aria-label="Go to date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {day && <DayScene key={date} activities={day.activities} transactions={day.transactions} members={reference.members} places={reference.places} goal={goal} />}

      <div className="columns">
        <div>
          <h3>Activities</h3>
          {day?.activities.length === 0 && <p className="empty">Nothing logged yet for this day.</p>}
          <ul className="list">
            {day?.activities.map((a) => (
              <li key={a.id}>
                <span className="icon" aria-hidden>{ICON[a.type] ?? "⭐"}</span>
                <div className="grow">
                  <b>{a.title}</b> {a.mood ? MOODS[a.mood - 1] : ""}
                  <small>{[shortTime(a.startTime) && `${shortTime(a.startTime)}${a.endTime ? `–${shortTime(a.endTime)}` : ""}`, place(a.place), a.members.map(name).join(", ")].filter(Boolean).join(" · ")}</small>
                  {a.note && <small className="note">{a.note}</small>}
                </div>
                {canEditA(a) && <><button onClick={() => setEditA(a)}>Edit</button><button onClick={() => remove(() => api.deleteActivity(a.id), "activity")}>Delete</button></>}
              </li>
            ))}
          </ul>
          <ActivityForm ctx={ctx} date={date} editing={editA} onSaved={() => { setEditA(null); load(); }} onCancel={() => setEditA(null)} />
        </div>
        <div>
          <h3>{user.role === "parent" ? "Money" : "My spending"} {day && day.spentCents > 0 && <span className="total">{formatPHP(day.spentCents)} spent</span>}</h3>
          {day?.transactions.length === 0 && <p className="empty">No money logged for this day.</p>}
          <ul className="list">
            {day?.transactions.map((t) => (
              <li key={t.id}>
                <span className="icon" aria-hidden>{t.kind === "income" ? "💰" : "🪙"}</span>
                <div className="grow">
                  <b className={t.kind}>{t.kind === "income" ? "+" : "−"}{formatPHP(t.amountCents)}</b>
                  <small>{[reference.categories.find((c) => c.key === t.category)?.name, t.payee, t.member && name(t.member)].filter(Boolean).join(" · ")}</small>
                </div>
                <button onClick={() => setEditT(t)}>Edit</button><button onClick={() => remove(() => api.deleteTransaction(t.id), "entry")}>Delete</button>
              </li>
            ))}
          </ul>
          <MoneyForm ctx={ctx} date={date} activities={day?.activities ?? []} editing={editT} onSaved={() => { setEditT(null); load(); }} onCancel={() => setEditT(null)} />
        </div>
      </div>
    </section>
  );
}
