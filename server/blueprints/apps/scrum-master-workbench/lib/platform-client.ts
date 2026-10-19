/**
 * Platform API Client — Scrum Master Workbench (Enhanced WOW)
 *
 * Full platform capability set:
 * - AppRecords (datasets CRUD)
 * - HIL forms (escalation)
 * - Mission triggers + logs
 * - Jira search + transition + sprint creation
 * - Confluence publish
 * - Knowledge Graph query
 * - Pipeline execution + status
 * - Agent Chat (SSE streaming)
 * - Fleet Workload
 * - Platform Dataset query
 * - Telemetry
 */

const BASE = "/api/oddjob";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const body = await res.json(); msg = body?.error ?? body?.message ?? msg; } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── AppRecords ────────────────────────────────────────────────────────────────

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
      method: "POST", body: JSON.stringify(data),
    }),
  update: (collection: string, id: string, data: Record<string, unknown>) =>
    request<AppRecord>(`/datasets/${id}?collection=${encodeURIComponent(collection)}`, {
      method: "PUT", body: JSON.stringify(data),
    }),
  delete: (collection: string, id: string) =>
    request<void>(`/datasets/${id}?collection=${encodeURIComponent(collection)}`, {
      method: "DELETE",
    }),
};

// ── HIL ───────────────────────────────────────────────────────────────────────

export interface HilCreateResult { id: number; status: "pending"; }

export const hil = {
  create: (prompt: string, context?: Record<string, unknown>) =>
    request<HilCreateResult>("/hil", { method: "POST", body: JSON.stringify({ prompt, context }) }),
  poll: (formId: number) =>
    request<{ status: "pending" | "completed", result?: any }>(`/hil/${formId}`),
};

// ── Missions ──────────────────────────────────────────────────────────────────

export interface MissionTriggerResult { runId: number; status: string; queued?: boolean; message?: string; }
export interface MissionLogsResult {
  logs: Array<{ id: number; level: "info" | "debug" | "error"; message: string; timestamp: string }>;
  status: string; runId: number | null;
}

export function requireLaunchedMission(receipt: MissionTriggerResult | null | undefined): number {
  if (!receipt || typeof receipt.runId !== "number" || !Number.isInteger(receipt.runId) || receipt.runId < 1 || receipt.status === "queued" || receipt.queued) {
    throw new Error(receipt?.message || "Mission did not launch an active execution run");
  }
  return receipt.runId;
}

export const missions = {
  trigger: (name: string, context?: Record<string, unknown>) =>
    request<MissionTriggerResult>("/missions/trigger", { method: "POST", body: JSON.stringify({ name, context }) }).then((receipt) => {
      requireLaunchedMission(receipt);
      return receipt;
    }),
  logs: (missionId: number) =>
    request<MissionLogsResult>(`/missions/${missionId}/logs`),
  status: (runId: number) =>
    request<{ runId: number; status: string; missionId: number }>(`/missions/${runId}/status`),
};

// ── Jira ──────────────────────────────────────────────────────────────────────

export interface JiraIssue {
  key: string; summary: string; status: string; priority: string;
  assignee: string | null; issueType: string; storyPoints?: number; updated: string;
}
export interface JiraSearchResult { success: boolean; issues: JiraIssue[]; total: number; error?: string; }
export interface JiraTransitionResult { success: boolean; issueKey: string; transitionName: string; error?: string; availableTransitions?: string[]; }

export const jira = {
  search: (jql: string, fields?: string[], limit = 50) =>
    request<JiraSearchResult>("/integrations/jira/search", { method: "POST", body: JSON.stringify({ jql, fields, limit }) }),
  transition: (issueKey: string, transitionName: string) =>
    request<JiraTransitionResult>("/integrations/jira/transition", { method: "POST", body: JSON.stringify({ issueKey, transitionName }) }),
};

// ── Confluence ────────────────────────────────────────────────────────────────

export interface ConfluencePublishResult { success: boolean; pageId?: string; title?: string; url?: string; action?: string; error?: string; }

export const confluence = {
  publish: (params: { title: string; content: string; pageId?: string; space?: string; parentPageId?: string }) =>
    request<ConfluencePublishResult>("/integrations/confluence/publish", { method: "POST", body: JSON.stringify(params) }),
};

// ── Knowledge Graph ───────────────────────────────────────────────────────────

export interface KnowledgeResult { nodes: any[]; edges: any[]; }

export const knowledge = {
  query: (q: string, limit = 10) =>
    request<KnowledgeResult>(`/knowledge/query?q=${encodeURIComponent(q)}&limit=${limit}`),
};

// ── Pipelines ─────────────────────────────────────────────────────────────────

export interface PipelineStatusResult {
  runId: number; status: string; startedAt: string | null; completedAt: string | null;
  stepOutputs: Array<{ stepId: number; status: string; output: any }>;
}

export const pipelines = {
  execute: (pipelineId: number, inputParams?: Record<string, unknown>) =>
    request<{ runId: number; status: string }>("/pipelines/execute", { method: "POST", body: JSON.stringify({ pipelineId, inputParams }) }),
  status: (runId: number) =>
    request<PipelineStatusResult>(`/pipelines/${runId}/status`),
};

// ── Agent Chat (SSE Streaming) ────────────────────────────────────────────────

export const agents = {
  chat: async function* (agentId: number, message: string, collectionName?: string): AsyncGenerator<string> {
    const res = await fetch(`${BASE}/agents/${agentId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, collectionName }),
    });
    if (!res.ok) throw new Error(`Agent chat failed: ${res.status}`);
    if (!res.body) throw new Error("No response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data);
            const content = parsed?.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {}
        }
      }
    }
  },

  history: (agentId: number, collection?: string) =>
    request<{ messages: Array<{ role: string; content: string; id?: string }> }>(
      `/agents/${agentId}/history${collection ? `?collection=${encodeURIComponent(collection)}` : ""}`
    ),
};

// ── Fleet Workload ────────────────────────────────────────────────────────────

export interface FleetAgent {
  agent: string; mission: string; status: string; risk: string;
  confidence: number | null; currentStep: string;
}

export interface FleetWorkload {
  cycle: { id: number; name: string; status: string; budgetLimitUsd: number; currentSpendUsd: number } | null;
  agents: FleetAgent[];
  summary: { active: number; waiting: number; blocked: number; idle: number; completed: number };
  generatedAt: string;
}

export const fleet = {
  workload: () => request<FleetWorkload>("/fleet/workload"),
};

// ── Platform Datasets ─────────────────────────────────────────────────────────

export const platformDatasets = {
  query: (datasetId: number, filter?: Record<string, unknown>, limit = 25) =>
    request<any>(`/datasets/platform/${datasetId}/query`, {
      method: "POST", body: JSON.stringify({ filter, limit }),
    }),
};

// ── Telemetry ─────────────────────────────────────────────────────────────────

export const telemetry = {
  emit: (event: string, level: "info" | "warn" | "error" = "info", metadata?: Record<string, unknown>) =>
    request<{ status: string }>("/telemetry", { method: "POST", body: JSON.stringify({ event, level, metadata }) }).catch(() => {}),
};
