import { XMLParser } from "fast-xml-parser";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("HeartbeatSources");

/**
 * Heartbeat source adapters.
 *
 * Each adapter polls one external source and returns the items that are new
 * since the trigger's `lastItemId` watermark. Items are returned oldest →
 * newest so the caller can take the last item's id as the next watermark.
 * Every item must carry an `id` field; the rest of the shape is
 * adapter-specific and flows through to the mission objective verbatim.
 */

export interface HeartbeatItem {
    id: string;
    [key: string]: unknown;
}

// ── Email (AgentMail inbox) ──────────────────────────────────────────────────
//
// Watermark is the message `created_at` ISO string — AgentMail orders newest
// first, and message ids are not sortable, so the timestamp is the cursor.
// `sourceConfig.sinceMinutes` optionally prunes the first poll so enabling a
// trigger doesn't backfill the whole inbox.

export async function pollAgentMailInbox(
    lastItemId: string | null,
    config: Record<string, unknown>,
    organizationId?: number | null,
): Promise<HeartbeatItem[]> {
    const { agentMailService } = await import(
        "../domain/integrations/core/agentmail.service.js"
    );
    if (!Number.isSafeInteger(organizationId) || !organizationId || organizationId <= 0) {
        throw new Error("Organization context required for AgentMail polling");
    }
    const roomKey = config.sessionKey;
    if (roomKey !== undefined && (typeof roomKey !== "string" || !roomKey)) throw new Error("Invalid AgentMail room context");
    const mail = roomKey === undefined ? await agentMailService.forOrg(organizationId)
        : await agentMailService.forContext(organizationId, roomKey);
    const limit = Math.min(100, Math.max(1, Number(config.limit) || 25));
    const { messages } = await mail.listMessages(limit);
    const ownAddress = await mail.getInboxAddress();
    const watermark = lastItemId ?? fallbackSince(config);
    const fresh = (messages ?? [])
        // Inbound only — our own outbound sends are not work items.
        .filter((m) => (m.from?.match(/<([^>]+)>/)?.[1] ?? m.from)?.trim().toLowerCase() !== ownAddress)
        .filter((m) => !watermark || m.created_at > watermark)
        .map((m) => ({
            id: m.created_at,
            messageId: m.message_id,
            threadId: m.thread_id,
            from: m.from,
            subject: m.subject,
            text: (m.text ?? "").slice(0, 2000),
            receivedAt: m.created_at,
        }))
        // API returns newest first; watermark cursor needs ascending order.
        .reverse();

    return fresh;
}

function fallbackSince(config: Record<string, unknown>): string | null {
    const minutes = Number(config.sinceMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    return new Date(Date.now() - minutes * 60_000).toISOString();
}

// ── RSS / Atom ───────────────────────────────────────────────────────────────
//
// `sourceConfig.url` is required. Watermark is the newest seen item id; we
// collect items (feeds are newest-first) until we hit the previous watermark.

export function parseRssItems(xml: string): HeartbeatItem[] {
    const doc = new XMLParser({ ignoreAttributes: false }).parse(xml);
    const entries: any[] =
        doc?.rss?.channel?.item ?? doc?.feed?.entry ?? doc?.rdf?.item ?? [];
    const list = Array.isArray(entries) ? entries : [entries];

    const items: HeartbeatItem[] = [];
    for (const e of list) {
        const id = String(
            e.guid?.["#text"] ?? e.guid ?? e.id ?? e.link?.["@_href"] ?? e.link ?? "",
        );
        if (!id) continue;
        items.push({
            id,
            title: String(e.title?.["#text"] ?? e.title ?? ""),
            link: String(e.link?.["@_href"] ?? e.link ?? ""),
            publishedAt: String(e.pubDate ?? e.published ?? e.updated ?? ""),
        });
    }
    return items;
}

export async function pollRssFeed(
    lastItemId: string | null,
    config: Record<string, unknown>,
): Promise<HeartbeatItem[]> {
    const url = String(config.url ?? "");
    if (!url) {
        logger.warn("rss heartbeat trigger missing sourceConfig.url");
        return [];
    }

    const res = await fetch(url, { headers: { "User-Agent": "Oddjob-Heartbeat/1.0" } });
    if (!res.ok) throw new Error(`RSS fetch failed [${res.status}] for ${url}`);

    const items = parseRssItems(await res.text());
    const fresh: HeartbeatItem[] = [];
    for (const item of items) {
        if (item.id === lastItemId) break;
        fresh.push(item);
    }
    // On first poll (no watermark) cap at one item — the newest — rather than
    // backfilling the feed's whole history as missions.
    const capped = lastItemId == null ? fresh.slice(0, 1) : fresh;
    return capped.reverse();
}

// ── Jira (JQL queue) ─────────────────────────────────────────────────────────
//
// `sourceConfig.jql` is required — the trigger watches the queue the query
// selects (e.g. `project = OPS AND status = "Needs Triage"`). Watermark is the
// issue `updated` timestamp. First poll caps at `maxFirstPoll` (default 5) so
// enabling a trigger on a large existing queue doesn't spawn a mission storm.

export async function pollJiraQueue(
    lastItemId: string | null,
    config: Record<string, unknown>,
    orgId: number | null,
): Promise<HeartbeatItem[]> {
    const jql = String(config.jql ?? "");
    if (!jql) {
        logger.warn("jira heartbeat trigger missing sourceConfig.jql");
        return [];
    }
    if (orgId == null) {
        logger.warn("jira heartbeat trigger has no org context");
        return [];
    }

    const { sdlcToolStubs } = await import(
        "../domain/tools/v1/capabilities/sdlc-tools.js"
    );
    const result = await sdlcToolStubs.jiraJqlSearch({
        jql,
        orgId,
        limit: Number(config.limit) || 25,
    });

    if (!result?.success) {
        logger.warn(`jira heartbeat JQL failed: ${(result as any)?.error ?? "unknown"}`);
        return [];
    }

    const watermark = lastItemId ?? fallbackSince(config);
    let fresh = (result.issues ?? [])
        .filter((i: any) => i.updated && (!watermark || i.updated > watermark))
        .map((i: any) => ({
            id: i.updated,
            key: i.key,
            summary: i.summary,
            status: i.status,
            priority: i.priority,
            assignee: i.assignee,
            issueType: i.issueType,
            project: i.project,
            updatedAt: i.updated,
        }))
        // Watermark cursor needs ascending order.
        .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));

    if (lastItemId == null && watermark == null) {
        fresh = fresh.slice(0, Number(config.maxFirstPoll) || 5);
    }
    return fresh;
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function pollHeartbeatSource(
    sourceType: string,
    sourceConfig: Record<string, unknown>,
    lastItemId: string | null,
    orgId: number | null = null,
): Promise<HeartbeatItem[]> {
    switch (sourceType) {
        case "email":
            return pollAgentMailInbox(lastItemId, sourceConfig, orgId);
        case "rss":
            return pollRssFeed(lastItemId, sourceConfig);
        case "jira":
            return pollJiraQueue(lastItemId, sourceConfig, orgId);
        case "slack":
            // Inbound Slack already arrives via SlackSocketListener → channel
            // gateway; polling history here would double-process those events.
            logger.debug("slack heartbeat adapter unused — inbound events flow through the socket listener");
            return [];
        case "db_inbox":
        case "webhook":
            logger.debug(`${sourceType} heartbeat adapter not yet implemented`);
            return [];
        default:
            logger.warn(`Unknown heartbeat source type: ${sourceType}`);
            return [];
    }
}
