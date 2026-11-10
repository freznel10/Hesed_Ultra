export type Member = { id: number; key: string; name: string; role: "parent" | "child"; color: string; sprite: string | null };
export type Health = { ok: boolean; db: string; members: number; time: string };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => get<Health>("/health"),
  members: () => get<Member[]>("/members"),
};
