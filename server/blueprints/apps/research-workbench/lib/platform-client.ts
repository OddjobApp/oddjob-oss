/**
 * Platform API Client — Research Workbench
 * Only runs client-side (browser). All calls go through /api/oddjob/* proxy.
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

/**
 * Coerce an API error payload to a readable string. Platform error responses may
 * carry `error` as a nested object (e.g. { message, code }); without this, throwing
 * `new Error(object)` yields the message "[object Object]" in the UI.
 */
export function errorMessage(raw: unknown, fallback: string): string {
  if (typeof raw === "string" && raw.trim()) return raw;
  if (raw && typeof raw === "object") {
    const m = (raw as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
    try {
      return JSON.stringify(raw);
    } catch {
      return fallback;
    }
  }
  if (raw != null && typeof raw !== "object") return String(raw);
  return fallback;
}

// ── Records ──────────────────────────────────────────────────────────────────
export interface AppRecord {
  id: string;
  [key: string]: unknown;
  _createdAt: string;
  _updatedAt: string;
}

export const records = {
  list: async (collection: string): Promise<AppRecord[]> => {
    const data = await request<unknown>(
      `/datasets?collection=${encodeURIComponent(collection)}`,
    );
    // Platform may return { items: [...] } or a plain array — normalize
    if (Array.isArray(data)) return data as AppRecord[];
    if (data && typeof data === "object" && Array.isArray((data as any).items))
      return (data as any).items;
    return [];
  },
  create: (collection: string, data: Record<string, unknown>) =>
    request<AppRecord>(
      `/datasets?collection=${encodeURIComponent(collection)}`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),
  update: (collection: string, id: string, data: Record<string, unknown>) =>
    request<AppRecord>(
      `/datasets/${id}?collection=${encodeURIComponent(collection)}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    ),
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
  pending: async (stage?: string): Promise<HilRequest[]> => {
    const data = await request<unknown>(
      `/hil${stage ? `?stage=${encodeURIComponent(stage)}` : ""}`,
    );
    if (Array.isArray(data)) return data as HilRequest[];
    if (data && typeof data === "object" && Array.isArray((data as any).items))
      return (data as any).items;
    return [];
  },
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
      try {
        handler(JSON.parse(e.data));
      } catch {}
    };
    source.onerror = () => {
      /* reconnects automatically */
    };
    return () => source.close();
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
      `/knowledge/query?q=${encodeURIComponent(q)}&topK=${topK}`,
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
      request<{
        success: boolean;
        issues: unknown[];
        total: number;
        error?: string;
      }>("/integrations/jira/search", {
        method: "POST",
        body: JSON.stringify({ jql, limit }),
      }),
  },
};

// ── Confluence ────────────────────────────────────────────────────────────────
export interface ConfluencePublishResult {
  success: boolean;
  pageId?: string;
  url?: string;
}
export const confluence = {
  publish: (params: { title: string; content: string; space?: string }) =>
    request<ConfluencePublishResult>("/integrations/confluence/publish", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  search: (query: string, limit = 10) =>
    request<{ success: boolean; results: unknown[] }>(
      "/integrations/confluence/search",
      {
        method: "POST",
        body: JSON.stringify({ query, limit }),
      },
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

// ── Research-specific types ───────────────────────────────────────────────────
export type SourceType =
  | "paper"
  | "api"
  | "doc"
  | "video"
  | "report"
  | "case"
  | "legal"
  | "financial"
  | "clinical"
  | "other";

export type SourceStatus = "pending" | "indexed" | "error";

export interface ResearchSource extends AppRecord {
  url: string;
  title: string;
  type: SourceType;
  addedAt: string;
  status: SourceStatus;
  summary?: string;
  publisher?: string;
  publishedAt?: string;
  retrievedAt?: string;
  runId?: number;
  quality?: SourceQualityAssessment;
}

export type EvidenceStrength = "high" | "medium" | "low";
export type ClaimDisposition =
  "verified" | "inferred" | "proposed" | "disputed";

export interface SourceQualityAssessment {
  score: number;
  strength: EvidenceStrength;
  primarySource: boolean;
  recency: "current" | "aging" | "unknown";
  authority: "first-party" | "peer-reviewed" | "independent" | "unknown";
  issues: string[];
}

export interface ResearchClaim extends AppRecord {
  statement: string;
  disposition: ClaimDisposition;
  confidence: number;
  sourceIds: string[];
  sourceUrls?: string[];
  supportingPassages?: Array<{
    sourceId?: string;
    sourceUrl?: string;
    passage: string;
    locator?: string;
  }>;
  contradictingSourceIds?: string[];
  rationale?: string;
  runId?: number;
  createdAt: string;
}

export interface SynthesisMatrixDimension {
  key: string;
  label: string;
}

export interface SynthesisMatrixRow {
  subject: string;
  scores: Record<string, string | number>;
  notes?: string;
}

export interface SynthesisMatrix extends AppRecord {
  label: string;
  dimensions: SynthesisMatrixDimension[];
  rows: SynthesisMatrixRow[];
}

export interface DecisionHistoryEntry extends AppRecord {
  formName: string;
  stage: string;
  decision: Record<string, unknown>;
  actor: string;
  timestamp: string;
  context: Record<string, unknown>;
}
