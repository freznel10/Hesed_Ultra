import { useEffect, useState } from "react";
import { api, type Health, type Member } from "./api";
import Town from "./scene/Town";

const PORTRAIT: Record<string, string> = {
  freznel: "freznel_neutral",
  diane: "diane_smile",
  ellie: "ellie_surprised",
  rafa: "rafa_surprised",
};

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(String(e)));
    api.members().then(setMembers).catch(() => {});
  }, []);

  return (
    <main>
      <header>
        <h1>Hesed Ultra</h1>
        <p className="sub">Our family's day, in pixels.</p>
      </header>

      <Town />

      <section className="family">
        {members.map((m) => (
          <figure key={m.id} className="member">
            <img
              className="pixel"
              src={`/sprites/${m.sprite}.png`}
              alt={m.name}
              // show at exactly 2x so every art pixel stays square
              onLoad={(e) => (e.currentTarget.style.width = `${e.currentTarget.naturalWidth * 2}px`)}
            />
            <img className="pixel portrait" src={`/sprites/portraits/${PORTRAIT[m.key] ?? ""}.png`} alt="" />
            <figcaption>
              {m.name}
              <span className="role">{m.role}</span>
            </figcaption>
          </figure>
        ))}
      </section>

      <footer className="status">
        {health ? `API ok · ${health.members} members · ${health.db}` : error ? `API error: ${error}` : "Connecting to API…"}
      </footer>
    </main>
  );
}
