/**
 * Mission Stall Detector
 *
 * Detects missions that have been stuck in `active` or `waiting_on_human`
 * for longer than their estimated duration threshold and escalates them.
 *
 * Threshold logic:
 * - If the mission has an `estimated_duration_hours` (from the cycle YAML), 
 *   the stall threshold is 2x that duration.
 * - Otherwise, falls back to the default STALL_THRESHOLD_MS (30 minutes).
 *
 * Call `missionStallDetector.runScan()` from a scheduled job (e.g. every 5 minutes).
 */

import { db } from "@server/database_service.js";
import { missions, missionRuns, missionTemplates } from "@shared/schema/index.js";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { approvalService } from "../../integrations/core/approval.service.js";

const logger = createLogger("MissionStallDetector");

const DEFAULT_STALL_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes (fallback)
const STALLED_STATUSES = ["active", "waiting_on_human"] as const;

export const missionStallDetector = {
    async runScan(): Promise<{ scanned: number; escalated: number }> {
        // Get all active/waiting runs with their mission's estimated duration
        const stalledRuns = await db
            .select({
                id: missionRuns.id,
                missionId: missionRuns.missionId,
                status: missionRuns.status,
                updatedAt: missionRuns.updatedAt,
                userId: missionRuns.createdBy,
                orgId: sql<number>`${missions.organizationId}`,
                objective: missions.objective,
                missionName: missions.name,
                cycleCount: sql<number>`(${missionRuns.missionContext}->>'cycleCount')::int`,
                // Try to get estimated_duration_hours from the mission template config
                estimatedHours: sql<number>`
                    COALESCE(
                        (SELECT (config->>'estimatedDurationHours')::numeric 
                         FROM mission_templates mt 
                         WHERE mt.name = ${missions.name} 
                         AND mt.organization_id = ${missions.organizationId}
                         LIMIT 1),
                        0
                    )`,
            })
            .from(missionRuns)
            .innerJoin(missions, eq(missionRuns.missionId, missions.id))
            .where(
                and(
                    inArray(missionRuns.status, STALLED_STATUSES as unknown as string[]),
                    // Exclude runs already flagged as stalled
                    sql`NOT (${missionRuns.missionContext}->>'stall_escalated' = 'true')`
                )
            )
            .limit(50);

        if (stalledRuns.length === 0) {
            logger.debug("[StallDetector] No active runs to check.");
            return { scanned: 0, escalated: 0 };
        }

        let escalated = 0;
        const now = Date.now();

        for (const run of stalledRuns) {
            // Calculate per-mission stall threshold
            // If estimated hours exists, stall = 2x estimated duration
            // Otherwise use default 30-minute threshold
            const estimatedMs = run.estimatedHours && run.estimatedHours > 0
                ? run.estimatedHours * 60 * 60 * 1000 * 2  // 2x estimated duration
                : DEFAULT_STALL_THRESHOLD_MS;

            const stallDurationMs = now - new Date(run.updatedAt).getTime();

            if (stallDurationMs < estimatedMs) continue; // Not stalled yet

            const stallDurationMin = Math.round(stallDurationMs / 60_000);
            const thresholdMin = Math.round(estimatedMs / 60_000);

            try {
                await approvalService.createApprovalRequest({
                    executionId: String(run.id),
                    approverType: "user",
                    approverId: run.userId || "admin",
                    approverEmail: "system",
                    status: "pending",
                    organizationId: run.orgId || undefined,
                    context: {
                        stallReason: `Mission "${run.missionName}" (run ${run.id}) has been in '${run.status}' for ${stallDurationMin} minutes (threshold: ${thresholdMin} min).`,
                        objective: run.objective,
                        cycleCount: run.cycleCount ?? 0,
                        stalledSince: run.updatedAt,
                        thresholdMinutes: thresholdMin,
                    },
                });

                // Mark run so we don't re-escalate on the next scan
                await db
                    .update(missionRuns)
                    .set({
                        missionContext: sql`jsonb_set(
                            COALESCE(${missionRuns.missionContext}::jsonb, '{}'::jsonb),
                            '{stall_escalated}',
                            'true'::jsonb
                        )`,
                    })
                    .where(eq(missionRuns.id, run.id));

                logger.info(`[StallDetector] Escalated stalled run ${run.id} "${run.missionName}" (${stallDurationMin}min > ${thresholdMin}min threshold).`);
                escalated++;
            } catch (err: any) {
                logger.error(`[StallDetector] Failed to escalate run ${run.id}: ${err.message}`);
            }
        }

        return { scanned: stalledRuns.length, escalated };
    },
};
