/**
 * Platform API Client — Agent Training Workbench
 * Only runs client-side (browser). All calls go through /api/oddjob/* proxy.
 */
const BASE = typeof window !== "undefined" ? "/api/oddjob" : "";

function errorMessage(raw: unknown, fallback: string): string {
  if (typeof raw === "string" && raw.trim()) return raw;
  if (raw && typeof raw === "object") {
    const message = (raw as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    try {
      return JSON.stringify(raw);
    } catch {
      return fallback;
    }
  }
  if (raw != null && typeof raw !== "object") return String(raw);
  return fallback;
}

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

// ── Records ──────────────────────────────────────────────────────────────────
export interface AppRecord {
  id: string;
  [key: string]: unknown;
  _createdAt: string;
  _updatedAt: string;
}

export const records = {
  list:   (collection: string) =>
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

// ── Knowledge graph ───────────────────────────────────────────────────────────
export interface KnowledgeResult { content: string; score: number; source: string; }
export const knowledge = {
  query: (q: string, topK = 5) =>
    request<{ results: KnowledgeResult[] }>(
      `/knowledge/query?q=${encodeURIComponent(q)}&topK=${topK}`
    ),
};

// ── Integrations ──────────────────────────────────────────────────────────────
export const integrations = {
  bugs: {
    create: (data: {
      title: string;
      description?: string;
      severity?: string;
      jiraProject?: string;
    }) =>
      request<{ success: boolean; issueKey?: string }>("/integrations/bugs", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },
  slack: {
    post: (data: { message: string; channel?: string }) =>
      request<{ success: boolean }>("/integrations/slack/post", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },
  jira: {
    search: (jql: string, limit = 50) =>
      request<{ success: boolean; issues: unknown[]; total: number; error?: string }>(
        "/integrations/jira/search",
        { method: "POST", body: JSON.stringify({ jql, limit }) }
      ),
  },
};

// ── Confluence ────────────────────────────────────────────────────────────────
export interface ConfluencePublishResult { success: boolean; pageId?: string; url?: string; }
export const confluence = {
  publish: (params: { title: string; content: string; space?: string }) =>
    request<ConfluencePublishResult>("/integrations/confluence/publish", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  search: (query: string, limit = 10) =>
    request<{ success: boolean; results: unknown[] }>("/integrations/confluence/search", {
      method: "POST",
      body: JSON.stringify({ query, limit }),
    }),
};

// ── Telemetry ─────────────────────────────────────────────────────────────────
export const telemetry = {
  emit: (event: string, level = "info", metadata?: Record<string, unknown>) =>
    request<unknown>("/telemetry", {
      method: "POST",
      body: JSON.stringify({ event, level, metadata }),
    }).catch(() => {}),
};

// ── Agent Training-specific types ─────────────────────────────────────────────
export interface EvalCase {
  id: string;
  input: string;
  expectedOutput: string;
  category: string;
}

export interface EvalResult {
  id: string;
  caseId: string;
  agentVersion: string;
  actualOutput: string;
  passed: boolean;
  score: number;
  failureCategory?: string;
  timestamp: string;
}

export interface FailurePattern {
  id: string;
  category: string;
  count: number;
  examples: string[];
  rootCause: string;
  severity: 'critical' | 'major' | 'minor';
}

export interface TrainingPair {
  id: string;
  input: string;
  idealOutput: string;
  source: string;
  approved: boolean;
}

export interface PromptVersion {
  id: string;
  version: string;
  promptText: string;
  benchmark: number;
  createdAt: string;
  notes: string;
}

export interface AgentUpdate {
  id: string;
  agentId: string;
  agentName: string;
  fromVersion: string;
  toVersion: string;
  status: 'pending' | 'staged' | 'promoted' | 'rolled_back';
  metrics: { baseline: number; candidate: number };
}
