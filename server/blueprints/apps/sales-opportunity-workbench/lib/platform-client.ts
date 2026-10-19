/**
 * Platform API Client - Sales Opportunity Workbench.
 * Only runs client-side (browser). All calls go through the /api/oddjob/* proxy
 * which forwards to the Oddjob platform /datasets, /missions, /hil, /knowledge
 * endpoints. Sales "tables" are dataset collections in app_records.
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

// Records
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

// Sales collections (mirror knowledge_datasets in the cycle YAML)
export const SalesCollections = {
  leads: "leads",
  accounts: "accounts",
  opportunities: "opportunities",
  activities: "activities",
  stageHistory: "stage_history",
  opportunityWindows: "opportunity_windows",
  windowSnapshots: "window_snapshots",
  forecasts: "forecasts",
  quotas: "quotas",
  recommendations: "sales_recommendations",
} as const;

// Missions
export interface MissionTriggerResult { runId: number; status: string; queued?: boolean; message?: string; }
export function requireLaunchedMission(receipt: MissionTriggerResult | null | undefined): number {
  if (!receipt || typeof receipt.runId !== "number" || !Number.isInteger(receipt.runId) || receipt.runId < 1 || receipt.status === "queued" || receipt.queued) {
    throw new Error(receipt?.message || "Mission did not launch an active execution run");
  }
  return receipt.runId;
}
export const missions = {
  trigger: (name: string, context?: Record<string, unknown>) =>
    request<MissionTriggerResult>("/missions/trigger", {
      method: "POST",
      body: JSON.stringify({ name, context }),
    }).then((receipt) => {
      requireLaunchedMission(receipt);
      return receipt;
    }),
};

// HIL (Human-in-the-Loop)
export interface HilField {
  name: string;
  label: string;
  type: "select" | "textarea" | "text" | "slider" | "multiselect" | "radio";
  options?: string[];
  required?: boolean;
}

export interface HilRequest {
  id: string;
  formName: string;
  stage: string;
  fields: HilField[];
  context: Record<string, unknown>;
  createdAt: string;
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

// SSE event stream
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

// Knowledge graph (semantic search over vectorized opportunities)
export interface KnowledgeResult { content: string; score: number; source: string; }
export const knowledge = {
  query: (q: string, topK = 8) =>
    request<{ results: KnowledgeResult[] }>(
      `/knowledge/query?q=${encodeURIComponent(q)}&topK=${topK}`
    ),
};

// Deal Synthesis (Act II — grounded 3-bullet "why is this slipping" overlay)
export type SynthesisBulletKey = "silence_gaps" | "dark_social" | "competitor_signals";
export type SynthesisSeverity = "low" | "medium" | "high";
export interface SynthesisBullet {
  key: SynthesisBulletKey;
  label: string;
  detail: string;
  severity: SynthesisSeverity;
}
export interface DealSynthesis {
  opportunity_id: string;
  generated_at: string;
  source: "ai" | "heuristic";
  bullets: SynthesisBullet[];
  verdict: string;
}
export const synthesis = {
  forOpportunity: (opportunity_id: string) =>
    request<DealSynthesis>("/synthesis", {
      method: "POST",
      body: JSON.stringify({ opportunity_id }),
    }),
};

// Outbound Rescue (Act III — dispatch followup with a human breakpoint + re-arm)
export interface OutboundDraft {
  opportunity_id: string;
  deal_name: string;
  account_name: string;
  to: string | null;
  recipient_name: string | null;
  source: "ai" | "heuristic";
  prompt: string;
  subject: string;
  body: string;
  rationale: string;
}
export interface OutboundReArm {
  window_id: string;
  opportunity_id: string;
  ceiling: number;
  next_gate_deadline: string;
  snapshot_id: string;
}
export interface DispatchResult {
  dispatched: boolean;
  opportunity_id: string;
  activity_id: string;
  rearmed: boolean;
  rearm: OutboundReArm | null;
  notified: boolean;
  slack_notified: boolean;
}
export const outbound = {
  draft: (opportunity_id: string) =>
    request<OutboundDraft>("/outbound/draft", {
      method: "POST",
      body: JSON.stringify({ opportunity_id }),
    }),
  dispatch: (payload: { opportunity_id: string; subject: string; body: string; prompt?: string }) =>
    request<DispatchResult>("/outbound/dispatch", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

// Onboarding Scaffold (Act IV — CLOSED_WON → The Forge onboarding handoff)
export type OnboardingStageStatus = "pending" | "provisioning" | "done";
export interface OnboardingStage {
  key: string;
  name: string;
  status: OnboardingStageStatus;
}
export interface OnboardingRun {
  run_id: string;
  opportunity_id: string;
  deal_name: string;
  account_name: string;
  packet: {
    deal_name: string;
    account: { name: string; domain: string | null; industry: string | null; segment: string | null; owner_rep: string | null };
    primary_contact: { name: string | null; email: string | null };
    terms: { amount: number; currency: string; stage: string; closed_at: string | null };
  };
  stages: OnboardingStage[];
  status: "PROVISIONING" | "HANDED_OFF";
  child_cycle_id: number | null;
  created_at: string;
}
export interface ProvisionResult {
  provisioned: boolean;
  window_reconciled: boolean;
  handoff_launched: boolean;
  child_cycle_id: number | null;
  onboarding_run: OnboardingRun;
}
export const onboarding = {
  provision: (opportunity_id: string) =>
    request<ProvisionResult>("/onboarding/provision", {
      method: "POST",
      body: JSON.stringify({ opportunity_id }),
    }),
};

// Telemetry
export const telemetry = {
  emit: (event: string, level = "info", metadata?: Record<string, unknown>) =>
    request<unknown>("/telemetry", {
      method: "POST",
      body: JSON.stringify({ event, level, metadata }),
    }).catch(() => {}),
};

// Sales domain types (mirror the cycle's knowledge_datasets)
export type Stage = "PROSPECT" | "QUALIFIED" | "PROPOSAL" | "NEGOTIATION" | "CLOSED_WON" | "CLOSED_LOST";
export type WindowStatus = "ARMED" | "DECAYING" | "WON" | "LOST";
export type RecommendationKind = "slip_risk" | "stalled" | "aging" | "next_best_action" | "win" | "loss";
export type RecommendationStatus = "OPEN" | "ACTED" | "SNOOZED" | "DISMISSED";
export type LeadStatus = "NEW" | "QUALIFYING" | "QUALIFIED" | "DISQUALIFIED";

/** The open stages, in pipeline order (terminal stages handled separately). */
export const OPEN_STAGES: Stage[] = ["PROSPECT", "QUALIFIED", "PROPOSAL", "NEGOTIATION"];

export interface Account extends AppRecord {
  account_id: string;
  name: string;
  domain?: string;
  industry?: string;
  segment?: "SMB" | "MID_MARKET" | "ENTERPRISE";
  owner_rep?: string;
}

export interface Lead extends AppRecord {
  lead_id: string;
  name: string;
  company: string;
  email: string;
  phone?: string;
  source?: string;
  estimated_value?: number;
  timeline?: string;
  status?: LeadStatus;
  qualification_score?: number;
  created_at?: string;
}

export interface Opportunity extends AppRecord {
  opportunity_id: string;
  account_id: string;
  lead_id?: string;
  name: string;
  amount: number;
  currency?: string;
  stage: Stage;
  stage_entitlement?: number;
  owner_rep?: string;
  opened_at?: string;
  expected_close?: string;
  outcome?: "won" | "lost" | null;
  closed_at?: string | null;
}

export interface Activity extends AppRecord {
  activity_id: string;
  opportunity_id: string;
  type: string;
  occurred_at: string;
  actor?: string;
  summary?: string;
  is_rearm_signal?: boolean;
  rearm_effect?: "HOLD" | "REBASELINE" | "NONE";
  weight?: number;
}

export interface StageHistory extends AppRecord {
  entry_id: string;
  opportunity_id: string;
  from_stage: string;
  to_stage: string;
  changed_at: string;
  changed_by?: string;
}

export interface OpportunityWindow extends AppRecord {
  window_id: string;
  opportunity_id: string;
  amount: number;
  opened_at: string;
  cycle_length_days: number;
  gate_ladder: string;
  current_gate_index: number;
  current_ceiling: number;
  next_gate_deadline: string;
  grace_period_hours?: number;
  rearm_signals?: string;
  last_rearm_at?: string | null;
  status: WindowStatus;
  outcome?: "won" | "lost" | null;
  closed_at?: string | null;
}

export interface WindowSnapshot extends AppRecord {
  snapshot_id: string;
  window_id: string;
  opportunity_id: string;
  taken_at: string;
  gate_index: number;
  ceiling_before: number;
  ceiling_after: number;
  amount_at_snapshot: number;
  weighted_value: number;
  trigger: string;
  realized_outcome: number | null;
}

export interface Forecast extends AppRecord {
  forecast_id: string;
  period: string;
  generated_at: string;
  weighted_pipeline: number;
  committed: number;
  best_case: number;
  deal_count: number;
  generated_by?: string;
}

export interface Quota extends AppRecord {
  quota_id: string;
  owner_rep: string;
  period: string;
  target_amount: number;
  attainment?: number;
}

export interface SalesRecommendation extends AppRecord {
  rec_id: string;
  opportunity_id: string;
  kind: RecommendationKind;
  title: string;
  body: string;
  status: RecommendationStatus;
  payload?: Record<string, unknown>;
  created_at?: string;
}

// Helpers
export function fmtCurrency(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n || 0);
}

/** Decode a window's JSON-encoded gate ladder, falling back to the default. */
export function parseLadder(w: Pick<OpportunityWindow, "gate_ladder">): number[] {
  try {
    const arr = JSON.parse(w.gate_ladder);
    if (Array.isArray(arr) && arr.length >= 2 && arr.every((n) => typeof n === "number")) return arr;
  } catch {}
  return [90, 60, 30, 0];
}

/** Tailwind text/bg/border accent for a live win-probability ceiling. */
export function ceilingAccent(ceiling: number): { text: string; bg: string; border: string; bar: string } {
  if (ceiling >= 90) return { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", bar: "bg-emerald-500" };
  if (ceiling >= 60) return { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", bar: "bg-amber-500" };
  if (ceiling >= 30) return { text: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30", bar: "bg-orange-500" };
  // Sub-30% ceiling = decaying/critical → spec "Neon Crimson" (#ef4444 = red-500).
  return { text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", bar: "bg-red-500" };
}
