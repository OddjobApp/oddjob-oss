import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { approvalRequests, hilForms, jobs, missionRuns, otpCodes, users } from "@shared/schema/index.js";
import type { StudioStage } from "@shared/form-studio.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { agentStagePrompt, fillStage, stageQuestions } from "./form-studio-stage-agent.js";
import { formProject, userCanReadProject } from "./form-studio-access.js";
import { formStudioStages, type StageOrigin } from "./form-studio-stages.service.js";

const logger = createLogger("FormStudioStageRequests");

/**
 * Asking for one stage of a cycle's Form Studio response, and taking the answers.
 *
 * A human-approval step configured with `{ formId, stageId }` opens the stage. It
 * uses the response this cycle is filling in (the id carried in mission context as
 * `formStudioResponses[formId]`, or the cycle's open response) or starts one,
 * records that id in mission context for the cycle's later blueprints, and asks
 * for the stage:
 *
 * - A stage assigned to people gets an approval request for each person the step
 *   names. Internal people answer in the Decision Inbox; external people get the
 *   emailed task link, behind the form's email code when it asks for one.
 * - A stage assigned to an agent is filled in by the organization's agent of that
 *   name, from the cycle's material, with the source of every answer recorded
 *   (form-studio-stage-agent.ts). The step continues at once.
 *
 * A stage request is completed only by submitting the stage's answers. That locks
 * the stage, approves the request, and resumes the step with the response id, the
 * status and every value, so later steps can route on them. Anyone else asked for
 * the same stage has their request closed.
 */

/** What an approval request for a stage carries as its context (`modifiedOutput`). */
export interface FormStageRequest {
    kind: "form_stage";
    formId: number;
    formName: string;
    responseId: number;
    releaseNumber: number;
    stageId: string;
    stageTitle: string;
    description: string;
    riskLevel: "medium";
}

export function isFormStageRequest(value: unknown): value is FormStageRequest {
    const candidate = value as Partial<FormStageRequest> | null;
    return candidate?.kind === "form_stage" && Number.isInteger(candidate.responseId) && Number.isInteger(candidate.formId) && typeof candidate.stageId === "string";
}

type Approver = { type: "internal" | "external"; id?: string; email?: string };

export interface OpenStageInput {
    organizationId: number | null;
    formId: number;
    stageId: string;
    approvers: Approver[];
    jobId: number;
    pipelineName: string;
    instructions?: string;
    emailSubject?: string;
    stepExecutionId?: number;
    /** The release a workflow release pinned — a NEW response starts on it instead of the form's current release. */
    releaseNumber?: number;
    pipelineExecutionId?: number;
    missionRunId?: number;
    missionId?: number;
    /** The step's `{{data}}`, which carries mission context between a cycle's blueprints. */
    contextData?: Record<string, any>;
}

export type OpenStageOutcome =
    | { kind: "waiting"; responseId: number; approvalRequestIds: number[]; message: string }
    /** The stage was already in, so the step continues with the response as it stands. */
    | { kind: "already_in"; output: Record<string, unknown> }
    /** An agent filled the stage in, so the step continues. */
    | { kind: "filled"; output: Record<string, unknown> }
    | { kind: "failed"; error: string };

export interface OpenStageDeps {
    /** The model call an agent-assigned stage uses. Defaults to the system AI service. */
    generate?: (prompt: string) => Promise<string | null | undefined>;
}

export interface Decider {
    id: string | number;
    email: string;
    adminRole?: { isSuperAdmin?: boolean; isOrgAdmin?: boolean; organizationId?: number | null } | null;
}

const appUrl = () => process.env.APP_URL || "http://localhost:5000";

async function systemGenerate(prompt: string) {
    const { systemAiService } = await import("@domain/ai/index.js");
    return systemAiService.generateText(prompt, { serviceKey: "copilot", temperature: 0 });
}

function assigneeLabel(assignee: StudioStage["assignee"]): string {
    switch (assignee.type) {
        case "respondent": return "the respondent";
        case "role": return `the ${assignee.role} role`;
        case "person": return `user ${assignee.userId}`;
        case "agent": return `the agent ${assignee.agent}`;
    }
}

async function responseFor(formId: number, organizationId: number, origin: StageOrigin, contextData?: Record<string, any>, releaseNumber?: number): Promise<number> {
    const carried = Number(contextData?.formStudioResponses?.[formId]);
    if (Number.isInteger(carried) && carried > 0) {
        // An id from mission context is used only when it answers this form in this organization.
        const found = await formStudioStages.progress(carried, organizationId).catch(() => null);
        if (found?.formId === formId) return carried;
    }
    const open = await formStudioStages.findOpen(formId, organizationId, origin);
    if (open) return open;
    return (await formStudioStages.start(formId, organizationId, origin, { releaseNumber })).responseId;
}

async function recordInMissionContext(missionRunId: number | undefined, formId: number, responseId: number) {
    if (!missionRunId) return;
    try {
        const { missionRunService } = await import("@domain/mission/core/mission-run.service.js");
        const run = await missionRunService.getById(missionRunId);
        if (!run?.missionId) return;
        const current = (((run.missionContext ?? {}) as any).formStudioResponses ?? {}) as Record<string, number>;
        if (current[formId] === responseId) return;
        await missionRunService.checkpoint({
            missionRunId,
            missionId: run.missionId,
            missionContext: { formStudioResponses: { ...current, [formId]: responseId } },
            reason: "checkpoint:form_studio_response",
            changedBy: "system",
        });
    } catch (error) {
        logger.warn(`Could not record response ${responseId} in mission run ${missionRunId}: ${(error as Error)?.message ?? error}`);
    }
}

/** Approvers with an email address, deduplicated. Internal approvers named only by id are looked up. */
async function withEmails(approvers: Approver[]): Promise<Array<{ type: "internal" | "external"; id: string | null; email: string }>> {
    const people = new Map<string, { type: "internal" | "external"; id: string | null; email: string }>();
    for (const approver of approvers) {
        let email = approver.email?.trim();
        let id = approver.type === "internal" ? approver.id ?? null : null;
        if (approver.type === "internal" && approver.id) {
            const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, approver.id)).limit(1);
            // An internal approver must be a real user: the request names them by id.
            if (!user) continue;
            id = user.id;
            email ||= user.email ?? undefined;
        }
        if (!email) continue;
        if (!people.has(email.toLowerCase())) people.set(email.toLowerCase(), { type: approver.type, id, email });
    }
    return [...people.values()];
}

async function notify(person: { type: "internal" | "external"; email: string }, token: string, input: OpenStageInput, request: FormStageRequest, organizationId: number) {
    try {
        const { gmailService } = await import("@domain/integrations/gmail-service.js");
        if (!(await gmailService.loadCredentials(organizationId))) return;
        const link = person.type === "internal" ? `${appUrl()}/control/decisions` : `${appUrl()}/external/task?token=${token}`;
        await gmailService.sendHilNotification(organizationId, person.email, link, { pipelineName: input.pipelineName, stepName: request.stageTitle, formName: request.formName }, input.emailSubject);
    } catch (error) {
        logger.warn(`Could not email ${person.email} about "${request.stageTitle}": ${(error as Error)?.message ?? error}`);
    }
}

type Progress = Awaited<ReturnType<typeof formStudioStages.progress>>;

/** Fill an agent-assigned stage from the cycle's material, or say why it could not be. */
async function fillAgentStage(
    progress: Progress, stage: { id: string; title: string; agent: string }, input: OpenStageInput, organizationId: number,
    generate: NonNullable<OpenStageDeps["generate"]>,
): Promise<OpenStageOutcome> {
    const [agent] = await db.select({ config: jobs.config }).from(jobs)
        .where(and(eq(jobs.type, "ai_agent"), eq(jobs.name, stage.agent), eq(jobs.organizationId, organizationId))).limit(1);
    if (!agent) return { kind: "failed", error: `"${stage.title}" is assigned to the agent ${stage.agent}, and this organization has no agent by that name.` };

    try {
        const view = await formStudioStages.view(progress.responseId, stage.id, organizationId);
        const questions = stageQuestions(view);
        const prompt = agentStagePrompt({
            agent: stage.agent, persona: (agent.config as { systemPrompt?: string } | null)?.systemPrompt,
            formName: progress.formName, view, questions, missionContext: input.contextData,
        });
        const outcome = await fillStage({
            generate, prompt, questions,
            check: (answers) => formStudioStages.check(progress.responseId, stage.id, answers, organizationId),
        });
        if (!outcome.ok) return { kind: "failed", error: `${stage.agent} could not fill in "${stage.title}" from the cycle's material. ${outcome.reason}` };
        const result = await formStudioStages.submit(progress.responseId, stage.id, outcome.answers, organizationId, { type: "agent", agent: stage.agent }, outcome.provenance);
        return { kind: "filled", output: result.pipelineOutput };
    } catch (error) {
        return { kind: "failed", error: `${stage.agent} could not fill in "${stage.title}": ${(error as Error)?.message ?? error}` };
    }
}

/** Called by the human-approval executor for a step configured with a form stage. */
export async function openFormStage(input: OpenStageInput, deps: OpenStageDeps = {}): Promise<OpenStageOutcome> {
    const { organizationId, formId, stageId, stepExecutionId } = input;
    if (organizationId == null) return { kind: "failed", error: "This step asks for a form stage, so its pipeline must belong to an organization." };
    if (!stepExecutionId) return { kind: "failed", error: "A form stage can only be asked for by a running pipeline step." };

    let cycleId: number | null = null;
    if (input.missionRunId) {
        const [run] = await db.select({ cycleId: missionRuns.cycleId }).from(missionRuns).where(eq(missionRuns.id, input.missionRunId)).limit(1);
        cycleId = run?.cycleId ?? null;
    }

    let progress: Progress;
    try {
        const responseId = await responseFor(formId, organizationId, { cycleId, missionRunId: input.missionRunId ?? null, pipelineExecutionId: input.pipelineExecutionId ?? null }, input.contextData, input.releaseNumber);
        progress = await formStudioStages.progress(responseId, organizationId);
    } catch (error) {
        return { kind: "failed", error: (error as Error)?.message ?? String(error) };
    }

    const stage = progress.stages.find((s) => s.id === stageId);
    if (!stage) return { kind: "failed", error: `"${progress.formName}" v${progress.releaseNumber} has no stage ${stageId}.` };
    await recordInMissionContext(input.missionRunId, formId, progress.responseId);
    if (stage.locked) return { kind: "already_in", output: { ...progress.pipelineOutput, stageId } };
    if (progress.nextStageId !== stageId) {
        const first = progress.stages.find((s) => s.id === progress.nextStageId);
        return { kind: "failed", error: `"${stage.title}" cannot be asked for yet: "${first?.title ?? progress.nextStageId}" comes first in "${progress.formName}".` };
    }
    if (stage.assignee.type === "agent") {
        return fillAgentStage(progress, { id: stage.id, title: stage.title, agent: stage.assignee.agent }, input, organizationId, deps.generate ?? systemGenerate);
    }

    const approvers = [...input.approvers];
    if (!approvers.length && stage.assignee.type === "person") approvers.push({ type: "internal", id: stage.assignee.userId });
    const people = await withEmails(approvers);
    // A private project's form is filled in by its members. People outside the
    // organization, who reach only their own stage through a task link, are not
    // members of anything and are not refused.
    const project = await formProject(formId);
    if (project?.visibility === "private") {
        const outsiders: string[] = [];
        for (const person of people) {
            if (person.type !== "internal") continue;
            if (!person.id || !(await userCanReadProject(project.id, organizationId, person.id))) outsiders.push(person.email);
        }
        if (outsiders.length) {
            return {
                kind: "failed",
                error: `"${stage.title}" belongs to the private project ${project.name}, and ${outsiders.join(", ")} ${outsiders.length === 1 ? "is not a member" : "are not members"}. Add them to the project, or name members on the step.`,
            };
        }
    }
    if (!people.length) {
        return { kind: "failed", error: `"${stage.title}" is assigned to ${assigneeLabel(stage.assignee)}, and this step names no one with an email address to fill it in. Add approvers to the step.` };
    }

    const request: FormStageRequest = {
        kind: "form_stage", formId, formName: progress.formName, responseId: progress.responseId, releaseNumber: progress.releaseNumber,
        stageId, stageTitle: stage.title, description: input.instructions || `Fill in "${stage.title}" of "${progress.formName}".`, riskLevel: "medium",
    };
    const { generateExternalToken } = await import("@domain/auth/core/jwt.service.js");
    const approvalRequestIds: number[] = [];
    for (const person of people) {
        const [row] = await db.insert(approvalRequests).values({
            executionId: String(stepExecutionId), jobId: input.jobId, approverType: person.type, approverId: person.id, approverEmail: person.email,
            status: "pending", token: "", organizationId, missionId: input.missionId ?? null, modifiedOutput: request,
        }).returning({ id: approvalRequests.id });
        const token = generateExternalToken({ executionId: String(stepExecutionId), formId, requestId: row.id, email: person.email, role: person.type });
        await db.update(approvalRequests).set({ token }).where(eq(approvalRequests.id, row.id));
        approvalRequestIds.push(row.id);
        await notify(person, token, input, request, organizationId);
    }
    return {
        kind: "waiting", responseId: progress.responseId, approvalRequestIds,
        message: `Waiting for ${people.map((p) => p.email).join(", ")} to fill in "${stage.title}".`,
    };
}

type ApprovalRow = typeof approvalRequests.$inferSelect & { organizationId: number };

async function loadStageRequest(approvalId: number): Promise<{ request: ApprovalRow; stage: FormStageRequest }> {
    const [request] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId)).limit(1);
    if (!request || request.organizationId == null || !isFormStageRequest(request.modifiedOutput)) throw new NotFoundError("Stage request not found.");
    return { request: request as ApprovalRow, stage: request.modifiedOutput };
}

const summary = (request: ApprovalRow, stage: FormStageRequest) => ({
    id: request.id, status: request.status, formName: stage.formName, stageTitle: stage.stageTitle, releaseNumber: stage.releaseNumber, description: stage.description,
});

async function assertCanDecide(request: ApprovalRow, decider: Decider, stage: FormStageRequest) {
    const { canDecideApproval } = await import("@domain/integrations/core/approval-authority.js");
    if (!canDecideApproval(request, decider.id, decider.email, decider.adminRole)) throw new ForbiddenError("You are not asked to fill in this stage.");
    // Someone removed from a private project since the request was made can no longer fill it in.
    const project = await formProject(stage.formId);
    if (project?.visibility === "private" && !(await userCanReadProject(project.id, request.organizationId, String(decider.id)))) {
        throw new ForbiddenError("You are not asked to fill in this stage.");
    }
}

function asInputs(inputs: unknown): Record<string, unknown> {
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) throw new BadRequestError("Send the stage's answers as an object.");
    return inputs as Record<string, unknown>;
}

/** Approve the submitter's request, which resumes the step, and close everyone else's request for the same stage. */
async function closeRequests(request: ApprovalRow, stage: FormStageRequest, output: Record<string, unknown>, decider: Decider, submittedExternally: boolean) {
    const { approvalService } = await import("@domain/integrations/core/approval.service.js");
    await approvalService.processDecision(
        request.id,
        { decision: "approved", comments: `Submitted "${stage.stageTitle}".`, modifiedOutput: { ...stage, ...output } },
        decider.id, decider.email, decider.adminRole, { formStageSubmitted: true, submittedExternally },
    );
    await db.update(approvalRequests)
        .set({ status: "approved", decisionAt: new Date(), comments: `"${stage.stageTitle}" was submitted by ${decider.email}.` })
        .where(and(
            eq(approvalRequests.executionId, request.executionId), eq(approvalRequests.status, "pending"), eq(approvalRequests.organizationId, request.organizationId),
            sql`${approvalRequests.modifiedOutput}->>'kind' = 'form_stage'`,
            sql`${approvalRequests.modifiedOutput}->>'responseId' = ${String(stage.responseId)}`,
            sql`${approvalRequests.modifiedOutput}->>'stageId' = ${stage.stageId}`,
        ));
}

/**
 * Lock the stage and close its requests. When the stage is already in (someone
 * else asked for it submitted first, or a submission locked it and then failed to
 * resume the step), this request is closed with the stage as it stands, so the
 * step still resumes.
 */
async function lockAndClose(request: ApprovalRow, stage: FormStageRequest, inputs: Record<string, unknown>, submitter: Parameters<typeof formStudioStages.submit>[4], decider: Decider, submittedExternally: boolean) {
    if (request.status !== "pending") throw new ConflictError(`"${stage.stageTitle}" is no longer waiting for answers on this request.`, { reason: "resolved" });
    const progress = await formStudioStages.progress(stage.responseId, request.organizationId);
    if (progress.stages.find((s) => s.id === stage.stageId)?.locked) {
        await closeRequests(request, stage, { ...progress.pipelineOutput, stageId: stage.stageId }, decider, submittedExternally);
        return { alreadySubmitted: true, complete: progress.complete, view: await formStudioStages.view(stage.responseId, stage.stageId, request.organizationId) };
    }
    const result = await formStudioStages.submit(stage.responseId, stage.stageId, inputs, request.organizationId, submitter);
    await closeRequests(request, stage, result.pipelineOutput, decider, submittedExternally);
    return { alreadySubmitted: false, complete: result.complete, view: result.view };
}

/** The stage a signed-in person is asked to fill in, as they may see it. */
export async function stageRequestForUser(approvalId: number, decider: Decider) {
    const { request, stage } = await loadStageRequest(approvalId);
    await assertCanDecide(request, decider, stage);
    return { request: summary(request, stage), view: await formStudioStages.view(stage.responseId, stage.stageId, request.organizationId) };
}

export async function completeStageForUser(approvalId: number, inputs: unknown, decider: Decider) {
    const { request, stage } = await loadStageRequest(approvalId);
    await assertCanDecide(request, decider, stage);
    const outcome = await lockAndClose(request, stage, asInputs(inputs), { type: "user", userId: String(decider.id), email: decider.email }, decider, false);
    return { request: { ...summary(request, stage), status: "approved" }, ...outcome };
}

interface TokenPayload { executionId: string; formId?: number; requestId?: number; email: string }

/** The stage request a task link was issued for, or null when the link is not for a form stage. */
async function stageRequestOfToken(payload: TokenPayload) {
    if (!payload?.requestId) return null;
    const [request] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, Number(payload.requestId))).limit(1);
    if (!request || !isFormStageRequest(request.modifiedOutput)) return null;
    const stage = request.modifiedOutput;
    // The link must be the one issued for this request's person, step and form.
    if (request.organizationId == null || request.executionId !== String(payload.executionId)
        || request.approverEmail.toLowerCase() !== String(payload.email).toLowerCase() || Number(payload.formId) !== stage.formId) {
        throw new NotFoundError("This link is no longer valid.");
    }
    const [form] = await db.select({ securityConfig: hilForms.securityConfig, themeConfig: hilForms.themeConfig }).from(hilForms)
        .where(and(eq(hilForms.id, stage.formId), eq(hilForms.organizationId, request.organizationId))).limit(1);
    if (!form) throw new NotFoundError("This link is no longer valid.");
    return { request: request as ApprovalRow, stage, form };
}

async function emailConfirmed(payload: TokenPayload, form: { securityConfig: unknown }): Promise<boolean> {
    if ((form.securityConfig as { requireOtp?: boolean } | null)?.requireOtp !== true) return true;
    const [verified] = await db.select({ id: otpCodes.id }).from(otpCodes)
        .where(and(eq(otpCodes.executionId, String(payload.executionId)), eq(otpCodes.email, payload.email), isNotNull(otpCodes.usedAt))).limit(1);
    return Boolean(verified);
}

/** For GET /api/external/task: the stage view behind a task link, or null when the link is not for a form stage. */
export async function stageTaskFromToken(payload: TokenPayload) {
    const loaded = await stageRequestOfToken(payload);
    if (!loaded) return null;
    const { request, stage, form } = loaded;
    if (!(await emailConfirmed(payload, form))) return { status: "otp_required" as const, email: payload.email, formId: stage.formId };
    return {
        status: "ready" as const, formId: stage.formId, formName: stage.formName, themeConfig: form.themeConfig, executionId: payload.executionId, email: payload.email,
        formStudioStage: { requestStatus: request.status, view: await formStudioStages.view(stage.responseId, stage.stageId, request.organizationId) },
    };
}

/** For POST /api/external/task/submit: lock the stage from a task link, or null when the link is not for a form stage. */
export async function completeStageFromToken(payload: TokenPayload, inputs: unknown) {
    const loaded = await stageRequestOfToken(payload);
    if (!loaded) return null;
    const { request, stage, form } = loaded;
    if (!(await emailConfirmed(payload, form))) throw new ForbiddenError("Confirm your email address with the code before submitting.");
    // The link itself is the authority here, as for the direct-approval links processDecision already accepts.
    const decider: Decider = { id: request.approverId ?? 0, email: request.approverEmail, adminRole: { isSuperAdmin: true } };
    const outcome = await lockAndClose(request, stage, asInputs(inputs), { type: "external", email: request.approverEmail }, decider, true);
    return { complete: outcome.complete, alreadySubmitted: outcome.alreadySubmitted, view: outcome.view };
}
