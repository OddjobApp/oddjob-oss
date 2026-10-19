
import { db } from "@server/database_service.js";
import { hilForms, otpCodes, pipelineStepExecutions, pipelineSteps, jobs, pipelineExecutions, type PipelineExecution, approvalRequests } from "@shared/schema/index.js";
import { eq, and, sql, gt } from "drizzle-orm";
import { NotFoundError, ForbiddenError, BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { approvalService } from "./approval.service.js";
import { pipelineExecutor } from "@server/core/pipeline-executor.js";
import { createKnowledgeGraphFromApproval } from "@domain/knowledge/core/extraction/knowledge-graph-integration.js";
import { qdrantPublisher } from "@domain/knowledge/core/indexing/qdrant-publisher.js";
import { missionRunService } from "@domain/mission/core/mission-run.service.js";

const logger = createLogger('ExternalService');

export const externalService = {
    /**
     * Get HIL Task Form Data
     */
    async getTaskForm(payload: any) {
        logger.info(`[EXTERNAL_HANDSHAKE] Handshake initiated for formId: ${payload.formId} (type: ${typeof payload.formId})`);
        
        // Special Case: Direct Approval Request (formId: 0)
        // Handle both numeric 0 and string "0" or "0.0" etc.
        const isDirectApproval = payload.formId === 0 || payload.formId === "0" || Number(payload.formId) === 0;

        if (isDirectApproval && payload.requestId) {
            logger.info(`[EXTERNAL_HANDSHAKE] Intercepted Direct Approval request for ID: ${payload.requestId}`);
            const [request] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, Number(payload.requestId))).limit(1);
            
            if (!request) {
                logger.warn(`[EXTERNAL_HANDSHAKE] FAILED: Approval request ${payload.requestId} NOT FOUND in database.`);
                throw new NotFoundError("This link is no longer valid.");
            }

            logger.info(`[ExternalService] Found request: status=${request.status}, tool=${(request.modifiedOutput as any)?.tool}`);
            
            // Build a synthesized schema for approval
            const schema: any = {
                fields: [
                    {
                        key: "decision",
                        label: "Decision",
                        type: "radio",
                        required: true,
                        options: [
                            { value: "approved", label: "Approve & Proceed" },
                            { value: "rejected", label: "Reject & Halt" }
                        ]
                    },
                    {
                        key: "comments",
                        label: "Feedback / Instructions",
                        type: "textarea",
                        required: false,
                        placeholder: "Optionally provide instructions for the agent..."
                    }
                ]
            };

            const ctx = request.modifiedOutput as any;
            return {
                status: "ready",
                formId: 0,
                schema,
                themeConfig: {
                    companyName: "Mission Control",
                    primaryColor: "#6366f1",
                    accentColor: "#fbbf24"
                },
                executionId: payload.executionId,
                email: payload.email,
                jobContext: {
                    jobId: request.jobId,
                    jobName: ctx?.tool || "Operational Request",
                    jobType: "governor_intervention",
                    output: ctx,
                    stepOrder: 0,
                    executedAt: request.createdAt?.toISOString() || null
                }
            };
        }

        // A stage of a cycle's Form Studio response: this person's stage and what they
        // may see of earlier ones, never the whole form or its other answers.
        const { stageTaskFromToken } = await import("@domain/pipeline/core/form-studio-stage-requests.service.js");
        const stageTask = await stageTaskFromToken(payload);
        if (stageTask) return stageTask;

        // Fetch form
        const [form] = await db
            .select()
            .from(hilForms)
            .where(eq(hilForms.id, payload.formId))
            .limit(1);

        if (!form || form.isArchived) throw new NotFoundError("This link is no longer valid.");
        // Check if OTP is required
        const securityConfig = (form.securityConfig as any) || {};
        const requiresOtp = securityConfig.requireOtp === true;

        // Check if OTP has already been verified
        const [otpRecord] = await db
            .select()
            .from(otpCodes)
            .where(
                and(
                    eq(otpCodes.executionId, payload.executionId),
                    eq(otpCodes.email, payload.email),
                    sql`${otpCodes.usedAt} IS NOT NULL`
                )
            )
            .limit(1);

        const otpVerified = !!otpRecord;

        if (requiresOtp && !otpVerified) {
            return {
                status: "otp_required",
                email: payload.email,
                formId: payload.formId,
            };
        }

        // Fetch step execution to get job output
        const stepExecutionId = parseInt(payload.executionId);
        let jobContext = null;
        let contextData = null;

        if (!isNaN(stepExecutionId)) {
            try {
                const [stepExecution] = await db
                    .select()
                    .from(pipelineStepExecutions)
                    .where(eq(pipelineStepExecutions.id, stepExecutionId))
                    .limit(1);

                if (stepExecution) {
                    const [pipelineStep] = await db
                        .select()
                        .from(pipelineSteps)
                        .where(eq(pipelineSteps.id, stepExecution.pipelineStepId))
                        .limit(1);

                    if (pipelineStep && pipelineStep.jobId) {
                        const [job] = await db
                            .select()
                            .from(jobs)
                            .where(eq(jobs.id, pipelineStep.jobId))
                            .limit(1);

                        if (job) {
                            let jobOutput = null;
                            if (stepExecution.output) {
                                try {
                                    jobOutput = JSON.parse(stepExecution.output);
                                    if ((jobOutput as any)._type === "hil_context") {
                                        contextData = (jobOutput as any).context;
                                    }
                                } catch {
                                    jobOutput = stepExecution.output;
                                }
                            }

                            jobContext = {
                                jobId: job.id,
                                jobName: job.name,
                                jobType: job.type,
                                output: jobOutput,
                                diff: (stepExecution as any).diff, // Reactive Intelligence
                                stepOrder: stepExecution.stepOrder,
                                executedAt: stepExecution.executedAt?.toISOString() || null,
                            };
                        }
                    }
                }
            } catch (error) {
                logger.error("Failed to fetch job context", error as Error, { stepExecutionId });
            }
        }

        return {
            status: "ready",
            formId: form.id,
            schema: form.schema,
            themeConfig: form.themeConfig,
            executionId: payload.executionId,
            email: payload.email,
            jobContext: jobContext,
            context: contextData,
        };
    },

    /**
     * Request OTP
     */
    async requestOtp(payload: any, email: string) {
        if (payload.email !== email) throw new ForbiddenError("Email mismatch");

        const [form] = await db
            .select()
            .from(hilForms)
            .where(eq(hilForms.id, payload.formId))
            .limit(1);

        if (!form) throw new NotFoundError("Form not found", "NOT_FOUND", { formId: payload.formId });

        const securityConfig = (form.securityConfig as any) || {};
        if (securityConfig.requireOtp !== true) throw new BadRequestError("OTP is not required for this form");

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10);

        // A new code replaces the earlier ones by expiring them. This used to mark them
        // used, and a used code is what getTaskForm takes as a confirmed email, so
        // asking for a second code opened the task without entering either one.
        await db
            .update(otpCodes)
            .set({ expiresAt: new Date() })
            .where(
                and(
                    eq(otpCodes.executionId, payload.executionId),
                    eq(otpCodes.email, email),
                    sql`${otpCodes.usedAt} IS NULL`,
                    gt(otpCodes.expiresAt, new Date())
                )
            );

        await db.insert(otpCodes).values({
            executionId: payload.executionId,
            email: email,
            code: code,
            expiresAt: expiresAt,
        });

        const { sendOtpEmail } = await import("./email.service.js"); // Dynamic import to avoid cycles/mocking issues
        await sendOtpEmail(email, code, form.name);

        return { status: "sent", message: "OTP code has been sent", formId: form.id };
    },

    /**
     * Verify OTP
     */
    async verifyOtp(payload: any, email: string, code: string) {
        if (payload.email !== email) throw new ForbiddenError("Email mismatch");

        const [otpRecord] = await db
            .select()
            .from(otpCodes)
            .where(
                and(
                    eq(otpCodes.executionId, payload.executionId),
                    eq(otpCodes.email, email),
                    eq(otpCodes.code, code),
                    sql`${otpCodes.usedAt} IS NULL`
                )
            )
            .limit(1);

        if (!otpRecord) throw new BadRequestError("Invalid OTP code");
        if (new Date() > otpRecord.expiresAt) throw new BadRequestError("OTP code has expired");

        await db
            .update(otpCodes)
            .set({ usedAt: new Date() })
            .where(eq(otpCodes.id, otpRecord.id));

        const [form] = await db
            .select()
            .from(hilForms)
            .where(eq(hilForms.id, payload.formId))
            .limit(1);

        if (!form) throw new NotFoundError("Form not found", "NOT_FOUND", { formId: payload.formId });

        // Fetch context if available
        const executionId = parseInt(payload.executionId);
        const [stepExecution] = await db
            .select()
            .from(pipelineStepExecutions)
            .where(eq(pipelineStepExecutions.id, executionId))
            .limit(1);

        let contextData = null;
        if (stepExecution && stepExecution.output) {
            try {
                const parsed = JSON.parse(stepExecution.output);
                if (parsed._type === "hil_context" && parsed.context) {
                    contextData = parsed.context;
                }
            } catch (e) {
                // Ignore parse errors
            }
        }

        return {
            status: "verified",
            formId: form.id,
            schema: form.schema,
            themeConfig: form.themeConfig,
            executionId: payload.executionId,
            email: payload.email,
            context: contextData,
        };
    },

    /**
     * Submit Form Response
     */
    async submitForm(payload: any, responses: any) {
        if (payload.formId === 0 && payload.requestId) {
            const decision = responses.decision || (responses.approved ? "approved" : "rejected");
            
            try {
                await approvalService.processDecision(
                    payload.requestId, 
                    {
                        decision: decision as any,
                        comments: responses.comments,
                        modifiedOutput: responses.modifiedOutput
                    },
                    0, // System/Trusted bypass
                    payload.email,
                    { isSuperAdmin: true } // Treat as super admin since the link is token-validated
                );
            } catch (err: any) {
                throw new BadRequestError("This action could not be completed. The link may have expired or already been used.");
            }

            return { stepExecutionId: payload.requestId };
        }

        // A stage of a cycle's Form Studio response: locks the stage, which resumes the step.
        const { completeStageFromToken } = await import("@domain/pipeline/core/form-studio-stage-requests.service.js");
        const formStudioStage = await completeStageFromToken(payload, responses?.inputs ?? responses);
        if (formStudioStage) return { stepExecutionId: parseInt(payload.executionId), formStudioStage };

        const stepExecutionId = parseInt(payload.executionId);
        if (isNaN(stepExecutionId)) throw new BadRequestError("Invalid execution ID in token", { executionId: payload.executionId }, "INVALID_INPUT");

        const [stepExecution] = await db
            .select()
            .from(pipelineStepExecutions)
            .where(eq(pipelineStepExecutions.id, stepExecutionId))
            .limit(1);

        if (!stepExecution) throw new NotFoundError("Pipeline step execution not found", "NOT_FOUND", { stepExecutionId });

        if (stepExecution.status !== "waiting_external_input") {
            throw new BadRequestError(`Step execution is not waiting for external input. Current status: ${stepExecution.status}`, { status: stepExecution.status });
        }

        let originalJobOutput = null;
        if (stepExecution.output) {
            try {
                originalJobOutput = JSON.parse(stepExecution.output);
            } catch {
                originalJobOutput = stepExecution.output;
            }
        }

        // Edit & Approve Logic: If modifiedOutput is provided, it overrides the original output
        let finalOutput = originalJobOutput;
        if (responses.modifiedOutput !== undefined) {
            console.log(`[ExternalService] Applying modified output for step ${stepExecutionId}`);
            finalOutput = responses.modifiedOutput;
            // Ensure it wraps correctly if it was supposed to be a hil_context, 
            // but usually the modifier edits the inner content. 
            // For now, assume the user sends the raw desired output.
        }

        const formOutput = typeof finalOutput === 'string' ? finalOutput : JSON.stringify(finalOutput);

        const { pipelineService } = await import("@domain/pipeline/core/pipeline.service.js");
        await pipelineService.updateStepExecution(stepExecutionId, {
            output: formOutput,
            status: "success",
            completedAt: new Date(),
        });

        const pipelineExecution = await pipelineService.getExecutionSystem(stepExecution.pipelineExecutionId);

        const hasApproval = responses.approved !== undefined || responses.approval !== undefined;
        const hasRating = responses.rating !== undefined || responses.quality_rating !== undefined;
        const approvalValue = responses.approved ?? responses.approval;
        const ratingValue = responses.rating ?? responses.quality_rating;

        if (hasApproval || hasRating) {
            try {
                const [pipelineStep] = await db
                    .select()
                    .from(pipelineSteps)
                    .where(eq(pipelineSteps.id, stepExecution.pipelineStepId))
                    .limit(1);

                if (pipelineStep && pipelineStep.jobId) {
                    const [job] = await db
                        .select()
                        .from(jobs)
                        .where(eq(jobs.id, pipelineStep.jobId))
                        .limit(1);

                    if (job && pipelineExecution) {
                        const organizationId = (pipelineExecution as any).organizationId || job.organizationId || null;

                        if (organizationId && originalJobOutput !== null) {
                            const nodes = await createKnowledgeGraphFromApproval({
                                jobOutput: originalJobOutput,
                                job,
                                pipelineExecution: pipelineExecution as any,
                                stepExecution,
                                formResponses: responses,
                                approvalValue: approvalValue === true || approvalValue === "true",
                                ratingValue: ratingValue ? Number(ratingValue) : undefined,
                                submitterEmail: payload.email,
                                organizationId: organizationId,
                            });

                            for (const node of nodes) {
                                qdrantPublisher.publishGraphNode(node.id).catch((err: any) =>
                                    logger.error(`Failed to index node ${node.id}`, err)
                                );
                            }
                        }
                    }
                }
            } catch (error) {
                logger.error("Failed to create nodes from approval", error as Error, { stepExecutionId });
            }
        }

        if (pipelineExecution && pipelineExecution.status === "running") {
            try {
                // --- NEW: Unpause mission run if applicable ---
                await missionRunService.resumeByStepExecutionId(stepExecutionId, responses);
                
                const resumeResult = await pipelineExecutor.resumePipelineExecution(
                    pipelineExecution.id,
                    null,
                    // We pass the FULL output as data so downstream steps can pick it up via {{step.N.output}}
                    // But usually resumeData is merged into {{data}}.
                    // Let's pass the approved payload.
                    {
                        ...responses,
                        output: finalOutput
                    }
                );

                if (resumeResult.success) {
                    logger.info(`Pipeline execution resumed`, { pipelineExecutionId: pipelineExecution.id });
                } else {
                    logger.error(`Pipeline resume returned error: ${resumeResult.error}`, undefined, { pipelineExecutionId: pipelineExecution.id });
                }
            } catch (error: any) {
                logger.error("Failed to trigger pipeline resume", error, { pipelineExecutionId: pipelineExecution?.id });
            }
        }

        return { stepExecutionId };
    }
};

export default externalService;


