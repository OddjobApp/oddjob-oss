/**
 * Platform API Client — Support Agent Dashboard
 *
 * Connects the Queue Manager, KB Editor, and Sentiment & Escalation Predictor
 * to org-scoped `app_records` via `/api/oddjob/datasets`, cross-app ticket reads
 * from `it-ticketing-portal`, Confluence publishing, HIL approvals, and
 * verified mission triggers.
 */
import type { QueueItem, QueueStage, SlaStatus } from "../pages/api/queue";
import type { KbArticle, KbStatus } from "../pages/api/kb";

export const SUPPORT_COLLECTIONS = {
  QUEUE: "support_agent_queue",
  KB_ARTICLES: "support_kb_articles",
  ESCALATIONS: "support_escalation_sessions",
  PORTAL_TICKETS: "it_service_desk_tickets",
} as const;

export const PORTAL_SOURCE_APP = "it-ticketing-portal";

export interface EscalationSession {
  id: string;
  recordId?: string;
  user: string;
  initialSentiment: string;
  currentSentiment: string;
  escalationRisk: number;
  reason: string;
  status?: "monitoring" | "escalated_l2" | "remediation_dispatched";
  hilRequestId?: string | number | null;
  lastMissionRunId?: number | null;
  updatedAt?: string;
}

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

export const records = {
  list: <T = Record<string, unknown>>(collection: string, sourceApp?: string) => {
    const qs = new URLSearchParams({ collection });
    if (sourceApp) qs.set("source_app", sourceApp);
    return request<T[]>(`/datasets?${qs.toString()}`);
  },
  create: <T = Record<string, unknown>>(collection: string, data: Record<string, unknown>) =>
    request<T>(`/datasets?collection=${encodeURIComponent(collection)}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: <T = Record<string, unknown>>(collection: string, id: string, data: Record<string, unknown>) =>
    request<T>(`/datasets/${encodeURIComponent(id)}?collection=${encodeURIComponent(collection)}`, {
      method: "PUT",
      body: JSON.stringify(data),
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

export interface ConfluencePublishResult {
  success: boolean;
  pageId?: string;
  url?: string;
  error?: string;
}

export const confluence = {
  publish: (params: { title: string; content: string; space?: string }) =>
    request<ConfluencePublishResult>("/integrations/confluence/publish", {
      method: "POST",
      body: JSON.stringify(params),
    }),
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

function normalizeQueueRow(raw: Record<string, unknown>): QueueItem {
  const recordId = typeof raw.id === "string" ? raw.id : String(raw._recordId ?? "");
  const ticketId = typeof raw.ticketId === "string" && raw.ticketId ? raw.ticketId : recordId;
  return {
    id: ticketId,
    recordId,
    subject: String(raw.subject ?? "Support request"),
    stage: (raw.stage as QueueStage) ?? "Triage",
    assignee: String(raw.assignee ?? "Unassigned"),
    aiConfidence: typeof raw.aiConfidence === "number" ? raw.aiConfidence : 0.75,
    sla: (raw.sla as SlaStatus) ?? "On Track",
    updatedAt: String(raw.updatedAt ?? raw._updatedAt ?? raw._createdAt ?? new Date().toISOString()),
  };
}

function mapPortalTicketToQueueItem(raw: Record<string, unknown>): QueueItem {
  const recordId = typeof raw.id === "string" ? raw.id : String(raw._recordId ?? "");
  const ticketId = typeof raw.ticketId === "string" && raw.ticketId ? raw.ticketId : recordId;
  const status = String(raw.status ?? "Open");
  const priority = String(raw.priority ?? "Medium");
  const stage: QueueStage =
    status === "In Progress" ? "In Progress" : status === "Resolved" ? "Awaiting Approval" : "Triage";
  const sla: SlaStatus = priority === "High" ? "At Risk" : "On Track";
  return {
    id: ticketId,
    recordId,
    subject: String(raw.subject ?? "IT Portal Request"),
    stage,
    assignee: status === "In Progress" ? "L2 · Assigned" : "L1 · Triage",
    aiConfidence: priority === "High" ? 0.68 : 0.88,
    sla,
    updatedAt: String(raw.updatedAt ?? raw._updatedAt ?? raw._createdAt ?? new Date().toISOString()),
  };
}

export const queueService = {
  async list(): Promise<{ items: QueueItem[]; source: "platform" | "local" }> {
    try {
      const [ownRows, portalRows] = await Promise.all([
        records.list<Record<string, unknown>>(SUPPORT_COLLECTIONS.QUEUE),
        records.list<Record<string, unknown>>(SUPPORT_COLLECTIONS.PORTAL_TICKETS, PORTAL_SOURCE_APP).catch(() => []),
      ]);
      const items = ownRows.map(normalizeQueueRow);
      const seenIds = new Set(items.map((i) => i.id));
      for (const p of portalRows) {
        const mapped = mapPortalTicketToQueueItem(p);
        if (mapped.id && !seenIds.has(mapped.id)) {
          seenIds.add(mapped.id);
          items.push(mapped);
        }
      }
      return { items, source: "platform" };
    } catch {
      const res = await fetch(resolveLocalApiUrl("/api/queue"));
      if (!res.ok) throw new Error(`Failed to load support queue (${res.status})`);
      const data = await res.json();
      return {
        items: (data.items ?? []).map(normalizeQueueRow),
        source: data.source === "platform" ? "platform" : "local",
      };
    }
  },

  async updateItem(item: QueueItem, patch: Partial<Pick<QueueItem, "stage" | "assignee" | "sla">>): Promise<QueueItem> {
    const updatedAt = new Date().toISOString();
    const recordKey = item.recordId || item.id;
    try {
      const updated = await records.update<Record<string, unknown>>(SUPPORT_COLLECTIONS.QUEUE, recordKey, {
        ticketId: item.id,
        subject: item.subject,
        stage: patch.stage ?? item.stage,
        assignee: patch.assignee ?? item.assignee,
        aiConfidence: item.aiConfidence,
        sla: patch.sla ?? item.sla,
        updatedAt,
      });
      telemetry.emit("support_queue_updated", "info", { ticketId: item.id, ...patch });
      return normalizeQueueRow({ ...item, ...updated, ...patch, updatedAt });
    } catch {
      // If the item originated from the sibling portal collection and doesn't yet exist in SUPPORT_COLLECTIONS.QUEUE, create it first
      try {
        const created = await records.create<Record<string, unknown>>(SUPPORT_COLLECTIONS.QUEUE, {
          ticketId: item.id,
          subject: item.subject,
          stage: patch.stage ?? item.stage,
          assignee: patch.assignee ?? item.assignee,
          aiConfidence: item.aiConfidence,
          sla: patch.sla ?? item.sla,
          updatedAt,
        });
        return normalizeQueueRow({ ...item, ...created, ...patch, updatedAt });
      } catch {
        const res = await fetch(resolveLocalApiUrl("/api/queue"), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...item, ...patch }),
        });
        if (!res.ok) throw new Error("Failed to update queue item");
        const data = await res.json();
        return normalizeQueueRow(data.item);
      }
    }
  },
};

function normalizeKbRow(raw: Record<string, unknown>): KbArticle {
  const recordId = typeof raw.id === "string" ? raw.id : String(raw._recordId ?? "");
  const articleId = typeof raw.articleId === "string" && raw.articleId ? raw.articleId : recordId;
  return {
    id: articleId,
    recordId,
    title: String(raw.title ?? "Untitled Article"),
    status: (raw.status as KbStatus) ?? "Draft",
    aiDrafted: raw.aiDrafted !== false,
    body: String(raw.body ?? ""),
    confluenceUrl: typeof raw.confluenceUrl === "string" ? raw.confluenceUrl : undefined,
    updatedAt: String(raw.updatedAt ?? raw._updatedAt ?? raw._createdAt ?? new Date().toISOString()),
  };
}

export const kbService = {
  async list(): Promise<{ articles: KbArticle[]; source: "platform" | "local" }> {
    try {
      const rows = await records.list<Record<string, unknown>>(SUPPORT_COLLECTIONS.KB_ARTICLES);
      if (rows.length > 0) {
        return { articles: rows.map(normalizeKbRow), source: "platform" };
      }
    } catch {}
    const res = await fetch(resolveLocalApiUrl("/api/kb"));
    if (!res.ok) throw new Error(`Failed to load KB articles (${res.status})`);
    const data = await res.json();
    return {
      articles: (data.articles ?? []).map(normalizeKbRow),
      source: data.source === "platform" ? "platform" : "local",
    };
  },

  async save(article: KbArticle, patch: { body: string; status: KbStatus; confluenceUrl?: string }): Promise<KbArticle> {
    const updatedAt = new Date().toISOString();
    const recordKey = article.recordId || article.id;
    const payload = {
      articleId: article.id,
      title: article.title,
      aiDrafted: article.aiDrafted,
      body: patch.body,
      status: patch.status,
      ...(patch.confluenceUrl ? { confluenceUrl: patch.confluenceUrl } : {}),
      updatedAt,
    };

    try {
      const updated = await records.update<Record<string, unknown>>(SUPPORT_COLLECTIONS.KB_ARTICLES, recordKey, payload);
      return normalizeKbRow({ ...article, ...updated, ...payload });
    } catch {
      try {
        const created = await records.create<Record<string, unknown>>(SUPPORT_COLLECTIONS.KB_ARTICLES, payload);
        return normalizeKbRow({ ...article, ...created, ...payload });
      } catch {
        const res = await fetch(resolveLocalApiUrl("/api/kb"), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: article.id, recordId: article.recordId, ...payload }),
        });
        if (!res.ok) throw new Error("Failed to save KB article");
        const data = await res.json();
        return normalizeKbRow(data.article);
      }
    }
  },

  async publishToConfluence(article: KbArticle, body: string): Promise<{ article: KbArticle; confluenceUrl?: string }> {
    const pub = await confluence.publish({
      title: article.title,
      content: body,
    });
    if (!pub.success) {
      throw new Error(pub.error || "Confluence publish rejected by connector");
    }
    const saved = await kbService.save(article, {
      body,
      status: "Published",
      confluenceUrl: pub.url,
    });
    telemetry.emit("kb_article_published", "info", { articleId: article.id, pageId: pub.pageId });
    return { article: saved, confluenceUrl: pub.url };
  },
};

const SEED_ESCALATION_SESSIONS: EscalationSession[] = [
  {
    id: "SESS-8921",
    recordId: "SESS-8921",
    user: "Alice M.",
    initialSentiment: "Neutral",
    currentSentiment: "Frustrated",
    escalationRisk: 94,
    reason: "Multiple failed attempts to reset password. Tone indicates high frustration.",
    status: "monitoring",
  },
  {
    id: "SESS-8924",
    recordId: "SESS-8924",
    user: "John D.",
    initialSentiment: "Positive",
    currentSentiment: "Neutral",
    escalationRisk: 22,
    reason: "Standard inquiry about billing cycle. Agent provided accurate link.",
    status: "monitoring",
  },
  {
    id: "SESS-8930",
    recordId: "SESS-8930",
    user: "Corp Inc.",
    initialSentiment: "Annoyed",
    currentSentiment: "Angry",
    escalationRisk: 88,
    reason: "Enterprise customer facing prolonged downtime. SLA breach imminent.",
    status: "monitoring",
  },
];

function normalizeEscalationRow(raw: Record<string, unknown>): EscalationSession {
  const recordId = typeof raw.id === "string" ? raw.id : String(raw._recordId ?? "");
  const sessionId = typeof raw.sessionId === "string" && raw.sessionId ? raw.sessionId : recordId;
  return {
    id: sessionId,
    recordId,
    user: String(raw.user ?? "Customer"),
    initialSentiment: String(raw.initialSentiment ?? "Neutral"),
    currentSentiment: String(raw.currentSentiment ?? "Neutral"),
    escalationRisk: typeof raw.escalationRisk === "number" ? raw.escalationRisk : 50,
    reason: String(raw.reason ?? ""),
    status: (raw.status as EscalationSession["status"]) ?? "monitoring",
    hilRequestId: (raw.hilRequestId as string | number | null) ?? null,
    lastMissionRunId: typeof raw.lastMissionRunId === "number" ? raw.lastMissionRunId : null,
    updatedAt: String(raw.updatedAt ?? raw._updatedAt ?? raw._createdAt ?? new Date().toISOString()),
  };
}

export const escalationService = {
  async list(): Promise<{ sessions: EscalationSession[]; source: "platform" | "local" }> {
    try {
      const rows = await records.list<Record<string, unknown>>(SUPPORT_COLLECTIONS.ESCALATIONS);
      if (rows.length > 0) {
        return { sessions: rows.map(normalizeEscalationRow), source: "platform" };
      }
      return { sessions: SEED_ESCALATION_SESSIONS, source: "platform" };
    } catch {
      return { sessions: SEED_ESCALATION_SESSIONS, source: "local" };
    }
  },
};
