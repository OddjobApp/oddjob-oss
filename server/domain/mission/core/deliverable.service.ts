import { db } from "@server/database_service.js";
import { missionDeliverables } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("DeliverableService");

export interface DeliverableOptions {
    missionId: number;
    // Nullable to match both the column and ToolContext.missionRunId, so callers
    // can forward a context that simply has no run attached.
    missionRunId?: number | null;
    name: string;
    content: string;
    type?: 'report' | 'specification' | 'dataset' | 'media' | 'code';
    isCritiqued?: boolean;
    critiqueContent?: string;
    metadata?: Record<string, any>;
}

export class DeliverableService {
    /**
     * Record a formal mission deliverable.
     */
    async recordDeliverable(options: DeliverableOptions) {
        try {
            logger.info(`Recording deliverable '${options.name}' for mission ${options.missionId}`);
            
            const [deliverable] = await db.insert(missionDeliverables).values({
                missionId: options.missionId,
                missionRunId: options.missionRunId,
                name: options.name,
                content: options.content,
                type: options.type || 'report',
                isCritiqued: options.isCritiqued || false,
                critiqueContent: options.critiqueContent,
                metadata: options.metadata || {}
            }).returning();

            return deliverable;
        } catch (error) {
            logger.error(`Failed to record deliverable: ${error}`);
            throw error;
        }
    }

    /**
     * Get deliverables for a mission.
     */
    async getDeliverablesForMission(missionId: number) {
        return await db.query.missionDeliverables.findMany({
            where: (deliverables, { eq }) => eq(deliverables.missionId, missionId)
        });
    }

    /**
     * Get a specific deliverable by ID.
     */
    async getDeliverableById(id: number) {
        return await db.query.missionDeliverables.findFirst({
            where: (deliverables, { eq }) => eq(deliverables.id, id)
        });
    }
}

export const deliverableService = new DeliverableService();
