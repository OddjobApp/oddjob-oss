/**
 * Crew Learning Service
 *
 * Turns a finished discussion into operational output. Without this, a round is
 * a transcript that dies in its session: agents read their knowledge graphs
 * before speaking (crew-memory) but nothing ever wrote back, so the loop was
 * half open.
 *
 * Three outputs, each landing on machinery that already exists:
 *
 *  1. KNOWLEDGE — settled conclusions become entries in each participating
 *     agent's own knowledge graph, via the same storeEntry() the codegen
 *     missions use (embeddings + 0.85 semantic dedup come free).
 *
 *  2. ISSUES — an unresolved disagreement is a finding. Low consensus plus a
 *     critique is persisted as a crew_issue and published on the cross-app
 *     event bus as BLOCKER_CREATED.
 *
 *  3. INTENT — what the keyword classifier guessed, recorded against what the
 *     discussion actually revealed, giving a labelled corpus for measuring
 *     routing accuracy.
 */

import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
    crewIntentObservations,
    crewIssues,
    crewDecisions,
    crewClaims,
    crewCommitments,
    crewSessions,
} from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import { crewMemoryService, discussionScope } from "./crew-memory.service.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";
import type { CrewIssueRecord, CrewIssueSeverity, CrewRoomMemory, CrewTurnRecord } from "@shared/schema/crew.js";
import type { ToolCallRecord } from "./crew-tools.service.js";
import type { SupervisorOutput } from "./crew-supervisor.service.js";

const logger = createLogger("CrewLearningService");

/**
 * Only conclusions at or above this consensus are written back. Below it the
 * crew has not actually settled anything, and persisting a contested claim as
 * knowledge is worse than persisting nothing.
 */
const WRITE_BACK_MIN_CONSENSUS = 60;

/** At or below this, with a critique on record, the round raises an issue. */
const ISSUE_MAX_CONSENSUS = 40;

export interface WriteBackResult {
    entriesWritten: number;
    agentsUpdated: string[];
}

export class CrewLearningService {
    /**
     * Files what the crew settled into the knowledge graph of every agent that
     * took part, so the next discussion on the subject starts from it.
     *
     * Best-effort throughout: a failed embedding or an unreachable Qdrant must
     * never fail the round the user already saw.
     */
    async writeBackKnowledge(
        orgId: number,
        speakers: AgentCardRecord[],
        output: SupervisorOutput,
        topic: string,
        projectId: number | null = null,
    ): Promise<WriteBackResult> {
        const result: WriteBackResult = { entriesWritten: 0, agentsUpdated: [] };

        const consensus = output.consensusLevel;
        if (consensus === null || consensus < WRITE_BACK_MIN_CONSENSUS) {
            logger.debug(
                `Skipping write-back: consensus ${consensus ?? "unknown"} below ${WRITE_BACK_MIN_CONSENSUS}`,
            );
            return result;
        }

        // What is worth keeping: the settled position, plus durable observations.
        const entries: Array<{ type: string; content: string }> = [];
        if (output.consensus) {
            entries.push({
                type: "discussion_consensus",
                content: `On "${topic}": ${output.consensus}`,
            });
        }
        for (const note of output.notes) {
            entries.push({ type: "discussion_insight", content: `On "${topic}": ${note}` });
        }

        if (entries.length === 0) return result;

        const { agentMemoryAcrossMissionsService } = await import(
            "@domain/agents/core/agent-memory-across-missions.service.js"
        ).catch(() => ({ agentMemoryAcrossMissionsService: null as any }));

        if (!agentMemoryAcrossMissionsService) {
            logger.warn("Agent memory service unavailable; skipping knowledge write-back");
            return result;
        }

        for (const card of speakers) {
            const agentId = await crewMemoryService.resolveAgentId(orgId, card.name);
            if (!agentId) continue;

            for (const entry of entries) {
                try {
                    await agentMemoryAcrossMissionsService.storeEntry(
                        orgId,
                        agentId,
                        // Project Space is encoded into the scope key — see
                        // discussionScope(). This is what stops a private
                        // project's conclusions leaking into another room.
                        discussionScope(projectId),
                        entry.type,
                        entry.content,
                        consensus, // confidence tracks how settled the crew actually was
                        { source: "crew-discussion", topic, projectId },
                    );
                    result.entriesWritten++;
                } catch (err) {
                    logger.warn(
                        `Write-back failed for ${card.name}: ${
                            err instanceof Error ? err.message : String(err)
                        }`,
                    );
                }
            }
            result.agentsUpdated.push(card.name);
        }

        if (result.entriesWritten > 0) {
            logger.info(
                `Wrote ${result.entriesWritten} discussion entries to ${result.agentsUpdated.length} agent knowledge graph(s)`,
            );
        }
        return result;
    }

    /**
     * Writes the supervisor's critique back to the agent it was aimed at.
     *
     * Deliberately NOT gated on consensus, unlike writeBackKnowledge. That gate
     * exists because persisting a contested claim ABOUT THE WORLD as knowledge
     * is worse than persisting nothing — a 20%-consensus conclusion is probably
     * wrong. A critique is a different kind of statement: it is feedback about
     * this agent's own contribution, and on that the supervisor is the authority
     * by construction, not one voice among several.
     *
     * Applying the consensus gate to it inverted the loop. Rounds that went well
     * taught the agent something; rounds that went badly taught it nothing, and
     * a critique became a ticket for a human instead of a signal to the agent
     * being critiqued. Low consensus is exactly when the critique matters most —
     * an agent that keeps answering unresponsively is precisely the one whose
     * rounds never converge, so under the old rule it could never learn.
     *
     * Only the critiqued agent receives it. The critique is attached to the last
     * agent turn, so handing it to every speaker would teach three agents a
     * lesson aimed at one.
     */
    async writeBackCritique(
        orgId: number,
        card: AgentCardRecord,
        output: SupervisorOutput,
        topic: string,
        projectId: number | null = null,
    ): Promise<boolean> {
        if (!output.critique?.trim()) return false;

        const { agentMemoryAcrossMissionsService } = await import(
            "@domain/agents/core/agent-memory-across-missions.service.js"
        ).catch(() => ({ agentMemoryAcrossMissionsService: null as any }));
        if (!agentMemoryAcrossMissionsService) return false;

        const agentId = await crewMemoryService.resolveAgentId(orgId, card.name);
        if (!agentId) return false;

        try {
            await agentMemoryAcrossMissionsService.storeEntry(
                orgId,
                agentId,
                discussionScope(projectId),
                "discussion_critique",
                // Framed in the second person so recall reads back as a lesson
                // about its own conduct rather than as a fact about the domain.
                `On "${topic}", your contribution drew this critique: ${output.critique.trim()}`,
                // Confidence is the supervisor's certainty about the critique,
                // not the room's about the topic — and it is high by definition.
                90,
                { source: "crew-critique", topic, projectId },
            );
            logger.info(`Wrote critique feedback to "${card.name}" for topic "${topic}"`);
            return true;
        } catch (err) {
            logger.warn(
                `Critique write-back failed for ${card.name}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return false;
        }
    }

    /**
     * Raises an issue when the crew looked at something and could not agree.
     *
     * Publishes on the cross-app bus via publish() — note that
     * autonomous-action.service uses EventEmitter.emit() for its own actions,
     * which bypasses the registered-handler registry and the event log.
     */
    async raiseIssueIfUnresolved(params: {
        orgId: number;
        sessionId: number;
        round: number;
        topic: string;
        output: SupervisorOutput;
        sourceTurnId?: number;
        projectId?: number | null;
    }): Promise<CrewIssueRecord | null> {
        const { orgId, sessionId, round, topic, output, sourceTurnId } = params;
        const projectId = params.projectId ?? null;
        const consensus = output.consensusLevel;

        // An issue needs both halves: demonstrable non-agreement AND a stated
        // reason. A low score with no critique is usually just an early round.
        if (consensus === null || consensus > ISSUE_MAX_CONSENSUS) return null;
        if (!output.critique && !output.consensus) return null;

        const severity: CrewIssueSeverity =
            consensus <= 15 ? "high" : consensus <= 30 ? "medium" : "low";

        const detail = [
            output.consensus && `Consensus: ${output.consensus}`,
            output.critique && `Critique: ${output.critique}`,
        ]
            .filter(Boolean)
            .join("\n\n");

        try {
            const [issue] = await db
                .insert(crewIssues)
                .values({
                    sessionId,
                    organizationId: orgId,
                    round,
                    title: `Unresolved: ${topic.slice(0, 160)}`,
                    detail,
                    severity,
                    consensusLevel: consensus,
                    projectId,
                    sourceTurnId: sourceTurnId ?? null,
                })
                .returning();

            try {
                const { crossAppEventBus, CrossAppEventType } = await import(
                    "@domain/org/core/event-bus.service.js"
                );
                await crossAppEventBus.publish({
                    type: CrossAppEventType.BLOCKER_CREATED,
                    organizationId: orgId,
                    sourceApp: "crew",
                    payload: {
                        issueId: issue.id,
                        sessionId,
                        round,
                        title: issue.title,
                        severity,
                        consensusLevel: consensus,
                    },
                });
            } catch (err) {
                // The record is the durable artefact; a bus failure must not lose it.
                logger.warn(
                    `Issue ${issue.id} persisted but not published: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }

            logger.info(`Raised ${severity} issue ${issue.id} (consensus ${consensus})`);
            return issue;
        } catch (err) {
            logger.error(
                `Failed to raise issue: ${err instanceof Error ? err.message : String(err)}`,
            );
            return null;
        }
    }

    /**
     * Records the classifier's guess against what the discussion revealed.
     *
     * One row per discovered intent, so a round that surfaces three real
     * questions behind one vague prompt yields three labelled examples.
     */
    async recordIntentObservations(params: {
        orgId: number;
        sessionId: number;
        round: number;
        message: string;
        topic: string;
        topicConfidence: number;
        intent: string;
        intentConfidence: number;
        discoveredIntents: string[];
        /** #[x] labels the user declared on their turn — ground truth the classifier is measured against. */
        declaredTopics?: string[];
        projectId?: number | null;
    }): Promise<number> {
        const {
            orgId,
            sessionId,
            round,
            message,
            topic,
            topicConfidence,
            intent,
            intentConfidence,
            discoveredIntents,
        } = params;
        const projectId = params.projectId ?? null;
        const declaredTopics = params.declaredTopics ?? [];

        const promptHash = createHash("sha256").update(message).digest("hex");
        const base = {
            sessionId,
            organizationId: orgId,
            round,
            promptHash,
            promptExcerpt: message.slice(0, 500),
            classifiedTopic: topic,
            classifiedTopicConfidence: topicConfidence,
            classifiedIntent: intent,
            classifiedIntentConfidence: intentConfidence,
            declaredTopics,
            projectId,
        };

        const rows =
            discoveredIntents.length > 0
                ? discoveredIntents.map((d) => ({ ...base, discoveredIntent: d }))
                : [{ ...base, discoveredIntent: null }];

        try {
            await db.insert(crewIntentObservations).values(rows);
            return rows.length;
        } catch (err) {
            logger.warn(
                `Failed to record intent observations: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return 0;
        }
    }

    /**
     * Automatically extracts and records Decisions, Claims, and Commitments
     * into the Blackboard database tables and session memory.
     */
    async syncBlackboardArtifacts(params: {
        orgId: number;
        sessionId: number;
        round: number;
        topic: string;
        output: SupervisorOutput;
        projectId?: number | null;
    }): Promise<{
        decisionsCreated: number;
        claimsCreated: number;
        commitmentsCreated: number;
    }> {
        const { orgId, sessionId, round, topic, output, projectId = null } = params;
        let decisionsCreated = 0;
        let claimsCreated = 0;
        let commitmentsCreated = 0;

        const newFacts: string[] = [];

        // 1. DECISIONS: From explicit output.decisions or settled consensus (>= 60)
        const decisionsToRecord: Array<{ statement: string; rationale?: string; confidence: number }> = [];
        if (Array.isArray(output.decisions) && output.decisions.length > 0) {
            for (const d of output.decisions) {
                if (d.statement?.trim()) {
                    decisionsToRecord.push({
                        statement: d.statement.trim(),
                        rationale: d.rationale?.trim() || output.summary || undefined,
                        confidence: d.confidence ?? output.consensusLevel ?? 80,
                    });
                }
            }
        } else if (output.consensus && output.consensusLevel !== null && output.consensusLevel >= WRITE_BACK_MIN_CONSENSUS) {
            decisionsToRecord.push({
                statement: output.consensus.trim(),
                rationale: output.summary?.trim() || undefined,
                confidence: output.consensusLevel,
            });
        }

        for (const dec of decisionsToRecord) {
            try {
                await db.insert(crewDecisions).values({
                    sessionId,
                    organizationId: orgId,
                    statement: dec.statement,
                    rationale: dec.rationale ?? null,
                    confidence: dec.confidence,
                    status: "accepted",
                    round,
                    createdBy: "Supervisor",
                });
                decisionsCreated++;
                newFacts.push(`Decision: ${dec.statement}`);
            } catch (err) {
                logger.warn(
                    `Failed to auto-record decision for session ${sessionId}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        }

        // 2. CLAIMS: From explicit output.claims or agent positions
        const claimsToRecord: Array<{ claim: string; agent?: string; confidence: number }> = [];
        if (Array.isArray(output.claims) && output.claims.length > 0) {
            for (const c of output.claims) {
                if (c.claim?.trim()) {
                    claimsToRecord.push({
                        claim: c.claim.trim(),
                        agent: c.agent?.trim() || undefined,
                        confidence: c.confidence ?? 70,
                    });
                }
            }
        } else if (Array.isArray(output.positions)) {
            for (const pos of output.positions) {
                if (pos.proposition?.trim()) {
                    claimsToRecord.push({
                        claim: pos.proposition.trim(),
                        agent: pos.agent?.trim() || undefined,
                        confidence: pos.confidence,
                    });
                }
            }
        }

        for (const clm of claimsToRecord) {
            try {
                await db.insert(crewClaims).values({
                    sessionId,
                    organizationId: orgId,
                    claim: clm.claim,
                    confidence: clm.confidence,
                    status: clm.confidence >= 75 ? "supported" : "unverified",
                    agreementLevel: output.consensusLevel ?? clm.confidence,
                    createdBy: clm.agent ?? "Supervisor",
                    positions: clm.agent
                        ? [{ agent: clm.agent, stance: "support" as const, confidence: clm.confidence, proposition: clm.claim }]
                        : [],
                });
                claimsCreated++;
            } catch (err) {
                logger.warn(
                    `Failed to auto-record claim for session ${sessionId}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        }

        // 3. COMMITMENTS: From explicit output.commitments or plan steps
        const commitmentsToRecord: Array<{ title: string; owner?: string; detail?: string }> = [];
        if (Array.isArray(output.commitments) && output.commitments.length > 0) {
            for (const c of output.commitments) {
                if (c.title?.trim()) {
                    commitmentsToRecord.push({
                        title: c.title.trim(),
                        owner: c.owner?.trim() || undefined,
                        detail: c.detail?.trim() || undefined,
                    });
                }
            }
        } else if (output.plan?.steps && Array.isArray(output.plan.steps)) {
            for (const step of output.plan.steps) {
                if (step.description?.trim()) {
                    commitmentsToRecord.push({
                        title: step.description.trim(),
                        owner: step.owner?.trim() || undefined,
                        detail: `Step ${step.order} of "${output.plan.title}"`,
                    });
                }
            }
        }

        for (const com of commitmentsToRecord) {
            try {
                await db.insert(crewCommitments).values({
                    sessionId,
                    organizationId: orgId,
                    title: com.title,
                    detail: com.detail ?? null,
                    ownerType: "agent",
                    ownerId: com.owner ?? null,
                    status: "open",
                    createdBy: "Supervisor",
                });
                commitmentsCreated++;
                newFacts.push(`Commitment (${com.owner ?? "Team"}): ${com.title}`);
            } catch (err) {
                logger.warn(
                    `Failed to auto-record commitment for session ${sessionId}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        }

        // 4. Update session memory with newly established facts
        if (newFacts.length > 0) {
            try {
                const [session] = await db
                    .select({ memory: crewSessions.memory })
                    .from(crewSessions)
                    .where(eq(crewSessions.id, sessionId))
                    .limit(1);

                if (session) {
                    const currentMemory: CrewRoomMemory = (session.memory as CrewRoomMemory | null) ?? {
                        facts: [],
                        hypotheses: [],
                        openQuestions: [],
                        constraints: [],
                        ontologyRefs: [],
                        updatedRound: 0,
                    };
                    const updatedFacts = [...(currentMemory.facts || []), ...newFacts].slice(-20);
                    await db
                        .update(crewSessions)
                        .set({
                            memory: sql`jsonb_set(${crewSessions.memory}, '{facts}', ${JSON.stringify(updatedFacts)}::jsonb, true)`,
                        })
                        .where(eq(crewSessions.id, sessionId));
                }
            } catch (err) {
                logger.warn(
                    `Failed to update session memory facts for session ${sessionId}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        }

        logger.info(
            `Blackboard auto-sync for session ${sessionId} round ${round}: ` +
                `${decisionsCreated} decision(s), ${claimsCreated} claim(s), ${commitmentsCreated} commitment(s)`,
        );

        return {
            decisionsCreated,
            claimsCreated,
            commitmentsCreated,
        };
    }

    /**
     * Files what the room's tools actually DID this round.
     *
     * The supervisor's claims are secondhand — it reports what agents said
     * they did, which is how a room could run 38 rounds and leave zero ledger
     * rows. Tool executions are firsthand: the call ran, the output exists.
     * One supported claim per successful call, sourced to the turn that
     * produced it, so the ledger records work even when the review itself
     * fails — and a claim here is a fact of execution, never an opinion the
     * model offered.
     *
     * Bookkeeping tools are excluded: "Copilot ran get_blackboard" is a read
     * of the ledger, not work worth filing in it.
     */
    async recordToolWorkClaims(params: {
        sessionId: number;
        organizationId: number;
        roundTurns: CrewTurnRecord[];
    }): Promise<number> {
        const { sessionId, organizationId, roundTurns } = params;

        const candidates: Array<{ claim: string; toolName: string; digest?: string; turn: CrewTurnRecord }> = [];
        for (const turn of roundTurns) {
            if (turn.speakerType !== "agent") continue;
            for (const tool of (turn.toolsUsed ?? []) as ToolCallRecord[]) {
                if (!tool.ok || LEDGER_META_TOOLS.has(tool.name)) continue;
                const claim =
                    `${turn.speakerName} ran ${tool.name}` +
                    (tool.digest ? ` — ${tool.digest}` : "");
                candidates.push({ claim: claim.slice(0, 500), toolName: tool.name, digest: tool.digest, turn });
            }
        }
        if (candidates.length === 0) return 0;

        // Two dedup layers. Derivation is deterministic, so a repeated run of
        // the same turn produces the same claim text — (sourceTurnId, claim)
        // catches a retried round. The second layer is cross-round: the same
        // speaker running the same tool in a later turn should fold new
        // evidence into the standing claim ("Copilot ran google_search"), not
        // open a second row per round, or the ledger re-becomes a transcript.
        const existing = await db
            .select({
                id: crewClaims.id,
                sourceTurnId: crewClaims.sourceTurnId,
                claim: crewClaims.claim,
                evidence: crewClaims.evidence,
            })
            .from(crewClaims)
            .where(eq(crewClaims.sessionId, sessionId))
            .limit(500);
        const seen = new Set(existing.map((r) => `${r.sourceTurnId}::${r.claim}`));
        const byPrefix = new Map<string, (typeof existing)[number]>();
        for (const row of existing) byPrefix.set(row.claim.split(" — ")[0].toLowerCase(), row);

        let created = 0;
        for (const c of candidates) {
            if (seen.has(`${c.turn.id}::${c.claim}`)) continue;
            const evidenceEntry = {
                label: c.toolName,
                ...(c.digest ? { excerpt: c.digest } : {}),
                ...(c.turn.createdAt ? { retrievedAt: new Date(c.turn.createdAt).toISOString() } : {}),
            };
            const prefixKey = `${c.turn.speakerName} ran ${c.toolName}`.toLowerCase();
            const prior = byPrefix.get(prefixKey);
            try {
                if (prior) {
                    const evidence = [...(prior.evidence ?? []), evidenceEntry].slice(-20);
                    await db.update(crewClaims).set({
                        claim: c.claim,
                        sourceTurnId: c.turn.id,
                        evidence,
                        updatedAt: new Date(),
                    }).where(eq(crewClaims.id, prior.id));
                    prior.claim = c.claim;
                    prior.sourceTurnId = c.turn.id;
                    prior.evidence = evidence;
                    continue;
                }
                await db.insert(crewClaims).values({
                    sessionId,
                    organizationId,
                    claim: c.claim,
                    status: "supported",
                    confidence: 100,
                    sourceTurnId: c.turn.id,
                    evidence: [evidenceEntry],
                    positions: [{ agent: c.turn.speakerName, stance: "support" as const, confidence: 100, proposition: c.claim }],
                    createdBy: c.turn.speakerName,
                });
                byPrefix.set(prefixKey, { id: -1, sourceTurnId: c.turn.id, claim: c.claim, evidence: [evidenceEntry] });
                created++;
            } catch (err) {
                logger.warn(
                    `Failed to record tool-work claim for session ${sessionId}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        }
        return created;
    }
}

/**
 * Reads and room-keeping calls: running one is not work a ledger row should
 * claim. Everything else that succeeded is.
 */
const LEDGER_META_TOOLS = new Set([
    "get_blackboard",
    "update_blackboard",
    "request_human_input",
    "request_help",
    "request_mcp_tool",
    "discover_capabilities",
    "list_available_mcp_capabilities",
]);

export const crewLearningService = new CrewLearningService();
