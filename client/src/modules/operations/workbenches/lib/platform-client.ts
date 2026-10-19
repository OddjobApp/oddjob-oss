/**
 * Native Platform Client — In-app Workbench Platform Adapter
 * Calls Oddjob's /api/platform/app/* endpoints directly using session cookies.
 */

const BASE = "/api/platform/app";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
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

// ── AppRecords / Datasets ───────────────────────────────────────────────────

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
  delete: (collection: string, id: string) =>
    request<void>(`/datasets/${id}?collection=${encodeURIComponent(collection)}`, {
      method: "DELETE",
    }),
};

// ── HIL ─────────────────────────────────────────────────────────────────────

export interface HilCreateResult { id: number; status: "pending"; }
export interface HilPollResult { id: number; status: "pending" | "completed"; data: Record<string, unknown> | null; }

export const hil = {
  create: (prompt: string, context?: Record<string, unknown>) =>
    request<HilCreateResult>("/hil", { method: "POST", body: JSON.stringify({ prompt, context }) }),
  poll: (formId: number) =>
    request<HilPollResult>(`/hil/${formId}/poll`),
};

// ── Missions ────────────────────────────────────────────────────────────────

export interface MissionTriggerResult { runId: number; status: string; }
export interface MissionLogsResult {
  logs: Array<{ id: number; level: "info" | "debug" | "error"; message: string; timestamp: string }>;
  status: string;
  runId: number | null;
}

export const missions = {
  trigger: (name: string, context?: Record<string, unknown>) =>
    request<MissionTriggerResult>("/missions/trigger", { method: "POST", body: JSON.stringify({ name, context }) }),
  logs: (missionId: number) =>
    request<MissionLogsResult>(`/missions/${missionId}/logs`),
  status: (runId: number) =>
    request<{ runId: number; status: string; missionId: number }>(`/missions/${runId}/status`),
};

// ── Jira ────────────────────────────────────────────────────────────────────

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee: string | null;
  issueType: string;
  updated: string;
}

export const jira = {
  search: (jql: string, fields?: string[], limit = 50) =>
    request<{ success: boolean; issues: JiraIssue[]; total: number; error?: string }>("/integrations/jira/search", {
      method: "POST",
      body: JSON.stringify({ jql, fields, limit }),
    }),
  transition: (issueKey: string, transitionName: string) =>
    request<{ success: boolean; issueKey: string; transitionName: string; error?: string }>("/integrations/jira/transition", {
      method: "POST",
      body: JSON.stringify({ issueKey, transitionName }),
    }),
};

// ── Confluence ──────────────────────────────────────────────────────────────

export const confluence = {
  search: (query: string, spaceKey?: string, limit = 10) =>
    request<{ success: boolean; results: any[]; total: number }>("/integrations/confluence/search", {
      method: "POST",
      body: JSON.stringify({ query, spaceKey, limit }),
    }),
  publish: (params: { title: string; content: string; pageId?: string; space?: string; parentPageId?: string }) =>
    request<{ success: boolean; pageId?: string; title?: string; url?: string; action?: string; error?: string }>("/integrations/confluence/publish", {
      method: "POST",
      body: JSON.stringify(params),
    }),
};

// ── Fleet Workload ──────────────────────────────────────────────────────────

export interface FleetWorkload {
  cycle: { id: number; name: string; status: string; budgetLimitUsd: number; currentSpendUsd: number } | null;
  agents: Array<{ agent: string; mission: string; status: string; risk: string; confidence: number | null }>;
  summary: { active: number; waiting: number; blocked: number; idle: number; completed: number };
  generatedAt: string;
}

export const fleet = {
  workload: () => request<FleetWorkload>("/fleet/workload"),
};

// ── Telemetry ───────────────────────────────────────────────────────────────

export const telemetry = {
  emit: (event: string, level: "info" | "warn" | "error" = "info", metadata?: Record<string, unknown>) =>
    request<{ status: string }>("/telemetry", {
      method: "POST",
      body: JSON.stringify({ event, level, metadata }),
    }).catch(() => {}),
};

// ── Launch Predictions & Readiness ──────────────────────────────────────────

export interface PredictionResult {
  predictedValue: number | string;
  confidence: number;
  factors: Array<{ name: string; impact: number; description: string }>;
  recommendations: string[];
}

export interface LaunchReadiness {
  score: number;
  status: "READY" | "RISK_DETECTED" | "BLOCKED" | "ON_TRACK";
  checks: Array<{ name: string; passed: boolean; details: string }>;
}

export const launch = {
  readiness: () => request<LaunchReadiness>("/launch/readiness"),
};

export const predictions = {
  launchTiming: () => request<PredictionResult>("/predictions/timing"),
  riskScore: () => request<PredictionResult>("/predictions/risk"),
  dayOneForecast: () => request<PredictionResult>("/predictions/day1"),
};
