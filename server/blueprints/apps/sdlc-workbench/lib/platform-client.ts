/**
 * Platform API Client — SDLC Workbench Shared Server
 * Only runs client-side (browser). All calls go through /api/oddjob/* proxy.
 */
import { requireLaunchedMission } from "./workflow-safety";
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
  const destination = new URL(`${BASE}${path}`, window.location.origin);
  const roomKey = new URLSearchParams(window.location.search).get('crewRoom');
  if (roomKey) destination.searchParams.set('crewRoom', roomKey);
  const res = await fetch(destination.pathname + destination.search, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  if (!res.ok) { let msg = `HTTP ${res.status}`; try { const b = await res.json(); msg = errorMessage(b?.error ?? b?.message, msg); } catch {} throw new Error(msg); }
  return res.json() as Promise<T>;
}

// ── Records ──────────────────────────────────────────────────────────────────
export interface AppRecord { id: string; [key: string]: unknown; _createdAt: string; _updatedAt: string; }
export const records = {
  list:   (collection: string) => request<AppRecord[]>(`/datasets?collection=${encodeURIComponent(collection)}`),
  create: (collection: string, data: Record<string, unknown>) => request<AppRecord>(`/datasets?collection=${encodeURIComponent(collection)}`, { method: "POST", body: JSON.stringify(data) }),
  update: (collection: string, id: string, data: Record<string, unknown>) => request<AppRecord>(`/datasets/${id}?collection=${encodeURIComponent(collection)}`, { method: "PUT", body: JSON.stringify(data) }),
};

export interface StageHandoffInput {
  version: 1;
  transition: 'requirements_to_development' | 'planning_to_development' | 'qa_to_uat' | 'uat_to_deployment';
  sourceRecordId: string; sourceUpdatedAt: string; sourceRunId?: number; commitSha?: string; ticketKeys?: string[];
}
export interface DurableStageHandoff {
  handoff: { id: string; target: string; label: string; status: 'offered' | 'acknowledged'; createdAt: string;
    binding: { roomKey: string; cycleId: number; repositoryUrl: string; branch: string; revision: string };
    input: StageHandoffInput; receipt?: { at: string; deploymentId: number } };
  blocker: string | null;
}
function handoffRetryKey() {
  const query = new URLSearchParams(window.location.search);
  const room = query.get('crewRoom');
  if (!room) throw new Error('Open this workbench through a configured CREW room to offer a handoff.');
  return `sdlc-handoff-retries:${window.location.pathname.match(/^\/app\/[^/]+/)?.[0] ?? 'standalone'}:${query.get('orgId') ?? ''}:${room}`;
}
function pendingHandoffOffers(): StageHandoffInput[] {
  const raw = window.localStorage.getItem(handoffRetryKey());
  return raw ? JSON.parse(raw) : [];
}
const offerKey = (input: StageHandoffInput) => `${input.transition}:${input.sourceRecordId}:${input.sourceUpdatedAt}:${input.sourceRunId ?? ''}`;
function savePendingOffers(inputs: StageHandoffInput[]) { window.localStorage.setItem(handoffRetryKey(), JSON.stringify(inputs)); window.dispatchEvent(new window.Event('sdlc-handoff-changed')); }
export const handoffs = {
  reconcileDeployment: (id: string) => request<{ reconciled: boolean; runId?: number; runStatus?: string; message: string }>(`/missions/deployments/${encodeURIComponent(id)}/reconcile`, { method: 'POST', body: '{}' }),
  list: (cursor?: number) => request<{ items: DurableStageHandoff[]; nextCursor: number | null }>(`/handoffs${cursor ? `?cursor=${cursor}` : ''}`),
  pending: pendingHandoffOffers,
  discardRetry: (input: StageHandoffInput) => savePendingOffers(pendingHandoffOffers().filter(item => offerKey(item) !== offerKey(input))),
  offer: async (input: StageHandoffInput) => {
    const pending = pendingHandoffOffers();
    if (!pending.some(item => offerKey(item) === offerKey(input))) {
      if (pending.length >= 20) throw new Error('Reconcile pending handoff offers before adding another. Do not repeat the source mission.');
      savePendingOffers([...pending, input]);
    }
    try {
      const receipt = await request<DurableStageHandoff & { replayed: boolean }>('/handoffs', { method: 'POST', body: JSON.stringify(input) });
      savePendingOffers(pendingHandoffOffers().filter(item => offerKey(item) !== offerKey(input)));
      return receipt;
    } catch (error) {
      throw new Error(`The handoff is not confirmed. Use Retry handoff in Stage handoffs; do not repeat the source action. ${error instanceof Error ? error.message : 'Reconciliation required.'}`);
    }
  },
  acknowledge: (id: string, target: string) => request<{ handoff: DurableStageHandoff['handoff']; replayed: boolean }>(`/handoffs/${encodeURIComponent(id)}/acknowledge`, { method: 'POST', body: JSON.stringify({ target }) }),
};

// ── Jira ─────────────────────────────────────────────────────────────────────
export interface JiraIssue { key: string; summary: string; status: string; priority: string; assignee: string | null; issueType: string; updated: string; }
export interface JiraSearchResult { success: boolean; issues: JiraIssue[]; total: number; error?: string; }
export const jira = {
  search:     (jql: string, limit = 50) => request<JiraSearchResult>("/integrations/jira/search", { method: "POST", body: JSON.stringify({ jql, limit }) }),
  transition: (issueKey: string, status: string) => request<{ success: boolean }>("/integrations/jira/transition", { method: "POST", body: JSON.stringify({ issueKey, status }) }),
};

// ── Fleet ─────────────────────────────────────────────────────────────────────
export interface FleetAgent { id: string; agent: string; mission: string; objective: string; status: "active" | "waiting" | "blocked" | "idle" | "completed"; risk: "low" | "medium" | "high"; confidence: number | null; currentStep: string; workingOn: string; dependencies: string[]; unresolvedDependencies: string[]; runtimeSeconds: number; costUsd: number; lastActionAt: string; flightRecorder: Array<{ id: number; type: string; toolName: string | null; content: string; confidence: number | null; createdAt: string }>; }
export interface FleetWorkload { cycle: { id: number; name: string; status: string; objective: string; budgetLimitUsd: number; currentSpendUsd: number } | null; agents: FleetAgent[]; attention: Array<{ id: string; severity: "critical" | "watch"; agent: string; mission: string; reason: string }>; summary: { active: number; waiting: number; blocked: number; idle: number; completed: number; tokenSpendUsd: number }; generatedAt: string; }
export const fleet = { workload: () => {
  const room = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('crewRoom') : null;
  return request<FleetWorkload>(`/fleet/workload${room ? `?crewRoom=${encodeURIComponent(room)}` : ''}`).then(result => {
    if (!result.cycle) throw new Error('No development cycle is bound to this room in the app’s Project Space');
    return result;
  });
} };

// ── Missions ──────────────────────────────────────────────────────────────────
export interface MissionTriggerResult { runId: number | null; status: string; queued?: boolean; outboxRecordId?: string | number; message?: string; }
export const missions = {
  trigger: (name: string, context?: Record<string, unknown>) => request<MissionTriggerResult>("/missions/trigger", { method: "POST", body: JSON.stringify({ name, context }) }).then(receipt => { requireLaunchedMission(receipt); return receipt; }),
};

// ── Confluencce ───────────────────────────────────────────────────────────────
export interface ConfluencePublishResult { success: boolean; pageId?: string; url?: string; }
export const confluence = {
  publish: (params: { title: string; content: string; space?: string }) => request<ConfluencePublishResult>("/integrations/confluence/publish", { method: "POST", body: JSON.stringify(params) }),
  search:  (query: string, limit = 10) => request<{ success: boolean; results: any[] }>("/integrations/confluence/search", { method: "POST", body: JSON.stringify({ query, limit }) }),
};

// ── Knowledge graph ───────────────────────────────────────────────────────────
export interface KnowledgeResult { content: string; score: number; source: string; }
export const knowledge = {
  query: (q: string, topK = 5) => request<{ results: KnowledgeResult[] }>(`/knowledge/query?q=${encodeURIComponent(q)}&topK=${topK}`),
};

// ── Integrations ──────────────────────────────────────────────────────────────
export const integrations = {
  bugs: {
    create: (data: { title: string; description?: string; severity?: string; jiraProject?: string }) =>
      request<{ success: boolean; issueKey?: string }>("/integrations/bugs", { method: "POST", body: JSON.stringify(data) }),
  },
  slack: {
    post: (data: { message: string; channel?: string }) =>
      request<{ success: boolean }>("/integrations/slack/post", { method: "POST", body: JSON.stringify(data) }),
  },
};

// ── HIL (Human-in-the-Loop) ───────────────────────────────────────────────────
export interface HilField { name: string; label: string; type: "select" | "textarea" | "text"; options?: string[]; required?: boolean; }
export interface HilRequest { id: string; formName: string; stage: string; fields: HilField[]; context: Record<string, unknown>; createdAt: string; slaHours?: number; }
export interface BulkHilSubmitResult { hilId: string; success: boolean; error?: string; }
export interface BulkHilSubmitResponse { results: BulkHilSubmitResult[]; totalProcessed: number; totalFailed: number; }
export const hil = {
  pending: (stage?: string) => request<HilRequest[]>(`/hil?scope=app${stage ? `&stage=${encodeURIComponent(stage)}` : ""}`),
  create:  (prompt: string, context?: Record<string, unknown>) => request<{ id: number; status: string }>("/hil", { method: "POST", body: JSON.stringify({ prompt, context }) }),
  submit:  (id: string, decision: Record<string, unknown>) => request<{ ok: boolean }>(`/hil/${id}/submit`, { method: "POST", body: JSON.stringify(decision) }),
  bulkSubmit: (decisions: Array<{ hilId: string; values: Record<string, string> }>) =>
    request<BulkHilSubmitResponse>("/hil/bulk-submit", { method: "POST", body: JSON.stringify({ decisions }) }),
};

// ── SSE event stream ──────────────────────────────────────────────────────────
export interface PlatformEvent { type: string; payload: Record<string, unknown>; timestamp: string; }

export interface ActivityEvent {
  id: string;
  timestamp: string;
  type: 'agent_thought' | 'tool_call' | 'tool_result' | 'mission_transition' | 'hil_request' | 'handoff' | 'error';
  agentName: string;
  missionStage: 'requirements' | 'development' | 'qa' | 'deployment' | 'other';
  summary: string;
  detail?: string;
  missionRunId?: number;
  ticketKey?: string;
  actionable?: { type: 'hil'; hilId: string } | { type: 'navigate'; href: string };
}

export interface EventsHistoryResponse {
  events: ActivityEvent[];
  nextCursor?: string;
  hasMore: boolean;
}

/** Subscribe to the cycle's real-time event stream. Returns an unsubscribe fn. */
export const events = {
  subscribe: (handler: (event: PlatformEvent) => void): (() => void) => {
    if (typeof window === "undefined") return () => {};
    const source = new EventSource(`${BASE}/events/stream`);
    source.onmessage = (e) => { try { handler(JSON.parse(e.data)); } catch {} };
    source.onerror   = () => { /* reconnects automatically */ };
    return () => source.close();
  },
  history: (params?: { cursor?: string; limit?: number; agent?: string; stage?: string; type?: string }): Promise<EventsHistoryResponse> => {
    const qs = new URLSearchParams();
    if (params?.cursor) qs.set("cursor", params.cursor);
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.agent) qs.set("agent", params.agent);
    if (params?.stage) qs.set("stage", params.stage);
    if (params?.type) qs.set("type", params.type);
    const query = qs.toString();
    return request<EventsHistoryResponse>(`/events/history${query ? `?${query}` : ""}`);
  },
};

// ── Telemetry ─────────────────────────────────────────────────────────────────
export const telemetry = {
  emit: (event: string, level = "info", metadata?: Record<string, unknown>) =>
    request<any>("/telemetry", { method: "POST", body: JSON.stringify({ event, level, metadata }) }).catch(() => {}),
};
