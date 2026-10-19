import { crewStudioForTurns, resolveCrewStudio } from "./crew-studio-tools.js";
/**
 * Crew Orchestrator Service
 *
 * Runs a round of multi-agent discussion.
 *
 * A round is: the user says something, some subset of the crew responds — each
 * agent seeing what the agents before it said in the same round, so they argue
 * with each other rather than all answering the user in parallel — and then the
 * supervisor reviews the round and critiques, refines consensus, summarises and
 * (when the discussion has converged) plans.
 *
 * Who speaks is decided by topic and intent affinity, using the same keyword
 * classifiers the intent router already uses. That is what makes the crew
 * respond "based on the subject being discussed": a Code question puts the
 * engineers in front, a compliance question puts the auditor in front.
 *
 * Each speaking agent is prompted with its own Legend + OCEAN personality and
 * with recall from its own accumulated knowledge graph, so a crew member argues
 * from the experience it actually has.
 */

import { and, asc, desc, eq, gt, gte, sql } from "drizzle-orm";
import { db, pool } from "@server/database_service.js";
import {
    agentCards,
    crewAttachments,
    crewBreakouts,
    crewHandRaises,
    crewCommitments,
    crewDecisions,
    crewIssues,
    crewMembers,
    crewPlans,
    crewSessions,
    crewTurns,
    scribeDocuments,
    orgs,
    projectEvents,
    supervisorNotes,
    type AgentCardRecord,
    type CrewRoomMemory,
    type CrewTurnRecord,
    type SupervisorNoteType,
} from "@shared/schema/index.js";
import { COPILOT_PERSONA_TYPE } from "@shared/constants/agent-personas.js";
import { intentRouterService } from "@domain/intent-router/core/intent-router.service.js";
import { scribeIntentResolverService } from "@domain/intent-router/core/scribe-intent-resolver.service.js";
import { optionalRoundContext } from "./optional-round-context.js";
import { createLogger } from "@server/utils/logger.js";
import { crewGenerationService, type GenerationMessage } from "./crew-generation.service.js";
import { crewBeliefsService } from "./crew-beliefs.service.js";
import { crewBudgetService } from "./crew-budget.service.js";
import { crewLearningService } from "./crew-learning.service.js";
import { crewMemoryService } from "./crew-memory.service.js";
import { crewClaimsService } from "./crew-claims.service.js";
import { crewRepository } from "./crew-repository.js";
import { buildCrewToolContext } from "./crew-tool-context.js";
import {
    RESEARCH_LADDER,
    TRANSCRIPT_WINDOW,
    extractMarkdownJsonToolCalls,
    generateForCard,
    splitPrediction,
    toGenerationMessages,
} from "./crew-turn-generation.js";
import { detectAssemblyIntent } from "./crew-assembly-directives.js";
import type { CrewOutputIntent } from "@shared/crew-output-intent.js";
import { hasPendingForgeDraft } from './crew-forge-brief.js';
import { runDirectiveFollowUp, runSupervisor } from "./crew-supervisor-round.service.js";
import { consumeCancellation, restatementScore, runSpeakerTurn } from "./crew-speaker-turn.service.js";
import { persistTurnTags, type PersistedTurnTag } from "./crew-topics.service.js";
import {
    acquireSessionLock,
    concludeSession,
    ensureSession,
    getRoomDelta,
    reopenSession,
    seedCopilotMember,
    type SessionLock,
} from "./crew-session.service.js";
// Re-exported: the routes and tests reach these through the orchestrator.
export { acquireSessionLock, concludeSession, ensureSession, getRoomDelta, reopenSession, type SessionLock };
import { stripRenderedArtifactEchoes } from "./crew-turn-generation.js";
// Re-exported: both were part of this module's public surface before they moved.
export { restatementScore, stripRenderedArtifactEchoes };
import {
    CREATE_INTENTS,
    isAppStudioRequest,
    isProjectStudioRequest,
    isComputerUseStudioRequest,
    isExplicitExternalResearchRequest,
    isFactualLookupRequest,
    isScribeAuthoringRequest,
    isScribeEditRequest,
    parseForgeConfirmation,
    parseMigrationApproval,
    isComputerUseStudioActive,
    type RoundContext,
    type RoundCost,
    type SupervisorRoundResult,
} from "./crew-round-context.js";
// Re-exported: these were part of this module's public surface before they moved.
export {
    CREATE_INTENTS,
    isAppStudioRequest,
    isProjectStudioRequest,
    isComputerUseStudioRequest,
    isExplicitExternalResearchRequest,
    isFactualLookupRequest,
    isScribeAuthoringRequest,
    parseForgeConfirmation,
    parseMigrationApproval,
    type RoundContext,
    type RoundCost,
    type SupervisorRoundResult,
};
import {
    mountedStudioApp,
    runDirectAppStudioChange,
    runDirectAppStudioMount,
    runDirectCycleAppMount,
    runDirectForgeStart,
} from "./crew-app-studio.service.js";
import { runDirectFormStudioAction } from "./crew-form-studio.service.js";
import { runDirectContributionApply } from "./crew-contribution.service.js";
import { runDirectFlowStudioAction } from "./crew-flow-studio.service.js";
import { runDirectPredictionStudioAction } from "./crew-prediction-studio.service.js";
import { runDirectAgentStudioAction } from "./crew-agent-studio.service.js";
import { runDirectComputerAction } from "./crew-computer-action.service.js";
import { runDirectMediaStudioAction } from "./crew-media-studio.service.js";
import { mediaIntentResolver } from "@domain/intent-router/core/media-intent-resolver.service.js";
import { crewPersonaService } from "./crew-persona.service.js";
import {
    crewSupervisorService,
    type SupervisorOutput,
    type SupervisorTranscriptTurn,
} from "./crew-supervisor.service.js";
import { crewParticipantsService } from "./crew-participants.service.js";
import { crewStreamService } from "./crew-stream.service.js";
import { crewTriageService, isConfirmationMessage, type CrewMode } from "./crew-triage.service.js";
import {
    crewToolsService,
    MAX_TOOL_CALLS_PER_TURN,
    ARTIFACT_TOOLS,
    batchConcurrentToolCalls,
    type CrewArtifact,
    type ToolCallRecord,
    type ResolvedCrewTool,
} from "./crew-tools.service.js";
import type { ToolContext } from "@domain/tools/v1/capabilities/types.js";
import { syntheticPersonaService } from "@domain/agents/core/synthetic-persona.service.js";
import { userInterestGraphService } from "@domain/agents/core/user-interest-graph.service.js";
import { oceanAssessmentService } from "@domain/agents/core/ocean-assessment.service.js";


const logger = createLogger("CrewOrchestratorService");


/**
 * How many crew members speak per round. Every speaker is a sequential model
 * call — they must be sequential for agents to react to each other — so this is
 * the main lever on round latency.
 */
const MAX_SPEAKERS_PER_ROUND = 3;

/** Words too common to indicate that an agent is relevant to a question. */
const RELEVANCE_STOPWORDS = new Set([
    "the", "and", "for", "our", "are", "was", "were", "with", "that", "this",
    "have", "has", "should", "would", "could", "what", "does", "did", "you",
    "your", "from", "into", "about", "there", "their", "them", "they", "than",
    "then", "when", "where", "which", "will", "can", "not", "but", "how",
    "why", "who", "any", "all", "some", "more", "most", "need", "want",
    "help", "please", "agent", "agents", "ai",
]);

function relevanceTokens(text: string): Set<string> {
    const words = (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
        .filter((w) => w.length > 3 && !RELEVANCE_STOPWORDS.has(w))
        // Crude singularisation, matching tool-subsetting's approach: "queues"
        // should match "queue".
        .map((w) => (w.length >= 5 && w.endsWith("s") ? w.slice(0, -1) : w));
    return new Set(words);
}

/**
 * How relevant an agent looks to what was actually asked.
 *
 * Affinity alone could not answer this. The intent router abstains often — it
 * returned confidence 0 for BOTH topic and intent on a real question, falling
 * back to General/Chat — and every card in the org declares General, so scoring
 * on affinity picked whichever cards happened to declare `Chat`. That is how an
 * "action_item_template Form Agent" ended up debating LLM rate limits.
 *
 * Name and capabilities carry the signal; descriptions frequently do not, being
 * boilerplate like "AI Agent: X" or "A specialized mock agent for testing." All
 * three are matched, weighted by how much they usually mean.
 *
 * Lexical rather than embedding-based, deliberately: this runs before the first
 * agent speaks, across every enabled card in the org, and a vector round-trip
 * per candidate is not worth it to choose who joins a conversation.
 */
export function agentRelevanceScore(message: string, card: AgentCardRecord): number {
    const terms = relevanceTokens(message);
    if (terms.size === 0) return 0;

    const nameTokens = relevanceTokens(card.name ?? "");
    const capabilityTokens = relevanceTokens((card.capabilities ?? []).join(" "));
    const descriptionTokens = relevanceTokens(card.description ?? "");

    let score = 0;
    for (const term of terms) {
        if (nameTokens.has(term)) score += 3;
        else if (capabilityTokens.has(term)) score += 2;
        else if (descriptionTokens.has(term)) score += 1;
    }
    return score;
}


export interface ConsensusMetrics {
    consensusRatio: number; // 0..1
    converged: boolean;
    activeSpeakerCount: number;
    conflictCount: number;
}

/**
 * Evaluates semantic consensus and convergence across turns in a discussion round.
 */
export function calculateConsensusMetrics(
    turns: Array<{ agentCardId?: number; content: string }>,
    threshold: number = 0.75,
): ConsensusMetrics {
    if (!turns || turns.length < 2) {
        return {
            consensusRatio: 1.0,
            converged: turns.length === 1,
            activeSpeakerCount: turns.length,
            conflictCount: 0,
        };
    }

    let totalPairs = 0;
    let agreementScore = 0;
    let conflictCount = 0;

    const conflictIndicators = /\b(disagree|incorrect|wrong|object|cannot\s+support|don't\s+support|reject|conflict|issue\s+with|oppose)\b/i;
    const agreementIndicators = /\b(agree|concur|align|support|makes\s+sense|valid\s+point|confirmed)\b/i;

    for (let i = 0; i < turns.length; i++) {
        for (let j = i + 1; j < turns.length; j++) {
            totalPairs++;
            const t1 = turns[i].content;
            const t2 = turns[j].content;

            const hasConflict = conflictIndicators.test(t1) || conflictIndicators.test(t2);
            const hasAgreement = agreementIndicators.test(t1) || agreementIndicators.test(t2);

            if (hasConflict) {
                conflictCount++;
                agreementScore += 0.2;
            } else if (hasAgreement) {
                agreementScore += 0.9;
            } else {
                agreementScore += 0.6;
            }
        }
    }

    const consensusRatio = totalPairs > 0 ? Number((agreementScore / totalPairs).toFixed(2)) : 1.0;
    const converged = consensusRatio >= threshold && conflictCount === 0;

    return {
        consensusRatio: Math.min(1.0, consensusRatio),
        converged,
        activeSpeakerCount: new Set(turns.map(t => t.agentCardId).filter(Boolean)).size,
        conflictCount,
    };
}

export interface BeliefState {
    verifiedFacts: string[];
    hypotheses: string[];
    openConstraints: string[];
    updatedAt: string;
}

/**
 * Extracts verified facts, active hypotheses, and operational constraints from discussion turns.
 */
export function extractBeliefState(
    turns: Array<{ agentCardId?: number; content: string }>,
): BeliefState {
    const verifiedFacts: string[] = [];
    const hypotheses: string[] = [];
    const openConstraints: string[] = [];

    const factIndicators = /\b(verified|confirmed|proven|established|metric shows|database contains|test passed)\b/i;
    const hypothesisIndicators = /\b(hypothesis|assume|might be|could be|likely|possibly|suspect)\b/i;
    const constraintIndicators = /\b(must not|required to|constraint|budget limit|deadline|cannot exceed|strict)\b/i;

    for (const turn of turns) {
        const sentences = turn.content.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 10);
        for (const sentence of sentences) {
            if (factIndicators.test(sentence)) {
                if (!verifiedFacts.includes(sentence)) verifiedFacts.push(sentence);
            } else if (hypothesisIndicators.test(sentence)) {
                if (!hypotheses.includes(sentence)) hypotheses.push(sentence);
            } else if (constraintIndicators.test(sentence)) {
                if (!openConstraints.includes(sentence)) openConstraints.push(sentence);
            }
        }
    }

    return {
        verifiedFacts,
        hypotheses,
        openConstraints,
        updatedAt: new Date().toISOString(),
    };
}


export interface RaisedHand {
    agentCardId: number;
    agentName: string;
    reason: string;
    affinityScore: number;
    memoryHits: number;
}

export interface RunRoundResult {
    sessionId: number;
    round: number;
    turns: CrewTurnRecord[];
    supervisor: SupervisorRoundResult;
    topic: string;
    intent: string;
    /** 'conversational' means triage judged the message not worth a full round. */
    mode: CrewMode;
    /** Members who did not speak but signalled they have something to add. */
    raisedHands: RaisedHand[];
    /** What this round spent — model calls, time inside them, tool executions. */
    cost: RoundCost;
}





/**
 * Detects when the same agent has produced near-identical content across recent
 * rounds — the "Yes loop" pattern where an agent describes calling a tool without
 * actually calling it, repeating across multiple user confirmations.
 *
 * Returns a corrective instruction to inject into that agent's next turn prompt,
 * or null if no loop is detected.
 *
 * Two conditions must both be true:
 *   1. The last 3 agent turns from this agent have high word-overlap (avgScore ≥ 0.45).
 *   2. None of those turns made progress — either all-prose, or the same
 *      set of tool calls with no new successful calls.
 *
 * The threshold is lower than restatementScore's 0.8 because "ACTION AND EVIDENCE /
 * JSON Request / Follow-Up Action / Would you like me to proceed?" varies just
 * enough in wording to stay below 0.6 while being semantically identical loops.
 */
function detectStuckLoop(
    agentName: string,
    priorTurns: CrewTurnRecord[],
): string | null {
    const agentTurns = priorTurns
        .filter((t) => t.speakerType === "agent" && t.speakerName === agentName)
        .slice(-6);

    if (agentTurns.length < 3) return null;

    const recent = agentTurns.slice(-3);

    // No-progress check: turns that made progress (called new successful tools)
    // should not be flagged. But turns that only called the SAME tool with the
    // same args repeatedly (e.g. mount_signal_studio 3 times) are still loops.
    const successfulToolNames = recent.map((t) =>
        ((t.toolsUsed as Array<{ name: string; ok: boolean }>) ?? [])
            .filter((tc) => tc.ok)
            .map((tc) => tc.name)
            .sort()
            .join(","),
    );
    const allSameTools =
        successfulToolNames.every((s) => s === successfulToolNames[0]) &&
        successfulToolNames[0] !== "";
    const allProseOnly = recent.every(
        (t) =>
            !t.toolsUsed ||
            (t.toolsUsed as Array<{ ok: boolean }>).length === 0 ||
            (t.toolsUsed as Array<{ ok: boolean }>).every((tc) => !tc.ok),
    );
    if (!allProseOnly && !allSameTools) return null;

    // Content overlap — lower threshold than restatementScore because "ACTION AND
    // EVIDENCE / JSON Request / Follow-Up Action / Would you like me to proceed?"
    // varies just enough in wording to stay below 0.6.
    const scores: number[] = [];
    for (let i = 0; i < recent.length - 1; i++) {
        scores.push(restatementScore(recent[i].content, recent[i + 1].content));
    }
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avgScore < 0.45) return null;

    logger.warn(
        `Loop detected for "${agentName}": last 3 turns avg overlap ${avgScore.toFixed(2)}, ` +
            `no new successful tool calls — injecting circuit breaker`,
    );

    return (
        `\n\nCIRCUIT BREAKER: You have described the same intended action without completing it ` +
        `across multiple rounds. This round you MUST do one of the following — no other output ` +
        `is acceptable:\n` +
        `(a) Call the tool now with the correct arguments. Do not describe calling it — call it.\n` +
        `(b) If the tool is genuinely unavailable or the action is blocked, state the specific ` +
        `blocker in one sentence and propose a concrete alternative action you can take right now.\n` +
        `Do not repeat what you said in previous rounds.`
    );
}

/** The agent-fleet or deck intake, or a request that names the art director. */
function isArtDirectionRequest(message: string): boolean {
    return (
        /pixel\s*maestro|art\s*director|agent-art-director/i.test(message) ||
        /\[DIVERSE PRIMITIVE INTAKE:\s*(?:CONFIGURE AGENT FLEET\]|GENERATE DECK)/i.test(message)
    );
}

function isArtDirectorCard(card: AgentCardRecord): boolean {
    return /pixel\s*maestro|art\s*director/i.test(card.name ?? "") || /art-director/i.test(card.personaType ?? "");
}

/**
 * A message from the person that states work to be done — recorded as a
 * durable fact whether or not the supervisor's review ran or parsed.
 *
 * The failure this closes: a room where the requirement was stated four times
 * ("I want to build a distressed realestate flow…") and never once landed in
 * `memory`, because every round that carried it was an answer task and the
 * supervisor's bookkeeping was skipped with its directive. A requirement is
 * the user's own text — extracting it here costs no model call and cannot be
 * lost to a generation failure.
 *
 * What is NOT a requirement: card commands ("Apply contribution …"), injected
 * selections ("[Signal Studio selection: …]"), mentions (a question asked of
 * one agent), and confirmations — "Yes, please upload the attachment" begins
 * with an approval word, and the requirement it approves was already stated.
 */
const REQUIREMENT_WORK_VERB =
    /\b(?:want|need|needs?|build|create|make|use|add|show|display|search|find|track|identify|give|get|set\s*up|configur\w*|ingest|monitor|alert|fetch|pull|write|draft|generate|design|deploy|lets?\b|let'?s|i'?d like|i would like|can you|could you|please|should\s+be|must\s+be|need\s+to|want\s+to)\b/i;

export function extractUserRequirement(message: string): string | null {
    const text = message.trim();
    // Too short to state a requirement — "Yes", "1", "hi".
    if (text.length < 20) return null;
    if (/^(?:apply contribution|create flow|create form|create agent|build\s+["']|i confirmed stage|\[|@)/i.test(text)) return null;
    if (isConfirmationMessage(text)) return null;
    // "Yes, please do X" / "Sure, add that" — an approval prefix, not a
    // requirement. The requirement it confirms was already stated.
    if (/^(?:yes|yeah|yep|ok|okay|sure|proceed|continue|go ahead|confirmed?|agreed)\b[\s,!.]/i.test(text)) return null;
    if (!REQUIREMENT_WORK_VERB.test(text)) return null;
    return text.slice(0, 280);
}

/**
 * A request to make a film, as the Media Studio resolver reads it.
 *
 * Resolved with no production context on purpose: this only has to establish
 * that the room is talking about a film at all, which is what recruitment turns
 * on. Which production and which scene are questions for the direct path, after
 * it has paid for the lookup.
 *
 * It matters because of what happened without it. A room asked to make a video
 * recruited by generic relevance and seated a SQL Schema Migration Guardian and
 * an Emergency Dispatch Coordinator, who between them produced a database
 * migration for a film's style guide. The Make a Film playbook has named its
 * roster — Director, Screenwriter, Cinematographer, Editor — all along; nothing
 * reached it unless the author clicked the card.
 */
function isFilmCrewRequest(message: string): boolean {
    const { intent, confidence } = mediaIntentResolver.resolve(message);
    return intent !== null && confidence >= 0.7;
}

function isFilmCrewCard(card: AgentCardRecord): boolean {
    const name = card.name ?? "";
    const persona = card.personaType ?? "";
    return (
        /\b(?:director|cinematographer|screenwriter|scriptwriter|storyboard|film\s*editor|video\s*editor|media\s*creator|producer)\b/i.test(name)
        || /director|cinematograph|screenwriter|storyboard|film|video/i.test(persona)
    );
}

/**
 * Keywords that signal a user needs a specific capability. When a message
 * contains one of these keywords, agents whose declared tools include the
 * matched tool name score higher. This prevents irrelevant agents (e.g. a
 * marketing planner) from answering data ingestion or web fetch questions
 * just because they scored on generic affinity terms.
 *
 * Kept keyword-based and model-free: this runs before any model call.
 */
const TOOL_AFFINITY_SIGNALS: Array<{ pattern: RegExp; toolNames: string[] }> = [
    { pattern: /upload|attach|ingesti?on|import file/i, toolNames: ["upload_attachment", "ingest_document", "create_dataset"] },
    { pattern: /search (the )?web|google|browse|external.*search|web.*search/i, toolNames: ["google_search", "browse_web"] },
    { pattern: /signal studio|spatial|map|geo|zipcode/i, toolNames: ["mount_signal_studio"] },
    { pattern: /knowledge base|unified knowledge|internal.*search/i, toolNames: ["search_unified_knowledge"] },
    { pattern: /build|scaffold|create (an )?app|forge/i, toolNames: ["mount_builder_pod", "scaffold_multistep_app"] },
    { pattern: /send (an )?email|email.*to|draft.*email/i, toolNames: ["send_agentmail", "send_email"] },
    { pattern: /computer|desktop|browser automation|playwright/i, toolNames: ["trycua_screenshot", "trycua_click"] },
    { pattern: /dataset|analytics|metric|report/i, toolNames: ["list_datasets", "get_dataset_items", "calculate_dataset_metric"] },
];

/**
 * Boost for agents whose declared tools match what the message is asking for.
 * Cards that hold the relevant tool score +4 — enough to override a generic
 * affinity match, not enough to override an @mention or a high-stakes verb.
 */
function toolAffinityBoost(message: string, card: AgentCardRecord): number {
    const declaredTools = new Set<string>(card.tools as string[] ?? []);
    if (declaredTools.size === 0) return 0;

    let boost = 0;
    for (const { pattern, toolNames } of TOOL_AFFINITY_SIGNALS) {
        if (pattern.test(message)) {
            if (toolNames.some((t) => declaredTools.has(t))) {
                boost += 4;
            }
        }
    }
    return boost;
}

export class CrewOrchestratorService {
    // ── Session management ───────────────────────────────────────────────



    // ── Speaker selection ────────────────────────────────────────────────

    /**
     * Finds crew members explicitly addressed with @Name in a message.
     * Matched longest-name-first so "@AI Trainer" is not shadowed by "@AI".
     */
    parseMentions(message: string, members: AgentCardRecord[]): AgentCardRecord[] {
        if (!message.includes("@")) return [];

        const lower = message.toLowerCase();
        return [...members]
            .sort((a, b) => b.name.length - a.name.length)
            .filter((m) => lower.includes(`@${m.name.toLowerCase()}`));
    }

    /**
     * Ranks the roster against the subject under discussion, using the same
     * affinity scoring the intent router uses for single-agent selection
     * (requirement 8.2): one point for a topic match, one for an intent match.
     *
     * An explicit @mention overrides affinity entirely — if the user named who
     * they want, that is the answer. Otherwise everyone in the room is eligible;
     * a zero-affinity member can still speak if the room is small. Ties break on
     * card id, so ordering is stable.
     */
    selectSpeakers(
        members: AgentCardRecord[],
        topic: string,
        intent: string,
        message = "",
    ): AgentCardRecord[] {
        const mentioned = this.parseMentions(message, members);
        if (mentioned.length > 0) return mentioned.slice(0, MAX_SPEAKERS_PER_ROUND);

        const isAppStudio = isAppStudioRequest(message);
        // Hoisted: this asks the same question of the same message for every
        // card, and the resolver is a whole rule table rather than one regex.
        const isFilmRequest = isFilmCrewRequest(message);

        const scored = members.map((card) => {
            let score = 0;
            if ((card.topicAffinities ?? []).includes(topic as never)) score += 2;
            if ((card.intentAffinities ?? []).includes(intent as never)) score += 1;
            score += agentRelevanceScore(message, card);
            score += toolAffinityBoost(message, card);

            if (isAppStudio) {
                const isArchitect =
                    /architect/i.test(card.name ?? "") ||
                    /architect/i.test(card.personaType ?? "") ||
                    (card.capabilities ?? []).some((c) => /architect|scaffold|app/i.test(c));
                if (isArchitect) {
                    score += 10;
                }
            }

            // isScribeEditRequest defaults hasActiveDocument to false on purpose:
            // passing true reduces it to "any action verb", so "generate a report"
            // or "improve the query" would score an author into an unrelated room.
            const isAuthoringRequest =
                /ghostwriter|ghost\s*writer/i.test(message) ||
                isScribeEditRequest(message) ||
                isScribeAuthoringRequest(message);
            if (isAuthoringRequest) {
                const isAuthor =
                    /ghostwriter/i.test(card.name ?? "") ||
                    /ghostwriter/i.test(card.personaType ?? "") ||
                    (card.capabilities ?? []).some((c) => /author|prose|manuscript|rewrite/i.test(c));
                if (isAuthor) {
                    score += 15;
                }
            }

            if (isArtDirectionRequest(message) && isArtDirectorCard(card)) {
                score += 25;
            }

            // A film question goes to whoever makes films. Weighted alongside art
            // direction rather than above it: both are "the right specialist is in
            // the room, let them answer".
            if (isFilmRequest && isFilmCrewCard(card)) {
                score += 25;
            }

            return { card, score };
        });

        scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.card.id - b.card.id));
        return scored.slice(0, MAX_SPEAKERS_PER_ROUND).map((s) => s.card);
    }

    // ── The round ────────────────────────────────────────────────────────

    /**
     * Close the round: persist the supervisor's claims, report the cost, tell
     * the room it finished.
     *
     * Claim extraction is awaited but its failure is logged and swallowed: the
     * round happened, and losing the derived claims is not a reason to fail a
     * request whose turns are already committed. round-complete is published
     * before the learning pass is scheduled so the client is not waiting on
     * background work to be told the round is over.
     */
    private async closeRound(scope: {
        orgId: number;
        sessionKey: string;
        session: { id: number };
        round: number;
        userId?: string;
        cost: RoundCost;
        roundTurns: CrewTurnRecord[];
        supervisorResult: SupervisorRoundResult;
    }): Promise<void> {
        const { orgId, sessionKey, session, round, userId, cost, roundTurns, supervisorResult } = scope;

        if (supervisorResult.output?.positions.length) {
            await crewClaimsService.persistSupervisorClaims({
                sessionId: session.id,
                organizationId: orgId,
                output: supervisorResult.output,
                turns: roundTurns,
            }).catch((err) => logger.warn(`Claim extraction failed: ${err?.message ?? err}`));
        }

        logger.info(
            `Round ${round} (session ${session.id}) cost: ${cost.modelCalls} model call(s), ` +
                `${cost.toolCalls} tool call(s), ${(cost.generationMs / 1000).toFixed(1)}s in generation.`,
        );

        void crewStreamService.publish({
            type: "round-complete",
            organizationId: orgId,
            sessionKey,
            actor: userId,
            payload: { round },
        });
    }

    /**
     * The supervisor's review, and whatever it causes to be said.
     *
     * Returns the turns to append rather than pushing them onto the caller's
     * array. runRound owns roundTurns; a phase that mutated it in place hid two
     * appends behind a call that looked like it only computed a review, and both
     * runSupervisor and runDirectiveFollowUp read that array while it was being
     * written. Both are read-only on it, which is what makes handing them a
     * snapshot safe.
     *
     * `skip` short-circuits the whole phase for an answer task. Raising hands is
     * useful only when the room will continue a discussion: it used to run a
     * memory lookup for every silent member even for a greeting or a factual
     * answer, delaying the response after the requested agent had finished.
     */
    private async runSupervisorPhase(scope: {
        skip: boolean;
        /** Review and record, but never speak — for answer tasks that still
         *  carry requirements or tool work worth tracking. */
        trackOnly: boolean;
        orgId: number;
        sessionKey: string;
        session: { id: number; cycleContext?: { studio?: any } | null };
        activeStudio?: string | null;
        round: number;
        message: string;
        topic: string;
        intent: string;
        members: AgentCardRecord[];
        speakers: AgentCardRecord[];
        roster: Array<{ name: string; description: string }>;
        projectId: number | null;
        projectKey: string | null;
        roundTurns: CrewTurnRecord[];
        cost: RoundCost;
        declaredTags?: string[];
    }): Promise<{
        supervisorResult: SupervisorRoundResult;
        raisedHands: Awaited<ReturnType<CrewOrchestratorService["collectRaisedHands"]>>;
        appendedTurns: CrewTurnRecord[];
    }> {
        const {
            skip, trackOnly, orgId, sessionKey, session, round, message, topic, intent,
            members, speakers, roster, projectId, projectKey, roundTurns, cost, declaredTags = [],
        } = scope;

        const empty: SupervisorRoundResult = {
            notes: [],
            plan: null,
            turn: null,
            activeTopic: "",
            nextSteps: "",
            consensusLevel: null,
            output: null,
        };

        if (skip) return { supervisorResult: empty, raisedHands: [], appendedTurns: [] };

        // Raised hands matter only when the room will continue a discussion —
        // on a track-only answer task nobody follows up, so the memory lookup
        // for each silent member would be cost without a reader.
        const raisedHands = trackOnly ? [] : await this.collectRaisedHands({
            orgId,
            sessionId: session.id,
            round,
            members,
            spoke: speakers,
            topic,
            intent,
            message,
            declaredTags,
            projectId,
        });

        const speakerWithBinding = speakers.find(
            (s) => s.modelBindingProviderId != null && s.modelBindingModelId != null,
        ) || members.find(
            (m) => m.modelBindingProviderId != null && m.modelBindingModelId != null,
        );
        const supervisorModelBinding = speakerWithBinding
            ? {
                  modelBindingProviderId: speakerWithBinding.modelBindingProviderId,
                  modelBindingModelId: speakerWithBinding.modelBindingModelId,
              }
            : null;

        const supervisorResult = await runSupervisor({
            cost,
            orgId,
            sessionId: session.id,
            round,
            topic: message,
            roundTurns,
            roster,
            projectId,
            sessionKey,
            trackOnly,
            modelBinding: supervisorModelBinding,
        });

        const appendedTurns: CrewTurnRecord[] = [];
        if (supervisorResult.turn) {
            appendedTurns.push(supervisorResult.turn);
            void crewStreamService.publish({
                type: "turn-content",
                organizationId: orgId,
                sessionKey,
                payload: { turn: supervisorResult.turn, round },
            });

            // 5b. The agent the supervisor addressed answers, in this round.
            //
            // The supervisor speaks last and rounds only start from a user
            // message, so "@Copilot, clarify X" had nobody listening: the round
            // was over. The directive sat in the transcript until the user spoke
            // again, which made the supervisor look ignored and made the user do
            // the work of relaying it.
            const followUp = await runDirectiveFollowUp({
                orgId,
                sessionKey,
                sessionId: session.id,
                round,
                members,
                directive: supervisorResult.turn.content,
                studio: resolveCrewStudio(scope.activeStudio, roundTurns, session.cycleContext?.studio),
                supervisorTurnId: supervisorResult.turn.id,
                // The follow-up must see the supervisor's turn it is answering.
                roundTurns: [...roundTurns, supervisorResult.turn],
                projectId,
                projectKey,
                roster,
                cost,
            });
            if (followUp) appendedTurns.push(followUp);
        }

        return { supervisorResult, raisedHands, appendedTurns };
    }

    /**
     * Did one of the direct paths answer this round on its own?
     *
     * True means the round is already answered and the speaker loop must not
     * run: these paths post their own turn, and letting the crew also discuss
     * the request would answer it twice.
     *
     * Order matters, in three ways:
     *
     * Scribe first. Note it short-circuits only when it actually mounts: a
     * scribe request whose mount does not take still falls through to the studio
     * paths, which is what the original `directScribeMounted ? false : ...`
     * expressed.
     *
     * A confirmed build next: its message is a fixed string emitted by a
     * surface, and no other path should get a chance to reinterpret it.
     *
     * Change before mount. Once a studio is open for an app, the next thing the
     * author says about it is far more often a change than a request to see it
     * again, and re-mounting in answer to "add a page" would look like the room
     * ignored them. The request gate is skipped for the change path when a
     * studio is already open: those patterns all require an app noun, and once
     * the studio is on screen nobody says it any more -- "make the header
     * sticky" is obviously about the app in front of them. The resolver must
     * still reach a change intent at confidence, so an open studio widens what
     * is considered, never what is acted on.
     */
    private async runDirectAction(ctx: RoundContext): Promise<boolean> {
        const { message, speakers } = ctx;
        const speaker = speakers[0];

        // A change asked for about something marked in Media Studio, or the approval
        // its card sent. Both are explicit, so no other path reads them first.
        if (await runDirectMediaStudioAction(ctx, speaker)) return true;

        // The contribution card's Apply message — an exact string, claimed
        // before anything else can read it as a request.
        if (await runDirectContributionApply(ctx, speaker)) return true;

        if (await this.runDirectProjectStudioMount(ctx, speaker)) return true;
        if (await runDirectComputerAction(ctx, speaker)) return true;
        if (await this.runDirectComputerStudioMount(ctx, speaker)) return true;

        const scribeMounted = isScribeAuthoringRequest(message)
            ? await this.runDirectScribeMount(ctx, speaker)
            : false;
        if (scribeMounted) return true;

        // Agent Studio first among the studios, because its approval string is emitted
        // by a card and must not be read as anything else. Everything but that string
        // and an explicit "agent studio" falls through; asking for a bot is a REQUEST,
        // answered by the room's speakers reaching for propose_agent.
        if (await runDirectAgentStudioAction(ctx, speaker)) return true;

        // Form Studio before App Studio: with a form open, "add a page" is a change to
        // that form. decideFormStudioAction only acts on an open form, an approval its
        // card sent, or a request that names a form, so anything else falls through.
        if (await runDirectFormStudioAction(ctx, speaker)) return true;

        // Flow Studio after Form Studio, and only for the approval its card sent.
        // Requests never reach here -- "build me a scorecard flow" is Form Studio's
        // to claim first, and anything neither claims is answered by the room's
        // speakers reaching for propose_flow.
        if (await runDirectFlowStudioAction(ctx, speaker)) return true;

        // Same shape as Flow Studio: only the approval its card sent. A request
        // for a prediction job is answered by propose_prediction_job.
        if (await runDirectPredictionStudioAction(ctx, speaker)) return true;

        // An explicit "open <installed app>" mounts the governed canvas
        // directly — before the studio paths, because "launch the wayfare app"
        // IS an app-studio request syntactically but resolves to nothing there:
        // the resolver has no open-an-existing-app intent, and the change path
        // needs a change. Without this the request reached the speaker loop,
        // which rendered an ungoverned transcript iframe.
        if (await runDirectCycleAppMount(ctx, speaker)) return true;

        const studioIsOpen = Boolean(mountedStudioApp(ctx)?.appId);
        return (
            (await runDirectForgeStart(ctx, speaker)) ||
            ((studioIsOpen || isAppStudioRequest(message)) &&
                (await runDirectAppStudioChange(ctx, speaker))) ||
            ((isAppStudioRequest(message) || hasPendingForgeDraft(ctx.priorTurns)) && (await runDirectAppStudioMount(ctx, speaker)))
        );
    }

    /**
     * Open the round: classify the subject, record the user's turn, and read the
     * transcript window the agents will answer into.
     *
     * Classification is keyword-based and LLM-free, so it is cheap enough to sit
     * on the critical path. The insert and the transcript read are issued
     * together because the read does not depend on the write: whether or not it
     * observes the new row, `priorTurns` ends with the user's turn exactly once,
     * keyed by id. The agents' prompt has to end on the message they are
     * answering, which is what that reconciliation is for.
     */
    private async openRound(scope: {
        orgId: number;
        sessionKey: string;
        sessionId: number;
        message: string;
        userId?: string;
        userDisplayName: string;
        round: number;
        projectId?: number | null;
    }): Promise<{
        topicResult: Awaited<ReturnType<typeof intentRouterService.classifyTopic>>;
        intentResult: Awaited<ReturnType<typeof intentRouterService.classifyIntent>>;
        topic: string;
        intent: string;
        userTurn: CrewTurnRecord;
        priorTurns: CrewTurnRecord[];
        declaredTags: string[];
        /** The persisted rows — labels plus the knowledge_topics ids they resolved to. */
        declaredTagRows: PersistedTurnTag[];
    }> {
        const { orgId, sessionKey, sessionId, message, userId, userDisplayName, round, projectId } = scope;

        const [topicResult, intentResult] = await Promise.all([
            intentRouterService.classifyTopic(message, { orgId }),
            intentRouterService.classifyIntent(message),
        ]);
        const topic = topicResult.topic;
        // The classifier's category, never the output intent: `intent` is stored on
        // crew_turns and scored against each card's intentAffinities, which speak
        // IntentCategory ("Document Authoring", "Image Generation", ...). A /map
        // round keeps its classified intent; the output intent travels separately.
        const intent = intentResult.intent;

        const [[userTurn], transcriptWindow] = await Promise.all([
            db
                .insert(crewTurns)
                .values({
                    sessionId,
                    organizationId: orgId,
                    speakerType: "user",
                    speakerName: userDisplayName,
                    userId: userId ?? null,
                    content: message,
                    round,
                    topic,
                    intent,
                })
                .returning(),
            crewRepository.getTranscript(sessionId, TRANSCRIPT_WINDOW),
        ]);

        void crewStreamService.publish({
            type: "turn",
            organizationId: orgId,
            sessionKey,
            actor: userId,
            payload: { speakerType: "user", speakerName: userDisplayName, round },
        });

        const priorTurns = transcriptWindow.some((t) => t.id === userTurn.id)
            ? transcriptWindow
            : [...transcriptWindow, userTurn];

        // Declared-topic tags (#[x] / #x) — the user's own labels, resolved to
        // knowledge_topics and persisted beside the turn. Runs after the turn
        // row exists; awaited so the room delta and tests observe the rows
        // deterministically.
        const tagRows = await persistTurnTags({
            orgId,
            sessionId,
            turnId: userTurn.id,
            round,
            source: "user",
            text: message,
            projectId: projectId ?? null,
            sessionKey,
            speakerName: userDisplayName,
            classifiedTopic: topic,
        });
        const declaredTags = tagRows.map((t) => t.label);

        return { topicResult, intentResult, topic, intent, userTurn, priorTurns, declaredTags, declaredTagRows: tagRows };
    }

    /**
     * Fold the round's outcome back onto the session row.
     *
     * Written synchronously, not scheduled: the cooldown check reads
     * lastRoundCompletedAt, and the response the caller is about to render
     * should reflect the supervisor's current read rather than the previous
     * round's.
     *
     * Where the supervisor's consensus lands depends on how strongly it holds
     * it. At 70 or above it is recorded as a fact; below that the same sentence
     * is a hypothesis, and the open question is kept alongside it. Each list is
     * capped at 100 so a long-running room cannot grow this row without bound.
     */
    private async persistRoundState(scope: {
        session: { id: number; title: string | null; memory: CrewRoomMemory | null; activeTopic?: string | null };
        round: number;
        message: string;
        supervisorResult: SupervisorRoundResult;
        declaredTagRows?: PersistedTurnTag[];
    }): Promise<void> {
        const { session, round, message, supervisorResult, declaredTagRows = [] } = scope;

        const previousMemory = session.memory ?? { facts: [], hypotheses: [], openQuestions: [], constraints: [], ontologyRefs: [], updatedRound: 0 };

        // The user's stated requirement is a fact the room must not lose. It is
        // recorded from the message itself — supervisor output is a bonus on
        // top, never the only channel, since it can be skipped or fail.
        const requirement = extractUserRequirement(message);
        const requirementFact = requirement ? `Requirement: ${requirement}` : null;
        const baseFacts =
            requirementFact &&
            !previousMemory.facts.some(
                (f) => f.toLowerCase().replace(/\s+/g, " ").trim().endsWith(requirement!.toLowerCase().replace(/\s+/g, " ").trim()),
            )
                ? [...previousMemory.facts, requirementFact]
                : previousMemory.facts;

        const nextMemory = {
            ...previousMemory,
            facts: supervisorResult.output?.consensus && (supervisorResult.consensusLevel ?? 0) >= 70
                ? [...baseFacts, supervisorResult.output.consensus].slice(-100)
                : baseFacts.slice(-100),
            hypotheses: supervisorResult.output?.consensus && (supervisorResult.consensusLevel ?? 100) < 70
                ? [...previousMemory.hypotheses, supervisorResult.output.consensus].slice(-100)
                : previousMemory.hypotheses,
            openQuestions: supervisorResult.activeTopic && (supervisorResult.consensusLevel ?? 100) < 70
                ? [...previousMemory.openQuestions, supervisorResult.activeTopic].slice(-100)
                : previousMemory.openQuestions,
            updatedRound: round,
        };

        // The standing topic should exist even when the supervisor's JSON
        // does not provide one — session 485 ran 23 rounds with a null topic
        // because the model emitted "" every time. A freshly captured user
        // requirement is the honest fallback: it is what the room is actually
        // working on. When neither exists the column keeps its prior value —
        // better a stale anchor than a churned one ("Yes" must not retitle it).
        // A declared tag outranks the requirement fallback: the user named the
        // subject explicitly, which is stronger evidence of what the room is
        // about than prose sliced out of the message.
        const declaredFallback = declaredTagRows.at(-1) ?? null;
        const resolvedTopic =
            supervisorResult.activeTopic ||
            declaredFallback?.label ||
            (requirement ? requirement.slice(0, 200) : session.activeTopic ?? "");

        await db
            .update(crewSessions)
            .set({
                updatedAt: new Date(),
                lastRoundCompletedAt: new Date(),
                title: session.title ?? message.slice(0, 120),
                // Standing state — overwritten each round, so the panels always
                // show the supervisor's current read rather than a history.
                ...(resolvedTopic ? { activeTopic: resolvedTopic } : {}),
                // When the declared tag is what landed in activeTopic, link the
                // knowledge_topics row it resolved to — declared and standing
                // topic then point at the same vocabulary node.
                ...(resolvedTopic && declaredFallback?.topicId != null && resolvedTopic === declaredFallback.label
                    ? { activeTopicId: declaredFallback.topicId }
                    : {}),
                ...(supervisorResult.nextSteps ? { nextSteps: supervisorResult.nextSteps } : {}),
                ...(supervisorResult.consensusLevel !== null
                    ? { consensusLevel: supervisorResult.consensusLevel }
                    : {}),
                // The human brief may change while a round runs. Merge the
                // round-owned fields without overwriting that newer brief.
                memory: sql`${crewSessions.memory} || ${JSON.stringify({ ...nextMemory, roomBrief: undefined, activeAgentSelections: undefined })}::jsonb`,
            })
            .where(eq(crewSessions.id, session.id));
    }

    /**
     * Everything a speaker needs that can be read before anyone speaks.
     *
     * One batch rather than per-speaker reads: these are independent of each
     * other and of turn order, and each speaker's model call is sequential, so
     * anything left here lands on the user's critical path once per speaker.
     * The persona snippet is a single lookup shared by every speaker, which is
     * why it belongs in this batch and not in front of it.
     *
     * Recall is allSettled, not all: a memory lookup that fails should cost that
     * speaker its context, not the round.
     */
    private async prefetchSpeakerContext(scope: {
        orgId: number;
        userId?: string;
        message: string;
        projectId: number | null;
        speakers: AgentCardRecord[];
        studio?: string;
    }): Promise<{
        personaContextSnippet: string;
        memoryContextMap: Map<number, string>;
        toolsMap: Map<number, ResolvedCrewTool[]>;
        declMap: Map<number, Array<Record<string, unknown>>>;
        beliefsMap: Map<number, string[]>;
    }> {
        const { orgId, userId, message, projectId, speakers } = scope;

        const [recallResults, toolsResults, beliefsResults, personaContextSnippet] = await Promise.all([
            Promise.allSettled(
                speakers.map((card) =>
                    optionalRoundContext(
                        crewMemoryService.recallForDiscussion(orgId, card.name, message, 4, 700, projectId)
                            .then((recall) => ({ agentCardId: card.id, context: recall.formattedMemoryContext })),
                        { agentCardId: card.id, context: "" },
                        () => logger.warn(`Optional recall unavailable for ${card.name}; continuing without memory context`)),
                ),
            ),
            Promise.all(speakers.map((card) => crewToolsService.resolveForCard(card, scope.studio))),
            Promise.all(speakers.map((card) => crewBeliefsService.heldBeliefs(card.id).catch(() => []))),
            userId
                ? optionalRoundContext(syntheticPersonaService.getPromptContextSnippet(orgId, userId), "",
                    () => logger.warn("Optional persona context unavailable; continuing without it"))
                : Promise.resolve(""),
        ]);

        const memoryContextMap = new Map<number, string>();
        for (let i = 0; i < speakers.length; i++) {
            const result = recallResults[i];
            if (result.status === "fulfilled") {
                memoryContextMap.set(result.value.agentCardId, result.value.context);
            } else {
                logger.debug(
                    `Recall skipped for ${speakers[i].name}: ${
                        result.reason instanceof Error ? result.reason.message : String(result.reason)
                    }`,
                );
                memoryContextMap.set(speakers[i].id, "");
            }
        }

        const toolsMap = new Map<number, ResolvedCrewTool[]>();
        const declMap = new Map<number, Array<Record<string, unknown>>>();
        const beliefsMap = new Map<number, string[]>();

        for (let i = 0; i < speakers.length; i++) {
            const card = speakers[i];
            const tools = toolsResults[i];
            toolsMap.set(card.id, tools);
            declMap.set(card.id, crewToolsService.toFunctionDeclarations(tools));
            beliefsMap.set(
                card.id,
                beliefsResults[i].map((b) => `${b.proposition} (confidence ${b.confidence})`),
            );
        }

        return { personaContextSnippet, memoryContextMap, toolsMap, declMap, beliefsMap };
    }

    /**
     * Who speaks this round, and is this an answer task rather than a debate?
     *
     * `answerTask` is one decision with two consequences, which is why it is
     * returned rather than recomputed: it cuts the room to a single speaker, and
     * later it skips the supervisor review. A direct factual or external-research
     * request, a mention, a direct action, or purely conversational traffic are
     * all answers — a supervisor follow-up after a completed lookup produces the
     * chorus/rephrasing loop rather than a second opinion. The two uses were
     * separate copies of the same boolean expression, 130 lines apart.
     */
    private selectRoundSpeakers(scope: {
        members: AgentCardRecord[];
        topic: string;
        intent: string;
        message: string;
        triageMode: CrewMode;
    }): {
        roster: Array<{ name: string; description: string }>;
        speakers: AgentCardRecord[];
        answerTask: boolean;
    } {
        const { members, topic, intent, message, triageMode } = scope;

        const roster = members.map((m) => ({ name: m.name, description: m.description }));
        const allSpeakers = this.selectSpeakers(members, topic, intent, message);

        const isDirectActionOrMention =
            message.includes("@") ||
            message.startsWith("[DIVERSE PRIMITIVE INTAKE:") ||
            message.startsWith("[DIVERSE MISSION BRIEF:") ||
            /\b(send|email|draft|deploy|create form|mount|show me|build|run)\b/i.test(message) ||
            isScribeAuthoringRequest(message);
        const answerTask =
            triageMode === "conversational" ||
            isExplicitExternalResearchRequest(message) ||
            isFactualLookupRequest(message) ||
            isDirectActionOrMention;

        return { roster, speakers: answerTask ? allSpeakers.slice(0, 1) : allSpeakers, answerTask };
    }

    /**
     * Feed the round's message into the user's behavioural profile.
     *
     * Fire-and-forget on purpose: none of this is on the answer's critical path,
     * and a profiling failure must not fail the round. Errors are swallowed for
     * that reason, which is also why this is not awaited anywhere.
     */
    private recordInteractionSignals(scope: {
        orgId: number;
        userId?: string;
        message: string;
        topic: string;
        declaredTags?: string[];
        projectId?: number | null;
    }): void {
        const { orgId, userId, message, topic, declaredTags = [], projectId = null } = scope;
        if (!userId) return;

        void (async () => {
            const isExploratory = /what if|how could|explore|architect|design/i.test(message);
            const isDirect = /do |run |fix |execute|create/i.test(message);
            const hasFormatting = message.includes("```") || message.includes("\n- ") || message.includes("\n1. ");

            await oceanAssessmentService.assessAndCalibrate(orgId, userId, {
                messageLength: message.length,
                hasStructuredFormatting: hasFormatting,
                isExploratoryQuestion: isExploratory,
                isDirectCommand: isDirect,
            });

            if (topic && String(topic).toLowerCase() !== "general") {
                await userInterestGraphService.reinforceInterest(orgId, userId, String(topic), "chat_discussion", 10.0, message.slice(0, 100));
            }

            // Declared tags outweigh the classified topic: the user named the
            // subject themselves, which is a stronger signal than an inference.
            for (const label of declaredTags) {
                await userInterestGraphService.reinforceInterest(orgId, userId, label, "declared_tag", 15.0, message.slice(0, 100));
                if (projectId !== null) {
                    await userInterestGraphService.logProjectActivity(orgId, userId, "chat_discussion", label, message.slice(0, 100), projectId);
                }
            }

            await syntheticPersonaService.synthesizePersona(orgId, userId);
        })().catch(() => {});
    }

    /**
     * Runs one full round: user turn, agent turns in sequence, supervisor review.
     */
    async runRound(params: {
        orgId: number;
        sessionKey: string;
        message: string;
        /** Server-resolved app data, excluded from authored-text routing and persistence. */
        mountedAppContext?: string;
        userId?: string;
        userDisplayName?: string;
        agentCardIds?: number[];
        computerUseStudioActive?: boolean;
        activeStudio?: string | null;
        outputIntent?: CrewOutputIntent;
        /** Active Project Space, already read-gated by withProjectScope. */
        projectId?: number | null;
        projectKey?: string | null;
    }): Promise<RunRoundResult> {
        const { orgId, sessionKey, message, userId, userDisplayName = "You" } = params;
        const projectId = params.projectId ?? null;
        const projectKey = params.projectKey ?? null;

        // The room and its organization's name are independent reads — the name
        // is keyed by orgId, which is already in hand. Everything from here to
        // the first model call is on the user's critical path, so nothing that
        // can overlap should wait.
        const [session, [orgRow]] = await Promise.all([
            ensureSession(orgId, sessionKey, userId),
            db
                .select({ name: orgs.name })
                .from(orgs)
                .where(eq(orgs.id, orgId))
                .limit(1),
        ]);
        const orgName = orgRow?.name ?? "Oddjob Platform";

        let members = await this.admitRound({
            orgId,
            session,
            userId,
            projectId,
            agentCardIds: params.agentCardIds,
            message,
        });

        // Acquire a per-session advisory lock to serialize concurrent rounds.
        // This prevents race conditions in round numbering and interleaved turns.
        const sessionLock = await acquireSessionLock(session.id);
        try {
        // Round number: one past the highest so far.
        const [last] = await db
            .select({ round: crewTurns.round })
            .from(crewTurns)
            .where(eq(crewTurns.sessionId, session.id))
            .orderBy(desc(crewTurns.id))
            .limit(1);
        const round = (last?.round ?? 0) + 1;

        // 1-2. Classify the subject, record the user's turn, read the transcript
        //      window the agents will see.
        const { topicResult, intentResult, topic, intent, userTurn, priorTurns, declaredTags, declaredTagRows } =
            await this.openRound({ orgId, sessionKey, sessionId: session.id, message, userId, userDisplayName, round, projectId });

        const cost: RoundCost = { modelCalls: 0, generationMs: 0, toolCalls: 0 };

        // Triage: a greeting does not deserve three agents and a supervisor.
        // Pass priorRoundWasDiscussion so that short confirmations ("Yes", "1",
        // "proceed") continue the supervisor's oversight in an active work session
        // rather than silently dropping to conversational mode. The signal is
        // the last round that actually ran: more than one agent spoke, or one
        // did real work — session.mode is the room's declared mode and can
        // never be "discussion".
        const lastRound = priorTurns.length ? Math.max(...priorTurns.map((t) => t.round ?? 0)) : 0;
        const lastRoundTurns = priorTurns.filter((t) => (t.round ?? 0) === lastRound);
        const priorRoundWasDiscussion =
            lastRoundTurns.filter((t) => t.speakerType === "agent").length > 1 ||
            lastRoundTurns.some((t) => (t.toolsUsed?.length ?? 0) > 0);
        const triage = crewTriageService.assess(message, priorRoundWasDiscussion);

        // A real question in a default room brings in whoever specialises in it.
        // Skipped for conversational traffic: "hi" should not summon a crew.
        if (triage.mode === "discussion" || isAppStudioRequest(message)) {
            const recruited = await this.recruitSpecialists({
                orgId,
                sessionId: session.id,
                members,
                topic,
                intent,
                message,
            });
            if (recruited.length > 0) members = [...members, ...recruited];
        }

        const { roster, speakers, answerTask } = this.selectRoundSpeakers({
            members,
            topic,
            intent,
            message,
            triageMode: triage.mode,
        });

        logger.info(
            `Crew round ${round} (session ${session.id}): mode=${triage.mode} ` +
                `(substance ${triage.substance}, ${triage.reason}), topic=${topic}, intent=${intent}, ` +
                `speakers=${speakers.map((s) => s.name).join(" -> ")}`,
        );

        this.recordInteractionSignals({ orgId, userId, message, topic, declaredTags, projectId });

        // 3. Agents speak in sequence, each seeing what came before it.
        const roundTurns: CrewTurnRecord[] = [userTurn];
        const replyTarget = userTurn.id;

        // Pre-fetch memory recall, available tools, held beliefs, and the
        // synthetic persona snippet for all speakers in parallel. The persona
        // read is a single lookup shared by every speaker, so it belongs in this
        // batch rather than in front of it.
        const { personaContextSnippet, memoryContextMap, toolsMap, declMap, beliefsMap } =
            await this.prefetchSpeakerContext({ orgId, userId, message, projectId, speakers, studio: resolveCrewStudio(params.activeStudio, priorTurns, session.cycleContext?.studio) });

        const ctx: RoundContext = {
            orgId,
            sessionKey,
            userId,
            userDisplayName,
            message,
            computerUseStudioActive: params.computerUseStudioActive === true || isComputerUseStudioActive(priorTurns),
            session,
            orgName,
            projectId,
            projectKey,
            round,
            topic,
            intent,
            declaredTags,
            outputIntent: params.outputIntent,
            roster,
            speakers,
            priorTurns,
            roundTurns,
            replyTarget,
            speakerSkips: [],
            personaContextSnippet: [personaContextSnippet, params.mountedAppContext].filter(Boolean).join("\n\n"),
            cost,
            lastSupervisorOutput: (params as any)?.lastSupervisorOutput,
            prefetch: { memoryContextMap, toolsMap, declMap, beliefsMap },
        };

        // 3-4. A direct action answers the round on its own, or the speakers do.
        if (!(await this.runDirectAction(ctx))) {
            for (const card of speakers) {
                if (await consumeCancellation(ctx, card)) {
                    ctx.speakerSkips?.push({
                        name: card.name,
                        reason: "round cancelled or paused before this speaker ran — later speakers dropped too",
                    });
                    break;
                }
                // Detect repetitive "describe but don't act" loops and inject a
                // corrective instruction into that specific speaker's context.
                const loopBreaker = detectStuckLoop(card.name, priorTurns);
                if (loopBreaker) {
                    // Append the circuit-breaker to a per-speaker context override.
                    // runSpeakerTurn reads ctx.message for prompt construction, so
                    // we pass a temporary augmented context for this card only.
                    const augmentedCtx: RoundContext = {
                        ...ctx,
                        message: ctx.message + loopBreaker,
                    };
                    await runSpeakerTurn(augmentedCtx, card);
                } else {
                    await runSpeakerTurn(ctx, card);
                }
            }
        }

        // 4b. File the work that actually ran. Claims derived from tool
        //     executions are firsthand — the call happened, the output exists —
        //     and they land whether or not the supervisor's review below
        //     produces anything, which is the difference between a ledger and a
        //     transcript summary.
        await crewLearningService
            .recordToolWorkClaims({ sessionId: session.id, organizationId: orgId, roundTurns })
            .catch((err) =>
                logger.warn(
                    `Tool-work claim derivation failed for session ${session.id}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                ),
            );

        // 5. Supervisor reviews the round and speaks to the room. Only a round
        //    triaged conversational skips it entirely; an answer task still gets
        //    its decisions and commitments recorded — it just gets no spoken
        //    directive, which is what used to produce the chorus/rephrasing loop.
        //    Skipping the review on "build X" or "@Name check Y" is exactly how a
        //    room ended up with 38 rounds and not one tracked requirement.
        const { supervisorResult, raisedHands, appendedTurns } = await this.runSupervisorPhase({
            skip: triage.mode === "conversational",
            trackOnly: answerTask && triage.mode !== "conversational",
            activeStudio: params.activeStudio === undefined ? crewStudioForTurns(priorTurns, session.cycleContext?.studio) : params.activeStudio,
            orgId,
            sessionKey,
            session,
            round,
            message,
            topic,
            intent,
            members,
            speakers,
            roster,
            projectId,
            projectKey,
            roundTurns,
            cost,
            declaredTags,
        });
        roundTurns.push(...appendedTurns);

        // A round that produced nothing has to say so.
        //
        // runSpeakerTurn swallows a speaker's failure so the rest of the room
        // can still speak, and runDirectAction can claim the round. When
        // neither leaves a turn behind, the round closes normally and the room
        // shows the user's own message and nothing else — no error, no notice,
        // no indication anything was even attempted. That is what an
        // organization with no AI key connected looked like for an afternoon:
        // every speaker failed, every round closed in 40ms, and the room stayed
        // silent.
        if (!roundTurns.some((t) => t.speakerType !== "user")) {
            const reason = ctx.lastSpeakerError;
            // Per-speaker attribution: "nobody answered" has to say who dropped
            // and why — an evasion fallback, an exhausted retry, a cancelled
            // round — or a systemic failure is indistinguishable from a shrug.
            const skipDetail = (ctx.speakerSkips ?? [])
                .map((s) => `${s.name}: ${s.reason}`)
                .join("; ")
                .slice(0, 600);
            const [noticeTurn] = await db
                .insert(crewTurns)
                .values({
                    sessionId: session.id,
                    organizationId: orgId,
                    // "supervisor" rather than a new speaker type: TurnRow
                    // renders every non-user turn through one branch, and a
                    // fourth type would need a client change to appear at all.
                    speakerType: "supervisor",
                    speakerName: "Room",
                    round,
                    inReplyToTurnId: userTurn.id,
                    topic,
                    intent,
                    content: reason
                        ? `Nobody in this room could answer that. The last attempt failed with: ${reason}` +
                          (skipDetail ? ` Speakers: ${skipDetail}.` : "")
                        : skipDetail
                          ? `Nobody in this room answered that. ${skipDetail}.`
                          : "Nobody in this room answered that. Nothing failed outright — say it again and the room will try once more.",
                })
                .returning();
            if (noticeTurn) {
                roundTurns.push(noticeTurn);
                void crewStreamService.publish({
                    type: "turn-content",
                    organizationId: orgId,
                    sessionKey,
                    payload: { turn: noticeTurn, round },
                });
            }
            logger.warn(
                `Crew round ${round} (session ${session.id}) produced no turns` +
                    (reason ? `: ${reason}` : "") +
                    (skipDetail ? ` — skips: ${skipDetail}` : ""),
            );
        }

        // Scribe In-Pod Copilot Auto-Synthesis:
        // When the user requested a TOC, station structure, or outline on a room with an active Scribe document,
        // if advisors debated or proposed outlines in chat without executing scribe_configure_stations,
        // the Scribe In-Pod Copilot automatically commits the reconciled stations to the canvas.
        const isTocOrOutline = /\b(?:toc|table\s+of\s+contents|outline|document\s+stations?|sections?\s+outline|suggest\s+stations?)\b/i.test(message);
        const scribeAlreadyConfigured = roundTurns.some(t =>
            (t.toolsUsed as any[])?.some(tool => (tool.name === "scribe_configure_stations" || tool.name === "scribe_add_table_of_contents") && tool.ok)
        );

        if (isTocOrOutline && !scribeAlreadyConfigured) {
            try {
                const { scribeDocuments } = await import("@shared/schema/scribe.js");
                const [activeDoc] = await db
                    .select()
                    .from(scribeDocuments)
                    .where(eq(scribeDocuments.sessionId, session.id))
                    .limit(1);

                if (activeDoc) {
                    const { scribeCopilotService } = await import("@domain/scribe/core/scribe-copilot.service.js");
                    const syncResult = await scribeCopilotService.syncCrewAdviceToDocument(activeDoc.id, orgId);
                    if (syncResult.success && syncResult.appliedCount > 0) {
                        logger.info(`[CrewOrchestrator] Scribe In-Pod Copilot auto-applied ${syncResult.appliedCount} stations to doc #${activeDoc.id}`);
                        const [copilotTurn] = await db.insert(crewTurns).values({
                            organizationId: orgId,
                            sessionId: session.id,
                            speakerType: "agent",
                            speakerName: "Scribe Copilot",
                            round,
                            content: `⚡ **Scribe In-Pod Copilot**: Synchronized ${syncResult.appliedCount} proposed stations directly into the Living Document Canvas:\n` +
                                syncResult.appliedStations.map(s => `- **${s.title}**`).join("\n"),
                            toolsUsed: [{ name: "scribe_configure_stations", ok: true, ms: 85 }],
                            artifacts: [{
                                tool: "scribe_configure_stations",
                                payload: {
                                    type: "scribe_stations_configured",
                                    documentId: activeDoc.id,
                                    stationsCount: syncResult.appliedCount,
                                    stations: syncResult.appliedStations,
                                },
                            }],
                        }).returning();
                        if (copilotTurn) {
                            roundTurns.push(copilotTurn);
                        }
                    }
                }
            } catch (err: any) {
                logger.warn(`[CrewOrchestrator] Scribe Copilot auto-sync skipped: ${err.message}`);
            }
        }

        await this.persistRoundState({ session, round, message, supervisorResult, declaredTagRows });

        await this.closeRound({ orgId, sessionKey, session, round, userId, cost, roundTurns, supervisorResult });

        this.scheduleRoundLearning({
            orgId,
            session,
            round,
            message,
            topic,
            intent,
            topicResult,
            intentResult,
            declaredTags,
            projectId,
            members,
            speakers,
            roundTurns,
            triage,
            supervisorResult,
        });

        return {
            sessionId: session.id,
            round,
            turns: roundTurns,
            supervisor: supervisorResult,
            topic,
            intent,
            mode: triage.mode,
            raisedHands,
            cost,
        };
        } finally {
            await sessionLock.release();
        }
    }



    /**
     * Banks what the round produced: knowledge, critique, unresolved issues,
     * belief positions, prediction scoring, and intent observations.
     *
     * Deferred to setImmediate so the response goes out first, and only for
     * real discussions — a conversational reply has no consensus to bank, no
     * disagreement to raise, and no discovered intent worth labelling.
     *
     * Each write happens ONCE. 70c75a386 added a second copy of the knowledge,
     * critique and issue calls keyed on the classified `topic` rather than the
     * user's message, which meant every qualifying round banked its conclusions
     * twice and inserted two crew_issues rows — and, since raiseIssueIfUnresolved
     * also publishes BLOCKER_CREATED, fired the blocker event twice.
     *
     * The subject argument reaches the stored text, so `message` is the one that
     * belongs there: entries read `On "<what the user actually asked>": ...` and
     * issues are titled after it, where the classified label would have produced
     * `On "General": ...` and `Unresolved: General`.
     */
    private scheduleRoundLearning(scope: {
        orgId: number;
        session: { id: number };
        round: number;
        message: string;
        topic: string;
        intent: string;
        topicResult: { confidence: number };
        intentResult: { confidence: number };
        declaredTags: string[];
        projectId: number | null;
        members: AgentCardRecord[];
        speakers: AgentCardRecord[];
        roundTurns: CrewTurnRecord[];
        triage: { mode: string };
        supervisorResult: { output: SupervisorOutput | null };
    }): void {
        const {
            orgId, session, round, message, topic, intent, topicResult, intentResult,
            declaredTags, projectId, members, speakers, roundTurns, triage, supervisorResult,
        } = scope;

        if (triage.mode !== "discussion" || !supervisorResult.output) return;
        const output = supervisorResult.output;
        const lastAgentTurn = [...roundTurns]
            .reverse()
            .find((t) => t.speakerType === "agent");

        setImmediate(async () => {
            // Sequential rather than Promise.all: these write to overlapping
            // stores and none is urgent enough to risk interleaving.
            await crewLearningService
                .writeBackKnowledge(orgId, speakers, output, message, projectId)
                .catch((err) =>
                    logger.warn(`Knowledge write-back failed: ${err?.message ?? err}`),
                );

            // The critique goes to the agent it was aimed at, not the room.
            const critiquedCard = lastAgentTurn
                ? speakers.find((c) => c.id === lastAgentTurn.agentCardId)
                : undefined;
            if (critiquedCard) {
                await crewLearningService
                    .writeBackCritique(orgId, critiquedCard, output, message, projectId)
                    .catch((err) =>
                        logger.warn(`Critique write-back failed: ${err?.message ?? err}`),
                    );
            }

            await crewLearningService
                .raiseIssueIfUnresolved({
                    orgId,
                    sessionId: session.id,
                    round,
                    topic: message,
                    output,
                    sourceTurnId: lastAgentTurn?.id,
                    projectId,
                })
                .catch((err) => logger.warn(`Issue raising failed: ${err?.message ?? err}`));

            // Beliefs: what each agent actually argued, revised against what it
            // already held. The supervisor extracted these while reading the
            // round, so this costs no additional model call.
            const nameToCard = new Map(members.map((m) => [m.name, m.id]));
            const turnIdByAgent = new Map<number, number>();
            for (const t of roundTurns) {
                if (t.speakerType === "agent" && t.agentCardId) {
                    turnIdByAgent.set(t.agentCardId, t.id);
                }
            }

            const positions = output.positions
                .map((p) => {
                    const agentCardId = nameToCard.get(p.agent);
                    return agentCardId
                        ? {
                              agentCardId,
                              proposition: p.proposition,
                              confidence: p.confidence,
                          }
                        : null;
                })
                .filter((p): p is NonNullable<typeof p> => p !== null);

            await crewBeliefsService
                .recordPositions({
                    orgId,
                    projectId,
                    sessionId: session.id,
                    round,
                    positions,
                    turnIdByAgent,
                })
                .catch((err) => logger.warn(`Belief recording failed: ${err?.message ?? err}`));

            // Calibration: score this round's predictions against what the
            // subjects actually said.
            const turnsByAgent = new Map<number, { turnId: number; content: string }>();
            for (const t of roundTurns) {
                if (t.speakerType === "agent" && t.agentCardId) {
                    turnsByAgent.set(t.agentCardId, { turnId: t.id, content: t.content });
                }
            }

            await crewBeliefsService
                .scoreRound({ sessionId: session.id, round, turnsByAgent })
                .catch((err) => logger.warn(`Prediction scoring failed: ${err?.message ?? err}`));

            await crewLearningService
                .recordIntentObservations({
                    orgId,
                    sessionId: session.id,
                    round,
                    message,
                    topic,
                    topicConfidence: topicResult.confidence,
                    intent,
                    intentConfidence: intentResult.confidence,
                    discoveredIntents: output.intents,
                    declaredTopics: declaredTags,
                    projectId,
                })
                .catch((err) => logger.warn(`Intent capture failed: ${err?.message ?? err}`));
        });
    }

    /**
     * Everything that has to hold before a round is allowed to spend anything:
     * cooldown, project binding, membership, participation, and budget.
     *
     * Ordered so the cheap refusals come first — a round rejected on cooldown
     * must not have written a member row or checked a spending policy on the
     * way to being refused.
     *
     * Returns the roster the round will run with.
     */
    private async admitRound(scope: {
        orgId: number;
        session: Awaited<ReturnType<typeof ensureSession>>;
        userId?: string;
        projectId: number | null;
        agentCardIds?: number[];
        message?: string;
    }): Promise<AgentCardRecord[]> {
        const { orgId, session, userId, projectId, agentCardIds, message } = scope;

        // Cooldown enforcement: reject if last round completed less than 2s ago.
        if (session.lastRoundCompletedAt) {
            const elapsed = Date.now() - session.lastRoundCompletedAt.getTime();
            if (elapsed < 2000) {
                throw new Error("Cooldown: Please wait before sending another message.");
            }
        }

        // Bind the room to its Project Space the first time we learn it.
        if (projectId !== null && session.projectId === null) {
            await db
                .update(crewSessions)
                .set({ projectId })
                .where(eq(crewSessions.id, session.id));
            session.projectId = projectId;
        }

        if (agentCardIds) {
            await crewRepository.setMembers(orgId, session.id, agentCardIds);
        }

        // Three independent reads that all have to finish before the round can
        // start. Serially they were three round trips in front of the first
        // model call; the budget is still consulted before anything is spent,
        // because nothing below this point generates.
        const [, budget, admitted] = await Promise.all([
            // Speaking in a room makes you a participant in it.
            userId
                ? crewParticipantsService.ensureParticipant(session.id, orgId, userId)
                : Promise.resolve(),
            // A round is up to five model calls; refuse one the org cannot
            // afford before spending anything. Unmetered when no policy is
            // configured.
            crewBudgetService.check(orgId),
            crewRepository.getMembers(session.id),
        ]);

        if (!budget.allowed) {
            throw new Error(`Budget exceeded: ${budget.reason ?? "spending limit reached"}`);
        }

        let members = admitted;
        if (members.length === 0 && message) {
            const recruited = await this.recruitSpecialists({
                orgId,
                sessionId: session.id,
                members: [],
                topic: "General",
                intent: "Chat",
                message,
            });
            if (recruited.length > 0) {
                members = recruited;
            }
        }
        if (members.length === 0) {
            await seedCopilotMember(orgId, session.id);
            members = await crewRepository.getMembers(session.id);
        }
        if (members.length === 0) {
            try {
                const { seedProvisioningService } = await import("@domain/agent-cards/core/seed-provisioning.service.js");
                await seedProvisioningService.ensureDefaultCards(orgId);
                await seedCopilotMember(orgId, session.id);
                members = await crewRepository.getMembers(session.id);
            } catch (e: any) {
                logger.warn(`Could not provision default cards for org ${orgId}: ${e?.message}`);
            }
        }
        if (members.length === 0) {
            const defaultAgents = await db
                .select({ id: agentCards.id })
                .from(agentCards)
                .where(and(eq(agentCards.organizationId, orgId), eq(agentCards.enabled, true)))
                .limit(3);
            for (const da of defaultAgents) {
                await db.insert(crewMembers).values({ sessionId: session.id, agentCardId: da.id }).onConflictDoNothing();
            }
            members = await crewRepository.getMembers(session.id);
        }
        if (members.length === 0) {
            throw new Error("No agents in this crew — add at least one agent before starting a discussion.");
        }

        return members;
    }

    /**
     * Mount Project Studio directly for an explicit project/builder studio gesture without
     * asking an LLM to repeat the routing decision. This guarantees instant zero-latency
     * mounting and eliminates failures from external model unreachability or misdirection.
     */
    private async runDirectProjectStudioMount(ctx: RoundContext, card?: AgentCardRecord): Promise<boolean> {
        if (!card) return false;
        if (!isProjectStudioRequest(ctx.message)) return false;

        const availableTools = ctx.prefetch.toolsMap.get(card.id) ?? [];
        let record: any = { name: "mount_builder_pod", ok: true, ms: 8 };
        let artifact: CrewArtifact;

        const builderTool = availableTools.find((t) => t.definition.name === "mount_builder_pod");
        if (builderTool) {
            const res = await crewToolsService.execute(
                "mount_builder_pod",
                {
                    podComponent: "ProjectStudioPod",
                    stageId: "stage-intake",
                    title: "Project Studio",
                },
                availableTools,
                buildCrewToolContext({
                    orgId: ctx.orgId,
                    userId: ctx.userId,
                    projectId: ctx.projectId,
                    projectKey: ctx.projectKey,
                    sessionKey: ctx.sessionKey,
                    sessionId: ctx.session.id,
                    message: ctx.message,
                    agentCardId: card.id,
                }),
            );
            record = res.record;
            artifact = res.artifact ?? {
                tool: "mount_builder_pod",
                payload: {
                    type: "assistant_app",
                    module: "ProjectStudioPod",
                    component: "ProjectStudioPod",
                    componentName: "ProjectStudioPod",
                    podComponent: "ProjectStudioPod",
                    title: "Project Studio",
                    props: {
                        stageId: "stage-intake",
                        projectTitle: "Operational Cycle Planner",
                    },
                },
            };
        } else {
            artifact = {
                tool: "mount_builder_pod",
                payload: {
                    type: "assistant_app",
                    module: "ProjectStudioPod",
                    component: "ProjectStudioPod",
                    componentName: "ProjectStudioPod",
                    podComponent: "ProjectStudioPod",
                    title: "Project Studio",
                    props: {
                        stageId: "stage-intake",
                        projectTitle: "Operational Cycle Planner",
                    },
                },
            };
        }

        ctx.cost.toolCalls++;

        const [turn] = await db
            .insert(crewTurns)
            .values({
                sessionId: ctx.session.id,
                organizationId: ctx.orgId,
                speakerType: "agent",
                agentCardId: card.id,
                speakerName: card.name,
                content: "I've mounted Project Studio beside the chat. You can plan your mission sequence, CPM topological dependencies, and squad allocations in the canvas.",
                round: ctx.round,
                inReplyToTurnId: ctx.replyTarget,
                topic: ctx.topic,
                intent: ctx.intent,
                toolsUsed: [record],
                artifacts: [artifact],
                latencyMs: 8,
            })
            .returning();

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

    /**
     * Mount Computer Use Studio for an explicit desktop/OS sandbox gesture without asking
     * an LLM to repeat the routing decision. This removes both the initial generation
     * and the post-tool generation from the critical path.
     */
    private async runDirectComputerStudioMount(ctx: RoundContext, card?: AgentCardRecord): Promise<boolean> {
        if (!isComputerUseStudioRequest(ctx.message)) return false;

        const speakerCard = card ?? ctx.speakers[0];
        const availableTools = speakerCard ? (ctx.prefetch.toolsMap.get(speakerCard.id) ?? []) : [];
        let record: any = { name: "mount_builder_pod", ok: true, ms: 8 };
        let artifact: CrewArtifact;

        const builderTool = availableTools.find((t) => t.definition.name === "mount_builder_pod");
        if (builderTool && speakerCard) {
            const res = await crewToolsService.execute(
                "mount_builder_pod",
                {
                    podComponent: "ComputerUseStudioPod",
                    title: "Computer Use Studio",
                },
                availableTools,
                buildCrewToolContext({
                    orgId: ctx.orgId,
                    userId: ctx.userId,
                    projectId: ctx.projectId,
                    projectKey: ctx.projectKey,
                    sessionKey: ctx.sessionKey,
                    sessionId: ctx.session.id,
                    message: ctx.message,
                    agentCardId: speakerCard.id,
                }),
            );
            record = res.record;
            artifact = res.artifact ?? {
                tool: "mount_builder_pod",
                payload: {
                    type: "assistant_app",
                    module: "ComputerUseStudioPod",
                    component: "ComputerUseStudioPod",
                    componentName: "ComputerUseStudioPod",
                    podComponent: "ComputerUseStudioPod",
                    title: "Computer Use Studio",
                    props: {},
                },
            };
        } else {
            artifact = {
                tool: "mount_builder_pod",
                payload: {
                    type: "assistant_app",
                    module: "ComputerUseStudioPod",
                    component: "ComputerUseStudioPod",
                    componentName: "ComputerUseStudioPod",
                    podComponent: "ComputerUseStudioPod",
                    title: "Computer Use Studio",
                    props: {},
                },
            };
        }

        ctx.cost.toolCalls++;

        const [turn] = await db
            .insert(crewTurns)
            .values({
                sessionId: ctx.session.id,
                organizationId: ctx.orgId,
                speakerType: "agent",
                agentCardId: speakerCard?.id ?? null,
                speakerName: speakerCard?.name ?? "Copilot",
                content: "I've mounted the Computer Use Studio beside the chat. You can monitor the interactive desktop viewport, inspect action steps and vision grounding, or engage human takeover mode.",
                round: ctx.round,
                inReplyToTurnId: ctx.replyTarget,
                topic: ctx.topic,
                intent: ctx.intent,
                toolsUsed: [record],
                artifacts: [artifact],
                latencyMs: 8,
            })
            .returning();

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

    /**
     * Mount Scribe for an explicit authoring gesture without asking an LLM to
     * repeat the routing decision. This removes both the initial generation and
     * the post-tool generation from the critical path. If the card does not
     * hold the tool, normal agent execution remains the safe fallback.
     */
    private async runDirectScribeMount(ctx: RoundContext, card?: AgentCardRecord): Promise<boolean> {
        if (!card) return false;
        // Do not remount Scribe if it is already active in this session
        const alreadyMounted = ctx.priorTurns.some((t) =>
            t.artifacts && (t.artifacts as any[]).some((a) => a.tool === "mount_scribe_studio")
        );
        if (alreadyMounted) return false;

        const availableTools = ctx.prefetch.toolsMap.get(card.id) ?? [];
        if (!availableTools.some((tool) => tool.definition.name === "mount_scribe_studio")) return false;

        const resolution = scribeIntentResolverService.resolve(ctx.message);
        const { record, artifact } = await crewToolsService.execute(
            "mount_scribe_studio",
            {
                title: resolution.inferredTitle || "New Document",
                archetypeMode: resolution.archetypeMode || "freeform",
                targetWordCount: resolution.suggestedWordCount,
                // A vague entry gesture should open a warm canvas, not seed the
                // manuscript with the sentence "I want to write".
                ...(ctx.message.trim().split(/\s+/).length > 5 ? { initialPrompt: ctx.message } : {}),
            },
            availableTools,
            buildCrewToolContext({
                orgId: ctx.orgId,
                userId: ctx.userId,
                projectId: ctx.projectId,
                projectKey: ctx.projectKey,
                sessionKey: ctx.sessionKey,
                sessionId: ctx.session.id,
                message: ctx.message,
                agentCardId: card.id,
            }),
        );
        ctx.cost.toolCalls++;
        if (!record.ok || !artifact) return false;

        const [turn] = await db.insert(crewTurns).values({
            sessionId: ctx.session.id,
            organizationId: ctx.orgId,
            speakerType: "agent",
            agentCardId: card.id,
            speakerName: card.name,
            content: "Scribe Studio is ready. Start with a blank canvas or choose a station to begin writing.",
            round: ctx.round,
            inReplyToTurnId: ctx.replyTarget,
            topic: ctx.topic,
            intent: ctx.intent,
            toolsUsed: [record],
            artifacts: [artifact],
            latencyMs: record.ms,
        }).returning();

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


    /**
     * Asks which non-speaking members have something to contribute.
     *
     * Deliberately model-free. Asking each silent agent "do you have anything to
     * add?" would cost a generation apiece, which is exactly what capping
     * speakers per round was meant to avoid. Instead the signal comes from what
     * we already know: affinity to the classified topic/intent, and how many
     * entries the agent's own knowledge graph returns for this subject —
     * genuine evidence of prior experience rather than a guess.
     */
    /**
     * Brings specialists into a room that is still just the seeded Copilot.
     *
     * Every crew room ever created held exactly one member. seedCopilotMember
     * puts the Copilot in at creation and nothing ever added a second, while
     * selectSpeakers picks only from members — so the supervisor, consensus,
     * belief revision and divergence questions have never once had two agents to
     * work with. One org had twenty-five enabled agents and its rooms ran one.
     * That is why a "20% consensus" could appear in a room with a single voice.
     *
     * Recruitment uses the affinity signal collectRaisedHands already scores
     * with, on topic and intent. Memory recall is deliberately NOT consulted
     * here: it is a vector round-trip per candidate, and this runs before the
     * first agent speaks, where latency is most visible.
     *
     * ONLY for a room still at its default. A roster someone has edited is
     * theirs — the same reason seedCopilotMember only ever applies at creation.
     * Adding uninvited members to a curated room would be worse than an empty
     * one.
     */
    private async recruitSpecialists(params: {
        orgId: number;
        sessionId: number;
        members: AgentCardRecord[];
        topic: string;
        intent: string;
        /** What was actually asked — the strongest signal for who should answer. */
        message: string;
        limit?: number;
    }): Promise<AgentCardRecord[]> {
        const { orgId, sessionId, members, topic, intent, message } = params;
        const limit = params.limit ?? 2;

        try {
            const existing = new Set(members.map((m) => m.id));
            const candidates = await db
                .select()
                .from(agentCards)
                .where(and(eq(agentCards.organizationId, orgId), eq(agentCards.enabled, true)));

            // 1. Check for explicit fleet @mentions (e.g. "@Sales Outreach Representative")
            if (message.includes("@")) {
                const lowerMsg = message.toLowerCase();
                const mentionedCards = candidates
                    .filter((c) => !existing.has(c.id))
                    .sort((a, b) => b.name.length - a.name.length)
                    .filter((c) => lowerMsg.includes(`@${c.name.toLowerCase()}`));

                if (mentionedCards.length > 0) {
                    await db
                        .insert(crewMembers)
                        .values(mentionedCards.map((c) => ({ sessionId, agentCardId: c.id })))
                        .onConflictDoNothing();

                    logger.info(
                        `Recruited ${mentionedCards.length} @mentioned agent(s) into session ${sessionId}: ` +
                            `${mentionedCards.map((c) => c.name).join(", ")}`,
                    );
                    return mentionedCards;
                }
            }

            // 1.5 Recruit an existing art director for the agent-fleet or deck intake,
            // or when one is named. This used to create a "Pixel Maestro" card when
            // the org had none, so a chat message could add a permanent agent, with
            // no tools, to the org's roster.
            if (isArtDirectionRequest(message)) {
                const artDirector = candidates.find((c) => !existing.has(c.id) && isArtDirectorCard(c));
                if (artDirector) {
                    await db
                        .insert(crewMembers)
                        .values([{ sessionId, agentCardId: artDirector.id }])
                        .onConflictDoNothing();

                    logger.info(`Recruited art director "${artDirector.name}" into session ${sessionId}.`);
                    return [artDirector];
                }
            }

            // 1.6 Recruit the film crew for a film. Like the art director above it
            // recruits only from cards the org already has: a chat message must not
            // be able to add a permanent agent to an organisation's roster.
            if (isFilmCrewRequest(message)) {
                const hasFilmCrew = members.some((m) => isFilmCrewCard(m as AgentCardRecord));
                if (!hasFilmCrew) {
                    const filmCrew = candidates.filter((c) => !existing.has(c.id) && isFilmCrewCard(c)).slice(0, 2);
                    if (filmCrew.length) {
                        await db
                            .insert(crewMembers)
                            .values(filmCrew.map((c) => ({ sessionId, agentCardId: c.id })))
                            .onConflictDoNothing();

                        logger.info(
                            `Recruited film crew into session ${sessionId} for Media Studio: ${filmCrew.map((c) => c.name).join(", ")}`,
                        );
                        return filmCrew;
                    }
                }
            }

            // 2. Auto-recruit specialists if the active room lacks a relevant domain expert for this question
            if (isAppStudioRequest(message)) {
                const hasArchitect = members.some(
                    (m) => /architect/i.test(m.name ?? "") || /architect/i.test(m.personaType ?? ""),
                );
                if (!hasArchitect) {
                    const architectCandidate = candidates.find(
                        (c) =>
                            !existing.has(c.id) &&
                            (/architect/i.test(c.name ?? "") || /architect/i.test(c.personaType ?? "")),
                    );
                    if (architectCandidate) {
                        await db
                            .insert(crewMembers)
                            .values([{ sessionId, agentCardId: architectCandidate.id }])
                            .onConflictDoNothing();

                        logger.info(
                            `Recruited Architect "${architectCandidate.name}" into session ${sessionId} for App Forge.`,
                        );
                        return [architectCandidate];
                    }
                }
            }

            // 3. Auto-recruit GhostWriter for Scribe authoring or @GhostWriter mentions
            // Scoped like the relevance boost above: an unqualified action verb is
            // not a Scribe request, and recruiting on one would pull an author into
            // every room that happens to say "create" or "update".
            const isGhostWriterMention =
                /\b@?(?:ghostwriter|ghost\s*writer)\b/i.test(message) ||
                isScribeEditRequest(message) ||
                isScribeAuthoringRequest(message);
            if (isGhostWriterMention) {
                const hasGhostWriter = members.some(
                    (m) => /ghostwriter/i.test(m.name ?? "") || /ghostwriter/i.test(m.personaType ?? ""),
                );
                if (!hasGhostWriter) {
                    const ghostCandidate = candidates.find(
                        (c) =>
                            !existing.has(c.id) &&
                            (/ghostwriter/i.test(c.name ?? "") || /ghostwriter/i.test(c.personaType ?? "")),
                    );
                    if (ghostCandidate) {
                        await db
                            .insert(crewMembers)
                            .values([{ sessionId, agentCardId: ghostCandidate.id }])
                            .onConflictDoNothing();

                        logger.info(
                            `Recruited GhostWriter "${ghostCandidate.name}" into session ${sessionId} for Scribe authoring.`,
                        );
                        return [ghostCandidate];
                    }
                }
            }

            const hasMatchingSpecialist = members.some(
                (m) => m.personaType !== COPILOT_PERSONA_TYPE && agentRelevanceScore(message, m) > 1,
            );
            if (hasMatchingSpecialist || members.length >= 6) return [];

            // "General" is what the intent router falls back to when topic
            // confidence is below threshold, and every card in this org declares
            // it — so matching on it is not evidence of anything, it is evidence
            // that the classifier abstained. Counting it would score all
            // twenty-four candidates identically and make "recruit the top two"
            // mean "recruit whichever two the database returned first".
            const topicIsEvidence = topic !== "General";

            const scored = candidates
                .filter((c) => !existing.has(c.id) && c.personaType !== COPILOT_PERSONA_TYPE)
                .map((card) => {
                    const topicMatch =
                        topicIsEvidence && (card.topicAffinities ?? []).includes(topic as never);
                    const intentMatch = (card.intentAffinities ?? []).includes(intent as never);
                    const relevance = agentRelevanceScore(message, card);
                    return {
                        card,
                        topicMatch,
                        relevance,
                        // Relevance to the actual question dominates: a declared
                        // affinity says what an agent is for in general, the
                        // message says what is being asked right now.
                        score: relevance + (topicMatch ? 2 : 0) + (intentMatch ? 1 : 0),
                    };
                })
                // A matching INTENT is not, on its own, a reason to pull someone
                // into a discussion. Nearly every card declares the same handful
                // of intents, so admitting on that alone recruited whoever sorted
                // first — an arbitrary specialist, which is worse than none: it
                // makes a discussion look considered when it is not. Either the
                // agent looks relevant to the question, or its topic affinity
                // matched a topic the classifier was actually confident about.
                .filter((s) => s.relevance > 0 || s.topicMatch)
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);

            if (scored.length === 0) return [];

            await db
                .insert(crewMembers)
                .values(scored.map((s) => ({ sessionId, agentCardId: s.card.id })))
                .onConflictDoNothing();

            logger.info(
                `Recruited ${scored.length} specialist(s) into session ${sessionId} for ` +
                    `topic=${topic}/intent=${intent}: ${scored.map((s) => s.card.name).join(", ")}`,
            );
            return scored.map((s) => s.card);
        } catch (err) {
            // A room that cannot recruit still works with the members it has.
            logger.warn(
                `Specialist recruitment failed for session ${sessionId}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return [];
        }
    }

    private async collectRaisedHands(params: {
        orgId: number;
        sessionId: number;
        round: number;
        members: AgentCardRecord[];
        spoke: AgentCardRecord[];
        topic: string;
        intent: string;
        message: string;
        declaredTags?: string[];
        projectId?: number | null;
    }): Promise<RaisedHand[]> {
        const { orgId, sessionId, round, members, spoke, topic, intent, message, declaredTags = [] } = params;
        const projectId = params.projectId ?? null;

        const spokeIds = new Set(spoke.map((s) => s.id));
        const silent = members.filter((m) => !spokeIds.has(m.id));
        if (silent.length === 0) return [];

        // These recalls are independent. Running them serially made this
        // bookkeeping phase scale linearly with room size and held the message
        // response open after all speaking had completed.
        const candidates = await Promise.all(silent.map(async (card) => {
            let affinity = 0;
            if ((card.topicAffinities ?? []).includes(topic as never)) affinity += 1;
            if ((card.intentAffinities ?? []).includes(intent as never)) affinity += 1;

            // A declared tag is the user saying "this is about X" — an agent
            // whose card already claims X deserves the benefit of the doubt.
            // Matched fuzzily because the vocabularies differ (fixed
            // TopicCategory vs freeform label); tags under 3 chars skip the
            // fuzzy path to keep "AI"/"go" from matching everything.
            const tagMatch = declaredTags
                .map((t) => t.toLowerCase())
                .find((tag) =>
                    tag.length >= 3 && (
                        (card.topicAffinities ?? []).some(
                            (a) => a.toLowerCase() === tag || tag.includes(a.toLowerCase()),
                        ) ||
                        // Learned label affinities: the card declared this
                        // exact topic on its own past turns — the strongest
                        // self-reported evidence of fit.
                        (card.topicLabelAffinities ?? []).some(
                            (e) => e.label.toLowerCase() === tag,
                        ) ||
                        card.name.toLowerCase().includes(tag) ||
                        (card.description ?? "").toLowerCase().includes(tag)
                    ),
                );
            if (tagMatch) affinity += 2;

            let memoryHits = 0;
            try {
                const recall = await crewMemoryService.recallForDiscussion(
                    orgId,
                    card.name,
                    message,
                    3,
                    700,
                    projectId,
                );
                memoryHits = recall.entryCount;
            } catch {
                // No recall is not a failure — the agent simply has no history.
            }

            // A hand goes up only on real evidence: prior experience, or a
            // direct affinity match. Otherwise every member would raise one and
            // the signal would be worthless.
            if (memoryHits === 0 && affinity === 0) return null;

            const reason =
                memoryHits > 0
                    ? `${memoryHits} prior ${memoryHits === 1 ? "entry" : "entries"} on this subject`
                    : tagMatch
                      ? `matches declared topic #${tagMatch}`
                      : `specialises in ${[
                            (card.topicAffinities ?? []).includes(topic as never) ? topic : null,
                            (card.intentAffinities ?? []).includes(intent as never) ? intent : null,
                        ]
                            .filter(Boolean)
                            .join(" / ")}`;

            return {
                agentCardId: card.id,
                agentName: card.name,
                reason,
                affinityScore: affinity,
                memoryHits,
            } satisfies RaisedHand;
        }));
        const hands = candidates.filter((hand): hand is RaisedHand => hand !== null);

        // Strongest evidence first — experience outweighs affinity.
        hands.sort(
            (a, b) => b.memoryHits - a.memoryHits || b.affinityScore - a.affinityScore,
        );

        if (hands.length > 0) {
            try {
                await db
                    .insert(crewHandRaises)
                    .values(
                        hands.map((h) => ({
                            sessionId,
                            organizationId: orgId,
                            round,
                            agentCardId: h.agentCardId,
                            reason: h.reason,
                            affinityScore: h.affinityScore,
                            memoryHits: h.memoryHits,
                        })),
                    )
                    .onConflictDoNothing();
            } catch (err) {
                logger.warn(
                    `Failed to persist hand raises: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }

        return hands;
    }

    // ── Internals ────────────────────────────────────────────────────────




    /**
     * Injects a completed background task turn (research findings, simulation results,
     * spatial analysis, forged instant app, calculation results, or security audit)
     * into the room under the proposing agent's identity.
     *
     * Also updates supervisor notes, publishes to the SSE stream, and publishes
     * an intervention notification if the user is not actively viewing the room.
     */
    async injectTaskCompletionTurn(params: {
        orgId: number;
        sessionKey: string;
        agentCardId?: number | null;
        speakerName: string;
        content: string;
        topic?: string | null;
        intent?: string | null;
        artifacts?: CrewArtifact[];
        taskKind?: string;
        requestedByUserId?: string | null;
        metadata?: Record<string, unknown>;
    }): Promise<CrewTurnRecord> {
        const {
            orgId,
            sessionKey,
            agentCardId,
            speakerName,
            content,
            topic,
            intent,
            artifacts = [],
            taskKind,
            requestedByUserId,
        } = params;
        const session = await ensureSession(orgId, sessionKey);

        const [last] = await db
            .select({ round: crewTurns.round })
            .from(crewTurns)
            .where(eq(crewTurns.sessionId, session.id))
            .orderBy(desc(crewTurns.id))
            .limit(1);
        const round = (last?.round ?? 0) + 1;

        const [turn] = await db
            .insert(crewTurns)
            .values({
                sessionId: session.id,
                organizationId: orgId,
                speakerType: "agent",
                speakerName,
                agentCardId: agentCardId ?? null,
                content,
                round,
                topic: topic ?? "Task Results",
                intent: intent ?? taskKind ?? "task_completion",
                artifacts: artifacts as any,
            })
            .returning();

        // Broadcast to live room stream
        void crewStreamService.publish({
            type: "turn",
            organizationId: orgId,
            sessionKey,
            actor: agentCardId ? String(agentCardId) : undefined,
            payload: {
                speakerType: "agent",
                speakerName,
                round,
                turnId: turn.id,
                taskKind,
            },
        });

        // Add a supervisor note acknowledging the findings
        await db.insert(supervisorNotes).values({
            sessionId: session.id,
            organizationId: orgId,
            noteType: "summary",
            content: `Completed ${taskKind ? taskKind.replace(/_/g, " ") : "task"}: ${speakerName} presented findings for "${topic || "the open enquiry"}".`,
            round,
            targetTurnId: turn.id,
        });

        // Smart re-engagement: if user requested this and might be out of the room,
        // publish an intervention event that deep-links directly back into the room.
        try {
            const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
            await eventStream.publish(
                "intervention.triggered",
                {
                    interventionId: `crew-task-${turn.id}-${Date.now()}`,
                    title: `${speakerName} finished ${taskKind ? taskKind.replace(/_/g, " ") : "task"}`,
                    description: `Results are ready in CREW Room. Click to return and view findings.`,
                    actionLabel: "View in CREW Room",
                    actionUrl: `/crew/${sessionKey}?highlightTurn=${turn.id}&focus=${taskKind || "task"}`,
                    vector: "C",
                    priority: "high",
                    confidence: 0.95,
                    context: { sessionKey, turnId: turn.id, taskKind, requestedByUserId },
                },
                {
                    organizationId: orgId,
                    userId: requestedByUserId ?? undefined,
                    source: "crew_task_completion",
                },
                "crew-task",
            );
        } catch (eventErr: any) {
            logger.warn(`Failed to publish re-engagement intervention: ${eventErr.message}`);
        }

        return turn;
    }












}

export const crewOrchestratorService = new CrewOrchestratorService();
