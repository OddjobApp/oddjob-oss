/**
 * Platform API Client — Mission Supervisor
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

// ── Missions ──────────────────────────────────────────────────────────────────

export interface Mission {
  id: number;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  runId?: number;
}

export interface MissionExecution {
  runId: number;
  missionId: number;
  status: "running" | "completed" | "failed" | "paused";
  startedAt: string;
  completedAt?: string;
  totalCost?: number;
  totalDuration?: number;
  steps: MissionStep[];
}

export interface MissionStep {
  stepId: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "paused";
  agentId?: string;
  agentName?: string;
  startedAt?: string;
  completedAt?: string;
  cost?: number;
  duration?: number;
  dependencies?: string[];
}

export interface AgentExecution {
  agentId: string;
  agentName: string;
  status: "idle" | "busy" | "error";
  currentStep?: string;
  currentMission?: number;
  totalExecuted: number;
  totalCost: number;
  avgDuration: number;
}

export const missions = {
  list: () => request<Mission[]>("/missions"),
  getExecution: (runId: number) => request<MissionExecution>(`/missions/${runId}/execution`),
  pause: (runId: number) => request<{ success: boolean }>(`/missions/${runId}/pause`, { method: "POST" }),
  resume: (runId: number) => request<{ success: boolean }>(`/missions/${runId}/resume`, { method: "POST" }),
  abort: (runId: number) => request<{ success: boolean }>(`/missions/${runId}/abort`, { method: "POST" }),
};

export const agents = {
  list: () => request<AgentExecution[]>("/agents"),
  getStatus: (agentId: string) => request<AgentExecution>(`/agents/${agentId}`),
};

// ── Pipelines ─────────────────────────────────────────────────────────────────

export interface Pipeline {
  id: number;
  name: string;
  description?: string;
  status?: string;
}

export interface PipelineTrigger {
  id: number;
  pipelineId: number;
  type: string;
  enabled?: boolean;
}

export interface PipelineExecuteResult {
  success: boolean;
  runId?: number;
  error?: string;
}

/**
 * Pipeline trigger controls. Backed by the platform's real endpoints:
 *   GET  /api/pipelines            — the pipelines this org can run
 *   GET  /api/pipelines/:id/triggers — configured triggers for one pipeline
 *   POST /api/pipelines/:id/execute  — start a run
 */
export const pipelines = {
  list: () => request<Pipeline[]>("/pipelines"),
  listTriggers: (pipelineId: number) =>
    request<PipelineTrigger[]>(`/pipelines/${pipelineId}/triggers`),
  execute: (pipelineId: number, inputs: Record<string, unknown> = {}) =>
    request<PipelineExecuteResult>(`/pipelines/${pipelineId}/execute`, {
      method: "POST",
      body: JSON.stringify({ inputs }),
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
