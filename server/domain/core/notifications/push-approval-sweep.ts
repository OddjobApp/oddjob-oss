/**
 * Pushes "approval needed" to the approver of each new pending approval.
 *
 * Why a sweep and not a hook: approval_requests is inserted from about twenty
 * places (tools, the decision router, crew proposals, form studio, ...), and only
 * one of them ever enqueued a notification. Reading the table covers every writer,
 * including ones added later, which a per-call-site hook would silently miss.
 *
 * The recipient is `approver_id`, or the user whose email is `approver_email`: the
 * same person the inbox shows the request to. Only approvals created in the last
 * LOOKBACK window are considered, so enabling push does not replay history, and
 * the delivery ledger makes each (approval, person) go out once across processes.
 */
import { sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { pushService } from "./push.service.js";

const logger = createLogger("PushApprovalSweep");

const SWEEP_MS = 20_000;
const LOOKBACK_MINUTES = 15;
const BATCH = 100;

export interface PendingApprovalPush {
    id: number;
    recipientId: string;
    toolName: string | null;
    toolArgs: any;
    modifiedOutput: any;
}

/** What the approver sees: the step's own description when it has one. */
export function describeApproval(a: Pick<PendingApprovalPush, "toolName" | "toolArgs" | "modifiedOutput">): string {
    const text =
        a.modifiedOutput?.description ||
        a.toolArgs?.description ||
        a.toolArgs?.intent ||
        (a.toolName ? `Run ${a.toolName}` : "");
    return typeof text === "string" && text.trim() ? text : "A step is paused until you decide.";
}

export async function selectApprovalsToPush(): Promise<PendingApprovalPush[]> {
    const result = await db.execute(sql`
        SELECT a.id,
               coalesce(a.approver_id, u.id) AS "recipientId",
               a.tool_name AS "toolName",
               a.tool_args AS "toolArgs",
               a.modified_output AS "modifiedOutput"
        FROM approval_requests a
        LEFT JOIN users u
               ON a.approver_id IS NULL AND lower(u.email) = lower(a.approver_email)
        WHERE a.status = 'pending'
          AND a.created_at > now() - make_interval(mins => ${LOOKBACK_MINUTES})
          AND (a.snoozed_until IS NULL OR a.snoozed_until < now())
          AND coalesce(a.approver_id, u.id) IS NOT NULL
          -- A browser or a phone: either can be reached.
          AND (
              EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = coalesce(a.approver_id, u.id))
              OR EXISTS (SELECT 1 FROM push_devices pd WHERE pd.user_id = coalesce(a.approver_id, u.id))
          )
          AND NOT EXISTS (
              SELECT 1 FROM push_deliveries d
              WHERE d.source = 'approval'
                AND d.source_id = a.id::text
                AND d.user_id = coalesce(a.approver_id, u.id)
          )
        ORDER BY a.created_at
        LIMIT ${BATCH}
    `);
    return ((result as any).rows ?? result) as PendingApprovalPush[];
}

let sweepInFlight = false;

/** Browser push (VAPID) and phone push (FCM) are configured independently; either is enough. */
function anyPushConfigured(): boolean {
    return pushService.isConfigured() || pushService.devicesConfigured();
}

/** Where tapping the push lands. The id lets the phone app open this approval directly. */
export function approvalPushUrl(approvalId: number): string {
    return `/assistant/workbench?approval=${approvalId}`;
}

export async function sweepApprovalPushes(): Promise<number> {
    if (sweepInFlight || !anyPushConfigured()) return 0;
    sweepInFlight = true;
    let sent = 0;
    try {
        for (const a of await selectApprovalsToPush()) {
            const claimed = await pushService.sendOnce("approval", a.id, a.recipientId, {
                title: "Approval needed",
                body: describeApproval(a),
                url: approvalPushUrl(a.id),
                tag: `approval-${a.id}`,
            });
            if (claimed) sent++;
        }
    } catch (err: any) {
        // A bad sweep must never stop the schedule; the next tick retries.
        logger.error(`Approval push sweep failed: ${err.message}`);
    } finally {
        sweepInFlight = false;
    }
    return sent;
}

let timer: NodeJS.Timeout | null = null;

export function startApprovalPushSweep(): void {
    if (timer) return;
    if (!anyPushConfigured()) {
        logger.info("Neither web push (VAPID) nor phone push (FCM) is configured; approval push sweep not started.");
        return;
    }
    timer = setInterval(() => void sweepApprovalPushes(), SWEEP_MS);
    timer.unref?.();
    logger.info(`Approval push sweep active (every ${SWEEP_MS / 1000}s).`);
}
