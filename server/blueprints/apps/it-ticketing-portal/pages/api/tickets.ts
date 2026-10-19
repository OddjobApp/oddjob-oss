interface ApiRequest {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  end(): void;
}

export type TicketCategory = "Hardware" | "Software" | "Access" | "Network";
export type TicketStatus = "Open" | "In Progress" | "Resolved";
export type TicketPriority = "Low" | "Medium" | "High";

export interface Ticket {
  id: string;
  recordId?: string;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  requester: string;
  details?: string;
  updatedAt: string;
}

export interface TriageRecord {
  id?: string;
  ticketId: string;
  confidence: number;
  status: "Autonomous Resolution" | "Human Escalation" | "Pending Human Review";
  steps: string[];
  reasoning: string;
  knowledgeMatch: string;
  evaluatedAt: string;
  lastMissionRunId?: number | null;
  lastMissionStatus?: string;
  hilRequestId?: string | number | null;
}

const PLATFORM_URL = process.env.ODDJOB_PLATFORM_URL ?? "http://localhost:5000";
const APP_TOKEN = process.env.ODDJOB_APP_TOKEN ?? "";
const COLLECTION = "it_service_desk_tickets";

// Stateful fallback store for standalone execution when ODDJOB_APP_TOKEN is absent.
const standaloneTickets: Ticket[] = [
  { id: "TKT-1042", recordId: "TKT-1042", subject: "Laptop won't boot after update", category: "Hardware", status: "In Progress", priority: "High", requester: "dana@org", details: "Stuck on BIOS splash screen after overnight patch.", updatedAt: "2026-06-18T08:12:00.000Z" },
  { id: "TKT-1041", recordId: "TKT-1041", subject: "Need access to Finance SharePoint", category: "Access", status: "Open", priority: "Medium", requester: "sam@org", details: "Requesting read/write access to Q3 close folder.", updatedAt: "2026-06-18T07:55:00.000Z" },
  { id: "TKT-1039", recordId: "TKT-1039", subject: "VPN drops every few minutes", category: "Network", status: "Open", priority: "High", requester: "lee@org", details: "Tunnel disconnects every ~5 minutes on home Wi-Fi.", updatedAt: "2026-06-17T16:40:00.000Z" },
  { id: "TKT-1036", recordId: "TKT-1036", subject: "Install Figma license", category: "Software", status: "Resolved", priority: "Low", requester: "kim@org", details: "Product design seat approved by team lead.", updatedAt: "2026-06-17T11:05:00.000Z" },
  { id: "TKT-1033", recordId: "TKT-1033", subject: "Monitor flickering at desk 14", category: "Hardware", status: "Resolved", priority: "Medium", requester: "alex@org", details: "Replaced faulty USB-C display cable.", updatedAt: "2026-06-16T13:22:00.000Z" },
];

function mapPlatformRow(row: Record<string, unknown>): Ticket {
  const recordId = typeof row.id === "string" ? row.id : String(row._recordId ?? "");
  const ticketId = typeof row.ticketId === "string" && row.ticketId ? row.ticketId : recordId;
  return {
    id: ticketId,
    recordId,
    subject: String(row.subject ?? "Untitled request"),
    category: (row.category as TicketCategory) ?? "Software",
    status: (row.status as TicketStatus) ?? "Open",
    priority: (row.priority as TicketPriority) ?? "Medium",
    requester: String(row.requester ?? "you@org"),
    details: typeof row.details === "string" ? row.details : "",
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
          return res.status(200).json({ tickets: rows.map(mapPlatformRow), source: "platform" });
        }
      } catch {}
    }
    return res.status(200).json({ tickets: standaloneTickets, source: "local" });
  }

  if (req.method === "POST") {
    const { ticketId, subject, category, priority, details, requester } = (req.body ?? {}) as Partial<Ticket> & { ticketId?: string };
    if (!subject || !subject.trim()) {
      return res.status(400).json({ error: "subject is required" });
    }
    const id = ticketId && ticketId.trim() ? ticketId.trim() : `TKT-${Math.floor(1000 + (Date.now() % 9000))}`;
    const payload = {
      ticketId: id,
      subject: subject.trim(),
      category: (category as TicketCategory) ?? "Software",
      status: "Open" as TicketStatus,
      priority: (priority as TicketPriority) ?? "Medium",
      requester: requester?.trim() || "you@org",
      details: details?.trim() || "",
      updatedAt: new Date().toISOString(),
    };

    if (APP_TOKEN) {
      try {
        const upstream = await fetch(`${PLATFORM_URL}/api/platform/app/datasets?collection=${COLLECTION}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${APP_TOKEN}`,
          },
          body: JSON.stringify(payload),
        });
        if (upstream.ok) {
          const created = (await upstream.json()) as Record<string, unknown>;
          return res.status(201).json({ ticket: mapPlatformRow({ ...payload, ...created }), source: "platform" });
        }
      } catch {}
    }

    const ticket: Ticket = {
      id,
      recordId: id,
      subject: payload.subject,
      category: payload.category,
      status: payload.status,
      priority: payload.priority,
      requester: payload.requester,
      details: payload.details,
      updatedAt: payload.updatedAt,
    };
    standaloneTickets.unshift(ticket);
    return res.status(201).json({ ticket, source: "local" });
  }

  if (req.method === "PUT") {
    const { id, recordId, status, priority } = (req.body ?? {}) as Partial<Ticket>;
    const lookupId = recordId || id;
    if (!lookupId) {
      return res.status(400).json({ error: "ticket id is required" });
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
              ...(status ? { status } : {}),
              ...(priority ? { priority } : {}),
              updatedAt,
            }),
          }
        );
        if (upstream.ok) {
          const updated = (await upstream.json()) as Record<string, unknown>;
          return res.status(200).json({ ticket: mapPlatformRow(updated), source: "platform" });
        }
      } catch {}
    }

    const idx = standaloneTickets.findIndex((t) => t.id === id || t.recordId === lookupId);
    if (idx === -1) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    standaloneTickets[idx] = {
      ...standaloneTickets[idx],
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      updatedAt,
    };
    return res.status(200).json({ ticket: standaloneTickets[idx], source: "local" });
  }

  res.setHeader("Allow", "GET, POST, PUT");
  return res.status(405).end();
}
