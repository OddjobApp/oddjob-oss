import {
    ListPipelinesInput,
    GetPipelineDetailsInput,
    RunPipelineInput,
    GetExecutionStatusInput,
    ListRecentExecutionsInput,
    CreatePipelineInput,
    UpdatePipelineInput,
    DeletePipelineInput,
    AddPipelineStepInput,
    UpdatePipelineStepInput,
    DeletePipelineStepInput,
    DelegateTaskInput,
} from "../tools/pipelines.js";
import { pipelineService } from "../../domain/pipeline/core/pipeline.service.js";
import supervisorService from "../../domain/integrations/core/supervisor.service.js";
import { db } from "@server/database_service.js";
import { pipelineSteps, type Pipeline, type PipelineStep, type PipelineExecution } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { successResponse, errorResponse, getOrgContext, type ToolContext } from "./utils.js";

// Extended context type for delegation
interface DelegationToolContext extends ToolContext {
    executionId?: number;
}

export async function handleListPipelines(args: unknown, context?: ToolContext) {
    try {
        const input = ListPipelinesInput.parse(args);
        const orgContext = getOrgContext(context);

        const pipelines = await pipelineService.list(orgContext, {
            includeInactive: !input.activeOnly,
            limit: 50,
            pipelineIds: context?.allowedPipelineIds
        } as any);

        let filtered = pipelines;
        if (input.search) {
            const searchLower = input.search.toLowerCase();
            filtered = pipelines.filter(
                p =>
                    p.name.toLowerCase().includes(searchLower) ||
                    (p.description && p.description.toLowerCase().includes(searchLower))
            );
        }

        return successResponse(
            filtered.map(p => ({
                id: p.id,
                name: p.name,
                description: p.description,
                isActive: p.isActive,
                triggerType: p.triggerType,
                stepCount: p.stepCount
            })),
            `Found ${filtered.length} pipelines`
        );
    } catch (error: unknown) {
        return errorResponse(error instanceof Error ? error.message : String(error));
    }
}

export async function handleGetPipelineDetails(args: unknown, context?: ToolContext) {
    try {
        const input = GetPipelineDetailsInput.parse(args);
        const orgContext = getOrgContext(context);

        let pipeline: (Pipeline & { steps?: PipelineStep[] }) | null = null;

        if (input.pipelineId) {
            if (context?.allowedPipelineIds && context.allowedPipelineIds.length > 0 && !context.allowedPipelineIds.includes(input.pipelineId)) {
                return errorResponse("Access to this pipeline is restricted");
            }
            pipeline = await pipelineService.getById(input.pipelineId, orgContext);
        } else if (input.pipelineName) {
            const allPipelines = await pipelineService.list(orgContext, { includeInactive: true });
            pipeline = allPipelines.find(p => p.name.toLowerCase().includes(input.pipelineName!.toLowerCase())) || null;
            if (pipeline) {
                pipeline = await pipelineService.getById(pipeline.id, orgContext);
            }
        }

        if (!pipeline) {
            return errorResponse("Pipeline not found");
        }

        let executions: PipelineExecution[] = [];
        if (input.includeExecutionHistory) {
            executions = await pipelineService.getExecutions(pipeline.id, orgContext, { limit: 5 });
        }

        return successResponse({
            id: pipeline.id,
            name: pipeline.name,
            description: pipeline.description,
            isActive: pipeline.isActive,
            triggerType: pipeline.triggerType,
            steps: pipeline.steps?.map((s: PipelineStep) => ({
                id: s.id,
                order: s.order,
                jobId: s.jobId
            })),
            recentExecutions: executions.map(e => ({
                id: e.id,
                status: e.status,
                startedAt: e.startedAt,
                completedAt: e.completedAt,
            })),
        });
    } catch (error: unknown) {
        return errorResponse(error instanceof Error ? error.message : String(error));
    }
}

export async function handleRunPipeline(args: unknown, context?: ToolContext) {
    try {
        const input = RunPipelineInput.parse(args);
        const orgContext = getOrgContext(context);

        let pipelineId = input.pipelineId;

        if (!pipelineId && input.pipelineName) {
            const allPipelines = await pipelineService.list(orgContext, { includeInactive: true });
            const found = allPipelines.find(p => p.name.toLowerCase().includes(input.pipelineName!.toLowerCase()));
            if (found) pipelineId = found.id;
        }

        if (!pipelineId) {
            return errorResponse("Pipeline not found");
        }

        if (input.dryRun) {
            return successResponse(
                {
                    pipelineId: pipelineId,
                    wouldExecute: true,
                },
                `[DRY RUN] Would execute pipeline ID ${pipelineId}`
            );
        }

        const execution = await pipelineService.run(pipelineId, { 
            input: input.inputData || {},
            missionId: context?.missionId || undefined,
            missionRunId: (context as any)?.missionRunId || undefined
        }, orgContext);

        return successResponse(
            {
                executionId: execution.id,
                pipelineId: pipelineId,
                status: execution.status,
                message: "Pipeline execution has been started",
            },
            `Started execution of pipeline ID ${pipelineId} (Execution ID: ${execution.id})`
        );
    } catch (error: unknown) {
        return errorResponse(error instanceof Error ? error.message : String(error));
    }
}

export async function handleGetExecutionStatus(args: unknown, context?: ToolContext) {
    try {
        const input = GetExecutionStatusInput.parse(args);
        const orgContext = getOrgContext(context);

        const { execution } = await pipelineService.getExecutionDetails(input.executionId, orgContext);

        return successResponse({
            executionId: execution.id,
            status: execution.status,
            startedAt: execution.startedAt,
            completedAt: execution.completedAt,
            error: execution.error,
        });
    } catch (error: unknown) {
        return errorResponse(error instanceof Error ? error.message : String(error));
    }
}

export async function handleListRecentExecutions(args: unknown, context?: ToolContext) {
    try {
        const input = ListRecentExecutionsInput.parse(args);
        const orgContext = getOrgContext(context);

        const executions = await pipelineService.listRecentExecutions(orgContext, {
            limit: input.limit,
            status: input.status,
            pipelineId: input.pipelineId
        });

        return successResponse(
            executions.map(e => ({
                id: e.id,
                pipelineId: e.pipelineId,
                pipelineName: e.pipelineName,
                status: e.status,
                startedAt: e.startedAt,
                completedAt: e.completedAt,
            })),
            `Found ${executions.length} recent executions`
        );
    } catch (error: unknown) {
        return errorResponse(error instanceof Error ? error.message : String(error));
    }
}

export async function handleCreatePipeline(args: unknown, context?: ToolContext) {
    try {
        const input = CreatePipelineInput.parse(args);
        const orgContext = getOrgContext(context);

        const newPipeline = await pipelineService.create({
            name: input.name,
            description: input.description || "",
            isActive: input.isActive ?? true,
            triggerType: input.triggerType || "manual",
            monthlyBudgetUsd: (input as any).monthlyBudgetUsd,
            steps: (input.steps || []).map(s => ({
                jobId: s.jobId!,
                order: s.order,
                moduleType: s.moduleType || "job",
                outputName: s.outputName || undefined,
                runOnCondition: s.runOnCondition || undefined,
                decisionNodeConfig: s.decisionNodeConfig as any || undefined
            }))
        }, orgContext);

        return successResponse(
            {
                id: newPipeline.id,
                name: newPipeline.name,
                stepsCreated: input.steps?.length || 0,
            },
            `Created pipeline "${input.name}" (ID: ${newPipeline.id})${input.steps?.length ? ` with ${input.steps.length} steps` : ''}`
        );
    } catch (error: unknown) {
        return errorResponse(error instanceof Error ? error.message : String(error));
    }
}

export async function handleUpdatePipeline(args: unknown, context?: ToolContext) {
    try {
        const input = UpdatePipelineInput.parse(args);
        const orgContext = getOrgContext(context);

        const updated = await pipelineService.update(input.pipelineId, {
            name: input.name,
            description: input.description,
            isActive: input.isActive,
            triggerType: input.triggerType,
        }, orgContext);

        return successResponse(
            { id: updated.id, name: updated.name, isActive: updated.isActive },
            `Updated pipeline "${updated.name}" (ID: ${updated.id})`
        );
    } catch (error: unknown) {
        return errorResponse(error instanceof Error ? error.message : String(error));
    }
}

export async function handleDeletePipeline(args: unknown, context?: ToolContext) {
    try {
        const input = DeletePipelineInput.parse(args);
        const orgContext = getOrgContext(context);

        await pipelineService.delete(input.pipelineId, orgContext);

        return successResponse(
            { id: input.pipelineId, deleted: true },
            `Deleted pipeline ID: ${input.pipelineId}`
        );
    } catch (error: unknown) {
        return errorResponse(error instanceof Error ? error.message : String(error));
    }
}

export async function handleAddPipelineStep(args: unknown, context?: ToolContext) {
    try {
        const input = AddPipelineStepInput.parse(args);
        const orgContext = getOrgContext(context);

        const pipeline = await pipelineService.getById(input.pipelineId, orgContext);
        const steps = pipeline.steps.map(s => ({
            jobId: s.jobId!,
            order: s.order,
            outputName: s.outputName || undefined,
            runOnCondition: s.runOnCondition || undefined,
            onFailureAction: s.onFailureAction || undefined,
            waitDurationSeconds: s.waitDurationSeconds || undefined,
            moduleType: s.moduleType || undefined,
            decisionNodeConfig: s.decisionNodeConfig as any || undefined
        }));

        const newStep = {
            jobId: input.jobId!,
            order: input.order ?? steps.length,
            outputName: input.outputName || undefined,
            runOnCondition: input.runOnCondition || undefined,
            onFailureAction: input.onFailureAction || undefined,
            waitDurationSeconds: input.waitDurationSeconds || undefined,
            moduleType: input.moduleType || "job",
            decisionNodeConfig: input.decisionNodeConfig as any || undefined
        };

        steps.push(newStep);
        steps.sort((a, b) => a.order - b.order);

        await pipelineService.update(input.pipelineId, { steps }, orgContext);

        return successResponse(
            { pipelineId: input.pipelineId, order: newStep.order },
            `Added step to pipeline "${pipeline.name}"`
        );
    } catch (error: unknown) {
        return errorResponse(error instanceof Error ? error.message : String(error));
    }
}

export async function handleUpdatePipelineStep(args: unknown, context?: ToolContext) {
    try {
        const input = UpdatePipelineStepInput.parse(args);
        const orgContext = getOrgContext(context);

        const [step] = await db.select().from(pipelineSteps).where(eq(pipelineSteps.id, input.stepId)).limit(1);
        if (!step) return errorResponse("Step not found");

        const pipeline = await pipelineService.getById(step.pipelineId, orgContext);
        const steps = pipeline.steps.map(s => {
            if (s.id === input.stepId) {
                return {
                    jobId: input.jobId ?? s.jobId!,
                    order: input.order ?? s.order,
                    outputName: (input.outputName ?? s.outputName) || undefined,
                    runOnCondition: (input.runOnCondition ?? s.runOnCondition) || undefined,
                    onFailureAction: (input.onFailureAction ?? s.onFailureAction) || undefined,
                    waitDurationSeconds: (input.waitDurationSeconds ?? s.waitDurationSeconds) || undefined,
                    moduleType: s.moduleType || undefined,
                    decisionNodeConfig: (input.decisionNodeConfig ?? s.decisionNodeConfig) as any || undefined
                };
            }
            return {
                jobId: s.jobId!,
                order: s.order,
                outputName: s.outputName || undefined,
                runOnCondition: s.runOnCondition || undefined,
                onFailureAction: s.onFailureAction || undefined,
                waitDurationSeconds: s.waitDurationSeconds || undefined,
                moduleType: s.moduleType || undefined,
                decisionNodeConfig: s.decisionNodeConfig as any || undefined
            };
        });

        await pipelineService.update(step.pipelineId, { steps }, orgContext);

        return successResponse(
            { stepId: input.stepId },
            `Updated pipeline step #${input.stepId}`
        );
    } catch (error: unknown) {
        return errorResponse(error instanceof Error ? error.message : String(error));
    }
}

export async function handleDeletePipelineStep(args: unknown, context?: ToolContext) {
    try {
        const input = DeletePipelineStepInput.parse(args);
        const orgContext = getOrgContext(context);

        const [step] = await db.select().from(pipelineSteps).where(eq(pipelineSteps.id, input.stepId)).limit(1);
        if (!step) return errorResponse("Step not found");

        const pipeline = await pipelineService.getById(step.pipelineId, orgContext);
        const steps = pipeline.steps
            .filter(s => s.id !== input.stepId)
            .map(s => ({
                jobId: s.jobId!,
                order: s.order,
                outputName: s.outputName || undefined,
                runOnCondition: s.runOnCondition || undefined,
                onFailureAction: s.onFailureAction || undefined,
                waitDurationSeconds: s.waitDurationSeconds || undefined,
                moduleType: s.moduleType || undefined,
                decisionNodeConfig: s.decisionNodeConfig as any || undefined
            }));

        await pipelineService.update(step.pipelineId, { steps }, orgContext);

        return successResponse(
            { stepId: input.stepId, deleted: true },
            `Deleted pipeline step #${input.stepId}`
        );
    } catch (error: unknown) {
        return errorResponse(error instanceof Error ? error.message : String(error));
    }
}

export async function handleDelegateTask(args: unknown, context?: DelegationToolContext) {
    try {
        const input = DelegateTaskInput.parse(args);
        const orgContext = getOrgContext(context);
        const userId = orgContext.userId || "system-agent";
        const parentExecutionId = context?.executionId;

        if (!parentExecutionId) {
            return errorResponse("Cannot delegate without a parent execution context. Use run_pipeline instead.");
        }

        let pipelineId = input.pipelineId;
        if (!pipelineId && input.pipelineName) {
            const pipeline = await supervisorService.findPipelineForAgent(input.pipelineName, orgContext.organizationId || undefined);
            if (pipeline) pipelineId = pipeline.id;
        }

        if (!pipelineId) {
            return errorResponse("Pipeline not found.");
        }

        const res = await supervisorService.delegate(
            pipelineId,
            input.inputData || {},
            parentExecutionId,
            userId,
            context?.missionId || undefined,
            (context as any)?.missionRunId || undefined
        );

        if (res.success) {
            return successResponse(
                { executionId: res.executionId },
                `Delegated successfully to pipeline ID: ${pipelineId}. Child Execution ID: ${res.executionId}.`
            );
        } else {
            return errorResponse(`Delegation failed: ${res.error}`);
        }
    } catch (error: unknown) {
        return errorResponse(error instanceof Error ? error.message : String(error));
    }
}

