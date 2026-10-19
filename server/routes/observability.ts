
import { Router, type Request, type Response } from "express";
import { validateIdParam } from "@server/utils/api-utils.js";
import { db } from "@server/database_service.js";
import { pipelineExecutions, pipelineStepExecutions } from "@shared/schema/index.js";
import { eq, desc } from "drizzle-orm";
import { SupervisorPlanSchema } from "@shared/schema/supervisor.js";
import { supervisorService } from "@domain/integrations/core/supervisor.service.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { reportingService } from "@domain/analytics/core/reporting.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";

export const observabilityRouter = Router();
export default observabilityRouter;

// GET /api/observability/execution/:executionId/thread
// Retrieve the full thought history for a Supervisor execution
observabilityRouter.get("/execution/:executionId/thread", async (req, res) => {
    try {
        const executionId = validateIdParam(req.params.executionId, 'executionId');
        if (isNaN(executionId)) {
            return res.status(400).json({ error: "Invalid execution ID" });
        }

        // 1. Fetch the pipeline execution to get the workgroup/plan context
        const execution = await db.query.pipelineExecutions.findFirst({
            where: eq(pipelineExecutions.id, executionId),
            with: {
                job: true
            }
        });

        if (!execution) {
            return res.status(404).json({ error: "Execution not found" });
        }

        // 2. Fetch the LATEST step execution to get the current plan state
        // Supervisor stores the plan in the output of its step
        const [lastStep] = await db.select().from(pipelineStepExecutions)
            .where(eq(pipelineStepExecutions.pipelineExecutionId, executionId))
            .orderBy(desc(pipelineStepExecutions.stepOrder))
            .limit(1);

        if (!lastStep || !lastStep.output) {
            return res.json({ thread: [], status: "no_data" });
        }

        // 3. Parse the plan
        let plan;
        try {
            plan = SupervisorPlanSchema.parse(JSON.parse(lastStep.output));
        } catch (e) {
            // If output isn't a valid plan (e.g. legacy or error), return partial data
            return res.json({ thread: [], error: "Invalid plan format", rawOutput: lastStep.output });
        }

        // 4. Construct the Thread
        // Merge history with current task status
        const thread = plan.history.map((item, index) => ({
            id: `history-${index}`,
            ...item,
            timestamp: item.timestamp
        }));

        res.json({
            executionId,
            intent: plan.intent,
            status: execution.status,
            thread,
            tasks: plan.tasks,
            currentContext: plan.currentContext
        });

    } catch (error) {
        console.error("Failed to fetch observability thread:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// POST /api/observability/fork
// Time Travel: Fork execution from a specific point
observabilityRouter.post("/fork", async (req, res) => {
    try {
        const { originalExecutionId, historyIndex, modifiedIntent, modifiedThought } = req.body;

        if (!originalExecutionId || historyIndex === undefined) {
            return res.status(400).json({ error: "Missing required parameters" });
        }

        // 1. Fetch original execution and plan
        const [lastStep] = await db.select().from(pipelineStepExecutions)
            .where(eq(pipelineStepExecutions.pipelineExecutionId, originalExecutionId))
            .orderBy(desc(pipelineStepExecutions.stepOrder))
            .limit(1);

        if (!lastStep || !lastStep.output) {
            return res.status(404).json({ error: "Original plan not found" });
        }

        const originalPlan = SupervisorPlanSchema.parse(JSON.parse(lastStep.output));

        // 2. Slice history and tasks
        // History: Keep items UP TO and INCLUDING the index (if we want to fork AFTER the step)
        // OR: Keep items UP TO the index (exclusive) if we want to REPLACE the step?
        // Assumption: historyIndex is the index of the step we want to "Rewind To" (i.e. discard everything after it)
        const slicedHistory = originalPlan.history.slice(0, historyIndex + 1);

        // If we modified the thought at this index, update it
        if (modifiedThought && slicedHistory.length > 0) {
            slicedHistory[slicedHistory.length - 1].thought = modifiedThought;
        }

        // Tasks: We need to figure out which tasks correspond to the sliced history.
        // This is tricky because history and tasks aren't 1:1 mapped by index.
        // Strategy: Reset all tasks that haven't "happened" yet in the sliced history.
        // Better Strategy: Just keep the 'completed' tasks that are mentioned in the sliced history?
        // Simplification: For now, if we rewind, we might just reset the 'pending' status of subsequent tasks
        // or let the Supervisor replan based on the truncated history.

        // Let's go with: Keep tasks, but reset status of anything that seems "future".
        // Actually, safest bet is to let Supervisor RE-EVALUATE.
        // But we want to keep the "memory" of what happened.

        const slicedTasks = originalPlan.tasks.map(t => {
            // If the task was completed AFTER the timestamp of the fork point, reset it?
            // Timestamp matching is hard.
            // Let's just keep the tasks as is, but maybe mark them as 'pending' if we want to re-try?
            return t;
        });

        // 3. Create NEW pipeline execution (Fork)
        const [originalExec] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, originalExecutionId)).limit(1);

        if (!originalExec) {
            return res.status(404).json({ error: "Original execution not found" });
        }

        // Prepare Initial State (Seeding the context)
        // We need to pass the "Sliced Plan" as the output of the previous step?
        // Actually, for a Supervisor, the "Plan" IS the state.
        // We need to construct a "Resume Data" object that the SupervisorJobExecutor will recognize.

        // Supervisor checks: context.data?.plan OR stepExecution.output
        // Since we are starting a NEW execution, we can pass it via `initialVariables`.

        // Update the plan with our sliced history/tasks
        const cleanPlan = { ...originalPlan };
        cleanPlan.history = slicedHistory;
        cleanPlan.tasks = slicedTasks;
        // Reset metrics
        cleanPlan.replanCount = 0;
        cleanPlan.currentContext = `Forked from execution ${originalExecutionId} at history index ${historyIndex}. Intent modified: ${!!modifiedIntent}`;
        if (modifiedIntent) cleanPlan.intent = modifiedIntent;

        const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");

        const result = await pipelineExecutor.executePipeline(
            originalExec.pipelineId,
            (req as any).user?.id || originalExec.createdBy || "system",
            originalExec.startStepId, // Start from same point
            originalExec.ttl,
            {
                // Inject the plan into the "initial variables" so the Supervisor can pick it up
                // The SupervisorJobExecutor looks for `context.data.plan` in lines 52-54
                plan: cleanPlan,
                approved: true, // Auto-approve the "restored" plan state
                _forkedFrom: originalExecutionId
            },
            originalExec.parentExecutionId || undefined
        );

        if (!result.success) {
            return res.status(500).json({ error: "Failed to start forked execution", details: result.error });
        }

        res.json({
            success: true,
            forkedExecutionId: result.executionId,
            message: "Time Travel successful. New execution started."
        });

    } catch (error) {
        console.error("Fork failed:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// GET /api/observability/stats
observabilityRouter.get("/stats", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    try {
        const orgContext = await getUserOrgContext(req);
        
        // 1. Fetch Pipeline Performance
        const rawPerformance = await reportingService.getPipelinePerformance(orgContext);
        const pipelines = rawPerformance.map((p: any) => ({
            pipeline_id: Number(p.pipeline_id),
            pipeline_name: p.pipeline_name,
            total_executions: Number(p.total_executions) || 0,
            success_rate_percentage: parseFloat(p.success_rate_percentage) || 0,
            avg_duration_seconds: String(p.avg_duration_seconds),
            last_execution_time: p.last_execution_time
        }));

        // 2. Fetch AI Usage
        const rawAiUsage = await reportingService.getAIUsage(orgContext);
        const ai_usage = rawAiUsage.map((u: any) => ({
            model: u.model,
            total_tokens: Number(u.total_tokens) || 0,
            avg_latency_ms: String(u.avg_latency_ms)
        }));

        // 3. Fetch Error Hotspots
        const rawErrors = await reportingService.getErrorHotspots(orgContext);
        const errors = rawErrors.map((e: any) => ({
            job_type: e.pipeline_name || "Pipeline",
            job_id: Number(e.pipeline_id) || 0,
            failure_count: Number(e.occurrence_count) || 0,
            last_failure: e.last_seen
        }));

        // 4. Fetch Trace Volume
        const rawTraceVolume = await reportingService.getTraceVolume(24);
        const trace_volume = rawTraceVolume.map((t: any) => ({
            span_count: Number(t.span_count) || 0
        }));

        res.json({
            pipelines,
            ai_usage,
            errors,
            trace_volume
        });
    } catch (error) {
        console.error("Failed to fetch observability stats:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}));


