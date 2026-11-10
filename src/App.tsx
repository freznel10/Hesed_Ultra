import { useEffect, useState } from "react";
import { api, type Health, type Member } from "./api";
import Town from "./scene/Town";

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
            <img className="pixel" src={`/sprites/${m.sprite}.png`} alt={m.name} />
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
