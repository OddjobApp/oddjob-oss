/**
 * Platform API Client — IT Ticketing Portal
 *
 * Persists tickets and triage evaluations into org-scoped `app_records`
 * through `/api/oddjob/datasets` (intercepted by the platform preview bridge
 * when mounted at `/app/<slug>` or forwarded by `pages/api/oddjob/[...path].ts`).
 * Falls back to `/api/tickets` only when running standalone outside Oddjob.
 */
import type { Ticket, TicketCategory, TicketPriority, TicketStatus, TriageRecord } from "../pages/api/tickets";

export const IT_COLLECTIONS = {
  TICKETS: "it_service_desk_tickets",
  TRIAGE_RUNS: "it_service_desk_triage_runs",
} as const;

export function resolveLocalApiUrl(apiPath: string): string {
  const clean = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/app/")) {
    const slug = window.location.pathname.split("/")[2];
    if (slug) return `/app/${slug}${clean}`;
  }
  return clean;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/oddjob${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
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

export interface AppRecord {
  id: string;
  _recordId?: string;
  _createdAt?: string;
  _updatedAt?: string;
  [key: string]: unknown;
}

export const records = {
  list: <T = AppRecord>(collection: string, sourceApp?: string) => {
    const qs = new URLSearchParams({ collection });
    if (sourceApp) qs.set("source_app", sourceApp);
    return request<T[]>(`/datasets?${qs.toString()}`);
  },
  create: <T = AppRecord>(collection: string, data: Record<string, unknown>) =>
    request<T>(`/datasets?collection=${encodeURIComponent(collection)}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: <T = AppRecord>(collection: string, id: string, data: Record<string, unknown>) =>
    request<T>(`/datasets/${encodeURIComponent(id)}?collection=${encodeURIComponent(collection)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (collection: string, id: string) =>
    request<void>(`/datasets/${encodeURIComponent(id)}?collection=${encodeURIComponent(collection)}`, {
      method: "DELETE",
    }),
};

export interface MissionTriggerResult {
  runId: number | null;
  status: string;
  queued?: boolean;
  outboxRecordId?: string | number;
  message?: string;
}

export function requireLaunchedMission(receipt: MissionTriggerResult | null | undefined): asserts receipt is MissionTriggerResult & { runId: number } {
  if (!receipt || typeof receipt.runId !== "number" || receipt.runId <= 0 || receipt.status === "queued" || receipt.queued) {
    throw new Error(receipt?.message || "Mission was queued without an active execution run ID");
  }
}

export const missions = {
  trigger: (name: string, context?: Record<string, unknown>) =>
    request<MissionTriggerResult>("/missions/trigger", {
      method: "POST",
      body: JSON.stringify({ name, context }),
    }),
};

export const knowledge = {
  query: (q: string, limit = 5) =>
    request<{ nodes?: Array<{ id?: string; label?: string; title?: string; summary?: string }>; matches?: Array<{ title?: string; content?: string }> }>(
      `/knowledge/query?q=${encodeURIComponent(q)}&limit=${limit}`
    ),
};

export const hil = {
  create: (prompt: string, context?: Record<string, unknown>) =>
    request<{ id: number | string }>("/hil", {
      method: "POST",
      body: JSON.stringify({ prompt, context }),
    }),
};

export const telemetry = {
  emit: (event: string, level: "info" | "warn" | "error" = "info", metadata?: Record<string, unknown>) =>
    request<unknown>("/telemetry", {
      method: "POST",
      body: JSON.stringify({ event, level, metadata }),
    }).catch(() => {}),
};

function normalizeTicket(raw: Record<string, unknown>): Ticket {
  const recordId = typeof raw.id === "string" ? raw.id : String(raw._recordId ?? "");
  const ticketId = typeof raw.ticketId === "string" && raw.ticketId ? raw.ticketId : recordId;
  return {
    id: ticketId,
    recordId,
    subject: String(raw.subject ?? "Untitled request"),
    category: (raw.category as TicketCategory) ?? "Software",
    status: (raw.status as TicketStatus) ?? "Open",
    priority: (raw.priority as TicketPriority) ?? "Medium",
    requester: String(raw.requester ?? "you@org"),
    details: typeof raw.details === "string" ? raw.details : "",
    updatedAt: String(raw.updatedAt ?? raw._updatedAt ?? raw._createdAt ?? new Date().toISOString()),
  };
}

export const ticketService = {
  async list(): Promise<{ tickets: Ticket[]; source: "platform" | "local" }> {
    try {
      const rows = await records.list<Record<string, unknown>>(IT_COLLECTIONS.TICKETS);
      return {
        tickets: rows.map(normalizeTicket),
        source: "platform",
      };
    } catch {
      const res = await fetch(resolveLocalApiUrl("/api/tickets"));
      if (!res.ok) throw new Error(`Failed to load tickets (${res.status})`);
      const data = await res.json();
      return {
        tickets: (data.tickets ?? []).map(normalizeTicket),
        source: data.source === "platform" ? "platform" : "local",
      };
    }
  },

  async create(input: {
    subject: string;
    category: TicketCategory;
    priority: TicketPriority;
    details?: string;
    requester?: string;
  }): Promise<{ ticket: Ticket; source: "platform" | "local" }> {
    const ticketId = `TKT-${Math.floor(1000 + (Date.now() % 9000))}`;
    const payload = {
      ticketId,
      subject: input.subject.trim(),
      category: input.category,
      status: "Open" as TicketStatus,
      priority: input.priority,
      requester: input.requester?.trim() || "you@org",
      details: input.details?.trim() || "",
      updatedAt: new Date().toISOString(),
    };

    try {
      const created = await records.create<Record<string, unknown>>(IT_COLLECTIONS.TICKETS, payload);
      telemetry.emit("it_ticket_submitted", "info", { ticketId, category: input.category, priority: input.priority });
      return { ticket: normalizeTicket({ ...payload, ...created }), source: "platform" };
    } catch {
      const res = await fetch(resolveLocalApiUrl("/api/tickets"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to submit ticket");
      }
      const data = await res.json();
      return { ticket: normalizeTicket(data.ticket), source: data.source === "platform" ? "platform" : "local" };
    }
  },

  async updateStatus(ticket: Ticket, status: TicketStatus): Promise<Ticket> {
    const updatedAt = new Date().toISOString();
    const recordKey = ticket.recordId || ticket.id;
    try {
      const updated = await records.update<Record<string, unknown>>(IT_COLLECTIONS.TICKETS, recordKey, {
        status,
        updatedAt,
      });
      telemetry.emit("it_ticket_status_updated", "info", { ticketId: ticket.id, status });
      return normalizeTicket({ ...ticket, ...updated, status, updatedAt });
    } catch {
      const res = await fetch(resolveLocalApiUrl("/api/tickets"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ticket.id, recordId: ticket.recordId, status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to update ticket status");
      }
      const data = await res.json();
      return normalizeTicket(data.ticket);
    }
  },
};

export function evaluateTicketTriage(
  ticket: Ticket,
  knowledgeTitles: string[] = []
): Omit<TriageRecord, "id"> {
  const baseByCategory: Record<TicketCategory, number> = {
    Access: 92,
    Software: 84,
    Network: 68,
    Hardware: 42,
  };
  const priorityPenalty: Record<TicketPriority, number> = {
    Low: 4,
    Medium: 0,
    High: -10,
  };
  const kbBonus = knowledgeTitles.length > 0 ? 4 : 0;
  const confidence = Math.max(15, Math.min(99, (baseByCategory[ticket.category] ?? 65) + (priorityPenalty[ticket.priority] ?? 0) + kbBonus));

  const status: TriageRecord["status"] =
    confidence >= 85 && ticket.priority !== "High"
      ? "Autonomous Resolution"
      : confidence >= 60
        ? "Pending Human Review"
        : "Human Escalation";

  const stepsByCategory: Record<TicketCategory, string[]> = {
    Access: [
      "Verify requester identity and group membership",
      "Check resource owner policy and manager approval",
      "Provision scoped role assignment",
      "Record audit trail and notify requester",
    ],
    Software: [
      "Check license seat availability in org catalog",
      "Validate software security & compliance allowlist",
      "Dispatch silent installer package",
      "Verify activation and attach setup guide",
    ],
    Network: [
      "Collect gateway and VPN session diagnostics",
      "Correlate drop timestamps against regional health",
      "Apply adapter/protocol remediation profile",
      "Verify tunnel stability or route to L2 network engineer",
    ],
    Hardware: [
      "Capture device serial and warranty entitlement",
      "Run remote hardware diagnostics check",
      "Stage loaner/replacement dispatch request",
      "Assign L2 desk-side technician",
    ],
  };

  const defaultSopByCategory: Record<TicketCategory, string> = {
    Access: "IT Policy: Zero-Trust Access Request SOP",
    Software: "KB-203: Standard Software Provisioning Runbook",
    Network: "KB-204: Resolving Recurring VPN & Wi-Fi Disconnects",
    Hardware: "KB-210: Hardware Triage & Loaner Dispatch Procedure",
  };

  const knowledgeMatch = knowledgeTitles[0] || defaultSopByCategory[ticket.category];

  return {
    ticketId: ticket.id,
    confidence,
    status,
    steps: stepsByCategory[ticket.category] ?? stepsByCategory.Software,
    reasoning: `Evaluated category "${ticket.category}" (${ticket.priority} priority)${knowledgeTitles.length ? ` with ${knowledgeTitles.length} knowledge base match(es)` : ""}. Calculated ${confidence}% autonomous resolution confidence.`,
    knowledgeMatch,
    evaluatedAt: new Date().toISOString(),
  };
}
