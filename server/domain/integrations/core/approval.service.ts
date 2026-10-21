import { db } from "@server/database_service.js";
import { approvalRequests, pipelineStepExecutions, pipelineSteps, jobs, missionRuns, pipelineExecutions, snapshots } from "@shared/schema/index.js";
import { eq, and, or, sql, desc, isNull, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createLogger } from "@server/utils/logger.js";
import { NotFoundError, BadRequestError, ForbiddenError } from "@server/utils/errors.js";
import { getOrgConditions } from '@server/utils/org-conditions.js';
import { validateExternalToken, generateExternalToken } from "@domain/core/auth/jwt.service.js";
import { externalService } from "./external.service.js";
import { missionRunService } from "../../mission/core/mission-run.service.js";
import { queueService, JobPriority } from "@domain/queue/queue.service.js";
import { ApprovalNotificationType } from "../workers/approval-notification.worker.js";
import fs from 'fs';

import { decisionRouter } from "../../governor/core/decision-router.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("ApprovalService");
function requiredApprovalOrg(request: { organizationId: number | null }): number {
    if (request.organizationId == null) throw new BadRequestError('Organization context is required for this approval action');
    return request.organizationId;
}

// Second view of mission_runs, reached via pipeline_executions rather than by
// matching the execution id, so the supervisor path can resolve its cycle too.
const supervisorRuns = alias(missionRuns, "supervisor_runs");

/**
 * Approval-envelope kinds to the product area they belong to — the inbox
 * header reads better as "GOOGLE CALENDAR" than "GCAL_CREATE_EVENT".
 */
const APPROVAL_KIND_LABELS: Record<string, string> = {
    amazon_purchase: "AMAZON PURCHASE",
    flighthub_booking: "FLIGHT BOOKING",
    youtube_action: 'YOUTUBE',
    google_workspace_action: "GOOGLE WORKSPACE",
    calendar_action: "GOOGLE CALENDAR",
    outbound_message: "OUTBOUND MESSAGE",
    app_record_action: "APP ACTION",
};

/** True when the request is addressed to a project's Executives and the user is one. */
async function isFinanceRoleApprover(request: { approverEmail: string | null; organizationId: number | null }, userId: string | number): Promise<boolean> {
    const { executiveApproverProject, financeRolesService } = await import("@domain/projects/core/finance-roles.service.js");
    const projectId = executiveApproverProject(request.approverEmail);
    if (projectId == null || request.organizationId == null) return false;
    return (await financeRolesService.executiveProjects(request.organizationId, userId.toString())).includes(projectId);
}

async function assertQuickBooksApprover(request: { toolArgs: unknown; organizationId: number | null }, userId: string | number): Promise<void> {
    const meta = request.toolArgs as any;
    const { QUICKBOOKS_WRITE_PERMISSIONS } = await import("@domain/tools/v1/capabilities/quickbooks.js");
    const { financeRolesService } = await import("@domain/projects/core/finance-roles.service.js");
    const permission = QUICKBOOKS_WRITE_PERMISSIONS[meta?.actionName];
    if (!permission || request.organizationId == null) throw new ForbiddenError("This QuickBooks change cannot be approved: its action is not recognised.");
    // Proposals saved before finance roles existed carry no permission project;
    // they resolve the same way a new proposal would.
    const projectId = meta.permissionProjectId ?? await financeRolesService.permissionProjectId(request.organizationId, meta.projectId ?? null);
    if (projectId == null) throw new ForbiddenError("This QuickBooks change has no project, so no finance role can approve it.");
    await financeRolesService.assertCanApprove({
        organizationId: request.organizationId, projectId, userId: userId.toString(),
        proposedBy: typeof meta.proposedBy === 'string' ? meta.proposedBy : null, ...permission,
    });
}

export const approvalService = {
    async verifyCalendarEvent(requestId: number, userId: string | number, email: string, organizationId?: number, adminRole?: any) {
        const request = await this.getById(requestId, userId, email, organizationId, adminRole);
        const meta = request.toolArgs as any;
        const stored = request.modifiedOutput as any;
        if (request.status !== 'approved' || meta?.kind !== 'calendar_action' || meta.actionName !== 'gcal_create_event' || !stored?.outcome?.success || !stored.outcome.result?.id) {
            throw new BadRequestError('This approval has no confirmed calendar event to verify.');
        }
        const { GOOGLE_CALENDAR_TOOLS } = await import('@domain/tools/v1/capabilities/google-calendar.js');
        const output = await GOOGLE_CALENDAR_TOOLS.gcal_get_event.execute({ calendar_id: meta.args?.calendar_id ?? 'primary', event_id: stored.outcome.result.id }, { organizationId: request.organizationId, projectId: meta.projectId });
        // The tool reports a failed read as text, not JSON.
        let result: any;
        try { result = JSON.parse(output); } catch { throw new BadRequestError(`The event could not be read from Google: ${String(output).slice(0, 200)}`); }
        return { verifiedAt: new Date().toISOString(), found: result.status !== 'cancelled', result };
    },
    /**
     * List pending approvals for a user
     */
    async listPending(userId: string | number, email: string, adminRole?: any): Promise<any[]> {
        const conditions = [
            eq(approvalRequests.status, "pending"),
            // Filter out snoozed requests until the time has passed
            sql`(${approvalRequests.snoozedUntil} IS NULL OR ${approvalRequests.snoozedUntil} < NOW())`
        ];

        // Authorization conditions
        const isSuperAdmin = adminRole?.isSuperAdmin;
        const isOrgAdmin = adminRole?.isOrgAdmin;

        let authConditions: any[];

        // Super admins and org admins see all approvals in their scope
        // Regular users see only approvals assigned to them
        if (isSuperAdmin || isOrgAdmin) {
            authConditions = [];
        } else {
            // An Executive also sees QuickBooks requests addressed to the
            // Executives of a project they hold that finance role on.
            const { executiveApproverAddresses } = await import("@domain/projects/core/finance-roles.service.js");
            const roleAddresses = await executiveApproverAddresses(adminRole?.organizationId ?? null, userId.toString());
            authConditions = [
                or(
                    eq(approvalRequests.approverId, userId.toString()),
                    eq(approvalRequests.approverEmail, email || ""),
                    ...(roleAddresses.length ? [inArray(approvalRequests.approverEmail, roleAddresses)] : [])
                )
            ];
        }

        // Scope by org. Super admins scoped to their current org; only system processes
        // should ever see cross-org data, and that path doesn't go through this method.
        // Include approvals with null organizationId (created without org context)
        conditions.push(...getOrgConditions({ organizationId: adminRole?.organizationId ?? null, isSuperAdmin: false } as any, approvalRequests, false));

        const results = await db.select({
            approval: approvalRequests,
            jobName: jobs.name,
            jobType: jobs.type,
            // Try to find missionId from either dynamic mission run OR supervisor pipeline execution
            missionIdFromRun: missionRuns.missionId,
            missionIdFromPipe: pipelineExecutions.missionId,
            // The operational cycle hangs off mission_runs. The dynamic path already
            // joins that table; the supervisor path reaches it one hop further out,
            // through pipeline_executions.mission_run_id.
            cycleIdFromRun: missionRuns.cycleId,
            cycleIdFromPipe: supervisorRuns.cycleId
        })
            .from(approvalRequests)
            .leftJoin(jobs, eq(approvalRequests.jobId, jobs.id))
            // Join for Dynamic Missions (executionId = missionRunId or prefixed)
            // Optimization: Use substring() instead of regexp_replace() for better performance
            .leftJoin(missionRuns, sql`CASE
                WHEN ${approvalRequests.executionId} ~ '^[0-9]+$' THEN CAST(${approvalRequests.executionId} AS INTEGER) = ${missionRuns.id}
                WHEN ${approvalRequests.executionId} ~ ':[0-9]+$' THEN CAST(substring(${approvalRequests.executionId}, position(':' IN ${approvalRequests.executionId}) + 1) AS INTEGER) = ${missionRuns.id}
                ELSE FALSE
            END`)
            // Join for Supervisor Missions (executionId = pipelineStepExecutionId or prefixed)
            .leftJoin(pipelineStepExecutions, sql`CASE
                WHEN ${approvalRequests.executionId} ~ '^[0-9]+$' THEN CAST(${approvalRequests.executionId} AS INTEGER) = ${pipelineStepExecutions.id}
                WHEN ${approvalRequests.executionId} ~ ':[0-9]+$' THEN CAST(substring(${approvalRequests.executionId}, position(':' IN ${approvalRequests.executionId}) + 1) AS INTEGER) = ${pipelineStepExecutions.id}
                ELSE FALSE
            END`)
            .leftJoin(pipelineExecutions, eq(pipelineStepExecutions.pipelineExecutionId, pipelineExecutions.id))
            .leftJoin(supervisorRuns, eq(pipelineExecutions.missionRunId, supervisorRuns.id))
            .where(
                authConditions.length > 0
                    ? and(...conditions, or(...authConditions))
                    : and(...conditions)
            )
            .orderBy(desc(approvalRequests.createdAt));

        // Enhancing with additional metadata for display
        return results.map(r => ({
            ...r.approval,
            // Map names for frontend compatibility (DecisionInbox.tsx expects pipelineName/stepName)
            // Approval envelopes carry a human title ("gdocs create document: <name>");
            // without it the row falls back to "Run gdocs_create_document".
            pipelineName: r.jobType?.toUpperCase() || APPROVAL_KIND_LABELS[(r.approval.toolArgs as any)?.kind] || r.approval.toolName?.toUpperCase() || (r.approval.modifiedOutput as any)?.tool?.toUpperCase() || "SYSTEM",
            stepName: r.jobName || (r.approval.toolArgs as any)?.description || (r.approval.toolArgs as any)?.intent || (r.approval.toolArgs as any)?.title || (r.approval.toolName ? `Run ${r.approval.toolName}` : null) || (r.approval.modifiedOutput as any)?.description || "Verification Required",
            contextSnapshot: r.approval.modifiedOutput || (r.approval.toolName ? { tool: r.approval.toolName, toolArgs: r.approval.toolArgs } : null), // Frontend expects contextSnapshot
            pipelineExecutionId: r.approval.executionId, // Map legacy ID
            missionId: r.missionIdFromRun || r.missionIdFromPipe, // Surface the missionId to frontend
            cycleId: r.cycleIdFromRun ?? r.cycleIdFromPipe ?? null, // Lets a cycle-scoped inbox tell its own work apart
            isEvolutionary: (r.approval as any).isEvolutionary // Add the badge field
        }));
    },

    /**
     * Get detail for a specific approval
     */
    async getById(requestId: number, userId: string | number, email: string, organizationId?: number, adminRole?: any) {
        const conditions: any[] = [eq(approvalRequests.id, requestId)];
        conditions.push(...getOrgConditions({ organizationId: organizationId ?? null, isSuperAdmin: false } as any, approvalRequests, false));

        const [request] = await db.select()
            .from(approvalRequests)
            .where(and(...conditions))
            .limit(1);

        if (!request) throw new NotFoundError("Approval request not found");

        const isDesignatedApprover = request.approverId === userId.toString() || request.approverEmail === email
            || await isFinanceRoleApprover(request, userId);
        const isSuperAdmin = adminRole?.isSuperAdmin;
        const isOrgAdminForThisOrg = adminRole?.isOrgAdmin && adminRole.organizationId === request.organizationId;
        if (!isDesignatedApprover && !isSuperAdmin && !isOrgAdminForThisOrg) {
            throw new ForbiddenError("You are not authorized to view this approval request");
        }

        // Try to enrich with job info
        const [jobInfo] = request.jobId
            ? await db.select({
                jobName: jobs.name,
                jobType: jobs.type,
                jobConfig: jobs.config
            })
                .from(jobs)
                .where(eq(jobs.id, request.jobId))
                .limit(1)
            : [];

        // --- Phase 2D: Baseline Resolution ---
        let baselineSnapshot: any = null;
        try {
            const executionIdStr = request.executionId || "";
            const matches = executionIdStr.match(/\d+/g);
            const resolvedId = matches ? parseInt(matches[matches.length - 1]) : -1;

            if (resolvedId > 0) {
                // Find the step execution to get the step ID
                const [stepExec] = await db.select({ 
                    pipelineStepId: pipelineStepExecutions.pipelineStepId,
                    missionId: pipelineExecutions.missionId 
                })
                    .from(pipelineStepExecutions)
                    .leftJoin(pipelineExecutions, eq(pipelineStepExecutions.pipelineExecutionId, pipelineExecutions.id))
                    .where(eq(pipelineStepExecutions.id, resolvedId))
                    .limit(1);

                if (stepExec?.pipelineStepId) {
                    const [primary] = await db.select()
                        .from(snapshots)
                        .where(and(
                            eq(snapshots.entityType, "pipeline_step"),
                            eq(snapshots.entityId, stepExec.pipelineStepId),
                            eq(snapshots.isPrimary, true)
                        ))
                        .limit(1);
                    
                    if (primary) {
                        baselineSnapshot = primary;
                    }
                }
            }
        } catch (err) {
            logger.warn("Failed to fetch baseline snapshot for approval detail:", err as any);
        }

        return {
            ...request,
            pipelineName: jobInfo?.jobType?.toUpperCase() || APPROVAL_KIND_LABELS[(request.toolArgs as any)?.kind] || request.toolName?.toUpperCase() || (request.modifiedOutput as any)?.tool?.toUpperCase() || "SYSTEM",
            stepName: jobInfo?.jobName || (request.toolArgs as any)?.description || (request.toolArgs as any)?.intent || (request.toolArgs as any)?.title || (request.toolName ? `Run ${request.toolName}` : null) || (request.modifiedOutput as any)?.description || "Verification Required",
            contextSnapshot: request.modifiedOutput || (request.toolName ? { tool: request.toolName, toolArgs: request.toolArgs } : null),
            jobName: jobInfo?.jobName,
            jobConfig: jobInfo?.jobConfig,
            baselineSnapshot: (baselineSnapshot?.data as Record<string, any> | undefined) || null,
            baselineLabel: baselineSnapshot?.label || "Gold Baseline"
        };
    },

    /**
     * Process an approval decision
     */
    async processDecision(requestId: number, decisionData: {
        decision: 'approved' | 'rejected',
        comments?: string,
        modifiedOutput?: any
    }, userId: string | number, userEmail: string, adminRole?: any, options: {
        /** Set only by Form Studio stage requests, once the stage's answers are locked. */
        formStageSubmitted?: boolean;
        /** The decider is an external person with a task link and no user row, so the request keeps its approver. */
        submittedExternally?: boolean;
    } = {}): Promise<any> {
        const { decision, comments, modifiedOutput } = decisionData;
        
        // Fetch current request
        const [request] = await db.select()
            .from(approvalRequests)
            .where(eq(approvalRequests.id, requestId))
            .limit(1);

        if (!request) throw new NotFoundError("Approval request not found");

        if (request.status !== 'pending') {
            // Re-check an uncertain calendar create without issuing another write.
            const meta = request.toolArgs as any;
            if (request.status === 'approved' && decision === 'approved' && meta?.kind === 'calendar_action' && meta.actionName === 'gcal_create_event') {
                const { canDecideApproval } = await import('./approval-authority.js');
                if (!canDecideApproval(request, userId, userEmail, adminRole)) throw new ForbiddenError('You are not the designated approver for this request');
                const stored = request.modifiedOutput as any;
                if (stored?.outcome?.success === true) return { status: 'approved', calendarAction: stored.outcome };
                const { reconcileCalendarApproval, calendarFailure } = await import('@domain/tools/v1/capabilities/google-calendar.js');
                let outcome;
                try {
                    const result = await reconcileCalendarApproval(meta.args, { organizationId: request.organizationId, projectId: meta.projectId,
                        sessionKey: meta.sessionKey, calendarWorkflow: meta.workflow }, request.id);
                    outcome = { success: true, state: 'succeeded', recovered: true, result };
                } catch (error) { outcome = { ...calendarFailure(error), state: 'outcome_unknown' }; }
                const saved = await db.update(approvalRequests).set({ modifiedOutput: { ...meta,
                    ...(meta.workflow ? { workflow: { ...meta.workflow, state: outcome.state } } : {}), outcome } })
                    .where(and(eq(approvalRequests.id, request.id), eq(approvalRequests.organizationId, requiredApprovalOrg(request)),
                        request.modifiedOutput == null ? isNull(approvalRequests.modifiedOutput) : eq(approvalRequests.modifiedOutput, request.modifiedOutput)))
                    .returning({ id: approvalRequests.id });
                if (!saved.length) {
                    const [current] = await db.select({ modifiedOutput: approvalRequests.modifiedOutput }).from(approvalRequests)
                        .where(and(eq(approvalRequests.id, request.id), eq(approvalRequests.organizationId, requiredApprovalOrg(request)))).limit(1);
                    outcome = (current?.modifiedOutput as any)?.outcome ?? outcome;
                }
                return { status: 'approved', calendarAction: outcome };
            }
            return { status: request.status, message: "This request has already been resolved." };
        }

        // Security check. The rule is shared with Form Studio stage requests, which
        // must apply it before a stage's answers are locked (see approval-authority.ts).
        const { canDecideApproval } = await import("./approval-authority.js");
        if (!canDecideApproval(request, userId, userEmail, adminRole) && !await isFinanceRoleApprover(request, userId)) {
            throw new ForbiddenError("You are not the designated approver for this request");
        }

        // A QuickBooks write is checked against the approver's finance roles
        // (shared/finance-roles.ts) BEFORE the decision is recorded: failing after
        // it would leave an "approved" request whose write never ran. Rejecting
        // needs no finance role.
        if (decision === 'approved' && (request.toolArgs as any)?.kind === 'quickbooks_action') {
            await assertQuickBooksApprover(request, userId);
        }

        // Escalated outbound sends (commitment_or_legal sensitivity, or a draft
        // the caller flagged) need a second pair of eyes: the person who asked
        // for the draft cannot self-approve it — only an org or super admin can.
        const outboundMeta = (request.toolArgs as any)?.kind === "outbound_message" ? request.toolArgs as any : null;
        if (decision === "approved" && outboundMeta?.escalatedReview && !(adminRole?.isSuperAdmin || (adminRole?.isOrgAdmin && adminRole.organizationId === request.organizationId))) {
            throw new ForbiddenError("This send is escalated — an org admin must approve it");
        }

        // A Form Studio stage request is completed by submitting the stage's answers
        // (form-studio-stage-requests.service.ts). Approving it here would resume the
        // cycle with the stage never filled in.
        if (decision === 'approved' && (request.modifiedOutput as any)?.kind === 'form_stage' && !options?.formStageSubmitted) {
            throw new BadRequestError("Fill in this form stage to complete it. Approving it without answers would skip the stage.");
        }

        // Validate a reviewed sender BEFORE claiming the decision, so missing or stale
        // authorization leaves the draft pending and cannot consume its approval.
        let confirmedEmailAccount: { connectorId: number; email: string; provider: "google" | "microsoft"; remember?: boolean } | undefined;
        if (decision === "approved" && outboundMeta?.channel === "email" && !["send_agentmail", "reply_agentmail"].includes(outboundMeta.sendTool ?? "")) {
            const { outboundEmailAccounts } = await import("./outbound-email-accounts.service.js");
            const projectId = await outboundEmailAccounts.projectForRoom(requiredApprovalOrg(request), outboundMeta.sessionKey);
            confirmedEmailAccount = await outboundEmailAccounts.confirm(requiredApprovalOrg(request), String(userId), modifiedOutput?.emailAccount, projectId);
        }

        // Update record. Conditional on still being pending: two concurrent
        // decisions both pass the status check above, and the side effects
        // below (an outbound send, a pipeline resume) must run once.
        const claimed = await db.update(approvalRequests)
            .set({
                status: decision,
                decisionAt: new Date(),
                comments: comments || null,
                // A task link's external submitter has no user row to name.
                approverId: options.submittedExternally ? request.approverId : userId.toString(),
                modifiedOutput: decision === 'approved' && (request.toolArgs as any)?.kind === 'calendar_action'
                    ? { ...(request.toolArgs as any), outcome: { success: false, state: 'executing' },
                        ...((request.toolArgs as any).workflow ? { workflow: { ...(request.toolArgs as any).workflow, state: 'executing' } } : {}) }
                    : modifiedOutput || request.modifiedOutput
            })
            .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.status, 'pending')))
            .returning({ id: approvalRequests.id });
        if (claimed.length === 0) {
            const [current] = await db.select({ status: approvalRequests.status })
                .from(approvalRequests).where(eq(approvalRequests.id, requestId)).limit(1);
            return { status: current?.status ?? "resolved", message: "This request has already been resolved." };
        }

        // Signal immediate wake-up
        await decisionRouter.notifyDecision(requestId);

        // Publish decision:resolved event for real-time SSE delivery
        if (request.organizationId != null) {
            await decisionRouter.publishResolution(requestId, request.organizationId, decision);
        }

        // Invalidate cached approval counts & blocked work
        try {
            const { cacheService } = await import("@domain/cache/cache.service.js");
            await cacheService.invalidate("approval:*");
            if (request.organizationId != null) {
                await cacheService.invalidateByTag(`org:${request.organizationId}`);
                await cacheService.invalidateByTag('approval-count');
            }
        } catch (err: any) {
            logger.warn("Failed to invalidate approval cache:", err.message);
        }

        // Capture decision to knowledge graph for organizational learning
        try {
            const { hilKnowledgeBridge } = await import("./hil-knowledge-bridge.js");
            await hilKnowledgeBridge.captureDecision(requestId);
        } catch (err: any) {
            logger.warn("HIL knowledge capture error:", err.message);
        }

        // Execute an approved assembly deployment — actually scaffold the app.
        //
        // Read from toolArgs as well as modifiedOutput: the crew proposal tools
        // store their envelope on toolArgs, so dispatching only on modifiedOutput
        // (as the mission branch below does) meant an approved deployment was
        // marked `approved` and nothing was ever built.
        let assembly: any;
        try {
            const meta = modifiedOutput || request.modifiedOutput || request.toolArgs;
            const isAssembly = meta?.kind === "assembly_deployment"
                || request.toolName === "propose_assembly_deployment";
            if (decision === "approved" && isAssembly) {
                const { assemblyDeploymentService } = await import("../../scaffold/assembly-deployment.service.js");
                assembly = await assemblyDeploymentService.execute({
                    appName: meta?.appName,
                    displayName: meta?.displayName,
                    packs: meta?.packs,
                    projectKey: meta?.projectKey ?? null,
                    projectId: meta?.projectId ?? null,
                    organizationId: request.organizationId ?? null,
                    // Attributed to whoever approved it, not to the agent that
                    // drafted the proposal — approval is the act that created it.
                    createdBy: userEmail ?? request.approverEmail ?? null,
                    publish: meta?.publish === true,
                    accessPolicy: meta?.accessPolicy === "public" ? "public" : "internal_only",
                    designStyleId: meta?.designStyleId ?? null,
                    aiEmbellishment: meta?.aiEmbellishment ?? null,
                });
            }
        } catch (err: any) {
            // The decision is already persisted; surface the failure to the
            // caller instead of losing it, but never fail the decision itself.
            logger.error("Assembly deployment execution error:", err?.message || err);
            assembly = { success: false, appName: "", executedPacks: [], error: err?.message || String(err) };
        }

        // Execute an approved adapter binding — actually bind the resource.
        //
        // Read from toolArgs like the assembly branch above: the proposal tool
        // stores its envelope there, and dispatching only on modifiedOutput
        // would mark the request approved while binding nothing.
        let adapterBinding: any;
        try {
            const meta = modifiedOutput || request.modifiedOutput || request.toolArgs;
            const isBinding = meta?.kind === "adapter_binding"
                || request.toolName === "propose_adapter_binding";
            if (decision === "approved" && isBinding) {
                if (meta?.projectId == null) throw new Error("The proposal carries no project to bind to.");
                const { projectBindingService } = await import("../project-binding.service.js");
                adapterBinding = await projectBindingService.bind({
                    orgId: requiredApprovalOrg(request),
                    projectId: Number(meta.projectId),
                    resourceKind: meta.resourceKind,
                    resourceKey: meta.resourceKey,
                    resourceName: meta.resourceName ?? null,
                    resourceType: meta.resourceType ?? null,
                    externalId: meta.externalId ?? null,
                    webUrl: meta.webUrl ?? null,
                    // Attributed to the approver, not the agent that drafted it.
                    boundBy: userEmail ?? request.approverEmail ?? null,
                });
            }
        } catch (err: any) {
            // The decision is already persisted; surface the failure rather than
            // losing it, and never fail the decision itself.
            logger.error("Adapter binding execution error:", err?.message || err);
            adapterBinding = { success: false, error: err?.message || String(err) };
        }

        // Execute an approved attachment promotion — file it in the project KB.
        let attachmentPromotion: any;
        try {
            const meta = modifiedOutput || request.modifiedOutput || request.toolArgs;
            const isPromotion = meta?.kind === "attachment_promotion"
                || request.toolName === "propose_attachment_promotion";
            if (decision === "approved" && isPromotion) {
                if (meta?.projectId == null) throw new Error("The proposal carries no project to file into.");
                const { attachmentService } = await import("@domain/knowledge/core/attachment.service.js");
                const files = await attachmentService.listForProject(
                    requiredApprovalOrg(request),
                    Number(meta.projectId),
                );
                const file = files.find((f: any) => f.id === Number(meta.attachmentId));
                if (!file) throw new Error(`Attachment ${meta.attachmentId} is no longer in that project.`);

                // Read the full text rather than the preview: the preview is 280
                // characters, and filing that would store a stub while claiming
                // to have filed the document.
                const { db } = await import("@server/database_service.js");
                const { fileBlobs, crewAttachments } = await import("@shared/schema/index.js");
                const { and, eq } = await import("drizzle-orm");
                const [blob] = await db
                    .select({ parsedText: fileBlobs.parsedText })
                    .from(crewAttachments)
                    .innerJoin(fileBlobs, eq(fileBlobs.id, crewAttachments.blobId))
                    .where(and(
                        eq(crewAttachments.id, Number(meta.attachmentId)),
                        eq(crewAttachments.orgId, requiredApprovalOrg(request)),
                    ))
                    .limit(1);

                if (!blob?.parsedText?.trim()) throw new Error("That attachment has no readable text to file.");

                const { documentService } = await import("@domain/knowledge/core/extraction/document-service.js");
                attachmentPromotion = await documentService.createDocument(
                    {
                        title: meta.title || file.displayName,
                        summary: `Filed from an attachment in ${meta.projectKey || "this project"}.`,
                        sourceType: "attachment",
                        textContent: blob.parsedText,
                        // Stays scoped to the project. Org-wide is a separate,
                        // deliberate act, not a side effect of filing.
                        projectId: Number(meta.projectId),
                    } as any,
                    {
                        organizationId: requiredApprovalOrg(request),
                        userId: userEmail ?? request.approverEmail ?? "approver",
                        isSuperAdmin: false,
                        isOrgAdmin: false,
                    } as any,
                );
            }
        } catch (err: any) {
            logger.error("Attachment promotion execution error:", err?.message || err);
            attachmentPromotion = { success: false, error: err?.message || String(err) };
        }

        let crewRecord: any;
        try {
            const meta = modifiedOutput || request.modifiedOutput || request.toolArgs;
            if (decision === "approved" && ["crew_decision", "crew_claim", "crew_commitment"].includes(meta?.kind)) {
                const { crewSessions, crewDecisions, crewClaims, crewCommitments } = await import("@shared/schema/index.js");
                const [room] = await db.select().from(crewSessions).where(and(eq(crewSessions.organizationId, requiredApprovalOrg(request)), eq(crewSessions.sessionKey, meta.sessionKey))).limit(1);
                if (!room) throw new Error("The originating CREW room no longer exists.");
                if (meta.kind === "crew_decision") {
                    [crewRecord] = await db.insert(crewDecisions).values({ sessionId: room.id, organizationId: requiredApprovalOrg(request), statement: meta.statement, rationale: meta.rationale ?? null, alternatives: meta.alternatives ?? [], ontologyRefs: meta.ontologyRefs ?? [], confidence: meta.confidence ?? null, status: "accepted", createdBy: String(userId) }).returning();
                } else if (meta.kind === "crew_claim") {
                    [crewRecord] = await db.insert(crewClaims).values({ sessionId: room.id, organizationId: requiredApprovalOrg(request), claim: meta.claim, status: meta.evidence?.length ? "supported" : "unverified", confidence: meta.confidence ?? null, evidence: meta.evidence ?? [], createdBy: String(userId) }).returning();
                } else {
                    [crewRecord] = await db.insert(crewCommitments).values({ sessionId: room.id, organizationId: requiredApprovalOrg(request), title: meta.title, detail: meta.detail ?? null, ownerType: meta.ownerType ?? "user", ownerId: meta.ownerId ?? String(userId), dueAt: meta.dueAt ? new Date(meta.dueAt) : null, ontologyRefs: meta.ontologyRefs ?? [], createdBy: String(userId) }).returning();
                }
            }
        } catch (err: any) {
            logger.error("CREW record approval execution error:", err?.message || err);
            crewRecord = { success: false, error: err?.message || String(err) };
        }

        // An outbound email or Slack message drafted by propose_outbound_message:
        // approving sends what the card showed. Read from the stored proposal only —
        // the approver's modifiedOutput is not trusted here, or an edit at approval
        // time could redirect the recipients.
        let googleWorkspaceAction: any;
        const workspaceMeta = request.toolArgs as any;
        if (workspaceMeta?.kind === 'google_workspace_action' || workspaceMeta?.kind === 'youtube_action' || workspaceMeta?.kind === 'amazon_purchase' || workspaceMeta?.kind === 'flighthub_booking' || workspaceMeta?.kind === 'quickbooks_action') {
            if (decision === 'approved') {
                try {
                    const executor = workspaceMeta.kind === 'youtube_action'
                        ? (await import('@domain/tools/v1/capabilities/youtube.js')).executeYouTubeApproval
                        : workspaceMeta.kind === 'amazon_purchase'
                        ? (await import('@domain/tools/v1/capabilities/amazon.js')).executeAmazonPurchaseApproval
                        : workspaceMeta.kind === 'quickbooks_action'
                        ? (await import('@domain/tools/v1/capabilities/quickbooks.js')).executeQuickBooksApproval
                        : workspaceMeta.kind === 'flighthub_booking'
                        ? (await import('@domain/tools/v1/capabilities/flighthub.js')).executeFlightHubBookingApproval
                        : (await import('@domain/tools/v1/capabilities/google-mail-docs.js')).executeMailDocsApproval;
                    const result = await executor(workspaceMeta.actionName, workspaceMeta.args, { organizationId: request.organizationId, projectId: workspaceMeta.projectId, userId: String(userId), approvalRequestId: requestId });
                    googleWorkspaceAction = { success: true, result };
                } catch (err: any) { googleWorkspaceAction = { success: false, error: err?.message || String(err) }; }
            } else googleWorkspaceAction = { success: true, discarded: true };
            await db.update(approvalRequests).set({ modifiedOutput: { ...workspaceMeta, outcome: googleWorkspaceAction } }).where(eq(approvalRequests.id, request.id));
        }
        let calendarAction: any;
        const calendarMeta = request.toolArgs as any;
        if (calendarMeta?.kind === 'calendar_action') {
            if (decision === 'approved') {
                try {
                    const { executeCalendarApproval } = await import('@domain/tools/v1/capabilities/google-calendar.js');
                    const result = await executeCalendarApproval(calendarMeta.actionName, calendarMeta.args, { organizationId: request.organizationId, projectId: calendarMeta.projectId,
                        sessionKey: calendarMeta.sessionKey, calendarWorkflow: calendarMeta.workflow }, request.id);
                    calendarAction = { success: true, state: 'succeeded', result };
                } catch (err: any) {
                    const { calendarFailure } = await import('@domain/tools/v1/capabilities/google-calendar.js');
                    calendarAction = calendarFailure(err);
                }
            } else calendarAction = { success: true, state: 'cancelled', discarded: true };
            await db.update(approvalRequests).set({ modifiedOutput: { ...calendarMeta,
                ...(calendarMeta.workflow ? { workflow: { ...calendarMeta.workflow, state: calendarAction.state } } : {}), outcome: calendarAction } })
                .where(and(eq(approvalRequests.id, request.id), eq(approvalRequests.organizationId, requiredApprovalOrg(request))));
        }
        let appRecordAction: any;
        const appRecordMeta = request.toolArgs as any;
        if (appRecordMeta?.kind === 'app_record_action') {
            if (decision === 'approved') {
                try {
                    const { executeAppRecordAction } = await import('@domain/apps/core/app-records-writer.service.js');
                    const result = await executeAppRecordAction({
                        organizationId: requiredApprovalOrg(request),
                        appId: appRecordMeta.app.id,
                        collection: appRecordMeta.collection,
                        action: appRecordMeta.action,
                        recordId: appRecordMeta.recordId,
                        data: appRecordMeta.data,
                        userId: String(userId),
                    });
                    appRecordAction = result;
                } catch (err: any) {
                    appRecordAction = { success: false, error: err?.message || String(err) };
                }
            } else {
                appRecordAction = { success: true, discarded: true };
            }
            await db.update(approvalRequests).set({ modifiedOutput: { ...appRecordMeta, outcome: appRecordAction } })
                .where(and(eq(approvalRequests.id, request.id), eq(approvalRequests.organizationId, requiredApprovalOrg(request))));
        }
        let outboundMessage: any;
        try {
            if ((request.modifiedOutput as any)?.kind === "outbound_message" || (request.toolArgs as any)?.kind === "outbound_message") {
                const { outboundMessageService } = await import("./outbound-message.service.js");
                // The approver may edit body/subject (Edit & approve). Nothing
                // else on modifiedOutput is trusted — recipients and channel
                // come from the stored proposal or the card could be redirected.
                const edits = modifiedOutput && typeof modifiedOutput === "object"
                    ? { body: typeof modifiedOutput.body === "string" ? modifiedOutput.body : undefined,
                        subject: typeof modifiedOutput.subject === "string" ? modifiedOutput.subject : undefined,
                        emailAccount: confirmedEmailAccount }
                    : undefined;
                const outcome = await outboundMessageService.onOutboundMessageDecision(
                    { id: request.id, organizationId: request.organizationId, modifiedOutput: (request.modifiedOutput as any)?.kind === "outbound_message" ? request.modifiedOutput : request.toolArgs },
                    decision,
                    { userId: String(userId), email: userEmail ?? null },
                    edits,
                );
                if (outcome.handled) outboundMessage = outcome;
            }
        } catch (err: any) {
            logger.error("Outbound message execution error:", err?.message || err);
            outboundMessage = { success: false, error: err?.message || String(err) };
        }

        // An action a Form Studio decision rule raised: approving starts its pipeline or
        // sends its message, rejecting is recorded on the response. Read from the stored
        // proposal only. The approver's modifiedOutput is not trusted here, or an edit
        // at approval time could point the action at a different pipeline.
        let formAction: any;
        try {
            if ((request.modifiedOutput as any)?.kind === "form_action") {
                const { formStudioRuntime } = await import("@domain/pipeline/core/form-studio-runtime.service.js");
                const outcome = await formStudioRuntime.onActionDecision(
                    { id: request.id, organizationId: request.organizationId, modifiedOutput: request.modifiedOutput },
                    decision,
                    { userId: String(userId), email: userEmail ?? null, comments: comments ?? null },
                );
                if (outcome.handled) {
                    const { completion: _completion, ...reported } = outcome;
                    formAction = reported;
                }
            }
        } catch (err: any) {
            logger.error("Form action execution error:", err?.message || err);
            formAction = { success: false, error: err?.message || String(err) };
        }

        // A canvas workflow node's Run (workflow-nodes.service.ts): approving runs its tool
        // through the governed tool executor, rejecting is recorded on the node. Read from
        // the stored request only, so an edit at approval time cannot change the tool or
        // what it is given.
        let workflowNodeRun: any;
        try {
            if ((request.modifiedOutput as any)?.kind === "workflow_node_run") {
                const { workflowNodes } = await import("@domain/knowledge/core/calculations/workflow-nodes.service.js");
                const outcome = await workflowNodes.onRunDecision(
                    { id: request.id, organizationId: request.organizationId, modifiedOutput: request.modifiedOutput },
                    decision,
                    { userId: String(userId), email: userEmail ?? null, adminRole },
                );
                if (outcome.handled) workflowNodeRun = outcome;
            }
        } catch (err: any) {
            logger.error("Workflow node run error:", err?.message || err);
            workflowNodeRun = { success: false, error: err?.message || String(err) };
        }

        // A pipeline run an agent proposed (pipeline-run-proposals.ts): approving starts the
        // run, rejecting records it. Read from the stored request only, so an edit at
        // approval time cannot change the pipeline or its inputs.
        let pipelineRun: any;
        try {
            if ((request.modifiedOutput as any)?.kind === "pipeline_run") {
                const { pipelineRunProposals } = await import("@domain/pipeline/core/pipeline-run-proposals.js");
                const outcome = await pipelineRunProposals.onRunDecision(
                    { id: request.id, organizationId: request.organizationId, modifiedOutput: request.modifiedOutput },
                    decision,
                    { userId: String(userId), email: userEmail ?? null, adminRole },
                );
                if (outcome.handled) pipelineRun = outcome;
            }
        } catch (err: any) {
            logger.error("Pipeline run proposal error:", err?.message || err);
            pipelineRun = { success: false, error: err?.message || String(err) };
        }

        // A Media Studio take (media-studio.service.ts): approving sends its render to
        // fal.ai, rejecting records that it was not approved. Read from the stored take
        // only, so an edit at approval time cannot change what is rendered or its cost.
        let mediaTakeRender: any;
        try {
            if ((request.modifiedOutput as any)?.kind === "media_take_render") {
                const { mediaStudio } = await import("@domain/media-studio/core/media-studio.service.js");
                const outcome = await mediaStudio.onTakeDecision(
                    { id: request.id, organizationId: request.organizationId, modifiedOutput: request.modifiedOutput },
                    decision,
                    { userId: String(userId), email: userEmail ?? null },
                );
                if (outcome.handled) mediaTakeRender = outcome;
            }
        } catch (err: any) {
            logger.error("Media take render error:", err?.message || err);
            mediaTakeRender = { success: false, error: err?.message || String(err) };
        }

        // Handle mission proposals & synthesis
        try {
            const meta = modifiedOutput || request.modifiedOutput;
            const kind = meta?.kind;
            if (kind === "mission_proposal" || kind === "mission_synthesis" || kind === "research_mission") {
                const { missionProposalService } = await import("../../mission/core/mission-proposal.service.js");
                if (decision === "approved") {
                    if (kind === "mission_proposal") {
                        await missionProposalService.executeLaunch(requestId, request, meta, userEmail);
                    } else if (kind === "mission_synthesis") {
                        await missionProposalService.executeSynthesis(requestId, request, meta, userEmail);
                    } else if (kind === "research_mission") {
                        await missionProposalService.executeResearch(requestId, request, meta, userEmail);
                    }
                }
            }
        } catch (err: any) {
            logger.warn("Mission proposal execution error:", err);
        }

        // Handle mission-run synchronization and recovery strategies
        try {
            const missions = await approvalService.getMissionsForApproval(request);
            if (missions.length > 0) {
                for (const m of missions) {
                    if (decision === 'approved' && modifiedOutput?.strategic_decision) {
                        await missionRunService.applyRecoveryStrategy(
                            m.id,
                            modifiedOutput.strategic_decision,
                            comments || "",
                            userEmail,
                            modifiedOutput
                        );
                    } else {
                        const decisionLabel = modifiedOutput?.recovery_strategy || modifiedOutput?.decision || decision;
                        await missionRunService.checkpoint({
                            missionRunId: m.id,
                            missionId: m.missionId!,
                            missionContext: {
                                hil_modified_output: modifiedOutput,
                                hil_comments: comments,
                                hil_decision: decision
                            },
                            reason: `checkpoint:hil_decision:${decisionLabel}`,
                            changedBy: userEmail,
                        });
                    }
                }
                
                // CRITICAL: Trigger resumption for any missions that were waiting on this approval
                await missionRunService.resumeIfWaitingOnApproval(requestId);
            } else {
                logger.warn(`No missions found for approval request ${requestId} (executionId: ${request.executionId})`);
            }
        } catch (err: any) {
            logger.warn("Mission sync error:", err);
        }

        // Advance the suspended pipeline step and resume execution. The mission
        // resumption above only updates *mission* state — it does NOT progress the
        // pipeline, so without this a Decision-Inbox approval marks the request
        // resolved while the step stays `waiting_external_input` forever and the
        // mission hangs.
        // request.executionId is the suspended step-execution id.
        try {
            await approvalService.resumeSuspendedStep(request, { decision, comments, modifiedOutput });
        } catch (err: any) {
            // A pipeline-resume failure must not abort the whole decision (status is
            // already persisted) nor block the Copilot agent-tool resume below.
            logger.warn("Suspended-step resume error:", err?.message || err);
        }

        // Resume an approved Copilot/Assistant agent-tool action. When the
        // Copilot decision-router suspends a write (update_job, add_dataset_items,
        // …) for approval it stores {tool, params, moltSessionId} on the request's
        // modifiedOutput. The blocking `requestDecision` poll only waits ~30s, so a
        // decision made later has no live agent turn to carry the action out — the
        // request just gets marked `approved` and nothing happens. Re-invoke the
        // agent so the approved action actually reaches an outcome.
        //
        // This is AWAITED (not fire-and-forget) so the approve response can carry
        // the outcome straight back to the surface the user approved from, letting
        // the Assistant show the result live instead of only on the next reload.
        // It is safe to await: the >45s guard inside means this only runs for late
        // approvals whose original agent turn has already timed out — early
        // approvals are resumed in-place by `notifyDecision` above and return here
        // fast. Non-Copilot approvals (no modifiedOutput.tool) also return fast.
        // Wrapped so a resume failure never fails the (already-persisted) decision.
        let resumedOutcome: string | undefined;
        let resumedTool: string | undefined;
        try {
            const resume = await approvalService.resumeApprovedAssistantAction(
                request,
                { decision, userId, userEmail, adminRole }
            );
            if (resume?.resumed) {
                resumedOutcome = resume.outcome;
                resumedTool = resume.tool;
            }
        } catch (err: any) {
            logger.warn("Assistant action resume error:", err?.message || err);
        }

        return {
            pipelineResumed: true,
            ...(formAction ? { formAction } : {}),
            ...(workflowNodeRun ? { workflowNodeRun } : {}),
            ...(pipelineRun ? { pipelineRun } : {}),
            ...(mediaTakeRender ? { mediaTakeRender } : {}),
            ...(resumedOutcome ? { resumedOutcome, resumedTool } : {}),
            // Carries the real scaffold outcome back to the surface that
            // approved it, so the room reports what was built instead of an
            // animation that always ends in success.
            ...(assembly ? { assembly } : {}),
            ...(adapterBinding ? { adapterBinding } : {}),
            ...(attachmentPromotion ? { attachmentPromotion } : {}),
            ...(crewRecord ? { crewRecord } : {}),
            ...(googleWorkspaceAction ? { googleWorkspaceAction } : {}),
            ...(calendarAction ? { calendarAction } : {}),
            ...(outboundMessage ? { outboundMessage } : {}),
            ...(appRecordAction ? { appRecordAction } : {}),
        };
    },

    /**
     * Re-run the Copilot agent turn for an approved agent-tool action.
     *
     * The Copilot decision-router suspends a gated write and records the intended
     * call on `request.modifiedOutput` as `{ tool, params, goal, moltSessionId }`.
     * `requestDecision` blocks only briefly; if the user approves after that window
     * the original agent turn is gone. This re-invokes `agentService.chat` in
     * Execute mode (confirmedExecution) with the approver's admin context so the
     * approved action is actually performed and its outcome persisted to the
     * session. No-op unless this is an approved Copilot agent-tool request.
     *
     * Double-execution guard: if the decision landed inside the original poll
     * window (~30s), `notifyDecision` already woke the still-blocked agent to run
     * the tool in-place, so re-running here would execute it twice. We therefore
     * only resume when enough time has elapsed that the original turn has certainly
     * timed out.
     */
    async resumeApprovedAssistantAction(
        request: any,
        opts: { decision: 'approved' | 'rejected'; userId: string | number; userEmail: string; adminRole?: any }
    ): Promise<{ resumed: boolean; outcome?: string; tool?: string }> {
        const { decision, userId, userEmail, adminRole } = opts;
        if (decision !== 'approved') return { resumed: false };

        const mo = request?.modifiedOutput as any;
        const sessionId: string | undefined = mo?.moltSessionId;
        const tool: string | undefined = mo?.tool;
        if (!sessionId || !tool) return { resumed: false }; // not a Copilot agent-tool approval

        // Only resume once the original blocking poll (~30s) has certainly expired,
        // otherwise `notifyDecision` already resumed the live agent in-place.
        const IN_PLACE_RESUME_WINDOW_MS = 45_000;
        const createdAtMs = request?.createdAt ? new Date(request.createdAt).getTime() : 0;
        const elapsedMs = createdAtMs ? Date.now() - createdAtMs : Number.MAX_SAFE_INTEGER;
        if (elapsedMs < IN_PLACE_RESUME_WINDOW_MS) {
            logger.info(
                `Assistant action ${request.id} approved within in-place window (${elapsedMs}ms) — live agent resumes it; skipping re-run.`
            );
            return { resumed: false };
        }

        // Resolve the org the action runs in: prefer the request's org, then the
        // approving admin's org, then the approver's default org.
        let organizationId: number | null = request?.organizationId ?? adminRole?.organizationId ?? null;
        if (organizationId == null) {
            try {
                const rows: any = await db.execute(
                    sql`select default_org_id from users where id = ${String(userId)} limit 1`
                );
                const row = Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
                if (row?.default_org_id != null) organizationId = Number(row.default_org_id);
            } catch { /* fall through with null org */ }
        }

        const params = mo?.params ?? {};
        const goal: string = mo?.goal || mo?.description || `Perform the approved ${tool} action.`;
        const message =
            `A previously pending action has just been APPROVED by ${userEmail}. ` +
            `Carry it out now using your tools and report the concrete outcome (IDs, before/after values).\n\n` +
            `Approved action: ${tool}\n` +
            `Parameters: ${JSON.stringify(params)}\n` +
            `Original goal: ${goal}`;

        const { agentService } = await import("../../agents/agent.service.js");
        const result = await agentService.chat({
            message,
            context: { sessionId, mode: "execute", confirmedExecution: true },
            userContext: {
                organizationId,
                userId: String(userId),
                isAdmin: true,
                isSuperAdmin: !!adminRole?.isSuperAdmin,
                isOrgAdmin: !!adminRole?.isOrgAdmin,
            },
        });

        const outcome = typeof result?.response === 'string'
            ? result.response
            : JSON.stringify(result?.response ?? "");

        logger.info(
            `Resumed approved Assistant action (request ${request.id}, tool ${tool}, session ${sessionId}).`
        );

        // Best-effort: persist the resumed outcome to the session transcript so it
        // is visible next time the user opens that Copilot conversation, in addition
        // to being returned to the approver for live display.
        try {
            await agentService.saveMessage(
                undefined,
                String(userId),
                'assistant',
                outcome,
                { resumedFromApproval: request.id, tool },
                sessionId,
                undefined,
                organizationId ?? undefined
            );
        } catch (err: any) {
            logger.warn("Assistant action resume transcript save failed:", err?.message || err);
        }

        return { resumed: true, outcome, tool };
    },

    /**
     * Advance a HIL step that suspended at `waiting_external_input` and resume its
     * pipeline execution. This is what makes a Decision-Inbox approval actually
     * progress the mission — `processDecision` previously only updated mission state,
     * leaving the step (and the cycle's finish_to_start gate) stuck forever. Mirrors
     * the external form's resume-step path. No-op unless the step is still waiting, so
     * it is safe even when the same HIL was already resolved via the form path.
     */
    async resumeSuspendedStep(
        request: { id: number; executionId?: string | null },
        decisionData: { decision: 'approved' | 'rejected'; comments?: string; modifiedOutput?: any }
    ): Promise<void> {
        const { decision, comments, modifiedOutput } = decisionData;
        const executionIdStr = request.executionId || "";
        const matches = executionIdStr.match(/\d+/g);
        const stepExecId = matches ? Number(matches[matches.length - 1]) : NaN;
        if (Number.isNaN(stepExecId)) return;
        // Copilot/Assistant approvals carry a non-pipeline executionId like
        // `alm_<session>_<epoch-ms>`; the last digit-run is a 13-digit timestamp
        // that overflows Postgres int4 and would throw here. These are not pipeline
        // steps at all, so bail before the (out-of-range) lookup.
        if (!Number.isSafeInteger(stepExecId) || stepExecId > 2147483647 || stepExecId < 1) return;

        const [stepExec] = await db.select()
            .from(pipelineStepExecutions)
            .where(eq(pipelineStepExecutions.id, stepExecId))
            .limit(1);
        if (!stepExec || stepExec.status !== 'waiting_external_input') return;

        const responses = {
            approved: decision === 'approved',
            approval: decision === 'approved',
            decision,
            comments: comments || "",
            policyDecision: decision,
            ...(modifiedOutput || {}),
        };

        try {
            await db.update(pipelineStepExecutions)
                .set({
                    output: JSON.stringify(modifiedOutput ?? responses),
                    status: decision === 'approved' ? 'success' : 'failed',
                    completedAt: new Date(),
                })
                .where(eq(pipelineStepExecutions.id, stepExecId));

            await missionRunService.resumeByStepExecutionId(stepExecId, responses);

            const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");
            await pipelineExecutor.resumePipelineExecution(stepExec.pipelineExecutionId, null, responses);
            logger.info(`[Approval] Resumed pipeline execution ${stepExec.pipelineExecutionId} after ${decision} (step ${stepExecId})`);
        } catch (err: any) {
            logger.error(`[Approval] Failed to resume pipeline after decision on step ${stepExecId}: ${err.message}`);
        }
    },

    /**
     * Snooze an approval request
     */
    async snooze(requestId: number, snoozedUntil: Date, userId: string | number, userEmail: string): Promise<any> {
        // Fetch current request
        const [request] = await db.select()
            .from(approvalRequests)
            .where(eq(approvalRequests.id, requestId))
            .limit(1);

        if (!request) throw new NotFoundError("Approval request not found");

        // Security check
        if (request.approverId !== userId.toString() && request.approverEmail !== userEmail) {
            throw new ForbiddenError("You are not the designated approver for this request");
        }

        // Update record (keep status as pending, but set snoozedUntil)
        // or set status to 'pending' and just set the timer. 
        // Based on DecisionRouter, we use status: "snoozed" to signal the waiting loop to exit.
        await db.update(approvalRequests)
            .set({
                status: "snoozed",
                snoozedUntil
            } as any)
            .where(eq(approvalRequests.id, requestId));

        // Signal immediate wake-up
        await decisionRouter.notifyDecision(requestId);

        // Publish decision:resolved event for real-time SSE delivery
        if (request.organizationId != null) {
            await decisionRouter.publishResolution(requestId, request.organizationId, 'snoozed');
        }

        logger.info(`Request ${requestId} snoozed by user ${userId} until ${snoozedUntil.toISOString()}`);
        
        return {
            status: "snoozed",
            requestId,
            snoozedUntil
        };
    },

    /**
     * Internal helper to find missions affected by an approval
     */
    async getMissionsForApproval(request: any): Promise<any[]> {
        const executionIdStr = request.executionId || "";
        
        // Extract numeric ID regardless of prefix (e.g., 'pipeline:593' -> '593')
        const matches = executionIdStr.match(/\d+/g);
        const resolvedId = matches ? parseInt(matches[matches.length - 1]) : -1;

        if (resolvedId > 0) {
            // Optimization: Parallelize the first two lookups instead of sequential awaits
            // Try DIRECT Mission Run (most common) and Pipeline Step Execution in parallel
            const [directRunResult, stepExecResult] = await Promise.all([
                // 1. Try DIRECT Mission Run first (most common for HIL_REQUEST in Dynamic mode)
                db.select()
                    .from(missionRuns)
                    .where(eq(missionRuns.id, resolvedId))
                    .limit(1),
                // 2. Fallback to Pipeline Step Execution (Supervisor/Pipeline flow)
                db.select({ pipelineExecutionId: pipelineStepExecutions.pipelineExecutionId })
                    .from(pipelineStepExecutions)
                    .where(eq(pipelineStepExecutions.id, resolvedId))
                    .limit(1),
            ]);

            // Return direct run if found (short-circuit the fallback path)
            const [directRun] = directRunResult;
            if (directRun) return [directRun];

            // Otherwise, resolve through pipeline execution
            const [stepExec] = stepExecResult;
            if (stepExec?.pipelineExecutionId) {
                const [pipeExec] = await db.select({ missionId: pipelineExecutions.missionId })
                    .from(pipelineExecutions)
                    .where(eq(pipelineExecutions.id, stepExec.pipelineExecutionId))
                    .limit(1);

                if (pipeExec?.missionId) {
                    return db.select()
                        .from(missionRuns)
                        .where(eq(missionRuns.missionId, pipeExec.missionId))
                        .limit(10);
                }
            }
        }
        
        return [];
    },

    /**
     * Create a new approval request (used by MissionReportingService)
     */
    async createApprovalRequest(input: {
        executionId: string;
        jobId?: number | null;
        approverType: string;
        approverEmail?: string;
        approverId?: string;
        status: string;
        organizationId?: number;
        context: any;
    }) {
        const { context, ...rest } = input;

        // IDEMPOTENCY: Check if a pending request already exists for this execution
        const idempotencyConditions = [
            eq(approvalRequests.executionId, input.executionId),
            eq(approvalRequests.status, "pending"),
        ];
        if (input.jobId != null) {
            idempotencyConditions.push(eq(approvalRequests.jobId, input.jobId) as any);
        }
        const [existing] = await db.select()
            .from(approvalRequests)
            .where(and(...idempotencyConditions))
            .limit(1);

        if (existing) {
            logger.info(`Idempotency hit: Pending approval request ${existing.id} already exists for execution ${input.executionId}`);
            return existing;
        }
        
        const [request] = await db.insert(approvalRequests)
            .values({
                ...rest,
                approverId: input.approverId,
                token: "", // placeholder; updated below with the JWT that embeds requestId
                modifiedOutput: context
            } as any)
            .returning();

        const token = generateExternalToken({
            executionId: input.executionId || `manual_${request.id}`,
            formId: 0,
            requestId: request.id,
            email: input.approverEmail || "system",
            role: input.approverType as any,
        });
        await db.update(approvalRequests).set({ token }).where(eq(approvalRequests.id, request.id));
        logger.info(`Created manual approval request ${request.id} for execution ${input.executionId}`);

        // Tell the intervention engine a decision is waiting on a human.
        //
        // This called eventStream.broadcast(), which does not exist — the service
        // only has publish(eventType, payload, context, source). The TypeError
        // landed in the catch below and was logged at debug, so the event was
        // never emitted and nothing downstream ever fired. publish also returns a
        // promise, so it has to be awaited for a rejection to reach the catch at
        // all. The failure is logged at warn now: a silent debug line is how this
        // stayed invisible.
        try {
            await eventStream.publish(
                "deliberation.started",
                {
                    approvalId: request.id,
                    executionId: input.executionId,
                    jobId: input.jobId,
                    pipelineName: context.missionName || context.pipelineName || 'Mission Execution',
                    stepName: context.stepName || context.type || 'High-Impact Step',
                    description: `${context.stepName || 'High-Impact Step'} is paused and needs a human decision.`,
                    riskLevel: context.riskLevel || 'high',
                    organizationId: (request as any).organizationId,
                },
                { organizationId: (request as any).organizationId },
                "approval.service",
            );
        } catch (streamErr: any) {
            logger.warn(`Failed to publish deliberation.started for approval ${request.id}: ${streamErr?.message}`);
        }

        // Submit async notification job (Phase 4D)
        // Notifications are sent in background; doesn't block response
        try {
            const notificationJob = await queueService.addJob(
                'approval-notifications',
                'notify',
                {
                    approvalId: request.id,
                    organizationId: (request as any).organizationId,
                    notificationType: ApprovalNotificationType.REQUEST_CREATED,
                    recipientIds: input.approverId ? [input.approverId] : undefined,
                    metadata: {
                        tool: context.stepName || context.type || 'Review',
                        description: context.stepName || 'A deliverable requires your review.',
                        riskLevel: 'medium',
                        missionName: context.missionName || 'Mission Deliverable Review',
                    },
                },
                {
                    priority: JobPriority.HIGH,
                    delay: 1000, // Slight delay to ensure DB committed
                    organizationId: (request as any).organizationId,
                }
            );

            logger.debug(`Approval notification job submitted`, {
                approvalId: request.id,
                jobId: notificationJob.id,
                recipientCount: input.approverId ? 1 : 0,
            });
        } catch (jobErr) {
            logger.error(`Failed to submit notification job for approval ${request.id}:`, jobErr);
            // Fall back to sync notification attempt
            try {
                await decisionRouter.fanOutNotifications({
                    sessionId: `manual_${request.id}`,
                    jobId: input.jobId ?? undefined,
                    executionId: input.executionId,
                    tool: context.stepName || context.type || 'Review',
                    params: context,
                    goal: context.missionName || 'Mission Deliverable Review',
                    riskLevel: 'medium',
                    description: context.stepName || 'A deliverable requires your review.',
                    approverType: input.approverType as any,
                    approverEmail: input.approverEmail,
                    approverId: input.approverId,
                    channels: ['slack', 'email', 'inbox'],
                    organizationId: (request as any).organizationId,
                    missionId: context.missionId
                }, token, request.id);
            } catch (fallbackErr) {
                logger.error(`Failed to trigger fallback notifications for approval ${request.id}:`, fallbackErr);
            }
        }

        return request;
    },

    /**
     * Trigger notifications for an existing approval request
     */
    async triggerNotifications(requestId: number, options: { missionRunId?: number, missionId?: number, organizationId?: number }) {
        const [request] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId)).limit(1);
        if (!request) return;

        const { generateExternalToken } = await import("@domain/core/auth/jwt.service.js");
        const { decisionRouter } = await import("../../governor/core/decision-router.js");

        let token = request.token;
        if (!token) {
            token = generateExternalToken({
                executionId: request.executionId || `manual_${request.id}`,
                formId: 0,
                requestId: request.id,
                email: request.approverEmail || "system",
                role: request.approverType as any,
            });
            await db.update(approvalRequests).set({ token }).where(eq(approvalRequests.id, request.id));
        }

        const context = request.modifiedOutput as any || {};
        await decisionRouter.fanOutNotifications({
            sessionId: `manual_${request.id}`,
            jobId: request.jobId ?? undefined,
            executionId: request.executionId,
            tool: context.stepName || context.type || 'Review',
            params: context,
            goal: context.missionName || 'Mission Deliverable Review',
            riskLevel: 'medium',
            description: context.stepName || 'A deliverable requires your review.',
            approverType: request.approverType as any,
            approverEmail: request.approverEmail,
            approverId: request.approverId ?? undefined,
            channels: ['slack', 'email', 'inbox'],
            organizationId: request.organizationId ?? undefined,
            missionId: request.missionId ?? options.missionId ?? undefined
        }, token, request.id);
    },
};

export default approvalService;

