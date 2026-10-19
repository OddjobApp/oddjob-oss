/**
 * Platform API Client — DevOps Workbench
 *
 * All calls are client-side only (guarded by `typeof window` checks).
 * Requests go through the /api/oddjob/* Pages Router proxy which attaches
 * the ODDJOB_APP_TOKEN Bearer credential before forwarding to the platform.
 */

const BASE = typeof window !== "undefined" ? "/api/oddjob" : "";

// ── Core fetch helper ─────────────────────────────────────────────────────────

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
    } catch {
      // ignore parse error — keep the HTTP status message
    }
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}

// ── TypeScript interfaces ─────────────────────────────────────────────────────

export interface AppRecord {
  id: string;
  _createdAt: string;
  _updatedAt: string;
  [key: string]: unknown;
}

export interface DeploymentRecord extends AppRecord {
  env: string;
  version: string;
  triggeredBy: string;
  status: string;
  timestamp: string;
  runId?: string | number;
}

export interface CabApprovalRecord extends AppRecord {
  decision: "approve" | "defer" | "reject" | string;
  version?: string;
  reviewedBy?: string;
  notes?: string;
}

export interface IacChangeRecord extends AppRecord {
  resource: string;
  action: string;
  risk: "Low" | "Medium" | "High" | string;
  autoApproved: "Yes" | "No" | boolean;
}

export interface FleetAgent {
  agent: string;
  mission: string;
  status: string;
  risk: string;
  confidence: number | null;
  currentStep: string;
}

export interface FleetWorkload {
  cycle: unknown;
  agents: FleetAgent[];
  attention: Array<{
    severity: string;
    agent: string;
    mission: string;
    reason: string;
  }>;
  summary: {
    active: number;
    blocked: number;
    idle: number;
    completed: number;
    tokenSpendUsd: number;
  };
  generatedAt: string;
}

export interface MissionTriggerResult {
  runId: number | string;
  status: string;
}

export interface ConfluencePublishResult {
  success: boolean;
  pageId?: string;
  url?: string;
}

export interface KnowledgeResult {
  content: string;
  score: number;
  source: string;
}

export interface PlatformEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

// ── Records ───────────────────────────────────────────────────────────────────

export const records = {
  list: <T extends AppRecord = AppRecord>(collection: string): Promise<T[]> =>
    request<T[]>(`/datasets?collection=${encodeURIComponent(collection)}`),

  create: <T extends AppRecord = AppRecord>(
    collection: string,
    data: Record<string, unknown>
  ): Promise<T> =>
    request<T>(`/datasets?collection=${encodeURIComponent(collection)}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: <T extends AppRecord = AppRecord>(
    collection: string,
    id: string,
    data: Record<string, unknown>
  ): Promise<T> =>
    request<T>(`/datasets/${id}?collection=${encodeURIComponent(collection)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

// ── Fleet ─────────────────────────────────────────────────────────────────────

export const fleet = {
  workload: (): Promise<FleetWorkload> => request<FleetWorkload>("/fleet/workload"),
};

// ── Missions ──────────────────────────────────────────────────────────────────

export function requireLaunchedMission(receipt: MissionTriggerResult | null | undefined): number {
  const id = typeof receipt?.runId === "string" ? Number(receipt.runId) : receipt?.runId;
  if (!receipt || typeof id !== "number" || !Number.isInteger(id) || id < 1 || receipt.status === "queued" || (receipt as any).queued) {
    throw new Error((receipt as any)?.message || "Mission did not launch an active execution run");
  }
  return id;
}

export const missions = {
  trigger: (
    name: string,
    context?: Record<string, unknown>
  ): Promise<MissionTriggerResult> =>
    request<MissionTriggerResult>("/missions/trigger", {
      method: "POST",
      body: JSON.stringify({ name, context }),
    }).then((receipt) => {
      requireLaunchedMission(receipt);
      return receipt;
    }),
};

// ── Integrations ──────────────────────────────────────────────────────────────

export const integrations = {
  bugs: {
    create: (data: {
      title: string;
      description?: string;
      severity?: string;
      jiraProject?: string;
    }): Promise<{ success: boolean; issueKey?: string }> =>
      request("/integrations/bugs", { method: "POST", body: JSON.stringify(data) }),
  },
  slack: {
    post: (data: {
      message: string;
      channel?: string;
    }): Promise<{ success: boolean }> =>
      request("/integrations/slack/post", { method: "POST", body: JSON.stringify(data) }),
  },
};

// ── Knowledge graph ───────────────────────────────────────────────────────────

export const knowledge = {
  query: (
    q: string,
    topK = 5
  ): Promise<{ results: KnowledgeResult[] }> =>
    request(`/knowledge/query?q=${encodeURIComponent(q)}&topK=${topK}`),
};

// ── Telemetry ─────────────────────────────────────────────────────────────────

export const telemetry = {
  emit: (
    event: string,
    level = "info",
    metadata?: Record<string, unknown>
  ): Promise<void> =>
    request<unknown>("/telemetry", {
      method: "POST",
      body: JSON.stringify({ event, level, metadata }),
    })
      .then(() => {})
      .catch(() => {}),
};

// ── Confluence ────────────────────────────────────────────────────────────────

export const confluence = {
  publish: (params: {
    title: string;
    content: string;
    space?: string;
  }): Promise<ConfluencePublishResult> =>
    request<ConfluencePublishResult>("/integrations/confluence/publish", {
      method: "POST",
      body: JSON.stringify(params),
    }),
};

// ── SSE event stream ──────────────────────────────────────────────────────────

/**
 * Subscribe to the platform's real-time event stream.
 * Returns an unsubscribe function — call it on component unmount.
 */
export const events = {
  subscribe: (handler: (event: PlatformEvent) => void): (() => void) => {
    if (typeof window === "undefined") return () => {};

    const source = new EventSource(`${BASE}/events/stream`);

    source.onmessage = (e) => {
      try {
        handler(JSON.parse(e.data) as PlatformEvent);
      } catch {
        // ignore malformed events
      }
    };

    source.onerror = () => {
      // EventSource reconnects automatically — no action needed here.
    };

    return () => source.close();
  },
};
