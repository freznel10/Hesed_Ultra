import { useCallback, useEffect, useState } from "react";
import { api, setLocalMember, type Member, type Reference, type Session, type User } from "./api";
import Budget from "./pages/Budget";
import BudgetHome from "./pages/BudgetHome";
import CalendarPage from "./pages/CalendarPage";
import Savings from "./pages/Savings";
import Settings from "./pages/Settings";
import Today from "./pages/Today";
import { today } from "./util";

type Tab = "budget" | "savings" | "money" | "today" | "calendar" | "settings";
const TABS: [Tab, string, boolean][] = [
  ["budget", "Budget", true], ["savings", "Savings", false], ["money", "Spending", false],
  ["today", "Family day", false], ["calendar", "Calendar", false], ["settings", "Settings", false],
];

export type AppContext = { user: User; me: Member; reference: Reference; session: Session };

function WhoIsHere(props: { session: Session; onDone: () => void }) {
  const { session, onDone } = props;
  const [member, setMember] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  async function pick(key: string) {
    if (!session.loginRequired) { setLocalMember(key); onDone(); return; }
    setMember(key); setPin(""); setError("");
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    try { await api.login(member!, pin); onDone(); } catch (err) { setError((err as Error).message); setPin(""); }
  }

  return (
    <main className="who">
      <h1>Hesed Ultra</h1>
      <p className="sub">Who's here?</p>
      <div className="family">
        {session.members.map((m) => (
          <button key={m.key} className={`member-card ${member === m.key ? "on" : ""}`} onClick={() => pick(m.key)}>
            <img className="pixel" src={`/sprites/${m.sprite}.png`} alt="" />
            <b>{m.name}</b>
          </button>
        ))}
      </div>
      {member && (
        <form onSubmit={login} className="panel pin">
          <label>PIN for {session.members.find((m) => m.key === member)?.name}
            <input autoFocus type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
          </label>
          <button>Sign in</button>
          <small>First time online? A parent signs in with the site's setup code, then sets PINs in Settings.</small>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      )}
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [reference, setReference] = useState<Reference | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab | null>(null);
  const [date, setDate] = useState(today());

  const load = useCallback(async () => {
    try {
      const s = await api.session();
      setSession(s);
      setReference(s.user ? await api.reference() : null);
    } catch (err) { setError((err as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <main><p className="error" role="alert">Could not reach the app's server: {error}</p></main>;
  if (!session) return <main><p>Loading…</p></main>;
  if (!session.user || !reference) return <WhoIsHere session={session} onDone={load} />;

  const me = reference.members.find((m) => m.key === session.user!.key)!;
  const parent = session.user.role === "parent";
  // Budget is the home screen for parents; children start on the family day.
  const current: Tab = tab ?? (parent ? "budget" : "today");
  const ctx: AppContext = { user: session.user, me, reference, session };
  const signOut = async () => {
    if (session.loginRequired) await api.logout(); else setLocalMember(null);
    setSession({ ...session, user: null });
    setTab(null);
  };

  return (
    <main>
      <header className="top">
        <h1>Hesed Ultra</h1>
        <nav>
          {TABS.filter(([, , parentOnly]) => parent || !parentOnly).map(([key, name]) => (
            <button key={key} className={current === key ? "tab on" : "tab"} onClick={() => setTab(key)}>{name}</button>
          ))}
        </nav>
        <button className="me" onClick={signOut} title="Switch person">
          <img className="pixel" src={`/sprites/portraits/${PORTRAIT[me.key]}.png`} alt="" /> {me.name} ⇄
        </button>
      </header>
      {current === "budget" && <BudgetHome ctx={ctx} />}
      {current === "today" && <Today ctx={ctx} date={date} setDate={setDate} />}
      {current === "calendar" && <CalendarPage ctx={ctx} date={date} onPick={(d) => { setDate(d); setTab("today"); }} />}
      {current === "money" && <Budget ctx={ctx} date={date} />}
      {current === "savings" && <Savings ctx={ctx} />}
      {current === "settings" && <Settings ctx={ctx} />}
    </main>
  );
}

export const PORTRAIT: Record<string, string> = {
  freznel: "freznel_neutral", diane: "diane_smile", ellie: "ellie_surprised", rafa: "rafa_surprised",
};
