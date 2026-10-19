import { type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { appDeployments, pipelineExecutions, pipelineStepExecutions, pipelines } from "@shared/schema/index.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AppPlatformPipelinesController");

export class PipelinesController {
    public static async executePipeline(req: Request, res: Response) {
        const { orgId, deploymentId } = req.appTokenContext!;
        const pipelineId = req.body?.pipelineId ?? Number(req.params.pipelineId);
        const { inputParams } = req.body ?? {};
        if (!pipelineId || typeof pipelineId !== "number")
            throw new BadRequestError("'pipelineId' (number) is required");

        const [deployment] = await db
            .select({ allowedPipelineIds: appDeployments.allowedPipelineIds })
            .from(appDeployments)
            .where(eq(appDeployments.id, deploymentId))
            .limit(1);

        const allowed: number[] = (deployment?.allowedPipelineIds ??
            []) as number[];
        if (allowed.length > 0 && !allowed.includes(pipelineId)) {
            return res.status(403).json({
                error: `Pipeline ${pipelineId} is not in this deployment's allowedPipelineIds`,
            });
        }

        const { executionManager } =
            await import("@domain/pipeline/core/execution-manager.js");
        const { getSystemOrgContext } =
            await import("@server/utils/auth-context.js");

        const result = await executionManager.run(
            pipelineId,
            { input: inputParams ?? {} },
            {
                ...getSystemOrgContext(orgId),
                userId: `app-deployment:${deploymentId}`,
            } as any,
        );

        logger.info(
            `[AppPlatform] Deployment ${deploymentId} started pipeline ${pipelineId} → execution ${result?.id}`,
        );
        res.status(201).json({
            runId: result?.executionId ?? result?.id,
            status: result?.success === false ? "failed" : result?.status ?? "completed",
        });
    }

    public static async getPipelineStatus(req: Request, res: Response) {
        const { orgId } = req.appTokenContext!;
        const runId = parseInt(req.params.runId);
        if (isNaN(runId)) throw new BadRequestError("Invalid runId");

        const [execution] = await db
            .select({
                id: pipelineExecutions.id,
                status: pipelineExecutions.status,
                startedAt: pipelineExecutions.startedAt,
                completedAt: pipelineExecutions.completedAt,
                organizationId: pipelineExecutions.organizationId,
            })
            .from(pipelineExecutions)
            .where(
                and(
                    eq(pipelineExecutions.id, runId),
                    eq(pipelineExecutions.organizationId, orgId),
                ),
            )
            .limit(1);

        if (!execution) throw new NotFoundError("Pipeline execution not found");

        const steps = await db
            .select({
                stepId: pipelineStepExecutions.pipelineStepId,
                status: pipelineStepExecutions.status,
                output: pipelineStepExecutions.output,
                completedAt: pipelineStepExecutions.completedAt,
            })
            .from(pipelineStepExecutions)
            .where(eq(pipelineStepExecutions.pipelineExecutionId, runId))
            .orderBy(pipelineStepExecutions.executedAt);

        res.json({
            runId: execution.id,
            status: execution.status,
            startedAt: execution.startedAt,
            completedAt: execution.completedAt,
            stepOutputs: steps.map((s) => ({
                stepId: s.stepId,
                status: s.status,
                output: s.output,
            })),
        });
    }

    public static async getPipelines(req: Request, res: Response) {
        const { orgId, deploymentId } = req.appTokenContext!;

        const { db } = await import("@server/database_service.js");
        const { pipelines } = await import("@shared/schema/pipelines/index.js");
        const { eq, and } = await import("drizzle-orm");

        // Get deployment's allowed pipeline IDs if configured
        const [deployment] = await db
            .select({ allowedPipelineIds: appDeployments.allowedPipelineIds })
            .from(appDeployments)
            .where(eq(appDeployments.id, deploymentId))
            .limit(1);

        const allowedIds =
            (deployment?.allowedPipelineIds as number[] | undefined) ?? [];

        // Fetch pipelines scoped to org
        let query = db
            .select({
                id: pipelines.id,
                name: pipelines.name,
                description: pipelines.description,
                status: pipelines.lifecycleStatus,
                createdAt: pipelines.createdAt,
            })
            .from(pipelines)
            .where(eq(pipelines.organizationId, orgId));

        const allPipelines = await query;

        // Filter if allowedIds is specified
        const filtered =
            allowedIds.length > 0
                ? allPipelines.filter((p) => allowedIds.includes(p.id))
                : allPipelines;

        res.json(filtered);
    }
}
