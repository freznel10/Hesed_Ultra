export type Role = "parent" | "child";
export type User = { key: string; role: Role };
export type Member = { key: string; name: string; role: Role; color: string; sprite: string | null };
export type Place = { key: string; name: string; sprite: string | null };
export type ActivityType = { key: string; name: string; defaultPlace: string | null };
export type Category = { key: string; name: string; kind: "expense" | "income" };
export type Reference = { members: Member[]; places: Place[]; activityTypes: ActivityType[]; categories: Category[] };

export type Activity = {
  id: number; date: string; startTime: string | null; endTime: string | null;
  type: string; place: string | null; title: string; note: string; mood: number | null; members: string[];
};
export type Transaction = {
  id: number; date: string; kind: "expense" | "income"; amountCents: number;
  category: string; member: string | null; payee: string; note: string; activityId: number | null;
};
export type Day = { date: string; activities: Activity[]; transactions: Transaction[]; spentCents: number };
export type CalendarDay = { date: string; activities: { type: string; place: string | null; members: string[] }[]; spentCents: number };
export type BudgetLine = {
  category: string; name: string; spentCents: number; limitCents: number | null;
  remainingCents: number | null; status: "none" | "ok" | "warning" | "over";
};
export type MonthSummary = { month: string; incomeCents: number; spentCents: number; netCents: number; categories: BudgetLine[] };
export type Goal = { id: number; name: string; targetCents: number; targetDate: string | null; savedCents: number; remainingCents: number; percent: number };
export type Change = { id: number; at: string; actor: string; source: string; entity: string; entityId: number; action: string };
export type Token = { id: number; name: string; member: string; createdAt: string; lastUsedAt: string | null; revoked: boolean };
export type Session = { loginRequired: boolean; user: User | null; members: Member[] };

export type ActivityInput = {
  date: string; type: string; members: string[]; place?: string; startTime?: string; endTime?: string;
  title?: string; note?: string; mood?: number;
};
export type TransactionInput = {
  date: string; kind: "expense" | "income"; amountCents: number; category: string;
  member?: string; payee?: string; note?: string; activityId?: number;
};

/** On your own machine the app just says who is using it; online a login cookie is used instead. */
let localMember: string | null = localStorage.getItem("hesed.member");
export function setLocalMember(key: string | null) {
  localMember = key;
  if (key) localStorage.setItem("hesed.member", key);
  else localStorage.removeItem("hesed.member");
}
export const getLocalMember = () => localMember;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(localMember ? { "x-member": localMember } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  session: () => call<Session>("GET", "/session"),
  login: (member: string, pin: string) => call<{ user: User }>("POST", "/login", { member, pin }),
  logout: () => call("POST", "/logout", {}),
  reference: () => call<Reference>("GET", "/reference"),
  day: (date: string) => call<Day>("GET", `/day/${date}`),
  calendar: (month: string) => call<{ month: string; days: CalendarDay[] }>("GET", `/calendar/${month}`),
  logActivity: (a: ActivityInput) => call<Activity>("POST", "/activities", a),
  updateActivity: (id: number, a: ActivityInput) => call<Activity>("PUT", `/activities/${id}`, a),
  deleteActivity: (id: number) => call("DELETE", `/activities/${id}`),
  logTransaction: (t: TransactionInput) => call<Transaction>("POST", "/transactions", t),
  updateTransaction: (id: number, t: TransactionInput) => call<Transaction>("PUT", `/transactions/${id}`, t),
  deleteTransaction: (id: number) => call("DELETE", `/transactions/${id}`),
  month: (month: string) => call<{ summary: MonthSummary | null; transactions: Transaction[] }>("GET", `/month/${month}`),
  setBudget: (month: string, category: string, limitCents: number) => call("PUT", "/budgets", { month, category, limitCents }),
  goals: () => call<Goal[]>("GET", "/goals"),
  createGoal: (name: string, targetCents: number, targetDate?: string) => call<Goal>("POST", "/goals", { name, targetCents, targetDate }),
  addSavings: (goalId: number, date: string, amountCents: number, note = "") => call("POST", "/savings", { goalId, date, amountCents, note }),
  changes: () => call<Change[]>("GET", "/changes"),
  setPin: (member: string, pin: string) => call("PUT", `/members/${member}/pin`, { pin }),
  tokens: () => call<Token[]>("GET", "/tokens"),
  createToken: (name: string, member: string) => call<{ name: string; token: string }>("POST", "/tokens", { name, member }),
  revokeToken: (id: number) => call("DELETE", `/tokens/${id}`),
};
