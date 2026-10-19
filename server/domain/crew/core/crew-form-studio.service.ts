/**
 * Form Studio actions taken directly inside a crew room: mounting the studio on
 * a form, drafting a change to the form that is open, and applying a drafted
 * change the author approved.
 *
 * The same shape as App Studio's (crew-app-studio.service.ts). What a message
 * does is decided by decideFormStudioAction, a pure function over the room's
 * history; this file only carries it out. Drafting and applying are reached from
 * here and nowhere else: neither tool is offered to an agent, so no model can
 * decide mid-conversation to rewrite a form.
 *
 * A change is always shown before it is saved. The draft is computed against the
 * form's current revision and posted as a diff card; applying saves exactly what
 * the card holds, at that revision, and the save refuses it if the form has
 * moved on since.
 */

import { crewTurns, type AgentCardRecord } from "@shared/schema/index.js";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import {
    decideFormStudioAction,
    findFormChangeProposal,
    findFormCreateProposal,
    mountedFormStudio,
    type FormChangeProposal,
    type FormCreateProposal,
    type MountedFormStudio,
} from "@shared/form-studio-crew.js";
import { crewStreamService } from "./crew-stream.service.js";
import { buildCrewToolContext } from "./crew-tool-context.js";
import { crewToolsService, type CrewArtifact, type CrewToolReason, type ResolvedCrewTool } from "./crew-tools.service.js";
import type { RoundContext } from "./crew-round-context.js";

const logger = createLogger("CrewFormStudio");

type ToolRecord = Awaited<ReturnType<typeof crewToolsService.execute>>["record"];

export async function runDirectFormStudioAction(ctx: RoundContext, card?: AgentCardRecord): Promise<boolean> {
    if (!card) return false;
    const action = decideFormStudioAction(ctx.message, ctx.priorTurns as any);
    switch (action.kind) {
        case "apply":
            return applyFormChange(ctx, card, action.proposalId);
        case "create":
            return createDraftedForm(ctx, card, action.proposalId);
        case "draft":
            return draftNewForm(ctx, card, action.instruction);
        case "propose":
            return proposeFormChange(ctx, card, action.form, action.instruction);
        case "mount":
            return mountFormStudio(ctx, card);
        default:
            return false;
    }
}

/**
 * Mount the studio on the form the message names, or on the form already open
 * when it names none. A card without the tool leaves the round to the speakers.
 */
async function mountFormStudio(ctx: RoundContext, card: AgentCardRecord): Promise<boolean> {
    const availableTools = ctx.prefetch.toolsMap.get(card.id) ?? [];
    if (!availableTools.some((tool) => tool.definition.name === "mount_form_studio")) return false;

    const open = mountedFormStudio(ctx.priorTurns as any);
    const first = await crewToolsService.execute("mount_form_studio", { formName: ctx.message }, availableTools, toolContext(ctx));
    ctx.cost.toolCalls++;
    let { record, output, artifact } = first;
    // "Open form studio" names no form. With one already open, that is the form meant.
    if (record.ok && !artifact && open) {
        ({ record, output, artifact } = await crewToolsService.execute("mount_form_studio", { formId: open.formId }, availableTools, toolContext(ctx)));
        ctx.cost.toolCalls++;
    }
    if (!record.ok) return false;

    if (!artifact) {
        await postTurn(ctx, card, { content: output, record });
        return true;
    }
    const p = artifact.payload as { formName?: string; revision?: number; legacy?: boolean };
    await postTurn(ctx, card, {
        content:
            `Form Studio is open on "${p.formName}" at revision ${p.revision}.` +
            (p.legacy ? " It was made outside Form Studio, so it opens read-only until you duplicate it there." : "") +
            ` Tell me what to change, for example "Weight flight risk at 20%", and I'll show you the change before anything is saved.`,
        artifact,
        record,
    });
    return true;
}

/**
 * Draft a change to the open form and post it as a diff card.
 *
 * Drafting runs a model over the whole form, which takes a minute or more, so
 * the room answers now and the card arrives as its own turn on the stream the
 * client already appends from.
 */
async function proposeFormChange(ctx: RoundContext, card: AgentCardRecord, form: MountedFormStudio, instruction: string): Promise<boolean> {
    const allowed = await registryTool("propose_form_change", "declared-read-safe");
    if (!allowed) return false;

    const started = await postTurn(ctx, card, {
        content: `Drafting that change to "${form.formName ?? "the form"}". I'll show it here before anything is saved.`,
    });
    if (!started) return false;

    const context = toolContext(ctx);
    const { orgId, sessionKey, round, topic, intent } = ctx;
    const sessionId = ctx.session.id;
    const replyTo = ctx.replyTarget;
    ctx.cost.toolCalls++;

    setImmediate(async () => {
        let content: string;
        let artifact: CrewArtifact | null = null;
        let record: ToolRecord | null = null;
        try {
            const result = await crewToolsService.execute("propose_form_change", { formId: form.formId, instruction }, allowed, context);
            record = result.record;
            artifact = result.artifact;
            content = artifact
                ? describeProposal(artifact.payload as unknown as FormChangeProposal)
                : result.record.ok ? result.output : `I couldn't draft that change: ${result.record.error ?? result.output}`;
        } catch (err: any) {
            logger.error(`[FormStudio] Drafting a change failed: ${err?.message ?? err}`);
            content = `I couldn't draft that change: ${err?.message ?? err}`;
        }
        await publishTurn({ sessionId, orgId, sessionKey, round, topic, intent, replyTo, card, content, artifact, record });
    });
    return true;
}

/**
 * Apply a drafted change, from the card the author pressed Apply on.
 *
 * What is saved comes from the card's artifact, never from the message: the
 * message only has to be this room's approval of that card.
 */
async function applyFormChange(ctx: RoundContext, card: AgentCardRecord, proposalId: string): Promise<boolean> {
    const found = findFormChangeProposal(ctx.priorTurns as any, proposalId);
    if (!found) {
        await postTurn(ctx, card, { content: "That change isn't in this room, so there is nothing to apply." });
        return true;
    }
    if (found.applied) {
        await postTurn(ctx, card, { content: `That change to "${found.proposal.formName ?? "the form"}" has already been applied.` });
        return true;
    }

    const allowed = await registryTool("apply_form_change", "declared-agent-tool");
    if (!allowed) return false;

    const { proposal } = found;
    const { record, output, artifact } = await crewToolsService.execute(
        "apply_form_change",
        {
            formId: proposal.formId,
            baseRevision: proposal.baseRevision,
            proposalId: proposal.proposalId,
            definition: proposal.definition,
            summary: `Changed from CREW: ${proposal.instruction}`.slice(0, 300),
        },
        allowed,
        toolContext(ctx),
    );
    ctx.cost.toolCalls++;

    const revision = (artifact?.payload as { revision?: number } | undefined)?.revision;
    await postTurn(ctx, card, {
        content: artifact
            ? `Applied to "${proposal.formName ?? "the form"}" as revision ${revision}. Undo is in the studio's History.`
            : record.ok ? output : `The change was not applied: ${record.error ?? output}`,
        artifact,
        record,
    });
    return true;
}

/**
 * Draft a new form for a calculator, intake form, questionnaire or similar request,
 * and post it as a card. Like a change, drafting runs a model, so the room answers
 * now and the card follows as its own turn.
 */
async function draftNewForm(ctx: RoundContext, card: AgentCardRecord, instruction: string): Promise<boolean> {
    const allowed = await registryTool("propose_new_form", "declared-read-safe");
    if (!allowed) return false;

    const started = await postTurn(ctx, card, {
        content: "Drafting that as a form in Form Studio. I'll show it here before anything is saved.",
    });
    if (!started) return false;

    const context = toolContext(ctx);
    const { orgId, sessionKey, round, topic, intent } = ctx;
    const sessionId = ctx.session.id;
    const replyTo = ctx.replyTarget;
    ctx.cost.toolCalls++;

    setImmediate(async () => {
        let content: string;
        let artifact: CrewArtifact | null = null;
        let record: ToolRecord | null = null;
        try {
            const result = await crewToolsService.execute("propose_new_form", { instruction }, allowed, context);
            record = result.record;
            artifact = result.artifact;
            content = artifact
                ? describeNewFormProposal(artifact.payload as unknown as FormCreateProposal)
                : result.record.ok ? result.output : `I couldn't draft that form: ${result.record.error ?? result.output}`;
        } catch (err: any) {
            logger.error(`[FormStudio] Drafting a new form failed: ${err?.message ?? err}`);
            content = `I couldn't draft that form: ${err?.message ?? err}`;
        }
        await publishTurn({ sessionId, orgId, sessionKey, round, topic, intent, replyTo, card, content, artifact, record });
    });
    return true;
}

/** Create the form a new-form card holds, from that card, and open it. */
async function createDraftedForm(ctx: RoundContext, card: AgentCardRecord, proposalId: string): Promise<boolean> {
    const found = findFormCreateProposal(ctx.priorTurns as any, proposalId);
    if (!found) {
        await postTurn(ctx, card, { content: "That form isn't drafted in this room, so there is nothing to create." });
        return true;
    }
    if (found.created) {
        await postTurn(ctx, card, { content: `"${found.proposal.name}" has already been created.` });
        return true;
    }

    const allowed = await registryTool("create_form_from_proposal", "declared-agent-tool");
    if (!allowed) return false;

    const { proposal } = found;
    const { record, output, artifact } = await crewToolsService.execute(
        "create_form_from_proposal",
        { proposalId: proposal.proposalId, name: proposal.name, instruction: proposal.instruction, definition: proposal.definition },
        allowed,
        toolContext(ctx),
    );
    ctx.cost.toolCalls++;

    await postTurn(ctx, card, {
        content: artifact
            ? `Created "${proposal.name}" as a draft and opened it in Form Studio. Tell me what to change, and I'll show you each change before it is saved.`
            : record.ok ? output : `The form was not created: ${record.error ?? output}`,
        artifact,
        record,
    });
    return true;
}

export function describeNewFormProposal(proposal: FormCreateProposal): string {
    const checks = proposal.checks.length
        ? ` It fails ${proposal.checks.length} check${proposal.checks.length === 1 ? "" : "s"} that block publishing, which you can fix in the studio.`
        : "";
    return (
        `Here is a draft of "${proposal.name}": ${proposal.summary.join("; ")}.${checks} ` +
        `Press Create draft to save it and open it in Form Studio.`
    );
}

export function describeProposal(proposal: FormChangeProposal): string {
    const checks = proposal.checks.length
        ? ` After it, the form fails ${proposal.checks.length} check${proposal.checks.length === 1 ? "" : "s"} that block publishing; it can still be saved.`
        : "";
    return (
        `Here is the change to "${proposal.formName ?? "the form"}" (revision ${proposal.baseRevision}): ` +
        `${proposal.changes.join("; ")}.${checks} Press Apply to save it as revision ${proposal.baseRevision + 1}.`
    );
}

/** A registry tool offered to this path alone, never to an agent's own tool list. Shared with Media Studio's direct path. */
export async function registryTool(name: string, reason: CrewToolReason): Promise<ResolvedCrewTool[] | null> {
    try {
        const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
        const definition = getAgentTools()[name];
        return definition ? [{ definition, reason }] : null;
    } catch {
        return null;
    }
}

export function toolContext(ctx: RoundContext) {
    return buildCrewToolContext({
        orgId: ctx.orgId,
        userId: ctx.userId,
        projectId: ctx.projectId,
        projectKey: ctx.projectKey,
        sessionKey: ctx.sessionKey,
        sessionId: ctx.session.id,
        message: ctx.message,
    });
}

/** Insert an agent turn into the running round and announce it. */
export async function postTurn(
    ctx: RoundContext,
    card: AgentCardRecord,
    opts: { content: string; artifact?: CrewArtifact | null; record?: ToolRecord | null },
): Promise<boolean> {
    const [turn] = await db.insert(crewTurns).values({
        sessionId: ctx.session.id,
        organizationId: ctx.orgId,
        speakerType: "agent",
        agentCardId: card.id,
        speakerName: card.name,
        content: opts.content,
        round: ctx.round,
        inReplyToTurnId: ctx.replyTarget,
        topic: ctx.topic,
        intent: ctx.intent,
        toolsUsed: opts.record ? [opts.record] : [],
        artifacts: opts.artifact ? [opts.artifact] : [],
        latencyMs: opts.record?.ms ?? 0,
    }).returning();
    if (!turn) return false;

    ctx.roundTurns.push(turn);
    ctx.replyTarget = turn.id;
    void crewStreamService.publish({
        type: "turn-content",
        organizationId: ctx.orgId,
        sessionKey: ctx.sessionKey,
        payload: { turn, round: ctx.round },
    });
    return true;
}

/** A turn posted after the round has ended, from values captured while it ran. */
export async function publishTurn(scope: {
    sessionId: number;
    orgId: number;
    sessionKey: string;
    round: number;
    topic: string;
    intent: string;
    replyTo: number;
    card: AgentCardRecord;
    content: string;
    artifact: CrewArtifact | null;
    record: ToolRecord | null;
}): Promise<void> {
    try {
        const [turn] = await db.insert(crewTurns).values({
            sessionId: scope.sessionId,
            organizationId: scope.orgId,
            speakerType: "agent",
            agentCardId: scope.card.id,
            speakerName: scope.card.name,
            content: scope.content,
            round: scope.round,
            inReplyToTurnId: scope.replyTo,
            topic: scope.topic,
            intent: scope.intent,
            toolsUsed: scope.record ? [scope.record] : [],
            artifacts: scope.artifact ? [scope.artifact] : [],
            latencyMs: scope.record?.ms ?? 0,
        }).returning();
        if (turn) {
            void crewStreamService.publish({
                type: "turn-content",
                organizationId: scope.orgId,
                sessionKey: scope.sessionKey,
                payload: { turn, round: scope.round },
            });
        }
    } catch (err: any) {
        logger.error(`Posting a drafted studio change failed: ${err?.message ?? err}`);
    }
}
