/**
 * Heartbeat Trigger Service
 *
 * Encapsulates CRUD operations and BullMQ worker scheduling for tenant-scoped
 * heartbeat polling triggers.
 */

import { db } from "@server/database_service.js";
import { eq, and } from "drizzle-orm";
import {
    heartbeatTriggers,
    type HeartbeatTrigger,
    type InsertHeartbeatTrigger,
    type UpdateHeartbeatTrigger,
} from "@shared/schema/heartbeat-triggers.js";
import { BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("HeartbeatTriggerService");

export const heartbeatTriggerService = {
    /**
     * Lists all heartbeat triggers for the organization.
     */
    async listTriggers(organizationId: number): Promise<HeartbeatTrigger[]> {
        return db
            .select()
            .from(heartbeatTriggers)
            .where(eq(heartbeatTriggers.orgId, organizationId));
    },

    /**
     * Creates a new heartbeat trigger and schedules its repeatable polling job.
     */
    async createTrigger(
        organizationId: number,
        userId: string,
        input: Omit<InsertHeartbeatTrigger, "orgId" | "createdBy">,
    ): Promise<HeartbeatTrigger> {
        const payload: InsertHeartbeatTrigger = {
            ...input,
            orgId: organizationId,
            createdBy: userId,
        };

        const [created] = await db
            .insert(heartbeatTriggers)
            .values(payload)
            .returning();

        // Immediately schedule the repeatable polling job
        try {
            const { startHeartbeatWorker } = await import("../../../workers/heartbeat-worker.js");
            const worker = startHeartbeatWorker();
            await worker.scheduleTrigger(created);
        } catch (e: any) {
            logger.warn(`Failed to schedule heartbeat trigger ${created.id}: ${e.message}`);
        }

        return created;
    },

    /**
     * Updates an existing heartbeat trigger and reschedules its worker job if necessary.
     */
    async updateTrigger(
        triggerId: number,
        organizationId: number,
        input: UpdateHeartbeatTrigger,
    ): Promise<HeartbeatTrigger> {
        // Verify trigger belongs to this org
        const [existing] = await db
            .select()
            .from(heartbeatTriggers)
            .where(
                and(
                    eq(heartbeatTriggers.id, triggerId),
                    eq(heartbeatTriggers.orgId, organizationId),
                ),
            )
            .limit(1);

        if (!existing) {
            throw new BadRequestError(`Heartbeat trigger ${triggerId} not found`);
        }

        const [updated] = await db
            .update(heartbeatTriggers)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(heartbeatTriggers.id, triggerId))
            .returning();

        // Re-schedule if interval or active status changed
        if (input.pollingIntervalMs !== undefined || input.isActive !== undefined) {
            try {
                const { startHeartbeatWorker } = await import("../../../workers/heartbeat-worker.js");
                const worker = startHeartbeatWorker();
                // The repeatable is keyed by its interval, so the old schedule
                // must go before a new one is added — otherwise an interval
                // change leaves both firing, and a deactivation that also
                // changed the interval removes nothing.
                await worker.unscheduleTrigger(existing);
                if (updated.isActive) {
                    await worker.scheduleTrigger(updated);
                } else {
                    await worker.unscheduleTrigger(updated);
                }
            } catch (e: any) {
                logger.warn(`Failed to reschedule heartbeat trigger ${triggerId}: ${e.message}`);
            }
        }

        return updated;
    },

    /**
     * Deletes a heartbeat trigger and cancels its repeatable polling job.
     */
    async deleteTrigger(triggerId: number, organizationId: number): Promise<void> {
        const [existing] = await db
            .select()
            .from(heartbeatTriggers)
            .where(
                and(
                    eq(heartbeatTriggers.id, triggerId),
                    eq(heartbeatTriggers.orgId, organizationId),
                ),
            )
            .limit(1);

        if (!existing) {
            throw new BadRequestError(`Heartbeat trigger ${triggerId} not found`);
        }

        await db.delete(heartbeatTriggers).where(eq(heartbeatTriggers.id, triggerId));

        // Remove the repeatable job
        try {
            const { startHeartbeatWorker } = await import("../../../workers/heartbeat-worker.js");
            const worker = startHeartbeatWorker();
            await worker.unscheduleTrigger(existing);
        } catch (e: any) {
            logger.warn(`Failed to unschedule heartbeat trigger ${triggerId}: ${e.message}`);
        }
    },
};
