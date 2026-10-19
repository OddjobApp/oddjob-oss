/**
 * The supervisor's review of a round, and everything it sets in motion.
 *
 * The supervisor speaks last: it reads what the crew said, critiques it,
 * records notes and a plan, publishes its standing read of the room, and where
 * the discussion has split it can spin the sub-topic out into a breakout room.
 * When it addresses an agent directly, that agent answers inside the same round
 * rather than waiting for the user to speak again.
 *
 * Lifted out of CrewOrchestratorService whole: none of these referenced any
 * orchestrator state, only each other and the turn-generation primitives, so
 * they were a service sharing a class rather than a class doing the work.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { formatCrewRoomBrief } from '@shared/crew-room-brief.js';
import { db } from "@server/database_service.js";
import {
    agentCards,
    crewBreakouts,
    crewMembers,
    crewPlans,
    crewSessions,
    crewTurns,
    crewTurnTopics,
    supervisorNotes,
    type AgentCardRecord,
    type CrewTurnRecord,
    type SupervisorNoteType,
} from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import { crewSupervisorService, type SupervisorOutput, type SupervisorTranscriptTurn } from "./crew-supervisor.service.js";
import { crewStreamService } from "./crew-stream.service.js";
import {
    crewToolsService,
    MAX_TOOL_CALLS_PER_TURN,
    type CrewArtifact,
    type ToolCallRecord,
} from "./crew-tools.service.js";
import { crewParticipantsService } from "./crew-participants.service.js";
import { buildCrewToolContext } from "./crew-tool-context.js";
import { detectAssemblyIntent } from "./crew-assembly-directives.js";
import { RESEARCH_LADDER, generateForCard, toGenerationMessages } from "./crew-turn-generation.js";
import { crewPersonaService } from "./crew-persona.service.js";
import { crewLearningService } from "./crew-learning.service.js";
import type { GenerationMessage } from "./crew-generation.service.js";
import type { RoundCost, SupervisorRoundResult } from "./crew-round-context.js";

const logger = createLogger("CrewSupervisorRound");

/**
 * The agent named in the supervisor's directive gets to answer it.
 *
 * Strictly bounded, because this is the one place the crew acts without the
 * user asking:
 *
 *   - ONE turn. It does not re-run the supervisor, so it cannot recurse and
 *     there is no path from here back into another follow-up.
 *   - Only an agent already in the room. An @mention of someone absent, or
 *     of the supervisor itself, resolves to nothing.
 *   - Only when a directive actually names someone. A directive addressed to
 *     the room at large is left alone.
 *
 * WITH tools, on one bounded pass. This originally ran prose-only, on the
 * reasoning that a directive asks for a position rather than a lookup. That
 * was wrong, and produced the worst answer in the room: asked to "confirm
 * whether other installed applications might also serve the user", Copilot
 * replied that it "would need to know what other applications are installed"
 * — while holding list_installed_apps, which answers precisely that. A
 * supervisor asking an agent to check something is the common case, not the
 * exception, and an agent that cannot check can only speculate, which is
 * what the supervisor will then critique it for.
 *
 * One execution pass, not the speaker loop's two: tools run, results go back,
 * the agent answers. No artifact chain, because a directive is answered to
 * the room rather than rendered for the user.
 */
export async function runDirectiveFollowUp(params: {
    orgId: number;
    sessionKey: string;
    sessionId: number;
    round: number;
    members: AgentCardRecord[];
    directive: string;
    studio?: string;
    supervisorTurnId: number;
    roundTurns: CrewTurnRecord[];
    projectId: number | null;
    projectKey: string | null;
    roster: Array<{ name: string; description: string }>;
    cost: RoundCost;
}): Promise<CrewTurnRecord | null> {
    const cost = params.cost;
    const { orgId, sessionKey, sessionId, round, members, directive, supervisorTurnId, roundTurns } =
        params;

    const target = resolveDirectiveTarget(directive, members);
    if (!target) return null;

    try {
        const availableTools = await crewToolsService.resolveForCard(target, params.studio);
        const declarations = crewToolsService.toFunctionDeclarations(availableTools);

        // The SAME system prompt the agent's main turn gets. Without it this
        // turn had no identity and no tool block, and the agent answered as a
        // generic assistant — "I lack the ability to perform actions in the
        // real world", moments after calling list_recent_executions. An agent
        // that is not told who it is describes the model instead.
        const messages: GenerationMessage[] = [
            {
                role: "system",
                content: crewPersonaService.buildSystemPrompt(
                    target,
                    params.roster,
                    "", // recall is the main turn's job; this one answers from the round
                    params.projectKey,
                    availableTools.map((t) => t.definition.name),
                    null, // nobody speaks after this, so no prediction is asked for
                    [],
                ),
            },
            ...toGenerationMessages(roundTurns, target.name),
            {
                role: "user",
                content:
                    `The supervisor addressed you directly:\n\n"${directive}"\n\n` +
                    `Answer it as ${target.name}, in one short paragraph. If it asked you to ` +
                    `choose between options, name your choice and the evidence for it. If it ` +
                    `asked you to ask the user something, ask them plainly. Do not restate ` +
                    `what you already said this round.\n\n` +
                    `If it asked you to check or confirm something, CHECK IT with your tools ` +
                    `before answering — do not reply that you would need information you can ` +
                    `look up. Never tell the user to contact an app's support team or ` +
                    `administrators: this is their own platform and you are inside it.` +
                    detectAssemblyIntent(directive) +
                    RESEARCH_LADDER,
            },
        ];

        let result = await generateForCard(cost, target, orgId, messages, {
            temperature: 0.7,
            maxTokens: 400,
            ...(declarations.length > 0 ? { tools: declarations } : {}),
        });

        const toolsUsed: ToolCallRecord[] = [];
        if (result.toolCalls.length > 0) {
            const outputs: string[] = [];
            for (const call of result.toolCalls.slice(0, MAX_TOOL_CALLS_PER_TURN)) {
                const { record, output } = await crewToolsService.execute(
                    call.name,
                    call.args,
                    availableTools,
                    {
                        organizationId: orgId,
                        userId: "crew",
                        projectId: params.projectId,
                        projectKey: null,
                        sessionKey,
                        named: {},
                        positional: {},
                    },
                );
                toolsUsed.push(record);
                cost.toolCalls++;
                outputs.push(`${call.name} →\n${output}`);
            }
            logger.info(
                `"${target.name}" called ${toolsUsed.length} tool(s) answering the directive: ` +
                    toolsUsed.map((t) => `${t.name}${t.ok ? "" : " (failed)"}`).join(", "),
            );

            messages.push({
                role: "user",
                content:
                    `Results from the tools you called:\n\n${outputs.join("\n\n")}\n\n` +
                    `Now answer the supervisor, grounded in what you found. State what you ` +
                    `established and what you could not.`,
            });
            result = await generateForCard(cost, target, orgId, messages, {
                temperature: 0.7,
                maxTokens: 400,
            });
        }

        const content = result.content?.trim();
        if (!content) {
            logger.warn(`"${target.name}" had nothing to say to the supervisor's directive.`);
            return null;
        }

        const [turn] = await db
            .insert(crewTurns)
            .values({
                sessionId,
                organizationId: orgId,
                speakerType: "agent",
                agentCardId: target.id,
                speakerName: target.name,
                content,
                round,
                inReplyToTurnId: supervisorTurnId,
                resolvedModelId: result.modelId,
                servedModel: result.actualModel ?? result.modelIdentifier,
                servedProvider: result.actualProvider ?? null,
                wasFallback: result.isFallback === true,
                latencyMs: result.latencyMs,
                toolsUsed,
            })
            .returning();

        logger.info(`"${target.name}" answered the supervisor's directive in round ${round}.`);
        void crewStreamService.publish({
            type: "turn-content",
            organizationId: orgId,
            sessionKey,
            payload: { turn, round },
        });
        return turn;
    } catch (err) {
        // A failed follow-up must not fail the round — the round's real work
        // is already persisted and streamed by this point.
        logger.warn(
            `Directive follow-up failed for "${target.name}": ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
        return null;
    }
}

/**
 * Which crew member a directive is addressed to, or null.
 *
 * Matches "@Name" against the room's roster. Longest name first, so a room
 * holding both "Research" and "Research Lead" resolves "@Research Lead" to
 * the latter rather than matching the prefix.
 */
export function resolveDirectiveTarget(
    directive: string,
    members: AgentCardRecord[],
): AgentCardRecord | null {
    if (!directive) return null;
    const haystack = directive.toLowerCase();
    const byLength = [...members].sort((a, b) => b.name.length - a.name.length);
    for (const member of byLength) {
        if (haystack.includes(`@${member.name.toLowerCase()}`)) return member;
    }
    return null;
}

/**
 * Asks the supervisor to read the round.
 *
 * Its own last summary goes back in for continuity, so successive rounds
 * read as one thread rather than a series of unrelated reviews.
 */
export async function reviewRound(scope: {
    orgId: number;
    sessionId: number;
    topic: string;
    roundTurns: CrewTurnRecord[];
    roster: Array<{ name: string; description: string }>;
    cost: RoundCost;
    modelBinding?: {
        modelBindingProviderId: number | null;
        modelBindingModelId: number | null;
    } | null;
}) {
    const { orgId, sessionId, topic, roundTurns, roster, modelBinding } = scope;

    const roundTurnIds = roundTurns.map((t) => t.id);
    const [[priorSummary], sessionState, declaredRows] = await Promise.all([
        db
            .select({ content: supervisorNotes.content })
            .from(supervisorNotes)
            .where(and(eq(supervisorNotes.sessionId, sessionId), eq(supervisorNotes.noteType, "summary")))
            .orderBy(desc(supervisorNotes.id))
            .limit(1),
        db
            .select({ activeTopic: crewSessions.activeTopic, nextSteps: crewSessions.nextSteps, memory: crewSessions.memory })
            .from(crewSessions)
            .where(eq(crewSessions.id, sessionId))
            .limit(1)
            .then((rows) => rows[0] ?? null),
        roundTurnIds.length > 0
            ? db
                  .select({ turnId: crewTurnTopics.turnId, label: crewTurnTopics.label, source: crewTurnTopics.source })
                  .from(crewTurnTopics)
                  .where(inArray(crewTurnTopics.turnId, roundTurnIds))
            : Promise.resolve([]),
    ]);

    // #[x] labels speakers declared this round — the room's own vocabulary,
    // next to the supervisor's inferred read. Attributed so "user declared
    // pricing" and "agent suggested pricing" read differently.
    const speakerByTurnId = new Map(roundTurns.map((t) => [t.id, t.speakerName]));
    const declaredByLabel = new Map<string, Set<string>>();
    for (const row of declaredRows) {
        const speakers = declaredByLabel.get(row.label) ?? new Set<string>();
        const speaker = speakerByTurnId.get(row.turnId);
        if (speaker) speakers.add(speaker);
        declaredByLabel.set(row.label, speakers);
    }
    const declaredLine = declaredByLabel.size
        ? `Declared topics this round: ${Array.from(declaredByLabel.entries())
              .map(([label, speakers]) => `#${label}${speakers.size ? ` (${Array.from(speakers).join(", ")})` : ""}`)
              .join(", ")}`
        : "";

    // Prepend the session's standing state so the supervisor has continuity
    // across rounds — it sees what the room has been working on and what the
    // last agreed next step was, rather than only the round transcript and the
    // last summary note.
    const sessionStateBlock = [
        formatCrewRoomBrief(sessionState?.memory?.roomBrief),
        sessionState?.activeTopic ? `Active topic: ${sessionState.activeTopic}` : "",
        declaredLine,
        sessionState?.nextSteps ? `Last agreed next step: ${sessionState.nextSteps}` : "",
    ].filter(Boolean).join("\n");

    const priorContext = [sessionStateBlock, priorSummary?.content ?? ""]
        .filter(Boolean)
        .join("\n\n");

    const transcript: SupervisorTranscriptTurn[] = roundTurns.map((t) => ({
        speaker: t.speakerName,
        speakerType: t.speakerType,
        content: t.content,
        toolsUsed: t.toolsUsed,
    }));

    scope.cost.modelCalls++; // the supervisor is a model call like any other
    return crewSupervisorService.review(
        orgId,
        topic,
        transcript,
        roster,
        priorContext,
        undefined,
        modelBinding,
    );
}

/**
 * Consensus among one agent is not low — it is undefined.
 *
 * A single speaker produced "20% consensus" figures and MEDIUM "unresolved
 * disagreement" issues out of a room that contained no disagreement, because
 * the supervisor was asked to score agreement and duly scored it. Nulling it
 * also stops the learning loop acting on the fiction: writeBackKnowledge and
 * raiseIssueIfUnresolved both no-op on a null consensus, so a solo round
 * banks nothing and raises nothing.
 *
 * Critique, summary and the directive survive — they are judgements about
 * the contribution, not about agreement.
 */
export function nullifySoloRoundConsensus(
    output: SupervisorOutput,
    roundTurns: CrewTurnRecord[],
    round: number,
): void {
    const distinctSpeakers = new Set(
        roundTurns.filter((t) => t.speakerType === "agent").map((t) => t.agentCardId),
    );
    if (distinctSpeakers.size < 2 && output.consensusLevel !== null) {
        logger.debug(
            `Round ${round}: ${distinctSpeakers.size} agent speaker(s) — discarding the ` +
                `supervisor's consensus score as undefined.`,
        );
        output.consensusLevel = null;
        output.divergenceQuestion = null;
    }
}

/** Files the supervisor's critique, consensus, summary, notes and intents. */
export async function persistSupervisorNotes(scope: {
    orgId: number;
    sessionId: number;
    round: number;
    output: SupervisorOutput;
    lastAgentTurn?: CrewTurnRecord;
}): Promise<Array<{ noteType: SupervisorNoteType; content: string; targetTurnId?: number }>> {
    const { orgId, sessionId, round, output, lastAgentTurn } = scope;

    const pending: Array<{ noteType: SupervisorNoteType; content: string; targetTurnId?: number }> = [];
    if (output.critique) {
        // The critique is about one turn, so it is filed against that turn.
        pending.push({ noteType: "critique", content: output.critique, targetTurnId: lastAgentTurn?.id });
    }
    if (output.consensus) pending.push({ noteType: "consensus", content: output.consensus });
    if (output.summary) pending.push({ noteType: "summary", content: output.summary });
    for (const n of output.notes) pending.push({ noteType: "note", content: n });
    for (const i of output.intents) pending.push({ noteType: "intent", content: i });

    if (pending.length > 0) {
        await db.insert(supervisorNotes).values(
            pending.map((p) => ({
                sessionId,
                organizationId: orgId,
                noteType: p.noteType,
                content: p.content,
                round,
                targetTurnId: p.targetTurnId ?? null,
            })),
        );
    }
    return pending;
}

/** Persists the supervisor's plan, when it proposed one. */
export async function persistSupervisorPlan(scope: {
    orgId: number;
    sessionId: number;
    round: number;
    output: SupervisorOutput;
}): Promise<SupervisorRoundResult["plan"]> {
    const { orgId, sessionId, round, output } = scope;
    if (!output.plan) return null;

    const [created] = await db
        .insert(crewPlans)
        .values({
            sessionId,
            organizationId: orgId,
            title: output.plan.title,
            steps: output.plan.steps,
            round,
        })
        .returning();
    return { title: created.title, steps: created.steps };
}

/** The supervisor speaks into the room, addressing agents by @mention. */
export async function postSupervisorDirective(scope: {
    orgId: number;
    sessionId: number;
    round: number;
    output: SupervisorOutput;
    lastAgentTurn?: CrewTurnRecord;
}): Promise<CrewTurnRecord | null> {
    const { orgId, sessionId, round, output, lastAgentTurn } = scope;
    if (!output.directive) return null;

    const artifacts: CrewArtifact[] = [];
    if (output.decisions && output.decisions.length > 0) {
        for (const dec of output.decisions) {
            artifacts.push({
                tool: "ratify_decision",
                payload: {
                    type: "decision_ratification",
                    statement: dec.statement,
                    rationale: dec.rationale ?? null,
                    confidence: dec.confidence ?? 85,
                    status: "proposed",
                    round,
                    createdBy: "Supervisor",
                },
            });
        }
    }
    if (output.commitments && output.commitments.length > 0) {
        for (const com of output.commitments) {
            artifacts.push({
                tool: "record_commitment",
                payload: {
                    type: "commitment_contract",
                    title: com.title,
                    detail: com.detail ?? null,
                    ownerType: "agent",
                    ownerId: com.owner ?? "Agent",
                    status: "open",
                    createdBy: "Supervisor",
                },
            });
        }
    }
    if (output.claims && output.claims.length > 0) {
        for (const clm of output.claims) {
            artifacts.push({
                tool: "verify_claim",
                payload: {
                    type: "claim_verification",
                    claim: clm.claim,
                    confidence: clm.confidence ?? 85,
                    agreementLevel: output.consensusLevel ?? 75,
                    createdBy: clm.agent ?? "Supervisor",
                    status: "unverified",
                },
            });
        }
    }

    const [created] = await db
        .insert(crewTurns)
        .values({
            sessionId,
            organizationId: orgId,
            speakerType: "supervisor",
            speakerName: crewSupervisorService.name,
            content: output.directive,
            round,
            inReplyToTurnId: lastAgentTurn?.id ?? null,
            artifacts: artifacts.length > 0 ? (artifacts as any) : null,
        })
        .returning();
    return created;
}

/**
 * Mirrors the round's decisions, claims and commitments onto the blackboard
 * and tells the client how many of each landed.
 *
 * A sync failure must not lose the supervisor's turn, so it is caught here
 * rather than allowed to abort the round.
 */
export async function syncBlackboard(scope: {
    orgId: number;
    sessionId: number;
    round: number;
    topic: string;
    output: SupervisorOutput;
    projectId: number | null;
    sessionKey: string;
}): Promise<void> {
    const { orgId, sessionId, round, topic, output, projectId, sessionKey } = scope;

    await crewLearningService
        .syncBlackboardArtifacts({ orgId, sessionId, round, topic, output, projectId })
        .catch((err) =>
            logger.warn(
                `Blackboard auto-sync failed for session ${sessionId}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            ),
        );

    void crewStreamService.publish({
        type: "blackboard-sync",
        organizationId: orgId,
        sessionKey: sessionKey ?? undefined,
        payload: {
            sessionId,
            round,
            decisionsCount: output.decisions?.length ?? (output.consensus ? 1 : 0),
            claimsCount: output.claims?.length ?? output.positions.length,
            commitmentsCount: output.commitments?.length ?? (output.plan?.steps.length ?? 0),
        },
    });
}

/**
 * Spins up a child room for a genuine topic digression.
 *
 * Creates the session, links it in crew_breakouts, clones the parent's
 * roster, seeds it with a context turn, and surfaces a navigable card back
 * into the parent room. Returns the parent's supervisor turn, which is
 * either updated to carry that card or created to hold it.
 *
 * Non-fatal throughout: a room that fails to provision must not cost the
 * round its supervisor turn.
 */
export async function provisionBreakoutRoom(scope: {
    orgId: number;
    sessionId: number;
    round: number;
    topic: string;
    sessionKey: string;
    projectId: number | null;
    roster: Array<{ name: string; description: string }>;
    suggestion: { subTopic: string; rationale: string; proposedTitle: string };
    turn: CrewTurnRecord | null;
}): Promise<CrewTurnRecord | null> {
    const { orgId, sessionId, round, topic, sessionKey, projectId, roster } = scope;
    const { subTopic, rationale, proposedTitle } = scope.suggestion;
    let turn = scope.turn;

    try {
        // 0. Bind the sub-topic to a knowledge topic — an existing node in the
        //    room's vocabulary when the digression is a known subject, a new
        //    freeform topic otherwise. A failure here must not cost the
        //    breakout, so it resolves before the try-body's real work.
        let breakoutTopicId: number | null = null;
        try {
            const { topicService } = await import("@domain/knowledge/core/topic-service.js");
            const { getSystemOrgContext } = await import("@server/utils/auth-context.js");
            const bound = await topicService.upsertTopic(
                { name: subTopic },
                getSystemOrgContext(orgId),
                projectId ?? null,
            );
            breakoutTopicId = bound.id;
        } catch (topicErr) {
            logger.warn(`Breakout topic binding failed (non-fatal): ${topicErr instanceof Error ? topicErr.message : topicErr}`);
        }

        // 1. Generate a stable child session key.
        const childKey = `crew-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

        // 2. Create the child session (reuse ensureSession which handles upsert).
        const [childSession] = await db
            .insert(crewSessions)
            .values({
                organizationId: orgId,
                sessionKey: childKey,
                title: proposedTitle,
                parentSessionId: sessionId,
                projectId: projectId ?? null,
                activeTopic: subTopic,
                activeTopicId: breakoutTopicId,
                createdBy: roster[0]?.name ?? "Supervisor",
            })
            .returning();

        // 3. Record parent ↔ child lineage.
        await db.insert(crewBreakouts).values({
            parentSessionId: sessionId,
            childSessionId: childSession.id,
            subTopic,
            topicId: breakoutTopicId,
            suggestedBy: "Supervisor",
        });

        // 4. Copy parent's agent roster into child.
        const parentMembers = await db
            .select({ agentCardId: crewMembers.agentCardId })
            .from(crewMembers)
            .where(eq(crewMembers.sessionId, sessionId));
        if (parentMembers.length > 0) {
            await db.insert(crewMembers).values(
                parentMembers.map((m) => ({
                    sessionId: childSession.id,
                    agentCardId: m.agentCardId,
                })),
            );
        }

        // 5. Pre-seed the child with a context turn so agents know
        //    immediately why the room exists.
        const parentTitle = roster[0] ? topic : "the parent discussion";
        // The sub-topic is seeded as a #[tag]: the child room opens with the
        // topic already in its declared set, so the lineage survives as a
        // knowledge_topics link rather than a sentence of prose.
        const seedContent =
            `This breakout room was created from the discussion "${parentTitle}".\n\n` +
            `**Sub-topic**: #[${subTopic}]\n\n` +
            `**Why a dedicated room**: ${rationale}\n\n` +
            `The original room continues uninterrupted. You can return there at any time using the link in the breakout card.`;
        const [seedTurn] = await db.insert(crewTurns).values({
            sessionId: childSession.id,
            organizationId: orgId,
            speakerType: "supervisor",
            speakerName: crewSupervisorService.name,
            content: seedContent,
            round: 1,
        }).returning();
        if (seedTurn) {
            const { persistTurnTags } = await import("./crew-topics.service.js");
            void persistTurnTags({
                orgId,
                sessionId: childSession.id,
                turnId: seedTurn.id,
                round: 1,
                source: "supervisor",
                text: seedContent,
                projectId: projectId ?? null,
                sessionKey: childKey,
                speakerName: crewSupervisorService.name,
            });
        }

        // 6. Write a crew_breakout artifact card into the PARENT room's
        //    supervisor turn so the user sees a navigable link.
        const parentSessionKey = sessionKey;
        const breakoutArtifact: CrewArtifact = {
            tool: "propose_breakout_room",
            payload: {
                type: "crew_breakout",
                subTopic,
                rationale,
                proposedTitle,
                parentSessionKey,
                childSessionKey: childKey,
                parentUrl: `/workspace/chat/${parentSessionKey}`,
                childUrl: `/workspace/chat/${childKey}`,
            },
        };

        // Attach the artifact to the supervisor's turn if one was written,
        // otherwise create a minimal artifact-only turn.
        if (turn) {
            await db
                .update(crewTurns)
                .set({ artifacts: [breakoutArtifact] as any })
                .where(eq(crewTurns.id, turn.id));
            turn = { ...turn, artifacts: [breakoutArtifact] as any };
        } else {
            const [artTurn] = await db
                .insert(crewTurns)
                .values({
                    sessionId,
                    organizationId: orgId,
                    speakerType: "supervisor",
                    speakerName: crewSupervisorService.name,
                    content: `A breakout room has been prepared for the sub-topic "${subTopic}". ${rationale}`,
                    round,
                    artifacts: [breakoutArtifact] as any,
                })
                .returning();
            turn = artTurn;
        }

        // 7. Broadcast the new child room to the stream so the frontend
        //    can surface the card immediately.
        void crewStreamService.publish({
            type: "turn",
            organizationId: orgId,
            sessionKey: parentSessionKey,
            payload: {
                speakerType: "supervisor",
                speakerName: crewSupervisorService.name,
                content: `Breakout room created for "${subTopic}".`,
                artifacts: [breakoutArtifact],
            },
        });

        logger.info(
            `Breakout room provisioned: parent=${sessionId} child=${childSession.id} ` +
                `key=${childKey} sub-topic="${subTopic}"`,
        );
    } catch (breakoutErr) {
        logger.warn(
        `Breakout provisioning failed (non-fatal): ` +
            `${breakoutErr instanceof Error ? breakoutErr.message : String(breakoutErr)}`,
        );
    }

    return turn;
}

/**
 * Runs the supervisor and persists whatever it produced.
 *
 * `trackOnly` rounds — mentions, factual lookups, "build that" instructions —
 * still get the bookkeeping: notes, plan, blackboard sync, and the memory
 * write-back the caller performs from this result. What they do not get is a
 * spoken directive or a follow-up, because answering a completed lookup with
 * an assignment is how the chorus/rephrasing loop used to happen. The review
 * itself is what keeps requirements and commitments on the record, and
 * skipping it was what left a room's stated requirements nowhere at all.
 */
export async function runSupervisor(params: {
    orgId: number;
    sessionId: number;
    round: number;
    topic: string;
    roundTurns: CrewTurnRecord[];
    roster: Array<{ name: string; description: string }>;
    cost: RoundCost;
    /** Parent room's project + key. The breakout block below referenced both as
     *  though they were parameters; they were never passed, so a proposed
     *  breakout could not compile, let alone run. */
    projectId: number | null;
    sessionKey: string;
    /** Persist the review but do not speak — no directive turn, no breakout. */
    trackOnly?: boolean;
    modelBinding?: {
        modelBindingProviderId: number | null;
        modelBindingModelId: number | null;
    } | null;
}): Promise<SupervisorRoundResult> {
    const { orgId, sessionId, round, topic, roundTurns, roster, projectId, sessionKey, trackOnly, modelBinding } = params;
    const empty: SupervisorRoundResult = {
        notes: [],
        plan: null,
        turn: null,
        activeTopic: "",
        nextSteps: "",
        consensusLevel: null,
        output: null,
    };

    // Nothing to review if no agent actually spoke.
    if (!roundTurns.some((t) => t.speakerType === "agent")) return empty;

    const output = await reviewRound({
        orgId,
        sessionId,
        topic,
        roundTurns,
        roster,
        cost: params.cost,
        modelBinding,
    });
    if (!output) {
        // The review produced nothing while agents spoke — the failure is
        // invisible by default: no turn, no note, empty panels. File it, so a
        // room whose supervisor never seems to track anything shows WHY.
        logger.warn(`Round ${round} (session ${sessionId}): supervisor review produced no output.`);
        await db
            .insert(supervisorNotes)
            .values({
                sessionId,
                organizationId: orgId,
                noteType: "note",
                content:
                    `Round ${round}: the supervisor review produced no usable output — ` +
                    `the round's decisions, commitments and requirements were not tracked. ` +
                    `Check the org's model connection if this repeats.`,
                round,
            })
            .catch((err) =>
                logger.warn(`Failed to record supervisor failure note: ${err instanceof Error ? err.message : String(err)}`),
            );
        return { ...empty, error: "supervisor review produced no output" };
    }

    nullifySoloRoundConsensus(output, roundTurns, round);

    const lastAgentTurn = [...roundTurns].reverse().find((t) => t.speakerType === "agent");

    const pending = await persistSupervisorNotes({
        orgId, sessionId, round, output, lastAgentTurn,
    });
    const plan = await persistSupervisorPlan({ orgId, sessionId, round, output });

    await syncBlackboard({ orgId, sessionId, round, topic, output, projectId, sessionKey });

    if (trackOnly) {
        return {
            notes: pending.map((p) => ({ noteType: p.noteType, content: p.content })),
            plan,
            turn: null,
            activeTopic: output.activeTopic,
            nextSteps: output.nextSteps,
            consensusLevel: output.consensusLevel,
            output,
        };
    }

    let turn = await postSupervisorDirective({
        orgId, sessionId, round, output, lastAgentTurn,
    });

    if (output.breakoutSuggestion) {
        turn = await provisionBreakoutRoom({
            orgId,
            sessionId,
            round,
            topic,
            sessionKey,
            projectId,
            roster,
            suggestion: output.breakoutSuggestion,
            turn,
        });
    }

    return {
        notes: pending.map((p) => ({ noteType: p.noteType, content: p.content })),
        plan,
        turn,
        activeTopic: output.activeTopic,
        nextSteps: output.nextSteps,
        consensusLevel: output.consensusLevel,
        output,
    };
}
