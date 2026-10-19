interface ApiRequest {
  method?: string;
  body?: unknown;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  end(): void;
}

export type QueueStage = "Triage" | "In Progress" | "Awaiting Approval";
export type SlaStatus = "On Track" | "At Risk" | "Breached";

export interface QueueItem {
  id: string;
  recordId?: string;
  subject: string;
  stage: QueueStage;
  assignee: string;
  aiConfidence: number; // 0..1
  sla: SlaStatus;
  updatedAt?: string;
}

const PLATFORM_URL = process.env.ODDJOB_PLATFORM_URL ?? "http://localhost:5000";
const APP_TOKEN = process.env.ODDJOB_APP_TOKEN ?? "";
const COLLECTION = "support_agent_queue";

const standaloneQueue: QueueItem[] = [
  { id: "TKT-1042", recordId: "TKT-1042", subject: "Laptop won't boot after update", stage: "In Progress", assignee: "L2 · Priya", aiConfidence: 0.82, sla: "At Risk" },
  { id: "TKT-1041", recordId: "TKT-1041", subject: "Finance SharePoint access", stage: "Triage", assignee: "Unassigned", aiConfidence: 0.94, sla: "On Track" },
  { id: "TKT-1039", recordId: "TKT-1039", subject: "VPN drops every few minutes", stage: "In Progress", assignee: "L2 · Marcus", aiConfidence: 0.61, sla: "Breached" },
  { id: "TKT-1044", recordId: "TKT-1044", subject: "New starter laptop provisioning", stage: "Awaiting Approval", assignee: "L1 · Bot", aiConfidence: 0.88, sla: "On Track" },
  { id: "TKT-1045", recordId: "TKT-1045", subject: "Password reset — exec account", stage: "Awaiting Approval", assignee: "Escalation", aiConfidence: 0.71, sla: "At Risk" },
  { id: "TKT-1046", recordId: "TKT-1046", subject: "Clear print spooler cache", stage: "Triage", assignee: "L1 · Bot", aiConfidence: 0.97, sla: "On Track" },
];

function mapPlatformRow(row: Record<string, unknown>): QueueItem {
  const recordId = typeof row.id === "string" ? row.id : String(row._recordId ?? "");
  const ticketId = typeof row.ticketId === "string" && row.ticketId ? row.ticketId : recordId;
  return {
    id: ticketId,
    recordId,
    subject: String(row.subject ?? "Support request"),
    stage: (row.stage as QueueStage) ?? "Triage",
    assignee: String(row.assignee ?? "Unassigned"),
    aiConfidence: typeof row.aiConfidence === "number" ? row.aiConfidence : 0.75,
    sla: (row.sla as SlaStatus) ?? "On Track",
    updatedAt: String(row.updatedAt ?? row._updatedAt ?? row._createdAt ?? new Date().toISOString()),
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === "GET") {
    if (APP_TOKEN) {
      try {
        const upstream = await fetch(`${PLATFORM_URL}/api/platform/app/datasets?collection=${COLLECTION}`, {
          headers: { Authorization: `Bearer ${APP_TOKEN}` },
        });
        if (upstream.ok) {
          const rows = (await upstream.json()) as Array<Record<string, unknown>>;
          return res.status(200).json({ items: rows.map(mapPlatformRow), source: "platform" });
        }
      } catch {}
    }
    return res.status(200).json({ items: standaloneQueue, source: "local" });
  }

  if (req.method === "POST" || req.method === "PUT") {
    const { id, recordId, subject, stage, assignee, aiConfidence, sla } = (req.body ?? {}) as Partial<QueueItem>;
    const lookupId = recordId || id;
    if (!lookupId) {
      return res.status(400).json({ error: "id is required" });
    }
    const updatedAt = new Date().toISOString();

    if (APP_TOKEN) {
      try {
        const upstream = await fetch(
          `${PLATFORM_URL}/api/platform/app/datasets/${encodeURIComponent(lookupId)}?collection=${COLLECTION}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${APP_TOKEN}`,
            },
            body: JSON.stringify({
              ...(subject ? { subject } : {}),
              ...(stage ? { stage } : {}),
              ...(assignee ? { assignee } : {}),
              ...(typeof aiConfidence === "number" ? { aiConfidence } : {}),
              ...(sla ? { sla } : {}),
              updatedAt,
            }),
          }
        );
        if (upstream.ok) {
          const updated = (await upstream.json()) as Record<string, unknown>;
          return res.status(200).json({ item: mapPlatformRow(updated), source: "platform" });
        }
      } catch {}
    }

    const idx = standaloneQueue.findIndex((q) => q.id === id || q.recordId === lookupId);
    if (idx === -1) {
      const created: QueueItem = {
        id: String(id || lookupId),
        recordId: String(lookupId),
        subject: subject?.trim() || "Support request",
        stage: stage ?? "Triage",
        assignee: assignee ?? "Unassigned",
        aiConfidence: typeof aiConfidence === "number" ? aiConfidence : 0.75,
        sla: sla ?? "On Track",
        updatedAt,
      };
      standaloneQueue.unshift(created);
      return res.status(201).json({ item: created, source: "local" });
    }

    standaloneQueue[idx] = {
      ...standaloneQueue[idx],
      ...(subject ? { subject } : {}),
      ...(stage ? { stage } : {}),
      ...(assignee ? { assignee } : {}),
      ...(typeof aiConfidence === "number" ? { aiConfidence } : {}),
      ...(sla ? { sla } : {}),
      updatedAt,
    };
    return res.status(200).json({ item: standaloneQueue[idx], source: "local" });
  }

  res.setHeader("Allow", "GET, POST, PUT");
  return res.status(405).end();
}
