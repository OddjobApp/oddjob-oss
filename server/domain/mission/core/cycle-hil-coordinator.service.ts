/**
 * Cycle HIL Coordinator
 *
 * Properly wires the cycle pause/resume lifecycle to the HIL (Human-in-the-Loop)
 * infrastructure. Replaces the Slack-notification-only approach in
 * requestPreFlightRefresh with a real HIL form that populates the Decision Inbox.
 *
 * Flow:
 *   1. Cycle pauses at a milestone or resource gate
 *      → createHILRequest() — inserts a hil_forms record + emits event
 *   2. Human opens the Decision Inbox, fills and submits the form
 *      → hil_forms.status = 'completed', hil_forms.data = { answers }
 *   3. Heartbeat calls checkPendingHILRequests()
 *      → Finds completed forms linked to paused cycles
 *      → Merges answers into cycle.metadata.resource_answers
 *      → Sets cycle.status = 'active' to resume execution
 */

import { db } from "@server/database_service.js";
import { operationalCycles, hilForms } from "@shared/schema/index.js";
import { eq, and, isNull, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { randomBytes } from "crypto";

const logger = createLogger("CycleHILCoordinator");

// Metadata key used to link a cycle to its pending HIL form
const HIL_FORM_ID_KEY = "pending_hil_form_id";
const HIL_FORM_CONTEXT_KEY = "hil_context";

export const cycleHILCoordinatorService = {

    /**
     * Creates a HIL form in the Decision Inbox for a paused cycle milestone.
     * Replaces the Slack-notification-only approach.
     *
     * @param cycleId    The cycle that is now paused
     * @param milestone  The blueprint name that triggered the pause
     * @param resources  The resource fields the operator must fill in
     * @param userId     The user who launched the cycle (for notification routing)
     * @param orgId      Organization context
     */
    async createHILRequest(
        cycleId: number,
        milestone: string,
        resources: Array<{ id: string; label: string; type: string; required?: boolean; description?: string }>,
        userId: string,
        orgId: number | null
    ): Promise<number> {
        const fields = resources.map(r => ({
            key: r.id,
            label: r.label,
            type: r.type === 'url_list' ? 'textarea' : r.type,
            required: r.required ?? false,
            description: r.description,
            placeholder: r.type === 'url_list' ? 'One URL per line' : undefined,
        }));

        const { hilRequests } = await import("@domain/pipeline/core/hil-requests.service.js");
        const form = await hilRequests.create({
            source: 'cycle',
            name: `Resources Required: ${milestone}`,
            description: `Cycle "${cycleId}" has paused at milestone "${milestone}". Please provide the required resources to continue execution.`,
            schema: { fields },
            organizationId: orgId,
            createdBy: userId,
            config: {
                cycleId,
                milestone,
                type: 'cycle_resource_refresh',
            },
        });

        // Link HIL form ID to the cycle so we can poll for completion
        await db.update(operationalCycles)
            .set({
                metadata: sql`${operationalCycles.metadata} || jsonb_build_object(
                    ${HIL_FORM_ID_KEY}::text, ${form.id}::int,
                    ${HIL_FORM_CONTEXT_KEY}::text, ${milestone}::text
                )`,
                updatedAt: new Date(),
            })
            .where(eq(operationalCycles.id, cycleId));

        logger.info(`[CycleHIL] Created HIL form ${form.id} for cycle ${cycleId} at milestone "${milestone}"`);

        // Emit event so real-time UI can surface the request
        eventStream.publish('cycle.hil_requested', {
            cycleId,
            hilFormId: form.id,
            milestone,
            fieldCount: fields.length,
        }, {
            organizationId: orgId ?? undefined,
            subject: `cycle:${cycleId}`,
        }, 'hil-coordinator').catch(() => {});

        return form.id;
    },

    /**
     * Heartbeat check — scans all paused cycles with a pending HIL form and
     * resumes them when the form has been submitted.
     */
    async checkPendingHILRequests(): Promise<void> {
        // Find paused cycles that have a pending_hil_form_id in metadata
        const pausedCycles = await db.select({
            id: operationalCycles.id,
            metadata: operationalCycles.metadata,
            organizationId: operationalCycles.organizationId,
        })
        .from(operationalCycles)
        .where(and(
            eq(operationalCycles.status, 'paused'),
            isNull(operationalCycles.deletedAt),
            sql`${operationalCycles.metadata}->>'${sql.raw(HIL_FORM_ID_KEY)}' IS NOT NULL`
        ));

        for (const cycle of pausedCycles) {
            const meta = (cycle.metadata as any) ?? {};
            const formId = meta[HIL_FORM_ID_KEY];
            if (!formId) continue;

            try {
                await this.processIfCompleted(cycle.id, formId, cycle.organizationId, meta);
            } catch (err: any) {
                logger.warn(`[CycleHIL] Failed to process HIL for cycle ${cycle.id}: ${err.message}`);
            }
        }
    },

    async processIfCompleted(
        cycleId: number,
        formId: number,
        orgId: number | null,
        existingMeta: Record<string, any>
    ): Promise<void> {
        const [form] = await db.select({ status: hilForms.status, data: hilForms.data })
            .from(hilForms)
            .where(eq(hilForms.id, formId));

        if (!form || form.status !== 'completed') return;

        const submittedAnswers = (form.data as Record<string, any>) ?? {};
        const milestone = String(existingMeta[HIL_FORM_CONTEXT_KEY] || "unknown");
        const scopedAnswers = submittedAnswers[milestone]
            ? submittedAnswers
            : { [milestone]: submittedAnswers };
        logger.info(`[CycleHIL] HIL form ${formId} completed for cycle ${cycleId}. Resuming.`);

        // Merge resource answers into cycle metadata and remove the HIL lock
        const existingAnswers = existingMeta.resource_answers ?? {};
        const updatedMeta = {
            ...existingMeta,
            resource_answers: { ...existingAnswers, ...scopedAnswers },
            [HIL_FORM_ID_KEY]: null,        // Clear the lock
            [HIL_FORM_CONTEXT_KEY]: null,
        };

        await db.update(operationalCycles)
            .set({
                status: 'active',
                metadata: updatedMeta,
                updatedAt: new Date(),
            })
            .where(and(
                eq(operationalCycles.id, cycleId),
                eq(operationalCycles.status, 'paused')
            ));

        eventStream.publish('cycle.hil_resolved', {
            cycleId,
            hilFormId: formId,
        }, {
            organizationId: orgId ?? undefined,
            subject: `cycle:${cycleId}`,
        }, 'hil-coordinator').catch(() => {});

        // Closed-loop alignment feedback: record a success reward for this prompt variant
        try {
            const { dspyOptimizerService } = await import("../../ai/core/dspy-optimizer.service.js");
            // Set reward based on completed form submission (completed -> 1.0 reward)
            dspyOptimizerService.recordReward(milestone, `${milestone}-base`, 1.0);
        } catch (dspyErr) {
            logger.warn(`[CycleHIL] Failed to record DSPy feedback: ${dspyErr instanceof Error ? dspyErr.message : String(dspyErr)}`);
        }

        logger.info(`[CycleHIL] Cycle ${cycleId} resumed after HIL completion.`);
    },
};
