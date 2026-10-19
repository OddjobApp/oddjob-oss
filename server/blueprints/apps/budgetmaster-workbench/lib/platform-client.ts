/**
 * Platform API Client — BudgetMaster Workbench (SAWM).
 * Only runs client-side (browser). All calls go through /api/oddjob/* proxy
 * which forwards to the Oddjob platform /datasets, /missions, /hil, /knowledge
 * endpoints. Finance "tables" are dataset collections in app_records.
 */
const BASE = typeof window !== "undefined" ? "/api/oddjob" : "";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (typeof window === "undefined") return {} as T;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      msg = errorMessage(b?.error ?? b?.message, msg);
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function errorMessage(raw: unknown, fallback: string): string {
  if (typeof raw === "string" && raw.trim()) return raw;
  if (raw && typeof raw === "object") {
    const message = (raw as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    try { return JSON.stringify(raw); } catch { return fallback; }
  }
  if (raw != null && typeof raw !== "object") return String(raw);
  return fallback;
}

// ── Records ──────────────────────────────────────────────────────────────────
export interface AppRecord {
  id: string;
  [key: string]: unknown;
  _createdAt?: string;
  _updatedAt?: string;
}

export const records = {
  list: (collection: string) =>
    request<AppRecord[]>(`/datasets?collection=${encodeURIComponent(collection)}`),
  create: (collection: string, data: Record<string, unknown>) =>
    request<AppRecord>(`/datasets?collection=${encodeURIComponent(collection)}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (collection: string, id: string, data: Record<string, unknown>) =>
    request<AppRecord>(`/datasets/${id}?collection=${encodeURIComponent(collection)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

// ── Finance collections (mirror knowledge_datasets in the cycle YAML) ─────────
export const FinanceCollections = {
  budgetContexts: "budget_contexts",
  budgetCategories: "budget_categories",
  accounts: "finance_accounts",
  transactions: "transactions",
  deadMansSwitches: "dead_mans_switches",
  installmentTokens: "installment_tokens",
  subscriptions: "subscriptions",
  purchaseSandboxes: "purchase_sandboxes",
  balanceSnapshots: "balance_snapshots",
  recommendations: "finance_recommendations",
  taxEstimates: "tax_estimates",
  taxDocuments: "tax_documents",
} as const;

// ── Missions ──────────────────────────────────────────────────────────────────
export interface MissionTriggerResult { runId: number | null; status: string; queued?: boolean; outboxRecordId?: string | number; message?: string; }
export function requireLaunchedMission(receipt: MissionTriggerResult | null | undefined): number {
  if (!receipt || typeof receipt.runId !== "number" || !Number.isInteger(receipt.runId) || receipt.runId < 1 || receipt.status === "queued" || receipt.queued) {
    throw new Error(receipt?.message || "Mission did not launch an active execution run");
  }
  return receipt.runId;
}
export const missions = {
  trigger: (name: string, context?: Record<string, unknown>) =>
    request<MissionTriggerResult & { runId: number }>("/missions/trigger", {
      method: "POST",
      body: JSON.stringify({ name, context }),
    }).then((receipt) => {
      requireLaunchedMission(receipt);
      return receipt;
    }),
};

// ── HIL (Human-in-the-Loop) ───────────────────────────────────────────────────
export interface HilField {
  name: string;
  label: string;
  type: "select" | "textarea" | "text" | "slider" | "multiselect" | "radio";
  options?: string[];
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface HilRequest {
  id: string;
  formName: string;
  stage: string;
  fields: HilField[];
  context: Record<string, unknown>;
  createdAt: string;
  slaHours?: number;
}

export const hil = {
  pending: (stage?: string) =>
    request<HilRequest[]>(`/hil${stage ? `?stage=${encodeURIComponent(stage)}` : ""}`),
  submit: (id: string, decision: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/hil/${id}/submit`, {
      method: "POST",
      body: JSON.stringify(decision),
    }),
};

// ── SSE event stream ──────────────────────────────────────────────────────────
export interface PlatformEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

/** Subscribe to the cycle's real-time event stream. Returns an unsubscribe fn. */
export const events = {
  subscribe: (handler: (event: PlatformEvent) => void): (() => void) => {
    if (typeof window === "undefined") return () => {};
    const source = new EventSource(`${BASE}/events/stream`);
    source.onmessage = (e) => {
      try { handler(JSON.parse(e.data)); } catch {}
    };
    source.onerror = () => { /* reconnects automatically */ };
    return () => source.close();
  },
};

// ── Knowledge graph (semantic search over vectorized transactions) ────────────
export interface KnowledgeResult { content: string; score: number; source: string; }
export const knowledge = {
  query: (q: string, topK = 8) =>
    request<{ results: KnowledgeResult[] }>(
      `/knowledge/query?q=${encodeURIComponent(q)}&topK=${topK}`
    ),
};

// ── Telemetry ─────────────────────────────────────────────────────────────────
export const telemetry = {
  emit: (event: string, level = "info", metadata?: Record<string, unknown>) =>
    request<unknown>("/telemetry", {
      method: "POST",
      body: JSON.stringify({ event, level, metadata }),
    }).catch(() => {}),
};

// ── Finance domain types ──────────────────────────────────────────────────────
export type AccountType = "CHECKING" | "SAVINGS" | "BROKERAGE" | "CREDIT_CARD" | "LOAN_LIABILITY";
export type TxStatus = "UNRECONCILED" | "CLEARED" | "RECONCILED";
export type RecommendationKind = "sweep" | "quarantine" | "dms_fault" | "capex_overrun";
export type RecommendationStatus = "open" | "approved" | "dismissed";

export interface FinanceAccount extends AppRecord {
  account_id: string;
  name: string;
  account_type: AccountType;
  base_currency: string;
  current_balance: number;
}

export interface BudgetContext extends AppRecord {
  context_id: string;
  name: string;
  archetype_mode?: "ENVELOPE" | "CAPEX_PROJECT" | "TAX_SCHEDULE_E";
}

export interface Transaction extends AppRecord {
  fitid: string;
  account_id: string;
  context_id: string;
  category_id?: string;
  timestamp: string;
  payee_raw: string;
  payee_clean?: string;
  amount: number;
  current_status: TxStatus;
  is_split?: boolean;
  parent_tx_id?: string;
}

export interface DeadMansSwitch extends AppRecord {
  switch_id: string;
  label: string;
  account_id: string;
  expected_direction: "INFLOW" | "OUTFLOW";
  amount_floor: number;
  payee_token: string;
  status: "ARMED" | "SATISFIED" | "FAULT";
  expiration_deadline: string;
  grace_period_hours?: number;
}

export interface Subscription extends AppRecord {
  subscription_id: string;
  payee_token: string;
  monthly_cost: number;
  cadence: string;
  usage_hours_logged: number;
  quarantine_flag: boolean;
  last_seen_at?: string;
}

export interface PurchaseSandbox extends AppRecord {
  sandbox_id: string;
  label: string;
  inputs: Record<string, unknown>;
  result: {
    financed: number;
    monthlyPayment: number;
    totalPaid: number;
    totalInterest: number;
    opportunityCostOfDownPayment: number;
    trueCost: number;
    schedule: Array<{ month: number; payment: number; interest: number; principalPaid: number; balance: number }>;
  };
  computed_at: string;
}

export interface BalanceSnapshot extends AppRecord {
  snapshot_id: string;
  period: string;
  net_worth: number;
  total_assets: number;
  total_liabilities: number;
  breakdown: Record<string, number>;
}

export interface FinanceRecommendation extends AppRecord {
  rec_id: string;
  kind: RecommendationKind;
  title: string;
  body: string;
  status: RecommendationStatus;
  payload?: Record<string, unknown>;
  created_at?: string;
}

// ── Currency helper ───────────────────────────────────────────────────────────
export function fmtCurrency(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n || 0);
}
