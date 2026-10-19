/**
 * Crew Supervisor Service
 *
 * The manager sitting alongside the discussion. It does not answer the user
 * directly and does not take a side in the debate — it *shapes* the discussion:
 *
 *   - critique   — challenges weak or unsupported contributions
 *   - consensus  — states where the crew actually agrees, and where it does not
 *   - summary    — the running account of what the room has established
 *   - note       — running observations worth keeping
 *   - intent     — a new thread of enquiry it introduces into the room
 *   - plan       — structured steps, optionally assigned to named crew members
 *
 * Runs on the org's default model rather than any one agent's binding, since it
 * is not a crew member: it is given a card-shaped object with no binding, which
 * ModelResolverService resolves to the org default.
 */

import { createLogger } from "@server/utils/logger.js";
import { crewGenerationService } from "./crew-generation.service.js";
import { GoodQuestionEngine } from "@domain/ai/core/good-question-engine.js";
import type { StructuredQuestionPayload } from "@domain/ai/core/good-question-engine.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";
import type { CrewPlanStep } from "@shared/schema/crew.js";

const logger = createLogger("CrewSupervisorService");

export interface SupervisorTranscriptTurn {
    speaker: string;
    speakerType: "user" | "agent" | "supervisor";
    content: string;
    toolsUsed?: Array<{ name: string; ok: boolean; error?: string }>;
}

export interface SupervisorOutput {
    critique: string;
    consensus: string;
    summary: string;
    notes: string[];
    intents: string[];
    plan: { title: string; steps: CrewPlanStep[] } | null;
    /**
     * What the supervisor says out loud in the room, addressing agents by
     * @mention. This is the only part of its output that becomes a transcript
     * turn — everything else is panel material.
     */
    directive: string;
    /** What the room is working on right now. */
    activeTopic: string;
    /** What the supervisor says happens next. */
    nextSteps: string;
    /** 0-100 — how close the crew is to agreement. */
    consensusLevel: number | null;
    /**
     * Each agent's position this round, as a single claim. Feeds the belief
     * layer — extracted here because the supervisor is already reading the whole
     * round, so it costs no extra model call.
     */
    positions: Array<{ agent: string; proposition: string; confidence: number }>;
    /**
     * A discriminating question, synthesised by the Good Question Engine when
     * the room is genuinely split. Panel material — its substance is folded into
     * `directive` so the agents actually hear it.
     */
    divergenceQuestion: StructuredQuestionPayload | null;
    /**
     * Creation Studio DAG Stage Gating status. Tells the room whether the
     * discussion is focused on the active unblocked stage, or needs redirection.
     */
    stageGating?: {
        status: "on_track" | "redirect_needed" | "stage_ready";
        activeStageId?: string;
        redirectReason?: string;
    } | null;
    /**
     * Dynamic token budget override granted to a designated specialist agent
     * for deep synthesis, complete code/schema output, or deadlock resolution.
     */
    speakerBudgetOverride?: SpeakerBudgetOverride | null;
    /**
     * When the Supervisor detects a genuine topic digression that warrants its
     * own room, it emits this to trigger breakout provisioning. Null otherwise.
     */
    breakoutSuggestion?: BreakoutSuggestion | null;
    /** Explicit decisions identified this round. */
    decisions?: Array<{ statement: string; rationale?: string; confidence?: number }>;
    /** Explicit claims identified this round. */
    claims?: Array<{ claim: string; agent?: string; confidence?: number }>;
    /** Explicit commitments or action assignments. */
    commitments?: Array<{ title: string; owner?: string; detail?: string }>;
}

export interface SpeakerBudgetOverride {
    agentName: string;
    maxTokens: number;
    rationale: "deep_synthesis" | "code_scaffold" | "entropy_resolution" | "architectural_blueprint" | "user_deep_dive";
}

export interface BreakoutSuggestion {
    /** Short label for the sub-topic that diverged from the main thread. */
    subTopic: string;
    /** One sentence explaining why it warrants its own room. */
    rationale: string;
    /** Pre-populated title for the new child session. */
    proposedTitle: string;
}

/** A position with the room's belief mass behind it. */
interface WeightedBranch {
    proposition: string;
    mass: number;
}

const POSITION_STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "are",
    "was", "were", "that", "this", "it", "with", "from", "as", "be", "can", "could",
]);

function positionTokens(value: string): Set<string> {
    return new Set(
        (value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
            .filter((word) => word.length > 2 && !POSITION_STOPWORDS.has(word)),
    );
}

function samePosition(a: string, b: string): boolean {
    const left = a.trim().toLowerCase();
    const right = b.trim().toLowerCase();
    if (left === right) return true;
    const aTokens = positionTokens(left);
    const bTokens = positionTokens(right);
    if (aTokens.size < 3 || bTokens.size < 3) return false;
    const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
    return overlap / Math.min(aTokens.size, bTokens.size) >= 0.7;
}

/**
 * Shannon entropy, in bits, of the room's belief mass across distinct positions.
 *
 * Deliberately NOT `1 - consensusLevel`. That would be a rescaled opinion of the
 * supervisor's wearing an information-theoretic name — the same overclaim as
 * calling a normalised degree count a Fiedler cut. This is a real entropy over a
 * real distribution: agent confidences grouped by proposition and normalised.
 * All mass on one position gives 0 bits; an even two-way split gives exactly 1.
 *
 * Confidence is the weight because an agent that is 0.9 sure of X should move the
 * room's uncertainty more than one that is 0.2 sure. When every confidence is
 * missing or zero, positions are weighted uniformly rather than dropped.
 */
export function positionEntropyBits(
    positions: Array<{ proposition: string; confidence: number }>,
): { bits: number; branches: WeightedBranch[] } {
    const byProposition = new Map<string, number>();
    const display = new Map<string, string>();
    for (const { proposition, confidence } of positions) {
        const normalized = proposition.trim().toLowerCase();
        if (!normalized) continue;
        const key = [...byProposition.keys()].find((existing) => samePosition(existing, normalized)) ?? normalized;
        const weight = Number.isFinite(confidence) && confidence > 0 ? confidence : 0;
        byProposition.set(key, (byProposition.get(key) ?? 0) + weight);
        if (!display.has(key)) display.set(key, proposition.trim());
    }
    if (byProposition.size === 0) return { bits: 0, branches: [] };

    let total = [...byProposition.values()].reduce((a, b) => a + b, 0);
    let entries = [...byProposition.entries()];
    if (total <= 0) {
        // No usable confidences — fall back to uniform mass over the positions.
        entries = entries.map(([k]) => [k, 1] as [string, number]);
        total = entries.length;
    }

    const bits = entries.reduce((acc, [, mass]) => {
        const p = mass / total;
        return p > 0 ? acc - p * Math.log2(p) : acc;
    }, 0);

    const branches = entries
        .map(([key, mass]) => ({ proposition: display.get(key) ?? key, mass: mass / total }))
        .sort((a, b) => b.mass - a.mass);

    return { bits: Number(bits.toFixed(2)), branches };
}

/** Below this the room is effectively agreed, and a disambiguating question is noise. */
const DIVERGENCE_MIN_BITS = 0.5;
/** The supervisor's own read; if it says the room agrees, do not manufacture a split. */
const DIVERGENCE_MAX_CONSENSUS = 80;

/**
 * Turn a split room into one discriminating question, via the Good Question
 * Engine — the same engine the copilot uses, reused rather than reimplemented.
 *
 * Only `synthesizeDivergenceQuestion` is reachable from here: the engine's
 * `generateStructuredQuestion` requires a TrajectoryEvaluationResult from the
 * prediction engine, and a discussion turn is not an agent lifecycle trajectory,
 * so there would be nothing honest to hand it.
 */
export function buildDivergenceQuestion(
    output: Pick<SupervisorOutput, "positions" | "consensusLevel" | "activeTopic">,
    rosterNames: string[] = [],
): { question: StructuredQuestionPayload; branchA: string; branchB: string } | null {
    if ((output.consensusLevel ?? 0) >= DIVERGENCE_MAX_CONSENSUS) return null;

    // Only the crew's own positions count. The supervisor is asked for positions
    // "from the roster" but reads a transcript that opens with the user's turn,
    // and it does attribute a position to them — which manufactured a split out
    // of a one-speaker round: branch A the user's request restated, branch B the
    // agent's finding. Those are a question and its answer, not a disagreement.
    const roster = new Set(rosterNames.map((n) => n.trim().toLowerCase()));
    const crewPositions = roster.size
        ? output.positions.filter((p) => roster.has(p.agent.trim().toLowerCase()))
        : output.positions;

    // Divergence needs at least two agents. One agent cannot disagree with itself,
    // however many propositions get attributed to it.
    const speakers = new Set(crewPositions.map((p) => p.agent.trim().toLowerCase()));
    if (speakers.size < 2) return null;

    const { bits, branches } = positionEntropyBits(crewPositions);
    if (branches.length < 2 || bits < DIVERGENCE_MIN_BITS) return null;

    // In collaborative authoring, outlining, or brainstorming on non-binary propositions,
    // divergence questions are distracting interruptions. Check if the topic or propositions indicate additive work.
    const isAdditivePlanning =
        /\b(?:outline|toc|table\s+of\s+contents|prd|requirements?|brainstorm|authoring|stations?|sections?\s+outline)\b/i.test(
            output.activeTopic || ""
        ) ||
        branches.some((b) => /\b(?:suggest|include|also|before suggesting)\b/i.test(b.proposition));
    if (isAdditivePlanning) return null;

    const [branchA, branchB] = [branches[0].proposition, branches[1].proposition];
    return {
        question: GoodQuestionEngine.synthesizeDivergenceQuestion(
            output.activeTopic || "the open question",
            bits,
            branchA,
            branchB,
        ),
        branchA,
        branchB,
    };
}

/**
 * Speak the question. The engine returns a form card, and `directive` is the only
 * part of the supervisor's output that becomes a transcript turn — so the two
 * branches are put to the room as a plain question rather than the card's
 * "Entropy Disambiguation Required (ΔH = …)" headline, which is instrument
 * panel language and not something to say out loud to a crew.
 */
export function appendDivergenceQuestion(
    directive: string,
    branchA: string,
    branchB: string,
): string {
    const ask =
        `The room is split. Which holds: (A) ${branchA} — or (B) ${branchB}? ` +
        `Answer A or B and give the one piece of evidence that decides it.`;
    return directive ? `${directive}\n\n${ask}` : ask;
}

const SUPERVISOR_NAME = "Supervisor";

/**
 * A card-shaped stand-in so the supervisor can reuse the same generation path as
 * crew members. Null bindings resolve to the organisation default.
 */
const SUPERVISOR_CARD = {
    id: -1,
    name: SUPERVISOR_NAME,
    description: "Discussion manager",
    modelBindingProviderId: null,
    modelBindingModelId: null,
} as unknown as AgentCardRecord;

const SYSTEM_PROMPT = `You are the Supervisor of a working group discussion — a manager, not a participant.

Several specialist agents are debating a subject with a human participant. Your job is to make that discussion produce something useful.

You must:
- DIRECTIVE: what you say out loud to the room. Address specific agents using @ and their exact name from the roster (e.g. "@AI Evaluator, expedite the Module B analysis"). Direct the next move — assign work, demand evidence, or call the question. One or two sentences, no preamble.
- ACTIVE TOPIC: a short phrase naming what the room is working on right now.
- NEXT STEPS: one short sentence on what happens next.
- CONSENSUS LEVEL: an integer 0-100 estimating how close the crew is to genuine agreement. Be honest — early rounds are low.
- POSITIONS: for each agent that spoke, the single claim they argued, in one sentence in their voice, with how strongly they held it (0-100). Their POSITION, not a summary of their turn. Required whenever any agent spoke.
- CRITIQUE: name the weakest or least supported claim made this round, and say why. Be specific and name the agent. If the round was genuinely sound, say what would strengthen it further. Never be vacuously positive.
- CONSENSUS: state precisely where the crew agrees and where a real disagreement remains open. Do not manufacture agreement that is not there — an unresolved disagreement is a legitimate and useful outcome.
- Treat compatible statements, paraphrases, complementary domain perspectives (e.g. data modeling AND UI/UX design for the same application), and evidence that elaborates another agent's answer as agreement or collaboration, NOT competing positions. A user's question and an agent's answer are never two sides of a split.
- COLLABORATIVE BRAINSTORMING & MULTI-FACETED PROPOSALS: Never manufacture a split room when agents are suggesting different facets of a project (e.g. one agent discussing data modeling and another discussing UI/UX). In document authoring, outlining, PRD drafting, or collaborative brainstorming, multiple perspectives are additive suggestions, NOT mutually exclusive propositions. Set consensusLevel to high (85-100) and do NOT record conflicting positions.
- DIVERGENCE CRITERIA: ONLY record competing positions if agents hold directly conflicting, irreconcilable factual or architectural claims on a mutually exclusive binary choice (e.g. "Use PostgreSQL" vs "Use MongoDB"). Never flag a split for "let's do A" vs "let's also do B".
- For a direct factual lookup or research request, do not assign agents to restate a completed answer. If the evidence answers the request, leave the directive empty and report the result as consensus.
- SUMMARY: a concise account of what the discussion has established so far, written for someone who has not read it.
- NOTES: durable observations worth carrying forward.
- INTENTS: new threads of enquiry the group has not yet considered but should, most important first. Only when genuinely warranted.
- DECISIONS: explicit choices, established invariants, or agreed approaches settled this round. Empty array if none.
- CLAIMS: explicit verifiable assertions or hypotheses argued by agents this round with confidence (0-100). Empty array if none.
- COMMITMENTS: explicit tasks or next action commitments assigned to specific agents. Empty array if none.
- PLAN: when the discussion has converged enough to act on, structured steps. Assign an owner only from the crew roster you are given. Otherwise null.
- STAGE GATING: when an active Assembly Blueprint stage is provided in the context, verify if the discussion progresses this active stage. If the room is prematurely discussing blocked downstream stages, set status to "redirect_needed" and directive should redirect the team to resolve the active stage. If active stage is clear, set "stage_ready". Otherwise "on_track".
- STRUCTURED REQUIREMENTS & ARTIFACT FORGING: When the user asks to build a new app, direct the lead agent to call plan_app_architecture before choosing a builder, then preserve the returned archetype, layout, surfaces, capabilities, and integrations through scaffolding and deployment. Do not collapse dashboards, consoles, boards, portals, canvases, collaboration hubs, or data studios into generic form wizards. Simple standalone forms and calculators may use render_intake_form directly.
- SPEAKER BUDGET OVERRIDE: If the next directed agent needs to provide an extensive code schema (Drizzle, SQL), detailed multi-step app scaffolding, mathematical proof, deep multi-variable synthesis, or deadlock resolution, grant an elevated token budget (1200-2500 maxTokens) and specify the rationale ("deep_synthesis" | "code_scaffold" | "entropy_resolution" | "architectural_blueprint"). Otherwise set to null.

Respond with ONLY a JSON object, no markdown fence, in exactly this shape:
{
  "directive": "string",
  "activeTopic": "string",
  "nextSteps": "string",
  "consensusLevel": 0,
  "positions": [{ "agent": "exact name from the roster", "proposition": "string", "confidence": 0 }],
  "critique": "string",
  "consensus": "string",
  "summary": "string",
  "notes": ["string"],
  "intents": ["string"],
  "decisions": [{ "statement": "settled decision", "rationale": "reason", "confidence": 85 }],
  "claims": [{ "claim": "verifiable proposition", "agent": "agent name", "confidence": 80 }],
  "commitments": [{ "title": "action item", "owner": "agent name", "detail": "context" }],
  "plan": { "title": "string", "steps": [{ "order": 1, "description": "string", "owner": "string or omitted" }] },
  "stageGating": {
    "status": "on_track",
    "activeStageId": "string or omitted",
    "redirectReason": "string or omitted"
  },
  "speakerBudgetOverride": {
    "agentName": "exact name from the roster",
    "maxTokens": 1800,
    "rationale": "code_scaffold"
  },
  "breakoutSuggestion": {
    "subTopic": "short label for the digressing sub-topic",
    "rationale": "one sentence on why it needs its own room",
    "proposedTitle": "short room title for the child session"
  }
}
Set "plan", "speakerBudgetOverride", or "breakoutSuggestion" to null when not applicable.`;

// ──────────────────────────────────────────────────────────────────────────────
// BREAKOUT ROOMS
// ──────────────────────────────────────────────────────────────────────────────
// When an agent raises a genuinely distinct sub-topic that is *not* part of the
// user's original request (e.g. an unsolicited enhancement, a long-running
// parallel investigation, or a sub-debate that is derailing the main thread),
// the Supervisor MAY emit a breakoutSuggestion. Criteria:
//   - The digression spans at least one full agent turn unrelated to the stated topic.
//   - Resolving it in the current room would derail the user's original request.
//   - It is not a minor tangent that one redirect can fix.
// When emitting, set `subTopic` to the digression's label, `rationale` to one
// sentence, and `proposedTitle` to a short title for the child room.
// Otherwise set breakoutSuggestion to null.

/**
 * Models sometimes wrap JSON in a markdown fence or add prose around it despite
 * instructions. Pull out the outermost balanced object rather than regexing —
 * a lazy pattern truncates at the first nested brace.
 */
function extractJsonObject(raw: string): string | null {
    const start = raw.indexOf("{");
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < raw.length; i++) {
        const ch = raw[i];

        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            escaped = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;

        if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) return raw.slice(start, i + 1);
        }
    }

    return null;
}

function asStringArray(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .map((v) => v.trim())
        .slice(0, limit);
}

function parsePlan(value: unknown): SupervisorOutput["plan"] {
    if (!value || typeof value !== "object") return null;
    const raw = value as { title?: unknown; steps?: unknown };
    if (typeof raw.title !== "string" || !raw.title.trim()) return null;
    if (!Array.isArray(raw.steps)) return null;

    const steps: CrewPlanStep[] = raw.steps
        .map((s, i) => {
            if (!s || typeof s !== "object") return null;
            const step = s as { order?: unknown; description?: unknown; owner?: unknown };
            if (typeof step.description !== "string" || !step.description.trim()) return null;
            return {
                order: typeof step.order === "number" ? step.order : i + 1,
                description: step.description.trim(),
                ...(typeof step.owner === "string" && step.owner.trim()
                    ? { owner: step.owner.trim() }
                    : {}),
            };
        })
        .filter((s): s is CrewPlanStep => s !== null)
        .slice(0, 12);

    if (steps.length === 0) return null;
    return { title: raw.title.trim(), steps };
}

/**
 * Each agent's stated position. Confidence is clamped rather than rejected —
 * a malformed number should cost the confidence value, not the whole position.
 */
function parsePositions(value: unknown): SupervisorOutput["positions"] {
    if (!Array.isArray(value)) return [];

    return value
        .map((raw) => {
            if (!raw || typeof raw !== "object") return null;
            const p = raw as { agent?: unknown; proposition?: unknown; confidence?: unknown };
            if (typeof p.agent !== "string" || !p.agent.trim()) return null;
            if (typeof p.proposition !== "string" || !p.proposition.trim()) return null;

            const n = Number(p.confidence);
            return {
                agent: p.agent.trim(),
                proposition: p.proposition.trim(),
                confidence: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50,
            };
        })
        .filter((p): p is SupervisorOutput["positions"][number] => p !== null)
        .slice(0, 8);
}

function parseStageGating(value: unknown): SupervisorOutput["stageGating"] {
    if (!value || typeof value !== "object") return null;
    const raw = value as { status?: unknown; activeStageId?: unknown; redirectReason?: unknown };
    const status = typeof raw.status === "string" ? raw.status.trim() : "on_track";
    if (!["on_track", "redirect_needed", "stage_ready"].includes(status)) return null;

    return {
        status: status as "on_track" | "redirect_needed" | "stage_ready",
        activeStageId: typeof raw.activeStageId === "string" ? raw.activeStageId.trim() : undefined,
        redirectReason: typeof raw.redirectReason === "string" ? raw.redirectReason.trim() : undefined,
    };
}

function parseSpeakerBudgetOverride(value: unknown): SupervisorOutput["speakerBudgetOverride"] {
    if (!value || typeof value !== "object") return null;
    const raw = value as { agentName?: unknown; maxTokens?: unknown; rationale?: unknown };
    if (typeof raw.agentName !== "string" || !raw.agentName.trim()) return null;

    const maxTokensNum = Number(raw.maxTokens);
    const maxTokens = Number.isFinite(maxTokensNum) ? Math.max(600, Math.min(2500, Math.round(maxTokensNum))) : 1500;
    const validRationales = ["deep_synthesis", "code_scaffold", "entropy_resolution", "architectural_blueprint", "user_deep_dive"];
    const rationale = typeof raw.rationale === "string" && validRationales.includes(raw.rationale.trim())
        ? (raw.rationale.trim() as SpeakerBudgetOverride["rationale"])
        : "deep_synthesis";

    return {
        agentName: raw.agentName.trim(),
        maxTokens,
        rationale,
    };
}

function parseDecisions(value: unknown): SupervisorOutput["decisions"] {
    if (!Array.isArray(value)) return [];
    return value
        .map((raw): NonNullable<SupervisorOutput["decisions"]>[number] | null => {
            if (!raw || typeof raw !== "object") return null;
            const d = raw as { statement?: unknown; rationale?: unknown; confidence?: unknown };
            if (typeof d.statement !== "string" || !d.statement.trim()) return null;
            const n = Number(d.confidence);
            return {
                statement: d.statement.trim(),
                rationale: typeof d.rationale === "string" && d.rationale.trim() ? d.rationale.trim() : undefined,
                confidence: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 80,
            };
        })
        .filter((d): d is NonNullable<SupervisorOutput["decisions"]>[number] => d !== null)
        .slice(0, 5);
}

function parseClaims(value: unknown): SupervisorOutput["claims"] {
    if (!Array.isArray(value)) return [];
    return value
        .map((raw): NonNullable<SupervisorOutput["claims"]>[number] | null => {
            if (!raw || typeof raw !== "object") return null;
            const c = raw as { claim?: unknown; agent?: unknown; confidence?: unknown };
            if (typeof c.claim !== "string" || !c.claim.trim()) return null;
            const n = Number(c.confidence);
            return {
                claim: c.claim.trim(),
                agent: typeof c.agent === "string" && c.agent.trim() ? c.agent.trim() : undefined,
                confidence: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 70,
            };
        })
        .filter((c): c is NonNullable<SupervisorOutput["claims"]>[number] => c !== null)
        .slice(0, 6);
}

function parseCommitments(value: unknown): SupervisorOutput["commitments"] {
    if (!Array.isArray(value)) return [];
    return value
        .map((raw): NonNullable<SupervisorOutput["commitments"]>[number] | null => {
            if (!raw || typeof raw !== "object") return null;
            const c = raw as { title?: unknown; owner?: unknown; detail?: unknown };
            if (typeof c.title !== "string" || !c.title.trim()) return null;
            return {
                title: c.title.trim(),
                owner: typeof c.owner === "string" && c.owner.trim() ? c.owner.trim() : undefined,
                detail: typeof c.detail === "string" && c.detail.trim() ? c.detail.trim() : undefined,
            };
        })
        .filter((c): c is NonNullable<SupervisorOutput["commitments"]>[number] => c !== null)
        .slice(0, 6);
}

function parseBreakoutSuggestion(value: unknown): BreakoutSuggestion | null {
    if (!value || typeof value !== "object") return null;
    const raw = value as { subTopic?: unknown; rationale?: unknown; proposedTitle?: unknown };
    const subTopic = typeof raw.subTopic === "string" ? raw.subTopic.trim() : "";
    const rationale = typeof raw.rationale === "string" ? raw.rationale.trim() : "";
    const proposedTitle = typeof raw.proposedTitle === "string" ? raw.proposedTitle.trim() : "";
    if (!subTopic || !rationale || !proposedTitle) return null;
    return { subTopic, rationale, proposedTitle };
}

export class CrewSupervisorService {
    get name(): string {
        return SUPERVISOR_NAME;
    }

    /**
     * Reviews a round of discussion.
     *
     * Returns null when the supervisor could not produce usable output — the
     * discussion itself is unaffected, the manager panel simply gains nothing
     * this round.
     */
    async review(
        orgId: number,
        topic: string,
        transcript: SupervisorTranscriptTurn[],
        crewRoster: Array<{ name: string; description: string }>,
        priorSummary = "",
        stageContext?: {
            blueprintId?: string;
            activeStageId?: string;
            activeStageName?: string;
            verifiedStages?: string[];
            blockedStages?: string[];
        },
        modelBinding?: {
            modelBindingProviderId: number | null;
            modelBindingModelId: number | null;
        } | null,
    ): Promise<SupervisorOutput | null> {
        if (transcript.length === 0) return null;

        const rosterBlock = crewRoster.map((m) => `- ${m.name}: ${m.description}`).join("\n");
        const transcriptBlock = transcript
            .map((t) => `${t.speaker} (${t.speakerType}): ${t.content}` +
                (t.toolsUsed?.length ? `\nExecution evidence: ${t.toolsUsed.map((tool) =>
                    `${tool.name}: ${tool.ok ? "succeeded" : `FAILED (${tool.error || "unknown error"})`}`).join("; ")}` : ""))
            .join("\n\n");

        const priorBlock = priorSummary.trim()
            ? `\n\nWHAT THE DISCUSSION HAD ESTABLISHED BEFORE THIS ROUND:\n${priorSummary.trim()}`
            : "";

        const stageBlock = stageContext?.activeStageId
            ? `\n\nACTIVE ASSEMBLY BLUEPRINT STAGE CONTEXT:\n` +
              `- Blueprint: ${stageContext.blueprintId ?? "current-blueprint"}\n` +
              `- Active Stage: ${stageContext.activeStageName ?? stageContext.activeStageId} (UNBLOCKED & ACTIVE)\n` +
              `- Verified Stages: ${stageContext.verifiedStages?.join(", ") || "None yet"}\n` +
              `- Blocked Downstream Stages: ${stageContext.blockedStages?.join(", ") || "None"}\n` +
              `DIRECTIVE RULE: Direct agents to resolve prerequisites and configure "${stageContext.activeStageName ?? stageContext.activeStageId}". Redirect if agents jump to blocked stages.`
            : "";

        const userPrompt =
            `SUBJECT UNDER DISCUSSION: ${topic}\n\n` +
            `CREW ROSTER:\n${rosterBlock}${priorBlock}${stageBlock}\n\n` +
            `THIS ROUND OF DISCUSSION:\n${transcriptBlock}\n\n` +
            `Judge execution against the tool evidence. Agreement about an error is not successful progress. ` +
            `If a requested build failed without a successful retry, explicitly state it remains incomplete and identify the blocker. ` +
            `Never call that round sound or treat a promise to fix it as a completed deliverable.`;

        const supervisorCard: AgentCardRecord = {
            ...SUPERVISOR_CARD,
            modelBindingProviderId: modelBinding?.modelBindingProviderId ?? null,
            modelBindingModelId: modelBinding?.modelBindingModelId ?? null,
        };

        let raw: string;
        try {
            const result = await crewGenerationService.generate(
                supervisorCard,
                orgId,
                [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: userPrompt },
                ],
                // jsonMode: the supervisor returns a structured object, so ask the
                // provider for JSON rather than hoping prose parses.
                { temperature: 0.4, maxTokens: 1200, jsonMode: true },
            );
            raw = result.content;
        } catch (err) {
            logger.warn(
                `Supervisor review failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return null;
        }

        const json = extractJsonObject(raw);
        if (!json) {
            logger.warn("Supervisor returned no parseable JSON object");
            // Rather than lose the output entirely, keep it as a summary.
            return raw.trim()
                ? {
                      critique: "",
                      consensus: "",
                      summary: raw.trim().slice(0, 4000),
                      notes: [],
                      intents: [],
                      plan: null,
                      positions: [],
                      directive: "",
                      activeTopic: "",
                      nextSteps: "",
                      consensusLevel: null,
                      divergenceQuestion: null,
                      stageGating: null,
                  }
                : null;
        }

        try {
            const parsed = JSON.parse(json) as Record<string, unknown>;
            const level = Number(parsed.consensusLevel);

            const output: SupervisorOutput = {
                critique: typeof parsed.critique === "string" ? parsed.critique.trim() : "",
                consensus: typeof parsed.consensus === "string" ? parsed.consensus.trim() : "",
                summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
                notes: asStringArray(parsed.notes, 6),
                intents: asStringArray(parsed.intents, 4),
                plan: parsePlan(parsed.plan),
                positions: parsePositions(parsed.positions),
                directive: typeof parsed.directive === "string" ? parsed.directive.trim() : "",
                activeTopic: typeof parsed.activeTopic === "string" ? parsed.activeTopic.trim() : "",
                nextSteps: typeof parsed.nextSteps === "string" ? parsed.nextSteps.trim() : "",
                consensusLevel: Number.isFinite(level)
                    ? Math.max(0, Math.min(100, Math.round(level)))
                    : null,
                divergenceQuestion: null,
                stageGating: parseStageGating(parsed.stageGating),
                speakerBudgetOverride: parseSpeakerBudgetOverride(parsed.speakerBudgetOverride),
                breakoutSuggestion: parseBreakoutSuggestion(parsed.breakoutSuggestion),
                decisions: parseDecisions(parsed.decisions),
                claims: parseClaims(parsed.claims),
                commitments: parseCommitments(parsed.commitments),
            };

            const divergence = buildDivergenceQuestion(
                output,
                crewRoster.map((m) => m.name),
            );
            if (divergence) {
                output.divergenceQuestion = divergence.question;
                logger.info(
                    `Supervisor synthesised a divergence question for "${output.activeTopic}" ` +
                        `(consensus ${output.consensusLevel ?? "unknown"}).`,
                );
                // The structured payload is a form card; the directive is the only
                // thing the room hears. Speak the question, keep the card as panel
                // material so nothing is lost.
                output.directive = appendDivergenceQuestion(
                    output.directive,
                    divergence.branchA,
                    divergence.branchB,
                );
            }

            // When a breakout is suggested, append a brief note to the directive
            // so the room knows what the Supervisor has flagged.
            if (output.breakoutSuggestion) {
                const { subTopic, rationale } = output.breakoutSuggestion;
                const nudge = `A breakout room is being prepared for the side-topic "${subTopic}". ${rationale} The discussion will continue uninterrupted here.`;
                output.directive = output.directive ? `${output.directive}\n\n${nudge}` : nudge;
            }

            return output;
        } catch (err) {
            logger.warn(
                `Supervisor JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return null;
        }
    }
}

export const crewSupervisorService = new CrewSupervisorService();
