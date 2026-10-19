
import { Job, Pipeline, DispatcherConfig } from "@shared/schema/index.js";
import { VariableContext, resolveVariables } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { rescueService } from "@domain/rescue/core/rescue-service.js";
import { db } from "../../../../database_service.js";
import { missionTemplates } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "../../../../utils/logger.js";
import { assertOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("DispatcherExecutor");

export class DispatcherExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "dispatcher";
    }

    async execute(
        job: Job,
        resolvedConfig: DispatcherConfig,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any>; missionId?: number; missionRunId?: number; executionId?: number },
        resolveAndExecuteJob: any,
        stepExecutionId?: number,
        pipelineExecutionId?: number
    ): Promise<StepExecutionResult> {
        try {
            logger.info(`Executing Dispatcher Job ${job.id} for Organization ${pipeline.organizationId}`);

            // 1. Resolve Mission Template
            let templateId = resolvedConfig.missionTemplateId;
            if (!templateId && resolvedConfig.missionTemplateName) {
                const template = await db.query.missionTemplates.findFirst({
                    where: eq(missionTemplates.name, resolvedConfig.missionTemplateName)
                });
                templateId = template?.id;
            }

            if (!templateId) {
                // Fallback to "On-Demand Service Dispatch" if not specified
                const template = await db.query.missionTemplates.findFirst({
                    where: eq(missionTemplates.name, "On-Demand Service Dispatch")
                });
                templateId = template?.id;
            }

            if (!templateId) {
                throw new Error("Mission template not found for Dispatcher.");
            }

            // 2. Resolve User Location
            let userLocation = {
                lat: 0,
                lng: 0,
                address: "Unknown",
                resolvedBy: "manual" as const
            };

            if (resolvedConfig.userLocationSource === "variable" && resolvedConfig.userLocationVar) {
                const locData = resolveVariables(resolvedConfig.userLocationVar, context);
                // Assume locData is { lat, lng, address } or a string that needs parsing
                if (typeof locData === 'object' && locData !== null) {
                    userLocation = { ...userLocation, ...(locData as object) };
                } else if (typeof locData === 'string') {
                    try {
                        const parsed = JSON.parse(locData);
                        if (typeof parsed === 'object' && parsed !== null) {
                            userLocation = { ...userLocation, ...parsed };
                        } else {
                            userLocation.address = parsed;
                        }
                    } catch {
                        userLocation.address = locData;
                    }
                }
            } else if (context.data?.userLocation) {
                userLocation = { ...userLocation, ...context.data.userLocation };
            }

            // 3. Initiate Rescue
            const session = await rescueService.initiateRescue({
                missionId: context.missionId ?? 0, // In pipeline context, missionId might be 0 if not mission-driven
                missionRunId: context.missionRunId ?? 0,
                orgId: assertOrgId(pipeline.organizationId),
                serviceType: resolvedConfig.serviceType,
                userLocation,
                isDemoMode: resolvedConfig.isDemoMode
            });

            return {
                success: true,
                output: JSON.stringify({
                    type: 'rescue_status',
                    sessionId: session.id,
                    status: session.status,
                    message: `Service dispatch initiated for ${resolvedConfig.serviceType}.`
                }),
                status: "completed"
            };

        } catch (error: any) {
            logger.error("Dispatcher execution failed:", error);
            return {
                success: false,
                output: "",
                status: "failure",
                error: error.message
            };
        }
    }
}


