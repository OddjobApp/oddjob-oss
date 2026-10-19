import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { crewSessions } from "@shared/schema/crew.js";
import { xrayOperationalEvents, xrayOperationalNotifications } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("MediaStudio");

export interface RenderFinished {
    organizationId: number;
    productionId: number;
    productionTitle: string;
    crewSessionId: number | null;
    takeId: number;
    takeNumber: number;
    sceneTitle: string | null;
    shotPosition: number | null;
    outcome: "ready" | "failed";
    detail?: string | null;
    costCents?: number;
    provider?: string | null;
}

/** What the inbox shows: the one part of this a reader actually sees. */
export function renderNotificationText(input: RenderFinished): { title: string; description: string } {
    const where = [input.sceneTitle, input.shotPosition == null ? null : `shot ${input.shotPosition}`]
        .filter(Boolean).join(", ");
    const place = `${input.productionTitle}${where ? ` — ${where}` : ""}`;
    if (input.outcome === "ready") {
        return {
            title: `Take ${input.takeNumber} is ready to review`,
            description: `${place} finished rendering and is waiting for a decision.`,
        };
    }
    return {
        title: `Take ${input.takeNumber} could not be rendered`,
        description: `${place} failed: ${(input.detail ?? "no reason was given").slice(0, 200)}`,
    };
}

/**
 * Tells the notification inbox that a render has finished.
 *
 * A take is rendered in the background and can take minutes — over half an hour on a
 * local ComfyUI — so the person who asked for it has usually gone somewhere else by the
 * time it lands. Until now nothing told them: the studio updated silently, and a room
 * they were no longer looking at was the only place that said so.
 *
 * This writes to the same operational-notification pair the inbox already reads, which
 * is how inbound email raises a room alert. The table is named for X-Ray, but it is the
 * only in-app inbox feed that carries an advisory message rather than a request for a
 * decision, and it is already used this way by another subsystem.
 */
export async function notifyRenderFinished(input: RenderFinished): Promise<void> {
    try {
        const room = input.crewSessionId == null
            ? null
            : (await db.select({ sessionKey: crewSessions.sessionKey, title: crewSessions.title })
                .from(crewSessions)
                .where(and(eq(crewSessions.id, input.crewSessionId), eq(crewSessions.organizationId, input.organizationId)))
                .limit(1))[0] ?? null;

        const succeeded = input.outcome === "ready";
        const text = renderNotificationText(input);
        const now = new Date();

        // One notification per take, whatever retries the follower makes. The events
        // table dedupes on this key and the notifications table on (eventId, ruleId).
        const deduplicationKey = `media-take-${input.takeId}-${input.outcome}`;

        const [event] = await db.insert(xrayOperationalEvents).values({
            organizationId: input.organizationId,
            scope: "media_studio",
            eventType: succeeded ? "take_render_ready" : "take_render_failed",
            severity: succeeded ? "info" : "warning",
            deduplicationKey,
            deduplicationBucket: now.toISOString().slice(0, 10),
            evidence: {
                productionId: input.productionId,
                takeId: input.takeId,
                takeNumber: input.takeNumber,
                provider: input.provider ?? null,
                costCents: input.costCents ?? 0,
                ...(input.detail ? { detail: input.detail.slice(0, 500) } : {}),
            },
            evaluation: {
                action: succeeded ? "review_take" : "inspect_failed_take",
                route: room ? `/workspace/chat/${room.sessionKey}` : null,
            },
            createdAt: now,
        }).onConflictDoNothing().returning();

        // Already raised for this take: the follower checked again, which is normal.
        if (!event) return;

        await db.insert(xrayOperationalNotifications).values({
            organizationId: input.organizationId,
            scope: "media_studio",
            eventId: event.id,
            ruleId: succeeded ? "media_take_ready" : "media_take_failed",
            severity: succeeded ? "info" : "warning",
            title: text.title,
            description: text.description,
            recipientRoles: ["admin", "operator", "member"],
            status: "unread",
            payload: {
                productionId: input.productionId,
                takeId: input.takeId,
                takeNumber: input.takeNumber,
                // The studio is opened by a window event, not a route, so the deep link
                // goes to the room that holds it and the studio takes it from there.
                ...(room ? { sessionKey: room.sessionKey, actionUrl: `/workspace/chat/${room.sessionKey}` } : {}),
                actionLabel: succeeded ? "Review the take" : "Open the production",
            },
            createdAt: now,
            updatedAt: now,
        }).onConflictDoNothing();
    } catch (error) {
        // A notification is never worth failing a finished render over, but it is worth
        // saying out loud — a silently swallowed one is indistinguishable from a feature
        // that was never wired up.
        logger.warn(`Could not raise a render notification for take ${input.takeId}: ${(error as Error)?.message ?? error}`);
    }
}
