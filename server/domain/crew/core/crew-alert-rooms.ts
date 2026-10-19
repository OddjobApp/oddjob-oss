/**
 * Posts new alerts into a standing CREW room per (org, category).
 *
 * Why a sweep of the `alerts` table and not a `system.alert_created` listener:
 * that event is published only by `createAlert()`, which nothing calls. The rows
 * that exist are written directly — by the dead-letter queue, the schedule
 * executor, the regulatory-source monitor and the Python scheduler — and none of
 * them publishes an event. Reading the table covers every writer, including
 * ones added later (the same reasoning as push-approval-sweep.ts).
 *
 * Only unresolved, unacknowledged, unsuppressed alerts of warning severity or
 * worse, belonging to an org, and created within LOOKBACK are posted, so
 * enabling this does not replay history and platform-wide (null-org) alerts
 * never land in a tenant's room. Alerts that arrive together for one room are
 * posted as one turn, so a burst does not flood it.
 *
 * Each alert is claimed in `push_deliveries` in the same transaction as the turn
 * that posts it: the main process and the standalone worker both run this sweep,
 * and the claim makes each alert post exactly once. People are pushed only for
 * errors and critical alerts; warnings wait in the room.
 */

import { sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { pushDeliveries } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import {
    ensureStandingRoom,
    insertRoomNotice,
    isOrgMember,
    publishRoomNotice,
    roomResponders,
    seatAndNotify,
} from "./crew-standing-rooms.js";

const logger = createLogger("CrewAlertRooms");

const SWEEP_MS = 30_000;
const LOOKBACK_MINUTES = 60;
const BATCH = 200;
/** Lines listed in one turn; the rest are counted. */
const MAX_LISTED = 10;
const MAX_MESSAGE = 240;

/** `push_deliveries.source` for the room claim; `user_id` is ROOM_CLAIMANT, not a person. */
export const ALERT_ROOM_SOURCE = "crew_alert_room";
const ROOM_CLAIMANT = "crew-room";
/** `push_deliveries.source` for the per-person push of one posted turn. */
const ALERT_PUSH_SOURCE = "crew_alert_turn";

const SEVERITY_RANK: Record<string, number> = { critical: 3, error: 2, warning: 1 };

export interface PendingAlert {
    id: number;
    severity: string;
    category: string;
    message: string;
    orgId: number;
    ownerUserId: string | null;
    createdAt: Date | string;
}

/** Room key for an alert category; categories are free text up to 50 chars. */
export function alertRoomSessionKey(category: string): string {
    const slug = category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `alerts-${slug || "general"}`;
}

export function alertCategoryLabel(category: string): string {
    const words = category.replace(/[_-]+/g, " ").trim();
    return words ? words[0].toUpperCase() + words.slice(1) : "General";
}

function oneLine(text: string): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > MAX_MESSAGE ? `${flat.slice(0, MAX_MESSAGE - 1)}…` : flat;
}

/** The turn text for alerts posted together, worst first. */
export function describeAlerts(category: string, batch: PendingAlert[]): string {
    const sorted = [...batch].sort(
        (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || a.id - b.id,
    );
    const label = alertCategoryLabel(category).toLowerCase();
    const head = batch.length === 1 ? `**New ${label} alert**` : `**${batch.length} new ${label} alerts**`;
    const lines = sorted.slice(0, MAX_LISTED).map((a) => `- **${a.severity}** · ${oneLine(a.message)} _(alert #${a.id})_`);
    if (sorted.length > MAX_LISTED) lines.push(`- …and ${sorted.length - MAX_LISTED} more`);
    return [
        head,
        "",
        ...lines,
        "",
        "Acknowledge them in [Alerts](/health/alerts), or ask the room to look into one.",
    ].join("\n");
}

export function groupByRoom(rows: PendingAlert[]): Map<string, PendingAlert[]> {
    const groups = new Map<string, PendingAlert[]>();
    for (const row of rows) {
        const key = `${row.orgId}\u0000${alertRoomSessionKey(row.category)}`;
        const group = groups.get(key);
        if (group) group.push(row);
        else groups.set(key, [row]);
    }
    return groups;
}

export async function selectAlertsToPost(): Promise<PendingAlert[]> {
    const result = await db.execute(sql`
        SELECT a.alert_id AS id,
               a.severity,
               a.category,
               a.message,
               a.organization_id AS "orgId",
               a.owner_user_id AS "ownerUserId",
               a.created_at AS "createdAt"
        FROM alerts a
        WHERE a.organization_id IS NOT NULL
          AND a.severity IN ('warning', 'error', 'critical')
          AND a.resolved_at IS NULL
          AND a.acknowledged_at IS NULL
          AND a.suppressed = false
          AND a.created_at > now() - make_interval(mins => ${LOOKBACK_MINUTES})
          AND NOT EXISTS (
              SELECT 1 FROM push_deliveries d
              WHERE d.source = ${ALERT_ROOM_SOURCE}
                AND d.source_id = a.alert_id::text
          )
        ORDER BY a.created_at
        LIMIT ${BATCH}
    `);
    return ((result as any).rows ?? result) as PendingAlert[];
}

/** Post one room's batch. @returns how many alerts this process posted (0 if another claimed them). */
async function postBatch(orgId: number, category: string, batch: PendingAlert[]): Promise<number> {
    const session = await ensureStandingRoom({
        orgId,
        sessionKey: alertRoomSessionKey(category),
        title: `Alerts · ${alertCategoryLabel(category)}`,
        activeTopic: `${alertCategoryLabel(category)} alerts that need a person`,
        projectId: null,
    });
    if (!session) return 0;

    const posted = await db.transaction(async (tx) => {
        const claimed = await tx
            .insert(pushDeliveries)
            .values(batch.map((a) => ({ source: ALERT_ROOM_SOURCE, sourceId: String(a.id), userId: ROOM_CLAIMANT })))
            .onConflictDoNothing()
            .returning({ sourceId: pushDeliveries.sourceId });
        const ids = new Set(claimed.map((c) => c.sourceId));
        const mine = batch.filter((a) => ids.has(String(a.id)));
        if (mine.length === 0) return null;
        const turn = await insertRoomNotice(session, { speakerName: "Alerts", content: describeAlerts(category, mine) }, tx);
        return turn ? { turn, mine } : null;
    });
    if (!posted) return 0;
    publishRoomNotice(session, posted.turn);

    const people = new Set(await roomResponders(orgId, { id: session.id, projectId: null }));
    for (const owner of new Set(posted.mine.map((a) => a.ownerUserId).filter((u): u is string => !!u))) {
        if (await isOrgMember(orgId, owner)) people.add(owner);
    }
    if (people.size === 0) {
        logger.warn(`${posted.mine.length} ${category} alert(s) posted in org ${orgId}, but it has no admins or alert owners to seat.`);
        return posted.mine.length;
    }

    const urgent = posted.mine.filter((a) => (SEVERITY_RANK[a.severity] ?? 0) >= SEVERITY_RANK.error);
    if (urgent.length === 0) {
        // Warnings still seat the responders, so the room is in their list; no push.
        await seatAndNotify(session, [...people], null);
        return posted.mine.length;
    }
    const worst = [...urgent].sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))[0];
    await seatAndNotify(session, [...people], {
        title: urgent.length === 1 ? `${alertCategoryLabel(category)} alert` : `${urgent.length} ${alertCategoryLabel(category).toLowerCase()} alerts`,
        body: oneLine(worst.message),
        tag: `alert-room-${session.id}`,
        once: { source: ALERT_PUSH_SOURCE, sourceId: posted.turn.id },
    });
    return posted.mine.length;
}

let sweepInFlight = false;

export async function sweepAlertRooms(): Promise<number> {
    if (sweepInFlight) return 0;
    sweepInFlight = true;
    let posted = 0;
    try {
        for (const batch of groupByRoom(await selectAlertsToPost()).values()) {
            try {
                posted += await postBatch(batch[0].orgId, batch[0].category, batch);
            } catch (err: any) {
                // One room failing must not hold back the others; its alerts stay unclaimed and retry.
                logger.error(`Posting ${batch.length} alert(s) for org ${batch[0].orgId} failed: ${err.message}`);
            }
        }
    } catch (err: any) {
        // A bad sweep must never stop the schedule; the next tick retries.
        logger.error(`Alert room sweep failed: ${err.message}`);
    } finally {
        sweepInFlight = false;
    }
    return posted;
}

let timer: NodeJS.Timeout | null = null;

export function startAlertRoomSweep(): void {
    if (timer) return;
    timer = setInterval(() => void sweepAlertRooms(), SWEEP_MS);
    timer.unref?.();
    logger.info(`Alert room sweep active (every ${SWEEP_MS / 1000}s).`);
}
