import { db } from "@server/database_service.js";
import { validateExternalToken } from "@domain/core/auth/jwt.service.js";
import { hilForms, pipelineStepExecutions, jobs, pipelines, pipelineSteps, type HilFormKind } from "@shared/schema/index.js";
import { eq, desc, and, ne } from "drizzle-orm";
import { ValidationError, NotFoundError } from "@server/utils/errors.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { missionRunService } from "@domain/mission/core/mission-run.service.js";
import { pipelineExecutor } from "@server/core/pipeline-executor.js";

// Requests are created by hilRequests (hil-requests.service.ts), which marks them
// as requests and announces them. The createForm that used to live here was only
// ever called by the Form Builder's template save, so its Slack broadcast
// announced templates being designed and never an actual request.
export const hilService = {
    /**
     * Mark a form as viewed to clear notifications
     */
    async markAsViewed(formId: number) {
        await db
            .update(hilForms)
            .set({
                isViewed: true,
                updatedAt: new Date(),
            })
            .where(eq(hilForms.id, formId));
    },

    /**
     * Get a form by ID
     */
    async getForm(formId: number) {
        const [form] = await db
            .select()
            .from(hilForms)
            .where(eq(hilForms.id, formId))
            .limit(1);

        if (!form) {
            throw new NotFoundError("HIL form not found");
        }

        return form;
    },

    /**
     * List forms for a user/org. Defaults to templates, the forms library; runtime
     * requests and stored Studio responses are asked for by kind.
     */
    async listForms(userId: string, organizationId: number, kind: HilFormKind = "template") {
        const results = await db
            .select({
                id: hilForms.id,
                stepExecutionId: hilForms.stepExecutionId,
                status: hilForms.status,
                // The Forms list renders both. Without them every form showed
                // "Active" and an empty description.
                description: hilForms.description,
                isArchived: hilForms.isArchived,
                createdAt: hilForms.createdAt,
                updatedAt: hilForms.updatedAt,
                name: hilForms.name,
                pipelineName: pipelines.name,
                stepName: jobs.name,
            })
            .from(hilForms)
            .leftJoin(pipelineStepExecutions, eq(hilForms.stepExecutionId, pipelineStepExecutions.id))
            .leftJoin(pipelineSteps, eq(pipelineStepExecutions.pipelineStepId, pipelineSteps.id))
            .leftJoin(pipelines, eq(pipelineSteps.pipelineId, pipelines.id))
            .leftJoin(jobs, eq(pipelineStepExecutions.jobId, jobs.id))
            // organizationId is required: a falsy-org branch here would have been
            // `.where(undefined)`, which returns every tenant's forms.
            .where(and(eq(hilForms.organizationId, organizationId), eq(hilForms.kind, kind)))
            .orderBy(desc(hilForms.createdAt));

        return results.map(f => ({
            ...f,
            pipelineName: f.pipelineName || 'Unknown Pipeline',
            stepName: f.stepName || 'Unknown Step',
        }));
    },

    /**
     * Submit a form (HIL completed)
     *
     * `userId` is optional because app-token callers have no user row, and
     * `submittedBy` references users.id.
     */
    async submitForm(formId: number, userId: string | undefined, data: any) {
        const form = await this.getForm(formId);

        if (form.status === "completed") {
            throw new ValidationError("Form already submitted");
        }

        // Claim the form in the same statement that completes it. Checking status
        // above and then updating by id alone let two answers (a CREW card and
        // the app itself, say) both pass the check: the second overwrote the
        // first's data and resumed the waiting pipeline a second time.
        const claimed = await db
            .update(hilForms)
            .set({
                status: "completed",
                submittedBy: userId,
                submittedAt: new Date(),
                data: data,
                updatedAt: new Date(),
            })
            .where(and(eq(hilForms.id, formId), ne(hilForms.status, "completed")))
            .returning({ id: hilForms.id });
        if (claimed.length === 0) {
            throw new ValidationError("Form already submitted");
        }

        // Signal the event stream that HIL is ready
        eventStream.emit("hil:completed", {
            formId,
            stepExecutionId: form.stepExecutionId,
            data,
        });

        // --- NEW: Unpause mission and resume pipeline ---
        try {
            // 1. Unpause mission run if applicable
            if (form.stepExecutionId != null) {
                await missionRunService.resumeByStepExecutionId(form.stepExecutionId, data);

                // 2. Mark step execution as success if it was waiting
                const [execution] = await db
                    .select()
                    .from(pipelineStepExecutions)
                    .where(eq(pipelineStepExecutions.id, form.stepExecutionId))
                    .limit(1);

                if (execution && (execution.status === "waiting_external_input" || execution.status === "waiting_async")) {
                    const { pipelineService } = await import("@domain/pipeline/core/pipeline.service.js");
                    await pipelineService.updateStepExecution(execution.id, {
                        status: "success",
                        output: typeof data === 'string' ? data : JSON.stringify(data),
                        completedAt: new Date(),
                    });

                    // 3. Trigger pipeline resume
                    await pipelineExecutor.resumePipelineExecution(execution.pipelineExecutionId, execution.id, data);
                }
            }
        } catch (error) {
            console.error("[HilService] Error during auto-resume:", error);
            // Don't fail the submission even if resume fails, as the event was already emitted
        }

        return { success: true };
    },

    /**
     * Generate a development link for a form (unauthenticated/direct).
     */
    async generateDevLink(stepExecutionId: number, protocol: string, host: string) {
        return `${protocol}://${host}/hil-form/${stepExecutionId}?dev=true`;
    }
};


