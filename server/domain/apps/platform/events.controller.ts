import { type Request, type Response } from "express";
import { db } from "@server/database_service.js";
import { forensicEventLog } from "@shared/schema/index.js";
import { eq, and, desc, lt, sql, SQL } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { eventStream, type EventPayload } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("AppPlatformEventsController");

/**
 * ActivityEvent interface — the shape returned to workbench clients.
 */
interface ActivityEvent {
    id: string;
    timestamp: string;
    type: "agent_thought" | "tool_call" | "tool_result" | "mission_transition" | "hil_request" | "handoff" | "error";
    agentName: string;
    missionStage: "requirements" | "development" | "qa" | "deployment" | "other";
    summary: string;
    detail?: string;
    missionRunId?: number;
    ticketKey?: string;
    actionable?: { type: "hil"; hilId: string } | { type: "navigate"; href: string };
}

/**
 * Map a forensic_event_log jobType to ActivityEvent.type
 */
function mapJobTypeToEventType(jobType: string): ActivityEvent["type"] {
    if (jobType.includes("thought") || jobType === "agent_thought") return "agent_thought";
    if (jobType.includes("tool_start") || jobType.includes("tool_call")) return "tool_call";
    if (jobType.includes("tool_end") || jobType.includes("tool_result")) return "tool_result";
    if (jobType.includes("transition") || jobType.includes("stage_transition")) return "mission_transition";
    if (jobType.includes("hil") || jobType.includes("human_in_loop")) return "hil_request";
    if (jobType.includes("handoff") || jobType.includes("stage_handoff")) return "handoff";
    if (jobType.includes("error") || jobType.includes("failure")) return "error";
    // Default based on status
    return "tool_call";
}

/**
 * Derive mission stage from event attributes or job type.
 */
function deriveMissionStage(attributes: any, jobType: string): ActivityEvent["missionStage"] {
    const stage = attributes?.stage ?? attributes?.missionStage ?? attributes?.payload?.targetStage ?? "";
    const normalized = String(stage).toLowerCase();
    if (normalized.includes("requirement") || normalized.includes("prd")) return "requirements";
    if (normalized.includes("develop") || normalized.includes("coding") || normalized.includes("sprint")) return "development";
    if (normalized.includes("qa") || normalized.includes("test") || normalized.includes("quality")) return "qa";
    if (normalized.includes("deploy") || normalized.includes("release") || normalized.includes("uat")) return "deployment";
    return "other";
}

/**
 * Map a forensic_event_log row to the ActivityEvent interface.
 */
function mapRowToActivityEvent(row: any): ActivityEvent {
    const attributes = row.attributes ?? {};
    const jobType = row.jobType ?? "";

    const event: ActivityEvent = {
        id: String(row.id),
        timestamp: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
        type: mapJobTypeToEventType(jobType),
        agentName: attributes.agentName ?? attributes.sourceApp ?? attributes.workbench ?? jobType.split(":")[0] ?? "system",
        missionStage: deriveMissionStage(attributes, jobType),
        summary: attributes.summary ?? row.thoughts ?? `${jobType} — ${row.status}`,
        detail: attributes.detail ?? row.errorMessage ?? undefined,
        missionRunId: row.missionRunId ?? undefined,
        ticketKey: attributes.ticketKey ?? attributes.payload?.ticketKeys?.[0] ?? undefined,
    };

    // Add actionable data for HIL events
    if (event.type === "hil_request" && attributes.hilId) {
        event.actionable = { type: "hil", hilId: String(attributes.hilId) };
    }

    return event;
}

export class EventsController {
    /**
     * GET /api/platform/app/events/history
     * 
     * Query forensic_event_log filtered by orgId, ordered by timestamp desc.
     * Supports cursor-based pagination and filters.
     * 
     * Query params:
     *   - cursor: last event id for pagination
     *   - limit: number of events to return (default 50, max 100)
     *   - agent: filter by agent name
     *   - stage: filter by mission stage
     *   - type: filter by event type
     */
    public static async getEventsHistory(req: Request, res: Response) {
        const { orgId } = req.appTokenContext!;

        const cursor = req.query.cursor ? parseInt(req.query.cursor as string, 10) : undefined;
        const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);
        const agentFilter = (req.query.agent as string | undefined)?.trim();
        const stageFilter = (req.query.stage as string | undefined)?.trim();
        const typeFilter = (req.query.type as string | undefined)?.trim();

        // Build conditions
        const conditions: SQL[] = [eq(forensicEventLog.organizationId, orgId)];

        if (cursor && !isNaN(cursor)) {
            conditions.push(lt(forensicEventLog.id, cursor));
        }

        // Query the forensic_event_log table
        const rows = await db
            .select()
            .from(forensicEventLog)
            .where(and(...conditions))
            .orderBy(desc(forensicEventLog.id))
            .limit(limit + 1); // Fetch one extra to determine hasMore

        const hasMore = rows.length > limit;
        const resultRows = hasMore ? rows.slice(0, limit) : rows;

        // Map rows to ActivityEvent and apply client-side filters
        let events: ActivityEvent[] = resultRows.map(mapRowToActivityEvent);

        // Apply filters that can't easily be done in SQL (attributes-based)
        if (agentFilter) {
            events = events.filter((e) => e.agentName.toLowerCase().includes(agentFilter.toLowerCase()));
        }
        if (stageFilter) {
            events = events.filter((e) => e.missionStage === stageFilter);
        }
        if (typeFilter) {
            events = events.filter((e) => e.type === typeFilter);
        }

        const nextCursor = events.length > 0 ? events[events.length - 1].id : undefined;

        logger.debug(
            `[EventsHistory] org=${orgId} cursor=${cursor ?? "none"} returned=${events.length} hasMore=${hasMore}`,
        );

        res.json({
            events,
            nextCursor: hasMore ? nextCursor : undefined,
            hasMore,
        });
    }

    /**
     * GET /api/platform/app/events/stream
     *
     * Server-Sent Events stream of live platform events, scoped to the token's
     * org. The embedded workbench subscribes via EventSource and reads default
     * (unnamed) messages as { type, payload, timestamp }.
     */
    public static async streamEvents(req: Request, res: Response) {
        const { orgId } = req.appTokenContext!;

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        // Flush after every write so compression middleware doesn't buffer the stream
        // (matches the platform's other SSE endpoints).
        const flush = () => { try { (res as any).flush?.(); } catch { /* noop */ } };
        const send = (data: unknown) => {
            try { res.write(`data: ${JSON.stringify(data)}\n\n`); flush(); } catch { /* client gone */ }
        };

        send({ type: "connected", payload: {}, timestamp: new Date().toISOString() });

        const listener = (evt: EventPayload) => {
            // Tenant isolation: never forward another org's events. Events without an
            // org (global/system) are safe to forward to any tenant.
            const evtOrg = evt?.payload?.organizationId ?? evt?.context?.organizationId;
            if (evtOrg != null && Number(evtOrg) !== orgId) return;
            send({
                type: evt.eventType,
                payload: evt.payload ?? {},
                timestamp: new Date(evt.timestamp ?? Date.now()).toISOString(),
            });
        };
        eventStream.on("*", listener);

        const heartbeat = setInterval(() => {
            try { res.write(": heartbeat\n\n"); flush(); } catch { /* noop */ }
        }, 25000);

        req.on("close", () => {
            clearInterval(heartbeat);
            eventStream.off("*", listener);
            logger.debug(`[EventsStream] org=${orgId} client disconnected`);
        });
    }
}
