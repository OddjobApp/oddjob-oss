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

export type KbStatus = "Draft" | "In Review" | "Published";

export interface KbArticle {
  id: string;
  recordId?: string;
  title: string;
  status: KbStatus;
  aiDrafted: boolean;
  body: string;
  confluenceUrl?: string;
  updatedAt: string;
}

const PLATFORM_URL = process.env.ODDJOB_PLATFORM_URL ?? "http://localhost:5000";
const APP_TOKEN = process.env.ODDJOB_APP_TOKEN ?? "";
const COLLECTION = "support_kb_articles";

const standaloneArticles: KbArticle[] = [
  {
    id: "KB-204",
    recordId: "KB-204",
    title: "Resolving recurring VPN disconnects",
    status: "In Review",
    aiDrafted: true,
    body: "## Symptom\nVPN drops every few minutes on Wi-Fi.\n\n## Resolution\n1. Disable IPv6 on the adapter.\n2. Switch the VPN protocol to TCP.\n3. Update the network driver.\n\n_Drafted by the KB maintainer agent from 3 resolved tickets._",
    updatedAt: "2026-06-18T09:10:00.000Z",
  },
  {
    id: "KB-203",
    recordId: "KB-203",
    title: "Requesting access to a SharePoint site",
    status: "Published",
    aiDrafted: true,
    body: "## Overview\nHow to request and approve SharePoint access.\n\n## Steps\n1. Submit an Access ticket naming the site.\n2. Owner approval routes via Slack.\n3. Access is granted within 1 business day.",
    updatedAt: "2026-06-17T14:30:00.000Z",
  },
  {
    id: "KB-205",
    recordId: "KB-205",
    title: "Clearing the print spooler cache",
    status: "Draft",
    aiDrafted: true,
    body: "## Symptom\nPrint jobs stuck in queue.\n\n## Resolution\nStop the Print Spooler service, clear %SystemRoot%\\System32\\spool\\PRINTERS, restart the service.",
    updatedAt: "2026-06-18T08:45:00.000Z",
  },
];

function mapPlatformRow(row: Record<string, unknown>): KbArticle {
  const recordId = typeof row.id === "string" ? row.id : String(row._recordId ?? "");
  const articleId = typeof row.articleId === "string" && row.articleId ? row.articleId : recordId;
  return {
    id: articleId,
    recordId,
    title: String(row.title ?? "Untitled Article"),
    status: (row.status as KbStatus) ?? "Draft",
    aiDrafted: row.aiDrafted !== false,
    body: String(row.body ?? ""),
    confluenceUrl: typeof row.confluenceUrl === "string" ? row.confluenceUrl : undefined,
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
          return res.status(200).json({ articles: rows.map(mapPlatformRow), source: "platform" });
        }
      } catch {}
    }
    return res.status(200).json({ articles: standaloneArticles, source: "local" });
  }

  if (req.method === "POST" || req.method === "PUT") {
    const { id, recordId, title, status, body, confluenceUrl } = (req.body ?? {}) as Partial<KbArticle>;
    const lookupId = recordId || id;
    if (!lookupId) return res.status(400).json({ error: "article id is required" });
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
              ...(title !== undefined ? { title } : {}),
              ...(status !== undefined ? { status } : {}),
              ...(body !== undefined ? { body } : {}),
              ...(confluenceUrl !== undefined ? { confluenceUrl } : {}),
              updatedAt,
            }),
          }
        );
        if (upstream.ok) {
          const updated = (await upstream.json()) as Record<string, unknown>;
          return res.status(200).json({ article: mapPlatformRow(updated), source: "platform" });
        }
      } catch {}
    }

    const idx = standaloneArticles.findIndex((a) => a.id === id || a.recordId === lookupId);
    if (idx === -1) return res.status(404).json({ error: "article not found" });
    standaloneArticles[idx] = {
      ...standaloneArticles[idx],
      ...(title !== undefined ? { title } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(confluenceUrl !== undefined ? { confluenceUrl } : {}),
      updatedAt,
    };
    return res.status(200).json({ article: standaloneArticles[idx], source: "local" });
  }

  res.setHeader("Allow", "GET, POST, PUT");
  return res.status(405).end();
}
