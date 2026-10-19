/**
 * Platform API Client — Product Launch Workbench
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
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  if (!res.ok) { let msg = `HTTP ${res.status}`; try { const b = await res.json(); msg = errorMessage(b?.error ?? b?.message, msg); } catch {} throw new Error(msg); }
  return res.json() as Promise<T>;
}

export interface AppRecord { id: string; [key: string]: unknown; _createdAt: string; _updatedAt: string; }
export const records = {
  list: (collection: string) => request<AppRecord[]>(`/datasets?collection=${encodeURIComponent(collection)}`),
  create: (collection: string, data: Record<string, unknown>) => request<AppRecord>(`/datasets?collection=${encodeURIComponent(collection)}`, { method: "POST", body: JSON.stringify(data) }),
};

export interface FleetWorkload { cycle: any; agents: Array<{ agent: string; mission: string; status: string; risk: string; confidence: number | null; currentStep: string }>; attention: Array<{ severity: string; agent: string; mission: string; reason: string }>; summary: { active: number; blocked: number; idle: number; completed: number; tokenSpendUsd: number }; generatedAt: string; }
export const fleet = { workload: () => request<FleetWorkload>("/fleet/workload") };

export interface MissionTriggerResult { runId: number; status: string; queued?: boolean; message?: string; }
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
};

export interface ConfluencePublishResult { success: boolean; pageId?: string; url?: string; }
export const confluence = {
  publish: (params: { title: string; content: string; space?: string }) => request<ConfluencePublishResult>("/integrations/confluence/publish", { method: "POST", body: JSON.stringify(params) }),
  search: (query: string, limit = 10) => request<{ success: boolean; results: any[] }>("/integrations/confluence/search", { method: "POST", body: JSON.stringify({ query, limit }) }),
};

export const telemetry = {
  emit: (event: string, level = "info", metadata?: Record<string, unknown>) => request<any>("/telemetry", { method: "POST", body: JSON.stringify({ event, level, metadata }) }).catch(() => {}),
};

// ── Launch-Specific APIs ─────────────────────────────────────────────────────

export interface LaunchReadiness {
  overall: number;
  breakdown: {
    missionCompletion: { score: number; weight: number; completed: number; total: number };
    contentAssets: { score: number; weight: number; approved: number; total: number };
    salesEnablement: { score: number; weight: number; playbooks: number; battleCards: number };
    approvalGates: { score: number; weight: number; detail: string };
    integrationHealth: { score: number; weight: number };
  };
  generatedAt: string;
}

export const launch = {
  readiness: () => request<LaunchReadiness>("/launch/readiness"),
  timeline: () => request<{ milestones: any[]; total: number }>("/launch/timeline"),
  generateContent: (params: { contentType: string; title: string; persona?: string; funnelStage?: string; keyMessages?: string[] }) =>
    request<{ success: boolean; recordId: string }>("/launch/content/generate", { method: "POST", body: JSON.stringify(params) }),
  synthesizeFeedback: () => request<{ success: boolean; totalFeedback: number; themesIdentified: number; prioritiesGenerated: number }>("/launch/feedback/synthesize", { method: "POST", body: JSON.stringify({}) }),
  metrics: () => request<{ content: any; feedback: any; nps: any; priorities: any }>("/launch/metrics"),
};

// ── Prediction Intelligence ──────────────────────────────────────────────────

export interface PredictionResult {
  prediction: string;
  confidence: number;
  factors: Array<{ factor: string; weight: number; signal: string }>;
  recommendation: string;
  generatedAt: string;
}

export const predictions = {
  /** Predict optimal launch timing based on market signals and readiness */
  launchTiming: (context?: Record<string, unknown>) =>
    request<PredictionResult>("/predictions/launch-timing", { method: "POST", body: JSON.stringify({ type: "launch_timing", context }) }),
  /** Forecast Day-1 metrics based on beta data and content readiness */
  day1Forecast: (context?: Record<string, unknown>) =>
    request<PredictionResult>("/predictions/day1-forecast", { method: "POST", body: JSON.stringify({ type: "day1_forecast", context }) }),
  /** Score launch risk probability */
  riskScore: (context?: Record<string, unknown>) =>
    request<PredictionResult>("/predictions/risk-score", { method: "POST", body: JSON.stringify({ type: "risk_score", context }) }),
  /** Predict content performance based on historical data */
  contentPerformance: (assetType: string, persona: string) =>
    request<PredictionResult>("/predictions/content-performance", { method: "POST", body: JSON.stringify({ type: "content_performance", assetType, persona }) }),
};

// ── Knowledge Graph ──────────────────────────────────────────────────────────

export interface KnowledgeResult {
  results: Array<{ content: string; source: string; relevance: number; metadata?: any }>;
  total: number;
}

export const knowledge = {
  query: (query: string, limit = 10) =>
    request<KnowledgeResult>(`/knowledge/query?q=${encodeURIComponent(query)}&limit=${limit}`),
};

// ── Pipelines ────────────────────────────────────────────────────────────────

export interface PipelineRun {
  runId: number;
  status: string;
  steps: Array<{ name: string; status: string; output?: any }>;
}

export const pipelines = {
  list: () => request<{ pipelines: any[] }>("/pipelines"),
  execute: (pipelineId: number, input?: Record<string, unknown>) =>
    request<PipelineRun>(`/pipelines/${pipelineId}/execute`, { method: "POST", body: JSON.stringify({ input }) }),
  status: (runId: number) => request<PipelineRun>(`/pipelines/${runId}/status`),
};

// ── HIL (Human-in-the-Loop) Approvals ────────────────────────────────────────

export interface HILForm {
  id: string;
  name: string;
  status: "pending" | "approved" | "rejected";
  fields: Array<{ name: string; label: string; type: string; value?: any }>;
  createdAt: string;
}

export const hil = {
  /** Poll for pending approval forms */
  poll: (formId: string) => request<HILForm>(`/hil/${formId}/poll`),
  /** Submit an approval decision */
  submit: (formId: string, decision: Record<string, any>) =>
    request<{ success: boolean }>("/hil", { method: "POST", body: JSON.stringify({ formId, ...decision }) }),
};

// ── Agent Chat (SSE Streaming) ───────────────────────────────────────────────

export const agentChat = {
  /** Get conversation history for an agent */
  history: (agentId: number) => request<{ messages: any[] }>(`/agents/${agentId}/history`),
  /** Send message and get streaming response (returns EventSource URL) */
  getStreamUrl: (agentId: number) => `${BASE}/agents/${agentId}/chat`,
};

// ── Mission Logs (Live Stream) ───────────────────────────────────────────────

export const missionLogs = {
  /** Get live log stream URL for a mission run */
  getStreamUrl: (missionId: number) => `${BASE}/missions/${missionId}/logs`,
};

// ── Jira Integration ─────────────────────────────────────────────────────────

export const jira = {
  search: (jql: string, limit = 50) =>
    request<{ success: boolean; issues: any[]; total: number }>("/integrations/jira/search", { method: "POST", body: JSON.stringify({ jql, limit }) }),
  transition: (issueKey: string, status: string) =>
    request<{ success: boolean }>("/integrations/jira/transition", { method: "POST", body: JSON.stringify({ issueKey, targetStatus: status }) }),
  createBug: (params: { summary: string; description: string; priority?: string }) =>
    request<{ success: boolean; key?: string }>("/integrations/bugs", { method: "POST", body: JSON.stringify(params) }),
};

// ── Slack Integration ────────────────────────────────────────────────────────

export const slack = {
  post: (channel: string, message: string, blocks?: any[]) =>
    request<{ success: boolean }>("/integrations/slack/post", { method: "POST", body: JSON.stringify({ channel, message, blocks }) }).catch(() => ({ success: false })),
};

// ── Event Stream (Real-time SSE) ─────────────────────────────────────────────

export const events = {
  /** Get the SSE stream URL for real-time updates */
  getStreamUrl: () => `${BASE}/events/stream`,
  /** Connect to the event stream and call handler on each event */
  subscribe: (onEvent: (event: { type: string; payload: any; timestamp: string }) => void): (() => void) => {
    if (typeof window === "undefined") return () => {};
    const url = `${BASE}/events/stream`;
    const source = new EventSource(url);
    source.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch {} };
    return () => source.close();
  },
};

// ── Schedule Management ──────────────────────────────────────────────────────

export const schedules = {
  list: () => request<{ schedules: any[]; total: number }>("/schedules/list"),
  update: (scheduleId: number, params: { cronExpression?: string; isActive?: boolean }) =>
    request<{ success: boolean }>("/schedules/update", { method: "POST", body: JSON.stringify({ scheduleId, ...params }) }),
};

// ── Cross-Cycle Intelligence ─────────────────────────────────────────────────

export const crossCycle = {
  /** Query status of all cycles in the org (e.g., check if SDLC engineering is done) */
  status: () => request<{ cycles: Array<{ id: number; name: string; status: string; missions: { total: number; completed: number; active: number; failed: number } }>; total: number }>("/cross-cycle/status"),
};

// ── Ephemeral Event Engine (S.C.O.R.E.) ──────────────────────────────────────

export interface IntentState {
  vector: string;       // S.C.O.R.E. state (e.g., "S:High C:Low O:Med R:High E:Low")
  confidence: number;
  route: string;
  timestamp: string;
}

export interface EngagementEntry {
  strategy: string;
  action: string;      // 'dismissed' | 'clicked' | 'ignored'
  timestamp: string;
}

export const ephemeral = {
  /** Emit a scoring event (UI interaction, content view, approval action) */
  emit: (eventType: string, metadata: { page?: string; element?: string; action?: string; vector?: string; [key: string]: any }) =>
    request<{ success: boolean }>("/ephemeral/event", { method: "POST", body: JSON.stringify({ eventType, ...metadata }) }).catch(() => ({ success: false })),

  /** Get current user intent state */
  getIntent: (fingerprint: string) =>
    request<{ current_state: IntentState; recent_engagements: EngagementEntry[] }>(`/ephemeral/intent?fingerprint=${encodeURIComponent(fingerprint)}`),

  /** Log an engagement outcome (user responded to a concierge prompt) */
  logEngagement: (fingerprint: string, strategy: string, action: string) =>
    request<{ success: boolean }>("/ephemeral/engagement", { method: "POST", body: JSON.stringify({ fingerprint, strategy, action }) }).catch(() => ({ success: false })),
};
