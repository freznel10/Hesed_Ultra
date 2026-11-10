import { useCallback, useEffect, useState } from "react";
import { api, type Change, type Token } from "../api";
import type { AppContext } from "../App";

export default function Settings({ ctx }: { ctx: AppContext }) {
  const parent = ctx.user.role === "parent";
  const [pinFor, setPinFor] = useState(ctx.user.key);
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [tokenName, setTokenName] = useState("");
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);

  const load = useCallback(async () => {
    if (!parent) return;
    try { setTokens(await api.tokens()); setChanges(await api.changes()); } catch (e) { setError((e as Error).message); }
  }, [parent]);
  useEffect(() => { load(); }, [load]);

  const name = (key: string) => ctx.reference.members.find((m) => m.key === key)?.name ?? key;
  async function savePin(e: React.FormEvent) {
    e.preventDefault();
    try { await api.setPin(pinFor, pin); setPin(""); setError(""); setMsg(`PIN saved for ${name(pinFor)}.`); } catch (err) { setMsg(""); setError((err as Error).message); }
  }
  async function addToken(e: React.FormEvent) {
    e.preventDefault();
    try { setFresh(await api.createToken(tokenName, ctx.user.key)); setTokenName(""); setError(""); load(); } catch (err) { setError((err as Error).message); }
  }

  return (
    <section>
      <h2>Settings</h2>
      {error && <p className="error" role="alert">{error}</p>}

      <form className="panel row" onSubmit={savePin}>
        <h3>PIN for signing in online</h3>
        {parent && (
          <label>For
            <select value={pinFor} onChange={(e) => setPinFor(e.target.value)}>
              {ctx.reference.members.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
            </select>
          </label>
        )}
        <label>New PIN (4–8 digits) <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} /></label>
        <button className="primary">Save PIN</button>
        {msg && <p className="ok">{msg}</p>}
        {!ctx.session.loginRequired && <small>On this computer nobody needs a PIN. PINs are used once the app is online.</small>}
      </form>

      {parent && (
        <>
          <div className="panel">
            <h3>Claude and other agents</h3>
            <p>On this computer, connect Claude Code with:</p>
            <pre>claude mcp add hesed -- npx tsx mcp/stdio.ts</pre>
            <p>Once the app is online, agents connect to <code>/mcp</code> with a token. Each token acts as you, and every change it makes is listed below under its name.</p>
            <form className="row" onSubmit={addToken}>
              <label>New token name <input value={tokenName} placeholder="e.g. claude" onChange={(e) => setTokenName(e.target.value)} /></label>
              <button className="primary">Create token</button>
            </form>
            {fresh && <p className="ok">Token for “{fresh.name}” (copy it now, it won't be shown again):<br /><code>{fresh.token}</code></p>}
            <table className="table">
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td><td>acts as {name(t.member)}</td>
                    <td>{t.revoked ? "revoked" : t.lastUsedAt ? `last used ${t.lastUsedAt.slice(0, 10)}` : "never used"}</td>
                    <td>{!t.revoked && <button onClick={async () => { await api.revokeToken(t.id); load(); }}>Revoke</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h3>Recent changes</h3>
            {changes.length === 0 && <p className="empty">No changes yet.</p>}
            <table className="table">
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id}>
                    <td>{new Date(c.at).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })}</td>
                    <td>{name(c.actor)}</td><td>{c.source}</td><td>{c.action} {c.entity.replace("_", " ")} #{c.entityId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
