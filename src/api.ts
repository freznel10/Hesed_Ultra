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
export type CategoryLine = {
  category: string; name: string; spentCents: number; limitCents: number | null;
  remainingCents: number | null; status: "none" | "ok" | "warning" | "over";
};
export type MonthSummary = { month: string; incomeCents: number; spentCents: number; netCents: number; categories: CategoryLine[] };
export type Pace = { monthsLeft: number | null; neededPerMonthCents: number | null; projectedMonth: string | null; status: "done" | "on_track" | "behind" | "no_plan" };
export type Goal = {
  id: number; name: string; targetCents: number; targetDate: string | null; monthlyCents: number | null;
  savedCents: number; remainingCents: number; percent: number; sweptCents: number; pace: Pace;
};
export type BudgetLine = {
  id: number; externalId: string; name: string; month: string; periodStart: string; periodEnd: string;
  plannedCents: number; availableCents: number; usedCents: number; remainingCents: number; carryover: boolean;
  categories: string[]; leftAlone: boolean; syncedAt: string;
  sweptCents: number; sweepableCents: number; ended: boolean; status: "ok" | "low" | "over";
  sweeps: { id: number; goalId: number; goal: string; amountCents: number; createdAt: string }[];
};
export type BudgetMonth = {
  month: string; ended: boolean; availableCents: number; usedCents: number; leftoverCents: number;
  overCents: number; sweptCents: number; sweepableCents: number; budgets: BudgetLine[];
};
export type BudgetOverview = {
  current: BudgetMonth;
  pending: { totalCents: number; budgets: BudgetLine[] };
  history: { month: string; sweptCents: number }[];
  lastSync: string | null;
};
export type DateOrder = "MDY" | "DMY" | "YMD";
export type CsvSkipped = { noDateOrAmount: number; transfers: number; otherCurrency: number; badDate: number; zero: number };
export type CsvPreview = {
  delimiter: string; columns: Record<string, string>; dateOrder: DateOrder; dateOrderSure: boolean; rows: number; count: number;
  skipped: CsvSkipped; from: string | null; to: string | null; incomeCents: number; expenseCents: number; categories: string[];
  sample: { date: string; kind: "expense" | "income"; amountCents: number; categoryPath: string; payee: string; note: string }[];
};
export type CsvResult = { count: number; from: string | null; to: string | null; skipped: CsvSkipped; created: number; updated: number; unchanged: number };
export type BudgetPlan = { id: number; name: string; monthlyCents: number; categories: string[]; startMonth: string };
export type GoalUpdate = { name?: string; targetCents?: number; targetDate?: string | null; monthlyCents?: number | null; archived?: boolean };
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
  createGoal: (name: string, targetCents: number, targetDate?: string, monthlyCents?: number) => call<Goal>("POST", "/goals", { name, targetCents, targetDate, monthlyCents }),
  updateGoal: (id: number, update: GoalUpdate) => call<Goal>("PUT", `/goals/${id}`, update),
  budget: (month: string) => call<BudgetOverview>("GET", `/budget/${month}`),
  sweep: (budgetPeriodId: number, goalId: number, amountCents?: number, note = "") => call("POST", "/sweeps", { budgetPeriodId, goalId, amountCents, note }),
  undoSweep: (id: number) => call("DELETE", `/sweeps/${id}`),
  csvPreview: (text: string, dateOrder?: DateOrder) => call<CsvPreview>("POST", "/import/csv", { text, dateOrder }),
  csvImport: (text: string, dateOrder?: DateOrder) => call<CsvResult>("POST", "/import/csv", { text, dateOrder, commit: true }),
  budgetPlans: () => call<{ plans: BudgetPlan[]; categories: string[] }>("GET", "/budget-plans"),
  createPlan: (p: Omit<BudgetPlan, "id">) => call<BudgetPlan>("POST", "/budget-plans", p),
  updatePlan: (id: number, p: Partial<Omit<BudgetPlan, "id">>) => call<BudgetPlan>("PUT", `/budget-plans/${id}`, p),
  removePlan: (id: number) => call("DELETE", `/budget-plans/${id}`),
  leaveAlone: (budgetPeriodId: number, value: boolean) => call("PUT", `/budget-periods/${budgetPeriodId}/leave-alone`, { value }),
  addSavings: (goalId: number, date: string, amountCents: number, note = "") => call("POST", "/savings", { goalId, date, amountCents, note }),
  changes: () => call<Change[]>("GET", "/changes"),
  setPin: (member: string, pin: string) => call("PUT", `/members/${member}/pin`, { pin }),
  tokens: () => call<Token[]>("GET", "/tokens"),
  createToken: (name: string, member: string) => call<{ name: string; token: string }>("POST", "/tokens", { name, member }),
  revokeToken: (id: number) => call("DELETE", `/tokens/${id}`),
};
