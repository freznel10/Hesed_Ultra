import { useEffect, useState } from "react";
import { api, type CalendarDay } from "../api";
import type { AppContext } from "../App";
import { addMonths, formatPHP, niceMonth, today } from "../util";

export default function CalendarPage(props: { ctx: AppContext; date: string; onPick: (date: string) => void }) {
  const { ctx, onPick } = props;
  const [month, setMonth] = useState(props.date.slice(0, 7));
  const [days, setDays] = useState<Map<string, CalendarDay>>(new Map());
  const [error, setError] = useState("");

  useEffect(() => {
    api.calendar(month).then((c) => { setDays(new Map(c.days.map((d) => [d.date, d]))); setError(""); }).catch((e) => setError(e.message));
  }, [month]);

  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sunday
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  const sprite = (key: string | null) => ctx.reference.places.find((p) => p.key === key)?.sprite;
  const color = (key: string) => ctx.reference.members.find((p) => p.key === key)?.color;

  return (
    <section>
      <div className="datebar">
        <button onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">◀</button>
        <h2>{niceMonth(month)}</h2>
        <button onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">▶</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="calendar">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="dow">{d}</div>)}
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="cell off" />;
          const d = days.get(date);
          const places = [...new Set(d?.activities.map((a) => a.place).filter(Boolean) as string[])].slice(0, 3);
          const who = [...new Set(d?.activities.flatMap((a) => a.members))];
          return (
            <button key={date} className={`cell ${date === today() ? "today" : ""}`} onClick={() => onPick(date)} aria-label={`Open ${date}`}>
              <span className="num">{Number(date.slice(8))}</span>
              <span className="thumbs">{places.map((p) => sprite(p) && <img key={p} className="pixel" src={`/sprites/${sprite(p)}.png`} alt="" />)}</span>
              <span className="dots">{who.map((k) => <i key={k} style={{ background: color(k) }} />)}</span>
              {d && d.spentCents > 0 && <span className="spent">{formatPHP(d.spentCents)}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
