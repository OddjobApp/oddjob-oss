/**
 * Platform API Client — Ops Workbench
 * Only runs client-side (browser). All calls go through /api/oddjob/* proxy.
 */

const BASE = "/api/oddjob";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (typeof window === "undefined") return {} as T;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body?.error ?? body?.message ?? msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── Records ───────────────────────────────────────────────────────────────────

export interface AppRecord {
  id: string;
  [key: string]: unknown;
  _createdAt: string;
  _updatedAt: string;
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
  delete: (collection: string, id: string) =>
    request<void>(`/datasets/${id}?collection=${encodeURIComponent(collection)}`, {
      method: "DELETE",
    }),
};

// ── Missions ──────────────────────────────────────────────────────────────────

export interface MissionTriggerResult {
  runId: number;
  status: string;
  queued?: boolean;
  message?: string;
}

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

// ── SSE event stream ──────────────────────────────────────────────────────────

export interface PlatformEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

/** Subscribe to the platform's real-time event stream. Returns an unsubscribe fn. */
export const events = {
  subscribe: (handler: (event: PlatformEvent) => void): (() => void) => {
    if (typeof window === "undefined") return () => {};
    const source = new EventSource(`${BASE}/events/stream`);
    source.onmessage = (e) => {
      try {
        handler(JSON.parse(e.data));
      } catch {}
    };
    source.onerror = () => {
      // EventSource reconnects automatically
    };
    return () => source.close();
  },
};

// ── Integrations ──────────────────────────────────────────────────────────────

export interface BugCreateResult {
  success: boolean;
  issueKey?: string;
  error?: string;
}

export interface SlackPostResult {
  success: boolean;
  error?: string;
}

export const integrations = {
  bugs: {
    create: (data: {
      title: string;
      description?: string;
      severity?: string;
      jiraProject?: string;
    }) =>
      request<BugCreateResult>("/integrations/bugs", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },
  slack: {
    post: (data: { message: string; channel?: string }) =>
      request<SlackPostResult>("/integrations/slack/post", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },
};

// ── Knowledge graph ───────────────────────────────────────────────────────────

export interface KnowledgeResult {
  content: string;
  score: number;
  source: string;
}

export const knowledge = {
  query: (q: string, topK = 5) =>
    request<{ results: KnowledgeResult[] }>(
      `/knowledge/query?q=${encodeURIComponent(q)}&topK=${topK}`
    ),
};

// ── Telemetry ─────────────────────────────────────────────────────────────────

export const telemetry = {
  emit: (
    event: string,
    level: "info" | "warn" | "error" | "critical" = "info",
    metadata?: Record<string, unknown>
  ) =>
    request<{ status: string }>("/telemetry", {
      method: "POST",
      body: JSON.stringify({ event, level, metadata }),
    }).catch(() => {}),
};

// ── Incident record shape (typed convenience) ─────────────────────────────────

export interface IncidentRecord extends AppRecord {
  severity: "SEV-1" | "SEV-2" | "SEV-3";
  component: string;
  description: string;
  triggeredBy: string;
  status:
    | "investigating"
    | "mitigated"
    | "resolved"
    | "hotfix_triggered"
    | string;
  timestamp: string;
}

export interface SloMetricRecord extends AppRecord {
  service: string;
  targetSlo: string;
  current: string;
  errorBudget: string;
  status: "healthy" | "at_risk" | "breached" | string;
}
