/**
 * Platform API Client — Agent Fleet Command (Full Platform)
 */
const BASE = "/api/oddjob";

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
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  if (!res.ok) { let msg = `HTTP ${res.status}`; try { const b = await res.json(); msg = errorMessage(b?.error ?? b?.message, msg); } catch {} throw new Error(msg); }
  return res.json() as Promise<T>;
}

export interface AppRecord { id: string; [key: string]: unknown; _createdAt: string; _updatedAt: string; }
export const records = {
  list: (collection: string) => request<AppRecord[]>(`/datasets?collection=${encodeURIComponent(collection)}`),
  create: (collection: string, data: Record<string, unknown>) => request<AppRecord>(`/datasets?collection=${encodeURIComponent(collection)}`, { method: "POST", body: JSON.stringify(data) }),
  update: (collection: string, id: string, data: Record<string, unknown>) => request<AppRecord>(`/datasets/${id}?collection=${encodeURIComponent(collection)}`, { method: "PUT", body: JSON.stringify(data) }),
};

export interface FleetAgent { id: string; agent: string; mission: string; objective: string; status: string; currentStep: string; workingOn: string; dependencies: string[]; unresolvedDependencies: string[]; runtimeSeconds: number; costUsd: number; confidence: number | null; risk: "low" | "medium" | "high"; lastActionAt: string; flightRecorder: Array<{ id: number; type: string; toolName: string | null; content: string; confidence: number | null; createdAt: string }>; }
export interface AttentionItem { id: string; severity: "critical" | "watch"; agent: string; mission: string; reason: string; }
export interface FleetWorkload { cycle: { id: number; name: string; status: string; objective: string; budgetLimitUsd: number; currentSpendUsd: number } | null; agents: FleetAgent[]; attention: AttentionItem[]; summary: { active: number; waiting: number; blocked: number; idle: number; completed: number; tokenSpendUsd: number }; generatedAt: string; }
export const fleet = { workload: () => request<FleetWorkload>("/fleet/workload") };

export const knowledge = { query: (q: string, limit = 5) => request<{ nodes: any[] }>(`/knowledge/query?q=${encodeURIComponent(q)}&limit=${limit}`) };
export const platformDatasets = { query: (datasetId: number, filter?: Record<string, unknown>, limit = 10) => request<any>(`/datasets/platform/${datasetId}/query`, { method: "POST", body: JSON.stringify({ filter, limit }) }) };

export interface ConfluencePublishResult { success: boolean; pageId?: string; url?: string; error?: string; }
export const confluence = { publish: (params: { title: string; content: string; space?: string }) => request<ConfluencePublishResult>("/integrations/confluence/publish", { method: "POST", body: JSON.stringify(params) }) };

export const agents = {
  chat: async function* (agentId: number, message: string, collectionName?: string): AsyncGenerator<string> {
    const res = await fetch(`${BASE}/agents/${agentId}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, collectionName }) });
    if (!res.ok) throw new Error(`Agent chat failed: ${res.status}`);
    if (!res.body) throw new Error("No response body");
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
    while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; for (const line of lines) { if (line.startsWith("data: ")) { const data = line.slice(6); if (data === "[DONE]") return; try { const p = JSON.parse(data); const c = p?.choices?.[0]?.delta?.content; if (c) yield c; } catch {} } } }
  },
  history: (agentId: number, collection?: string) => request<{ messages: any[] }>(`/agents/${agentId}/history${collection ? `?collection=${encodeURIComponent(collection)}` : ""}`),
};

export const telemetry = { emit: (event: string, level: "info" | "warn" | "error" = "info", metadata?: Record<string, unknown>) => request<any>("/telemetry", { method: "POST", body: JSON.stringify({ event, level, metadata }) }).catch(() => {}) };
