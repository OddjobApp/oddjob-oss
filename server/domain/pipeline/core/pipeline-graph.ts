import { db } from "@server/database_service.js";
import { pipelineSteps } from "@shared/schema/index.js";
import { eq, asc } from "drizzle-orm";
import { BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import type { CreatePipelineStepInput } from "./types.js";

const logger = createLogger("PipelineGraphService");

export const pipelineGraph = {
    /**
     * Helper to validate steps configuration
     */
    validateSteps(steps: CreatePipelineStepInput[]) {
        for (const step of steps) {
            if (step.destinationStepId) {
                const found = steps.find(s => (s as any).id === step.destinationStepId || s.tempId === String(step.destinationStepId));
                if (!found && step.destinationStepId) {
                    throw new BadRequestError(`Destination step ${step.destinationStepId} not found in pipeline steps`);
                }
            }

            if (step.moduleType === "logic_gatekeeper") {
                if (!step.decisionNodeConfig) {
                    throw new BadRequestError("Decision Node config is required when moduleType is 'logic_gatekeeper'");
                }
                if (!step.decisionNodeConfig.routes?.onMatch?.destinationStepId) {
                    throw new BadRequestError("Decision Node config must have routes.onMatch.destinationStepId");
                }
            }
        }
    },

    /**
     * Helper to validate graph
     */
    async validateGraph(pipelineId: number): Promise<{ valid: boolean; errors: any[]; warnings: any[] }> {
        try {
            const { validatePipelineGraph } = await import("../../../knowledge/graph-validator.js");
            const steps = await db.select().from(pipelineSteps).where(eq(pipelineSteps.pipelineId, pipelineId)).orderBy(asc(pipelineSteps.order));
            const validationResult = await validatePipelineGraph(steps as any);

            if (!validationResult.valid && validationResult.errors.length > 0) {
                logger.warn("Pipeline graph validation warnings", { pipelineId, errors: validationResult.errors });
            }
            return validationResult;
        } catch (validationError) {
            logger.error("Graph validation error", { error: validationError, pipelineId });
            return { valid: false, errors: [{ type: "system", message: String(validationError) }], warnings: [] };
        }
    },
};


