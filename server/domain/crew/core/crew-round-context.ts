/**
 * The shared vocabulary of a crew round.
 *
 * RoundContext is the execution context a round threads through every speaker
 * turn and every direct action, alongside the small pure parsers that decide
 * whether a message is a Forge confirmation, a migration approval or an App
 * Studio request.
 *
 * These live here rather than on the orchestrator because both the orchestrator
 * and crew-app-studio.service.ts need them, and importing them from the
 * orchestrator made the two modules circular.
 */

import type { AgentCardRecord, CrewTurnRecord, SupervisorNoteType } from "@shared/schema/index.js";
import type { CrewOutputIntent } from "@shared/crew-output-intent.js";
import { scribeConversationIntent } from "@shared/scribe-conversation.js";
import type { SupervisorOutput } from "./crew-supervisor.service.js";
import type { ResolvedCrewTool } from "./crew-tools.service.js";
// The session shape is whatever ensureSession returns. This used to reach for
// it through the orchestrator class; pointing at the session module directly
// removes this file's last reference to the orchestrator.
import type { ensureSession } from "./crew-session.service.js";
import { scribeIntentResolverService, type ScribeActionIntent } from "@domain/intent-router/core/scribe-intent-resolver.service.js";

/**
 * An explicit request to edit a Scribe document.
 */
export function isScribeEditRequest(message: string, hasActiveDocument = false): boolean {
    if (/\bread[- ]only\b/i.test(message)) return false;
    const conversation = scribeConversationIntent(message);
    if (conversation === "pause" || conversation === "review") return false;
    if (hasActiveDocument && (conversation === "resume" || conversation === "revise")) return true;
    if (/\b(?:only|just)\s+(?:review|discuss|suggest)|\b(?:do not|don't)\s+(?:edit|change|write|apply|create|generate|draft|mount)\b/i.test(message)) return false;
    const action = /\b(?:add|insert|update|edit|revise|rewrite|replace|remove|expand|shorten|reorganize|apply|improve|make|create|generate)\b/i.test(message);
    const target = /\b(?:toc|table\s+of\s+contents|outline|document|manuscript|section|station|paragraph|draft|prd)\b/i.test(message);
    return action && (target || hasActiveDocument);
}

export type ScribeLargeEditMode = "complete" | "batches" | "condensed";

export function getScribeLargeEditMode(message: string): ScribeLargeEditMode | null {
    if (/\b(?:complete update|full update|expanded output)\b/i.test(message)) return "complete";
    if (/\b(?:update in batches|batched update|section batches)\b/i.test(message)) return "batches";
    if (/\b(?:condensed update|concise update|shortened update)\b/i.test(message)) return "condensed";
    return null;
}

export function requiresScribeLargeEditApproval(message: string, hasActiveDocument = false): boolean {
    if (getScribeLargeEditMode(message) || !isScribeEditRequest(message, hasActiveDocument)) return false;
    const broadTarget = /\b(?:entire|whole|full|complete|all)\b[\s\S]{0,40}\b(?:document|manuscript|draft|sections?|stations?)\b|\b(?:document|manuscript|draft)\b[\s\S]{0,40}\b(?:throughout|in full|completely)\b/i;
    const explicitSize = /\b(?:[3-9]\d{3}|\d{5,})\s*(?:words?|tokens?)\b/i;
    return broadTarget.test(message) || explicitSize.test(message);
}

/**
 * Classifies authoring intent into 'structural', 'content', 'both', or 'none'.
 */
export function classifyScribeIntent(message: string): ScribeActionIntent {
    return scribeIntentResolverService.resolveActionIntent(message);
}

/**
 * An explicit request to enter a writing workspace.
 *
 * Keep programming and messaging verbs out of this route: "write a unit test"
 * and "write an email" belong to other tools. A bare first-person request such
 * as "I want to write" is intentionally enough; that is the Scribe entry
 * gesture and should not require the author to know a document taxonomy first.
 */
export function isScribeAuthoringRequest(message: string): boolean {
    const text = message.trim();
    if (/\bread[- ]only\b|\b(?:do not|don't)\s+(?:create|generate|write|draft|author|compose|mount)\b/i.test(text)) return false;
    if (/\b(?:unit|integration|e2e)\s+tests?\b|\b(?:code|function|query|script|regex|email|message)\b/i.test(text)) {
        return false;
    }
    return (
        /\b(?:i\s+want|i(?:'d|\s+would)\s+like|let\s+me|help\s+me|ready|start|begin)\s+(?:to\s+)?(?:write|draft|author|compose)\b/i.test(text) ||
        /\b(?:write|draft|author|compose|create)\b[\s\S]{0,48}\b(?:document|manuscript|novel|story|sow|sop|agreement|contract|proposal|memo|paper|whitepaper|prd|rfp|guide|handbook)\b/i.test(text) ||
        /\b(?:scribe studio|authoring mode|launch scribe|open scribe|mount scribe|scribe mode)\b/i.test(text)
    );
}

/**
 * A message a surface in this room sent to start a build — and nothing else.
 *
 * Two shapes are accepted, both of them things the UI actually emits, and both
 * anchored at the start of the message so prose cannot reach them:
 *
 *   Build "<name>" now.                                   (ForgeConfirmationCard)
 *   I confirmed stage "<stageId>" with configuration: {…}  (ScaffoldPackPod)
 *
 * Strictness is the whole point. This gate is what stands between a sentence and
 * a provisioned container, so a loose "did they say yes?" test would let an
 * ordinary agreement start a build.
 *
 * A previous revision also matched `/confirm(?:ed)?\s+architecture/i` anywhere in
 * a message, on the theory that it was another way of confirming the scaffold.
 * It matched ordinary prose — "Can you confirm architecture decisions with the
 * team?" and "Who confirmed architecture on this?" both started builds — and it
 * was never needed: the pod's button is labelled "Confirm Architecture &
 * Continue", but the message it sends is the structured stage form above. The
 * regression tests below pin both halves so the free-text shortcut cannot come
 * back unnoticed.
 */
const CARD_CONFIRMATION = /^Build\s+"([^"]{1,120})"\s+now\.$/i;
/**
 * Any stage id, deliberately.
 *
 * Scoping this to "stage-scaffold" looks tighter and is actually the reason the
 * free-text pattern existed: ScaffoldPackPod defaults its own stageId to
 * stage-scaffold, but crew-tools injects "stage-intake" into a mount_builder_pod
 * call that arrives without one — so the pod's confirmation can legitimately
 * name a stage this list would not have held, the structured branch would miss,
 * and a prose fallback starts to look necessary.
 *
 * Widening the stage id costs nothing that matters. What gates a build is
 * runDirectForgeStart's requirement that a forge confirmation card be the room's
 * standing proposal; this pattern only has to establish that the message came
 * from a surface rather than from a person typing, and the anchored structured
 * form with a JSON payload does that whatever the stage is called.
 */
const STAGE_CONFIRMATION = /^I confirmed stage\s+"[^"]{1,60}"\s+with configuration:\s*(\{[\s\S]*)$/i;

/**
 * Approval of a specific proposed migration, and nothing else.
 *
 * Strict for the same reason parseForgeConfirmation is: this writes over an
 * author's files. It requires the snapshot id the proposal handed out, so a
 * bare "apply it" cannot approve a migration nobody has looked at, and an
 * approval of one proposal cannot be replayed against a later one.
 *
 * Smart quotes are accepted because the room renders the instruction with them
 * and people copy what they see.
 */
const MIGRATION_APPROVAL = /^apply\s+migration\s+["“']([A-Za-z0-9._-]{1,80})["”']\.?$/i;

/**
 * What a round actually cost, in the units this system spends.
 *
 * Token counts are not available from the generation layer, so this counts what
 * is: model calls and the time inside them. That is the honest measure anyway —
 * calls are sequential by design (agents must see each other), so a round's
 * latency is the sum of its calls, and the number of calls is what grows when a
 * room gains members.
 *
 * Worth surfacing because the growth is not obvious: a one-agent room already
 * costs three calls per message (speaker, supervisor, directive follow-up), and
 * a populated room at MAX_SPEAKERS_PER_ROUND costs five or more.
 */
export interface RoundCost {
    modelCalls: number;
    generationMs: number;
    toolCalls: number;
}

/** Explicit requests for live/external evidence must not be downgraded to KB recall. */
export function isExplicitExternalResearchRequest(message: string): boolean {
    return /\b(?:google|google search|web search|search the web|browse the web|external sources?|online research|gemini)\b/i.test(message) ||
        /\b(?:visit|navigate to|browse|read|inspect|explore)\b[\s\S]{0,100}\b(?:website|webpage|site|https?)\b/i.test(message) ||
        /\b(?:find|look for|research)\b[\s\S]{0,80}\b(?:aggregators?|data sources?|websites?|data providers?)\b/i.test(message) ||
        /https?:\/\//i.test(message);
}

/** Direct knowledge questions need one evidence-backed answer, not a panel discussion. */
export function isFactualLookupRequest(message: string): boolean {
    const trimmed = message.trim();
    if (/\b(?:build|create|assemble|design|compare|decide|review|brainstorm|write|draft|author|outline|script|compose)\b/i.test(trimmed)) return false;
    return /^(?:what|who|when|where|why|how|define|explain|teach me|research|find out)\b/i.test(trimmed);
}

/** Intents that would create a NEW application rather than open an existing one. */
export const CREATE_INTENTS = new Set(["build_app", "create_dashboard", "create_api"]);

export function parseForgeConfirmation(message: string): { name?: string; packs?: string[] } | null {
    const trimmed = message.trim();

    const card = trimmed.match(CARD_CONFIRMATION);
    if (card) return { name: card[1].trim() };

    const stage = trimmed.match(STAGE_CONFIRMATION);
    if (!stage) return null;

    try {
        const parsed = JSON.parse(stage[1]);
        return { packs: Array.isArray(parsed.selectedPacks) ? parsed.selectedPacks : undefined };
    } catch {
        // The shape is right but its payload is not readable. Still a genuine
        // confirmation from the pod, so the build proceeds on the proposal's own
        // parameters rather than being dropped.
        return {};
    }
}

export function parseMigrationApproval(message: string): { snapshotId: string } | null {
    const match = message.trim().match(MIGRATION_APPROVAL);
    return match ? { snapshotId: match[1] } : null;
}

/** Decides whether a message is an explicit request to open or work in Project Studio. */
export function isProjectStudioRequest(message: string): boolean {
    const text = message.trim();
    if (isScribeAuthoringRequest(text)) return false;
    return (
        /\b(?:open|launch|show|start|mount|view)\s+(?:the\s+)?(?:project\s+studio|builder\s+studio|cycle\s+planner|wave\s+planner|project\s+planning\s+pod)\b/i.test(text) ||
        /^(?:open\s+)?project\s+studio[.!]?$/i.test(text) ||
        /^(?:open\s+)?builder\s+studio[.!]?$/i.test(text) ||
        /^(?:project|builder)\s+studio[.!]?$/i.test(text) ||
        /\b(?:project\s+studio|operational\s+cycle\s+planner)\b/i.test(text)
    );
}

/** Decides whether a message is an explicit request to open or work in Computer Use Studio. */
export function isComputerUseStudioRequest(message: string): boolean {
    const text = message.trim();
    return (
        /\b(?:open|launch|show|start|mount|view)\s+(?:the\s+)?(?:computer(?:\s+use)?(?:\s+studio)?|desktop(?:\s+studio)?|desktop\s+sandbox|os\s+studio)\b/i.test(text) ||
        /^(?:open\s+)?(?:the\s+)?(?:computer|desktop)(?:\s+studio)?[.!]?$/i.test(text) ||
        /^(?:computer|desktop)\s+studio[.!]?$/i.test(text) ||
        /\b(?:computer\s+use\s+studio|desktop\s+studio|launch\s+computer\s+use)\b/i.test(text)
    );
}

/** Detects if Computer Use Studio is currently active in the session */
export function isComputerUseStudioActive(priorTurns: CrewTurnRecord[]): boolean {
    for (let i = priorTurns.length - 1; i >= 0; i--) {
        const artifacts = priorTurns[i].artifacts ?? [];
        for (const art of artifacts) {
            const p = art.payload ?? {};
            if (
                art.tool === 'mount_computer_studio' ||
                p.type === 'computer_use_studio_pod' ||
                p.module === 'ComputerUseStudioPod' ||
                p.component === 'ComputerUseStudioPod' ||
                ((art.tool === 'mount_builder_pod' || p.type === 'builder_pod' || p.type === 'assistant_app') &&
                    (p.podComponent === 'ComputerUseStudioPod' || p.component === 'ComputerUseStudioPod' || p.module === 'ComputerUseStudioPod'))
            ) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Does this message concern building or evolving an application?
 *
 * A cheap pre-filter, not the routing decision — forgeIntentResolver makes that,
 * and it needs the org's apps to make it well. This only decides whether the
 * round is worth paying a lookup for, so it errs toward letting a message
 * through: a false positive costs one query the resolver then declines to act
 * on, while a false negative means the studio never mounts at all.
 */
export function isAppStudioRequest(message: string): boolean {
    const text = message.trim();
    // Authoring, project studio, and computer use studio win the overlap:
    if (isScribeAuthoringRequest(text) || isProjectStudioRequest(text) || isComputerUseStudioRequest(text)) return false;
    return (
        /\b(?:build|create|develop|make|forge|spin\s+up|scaffold)\b[\s\S]{0,80}\b(?:app|application|dashboard|portal|tool|console|api|service|ui)\b/i.test(text) ||
        /\b(?:app forge|app builder|app studio|instant app)\b/i.test(text) ||
        /\b(?:modify|change|update|edit|tweak|fix|debug|restyle|redesign|rebuild|publish|deploy|continue)\b[\s\S]{0,40}\b(?:app|application|dashboard|portal|tool|console)\b/i.test(text) ||
        /\b(?:this|that|the|my)\s+(?:[a-z][a-z-]*\s+){0,2}app\b/i.test(text)
    );
}

/**
 * An explicit request to open something already installed — "open Wayfare",
 * "launch the dispatch console", "pull up the tracker". A pre-filter like
 * isAppStudioRequest: the round pays for the catalog lookup only when an open
 * verb is present, and the build/change exclusion keeps those requests on the
 * forge and studio paths that own them. Whether the named thing exists is a
 * separate question — runDirectCycleAppMount answers it against the catalog.
 */
export function isAppOpenRequest(message: string): boolean {
    const text = message.trim();
    if (isScribeAuthoringRequest(text) || isProjectStudioRequest(text) || isComputerUseStudioRequest(text)) return false;
    if (!/\b(?:open|launch|load|show|view|mount|pull\s+up|bring\s+up|fire\s+up)\b/i.test(text)) return false;
    return !/\b(?:build|create|develop|make|forge|scaffold|spin\s+up|add|remove|rename|modify|change|update|edit|tweak|fix|debug|restyle|redesign|rebuild|publish|deploy)\b/i.test(text);
}

/**
 * Everything one round's speakers share.
 *
 * These were seventeen locals threaded down a 1,100-line method by proximity,
 * which is why adding a single field to the tool-call context meant finding
 * every place that built one. `roundTurns` is the same array the caller holds,
 * so a speaker's turn is visible to the next one; `replyTarget` is the only
 * scalar that has to be written back, because each agent replies to the one
 * before it.
 */
export interface RoundContext {
    orgId: number;
    sessionKey: string;
    userId?: string;
    userDisplayName: string;
    message: string;
    computerUseStudioActive: boolean;
    session: Awaited<ReturnType<typeof ensureSession>>;
    orgName: string;
    projectId: number | null;
    projectKey: string | null;
    round: number;
    topic: string;
    intent: string;
    /**
     * Declared-topic labels the user tagged this round's message with
     * (`#[topic]`). Empty when untagged. Supervisor, speaker prompts and
     * hand-raise scoring read this — it is the user's own statement of what
     * the round is about, so it outranks anything inferred.
     */
    declaredTags?: string[];
    outputIntent?: CrewOutputIntent;
    roster: Array<{ name: string; description: string }>;
    speakers: AgentCardRecord[];
    priorTurns: CrewTurnRecord[];
    /** Mutated as the round runs: the caller reads it after every speaker. */
    roundTurns: CrewTurnRecord[];
    replyTarget: number;
    /**
     * Why the last speaker produced nothing, when one failed. Written by
     * runSpeakerTurn, which swallows the error so the rest of the room can
     * still speak; read at the end of the round, where a round that produced
     * no turns at all has to say so rather than leave the room silent.
     */
    lastSpeakerError?: string;
    /**
     * Why each speaker's turn produced nothing, accumulated across the round —
     * cancellation, an error swallowed so the room could continue, or a turn
     * that resolved to no content. Read by the empty-round fallback so "nobody
     * spoke" says who dropped out and why, instead of a bare silence.
     */
    speakerSkips?: Array<{ name: string; reason: string }>;
    personaContextSnippet: string;
    cost: RoundCost;
    lastSupervisorOutput?: { speakerBudgetOverride?: { agentName: string; maxTokens: number; rationale: string } };
    prefetch: {
        memoryContextMap: Map<number, string>;
        toolsMap: Map<number, ResolvedCrewTool[]>;
        declMap: Map<number, Array<Record<string, unknown>>>;
        beliefsMap: Map<number, string[]>;
    };
}

/**
 * What the supervisor's review produced: the notes and plan it recorded, the
 * turn it spoke (when it had something to say), its standing read of the room,
 * and the raw output kept so the learning loop can act on it.
 */
export interface SupervisorRoundResult {
    notes: Array<{ noteType: SupervisorNoteType; content: string }>;
    plan: { title: string; steps: unknown[] } | null;
    /** The supervisor's spoken turn, when it had something to say. */
    turn: CrewTurnRecord | null;
    activeTopic: string;
    nextSteps: string;
    consensusLevel: number | null;
    /** Raw output, retained so the learning loop can act on it. */
    output: SupervisorOutput | null;
    /**
     * Why the review produced nothing, when a round that convened agents
     * yielded no supervisor output at all — the model call failed or returned
     * unparseable JSON. Null means the review ran and simply had nothing to
     * record, or was skipped outright.
     */
    error?: string | null;
}
