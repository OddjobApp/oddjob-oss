
import { Job, Pipeline, HumanApprovalConfig, hilForms, approvalRequests, users } from "@shared/schema/index.js";
import { HilFormFactory } from "../hil/hil-form-factory.js";

import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { db } from "../../../../database_service.js";
import { eq } from "drizzle-orm";
import { gmailService } from "../../../../domain/integrations/gmail-service.js";
import { generateExternalToken } from "@domain/core/auth/jwt.service.js";
import { createLogger } from "../../../../utils/logger.js";

const logger = createLogger('HumanApprovalExecutor');

export class HumanApprovalExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "human_approval";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
        executeJob?: any,
        stepExecutionId?: number
    ): Promise<StepExecutionResult> {

        const config = resolvedConfig as HumanApprovalConfig & {
            emailSubject?: string;
            instructions?: string;
            prompt?: string;
        };

        // Normalize Approvers (Legacy Support)
        const approvers = config.approvers || [];
        if (approvers.length === 0 && config.assigneeEmail) {
            approvers.push({ type: 'external', email: config.assigneeEmail });
        }

        // A Form Studio stage: this step asks its approvers for one stage of the
        // response the cycle is filling in, and resumes with the status and scores.
        if (config.stageId && config.formId) {
            const { openFormStage } = await import("@domain/pipeline/core/form-studio-stage-requests.service.js");
            const opened = await openFormStage({
                organizationId: pipeline.organizationId ?? job.organizationId ?? null,
                formId: config.formId,
                stageId: config.stageId,
                approvers: approvers.map((approver) => ({ type: approver.type, id: approver.id, email: approver.email || undefined })),
                jobId: job.id,
                pipelineName: pipeline.name,
                instructions: config.instructions,
                emailSubject: config.emailSubject,
                stepExecutionId,
                // A run under a workflow release answers the form release the
                // manifest pinned at publish time, not whatever is current now.
                releaseNumber: (context as any).workflowRelease?.formReleases?.[String(config.formId)]?.releaseNumber,
                pipelineExecutionId: (context as any).pipelineExecutionId,
                missionRunId: (context as any).missionRunId,
                missionId: (context as any).missionId,
                contextData: context.data,
            });
            if (opened.kind === "failed") return { success: false, status: "failed", output: "", error: opened.error };
            // In already, or filled in by the agent it is assigned to: the step continues.
            if (opened.kind === "already_in" || opened.kind === "filled") return { success: true, status: "success", output: JSON.stringify(opened.output) };
            return {
                success: true,
                status: "waiting_external_input",
                output: JSON.stringify({ _type: "hil_context", message: opened.message, requestId: opened.approvalRequestIds, formStudio: { responseId: opened.responseId, stageId: config.stageId } }),
                suspensionMetadata: { waitReason: "human_approval", approvalRequestIds: opened.approvalRequestIds },
            } as StepExecutionResult;
        }

        // 1. Resolve Form (DB or Factory)
        let form: any = null;
        let formName = "Human Approval";

        if (config.formId) {
            [form] = await db.select().from(hilForms).where(eq(hilForms.id, config.formId)).limit(1);
            formName = form?.name || formName;
        } else if ((config as any).formKey) {
            const schema = HilFormFactory.getSchema((config as any).formKey);
            if (schema) {
                form = { id: 0, name: (config as any).formKey, schema };
                formName = (config as any).formKey;
            }
        }

        if (!form) {
            logger.warn(`No form found for formId=${config.formId} or formKey=${(config as any).formKey}. Falling back to default.`);
            const defaultSchema = HilFormFactory.getSchema("standard_approval");
            form = { id: 0, name: "Standard Approval", schema: defaultSchema };
        }


        // Create Approval Requests
        const createdRequests: any[] = [];
        const orgId = job.organizationId || null;
        const hasGmail = await gmailService.loadCredentials(orgId);

        if (approvers.length > 0 && stepExecutionId) {
            for (const approver of approvers) {
                // Determine email for internal users if not provided
                let email = approver.email;
                if (approver.type === 'internal' && approver.id && !email) {
                    // Fetch user email
                    const [user] = await db.select().from(users).where(eq(users.id, approver.id)).limit(1);
                    if (user && user.email) {
                        email = user.email;
                    }
                }

                if (!email) {
                    logger.warn(`Skipping approver without email: ${approver.id}`);
                    continue;
                }

                // Generate Token
                const token = generateExternalToken({
                    executionId: String(stepExecutionId),
                    formId: config.formId,
                    email: email,
                    role: approver.type
                });

                // Create DB Record
                const [request] = await db.insert(approvalRequests).values({
                    executionId: String(stepExecutionId),
                    jobId: job.id,
                    approverType: approver.type,
                    approverId: approver.type === 'internal' ? approver.id : null,
                    approverEmail: email,
                    status: 'pending',
                    token: token,
                    organizationId: orgId,
                    modifiedOutput: {
                        tool: job.type || "human_approval",
                        params: context.data || {},
                        description: config.instructions || config.emailSubject || `Human approval required for ${job.name}`,
                        risk: "medium",
                    } as any
                }).returning();
                createdRequests.push(request);

                // Send Notification
                try {
                    const baseUrl = process.env.APP_URL || 'http://localhost:5000';
                    // Internal users go to Decision Inbox, External go to /external/task?
                    // For now, let's keep it simple: HIL link for everyone or specific link?
                    // Internal users get the consolidated Control decision queue.
                    // Or better: Internal users get a link to the app. External users get the token link.

                    let link = `${baseUrl}/external/task?token=${token}`;
                    if (approver.type === 'internal') {
                        link = `${baseUrl}/control/decisions`;
                    }

                    if (hasGmail) {
                        await gmailService.sendHilNotification(
                            orgId,
                            email,
                            link,
                            {
                                pipelineName: pipeline.name,
                                stepName: formName,
                                formName: formName,
                            },

                            config.emailSubject
                        );
                        logger.info(`Approval notification sent to ${email}`);
                    }
                } catch (error: any) {
                    logger.error('Failed to send approval notification', { error: error.message });
                }
            }
        }

        const approvalRequestIds = createdRequests.map(r => r.id);
        const output = {
            _type: "hil_context",
            message: `Waiting for approval from: ${createdRequests.map(r => r.approverEmail).join(', ')}`,
            requestId: approvalRequestIds,
            context
        };

        // Mission: Include suspensionMetadata for pause when workgroupId present
        const workgroupId = (context as any).workgroupId;
        const suspensionMetadata = workgroupId
            ? { waitReason: "human_approval" as const, approvalRequestIds }
            : undefined;

        return {
            success: true,
            status: "waiting_external_input",
            output: JSON.stringify(output),
            ...(suspensionMetadata && { suspensionMetadata } as any),
        };
    }
}



