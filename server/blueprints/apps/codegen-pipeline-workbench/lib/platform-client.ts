/**
 * Platform API Client - Codegen Pipeline Workbench.
 * Only runs client-side (browser). All calls go through the /api/oddjob/* proxy
 * which forwards to the Oddjob platform /datasets, /missions, /events endpoints.
 * Generation "sessions" and "phase artifacts" are dataset collections in app_records.
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
};

// Collections (mirror the cycle's knowledge_datasets).
export const Collections = {
  sessions: "generation_sessions",
  phaseArtifacts: "phase_artifacts",
  qualityReports: "quality_reports",
} as const;

// Missions
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

// SSE event stream
export interface PlatformEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}
export const events = {
  subscribe: (handler: (event: PlatformEvent) => void): (() => void) => {
    if (typeof window === "undefined") return () => {};
    const source = new EventSource(`${BASE}/events/stream`);
    source.onmessage = (e) => { try { handler(JSON.parse(e.data)); } catch {} };
    source.onerror = () => { /* reconnects automatically */ };
    return () => source.close();
  },
};

// Telemetry
export const telemetry = {
  emit: (event: string, level = "info", metadata?: Record<string, unknown>) =>
    request<unknown>("/telemetry", {
      method: "POST",
      body: JSON.stringify({ event, level, metadata }),
    }).catch(() => {}),
};

// ─── Codegen domain types (mirror the sdlc-pipeline autonomous phases) ───────

export const PHASES = [
  "context_load",
  "change_plan",
  "apply_edits",
  "test_loop",
  "quality_gate",
  "pr_generation",
] as const;
export type PhaseName = (typeof PHASES)[number];

export type SessionStatus =
  | "pending"
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export interface GenerationSession extends AppRecord {
  session_id?: string;
  objective?: string;
  status?: SessionStatus;
  current_phase?: PhaseName | string | null;
  repository?: string;
  total_cost_usd?: number;
  started_at?: string;
  completed_at?: string | null;
}

export interface QualityReport extends AppRecord {
  session_id?: string;
  gate_passed?: boolean;
  fix_attempts?: number;
  mutation_score?: number;
  verification_level?: string;
  pr_url?: string;
  created_at?: string;
}

export const PHASE_LABEL: Record<PhaseName, string> = {
  context_load: "Context Load",
  change_plan: "Change Plan",
  apply_edits: "Apply Edits",
  test_loop: "Test Loop",
  quality_gate: "Quality Gate",
  pr_generation: "PR Generation",
};

/** Tailwind accents for a session status. */
export function statusAccent(status?: string): { text: string; bg: string; border: string } {
  switch (status) {
    case "completed": return { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" };
    case "active": return { text: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" };
    case "failed": return { text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" };
    case "blocked": return { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" };
    case "cancelled": return { text: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/30" };
    default: return { text: "text-slate-300", bg: "bg-white/[0.03]", border: "border-white/10" };
  }
}

/** Zero-based index of a phase in the pipeline order, or -1. */
export function phaseIndex(phase?: string | null): number {
  if (!phase) return -1;
  return (PHASES as readonly string[]).indexOf(phase);
}

export function fmtCurrency(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n || 0);
}
