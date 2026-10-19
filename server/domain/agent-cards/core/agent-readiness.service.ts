import { PredictionEngine, type TrajectoryStep, type TrajectoryVector } from "@domain/ai/core/prediction-engine.service.js";
import { isConsequentialTool, type AgentDefinition } from "@shared/agent-studio.js";

/**
 * What an agent will need before it is any use, worked out before it is created.
 *
 * The PREDICTION ENGINE evaluates the trajectory this agent would take — the work it
 * is being asked to do, as a step — and says whether that is something to execute,
 * gate behind approval, or refuse. Its answer is what decides whether a missing
 * approval is a warning or a blocker, rather than a rule written twice.
 *
 * The point is that an agent is proposed with its gaps already named. Asking "this will
 * need to read your support inbox — which knowledge topic is that?" before it exists is
 * worth more than discovering it the first time the agent runs and says it cannot.
 */

/** What a request implies the agent will have to reach for, by the words people use. */
const TOOL_HINTS: Array<{ pattern: RegExp; tools: string[]; why: string }> = [
    { pattern: /\b(email|inbox|reply|reply to|mailbox)\b/i, tools: ["send_email", "read_email"], why: "the request is about email" },
    { pattern: /\b(slack|channel|dm)\b/i, tools: ["slack_post_message"], why: "the request is about Slack" },
    { pattern: /\b(search|find|look ?up|research)\b/i, tools: ["search_knowledge_graph"], why: "the request asks it to find things" },
    { pattern: /\b(browse|website|web ?page|portal|log ?in)\b/i, tools: ["computer_use_task"], why: "the request needs a browser" },
    { pattern: /\b(report|summar|digest|brief)\b/i, tools: ["create_document"], why: "the request produces something to read" },
    { pattern: /\b(schedule|every (day|week|morning)|recurring|nightly)\b/i, tools: ["create_scheduled_job"], why: "the request recurs" },
    { pattern: /\b(ticket|issue|jira|incident)\b/i, tools: ["jira_create_issue"], why: "the request is about tickets" },
    { pattern: /\b(dataset|spreadsheet|csv|table|records)\b/i, tools: ["query_dataset"], why: "the request is about stored data" },
];

/** Words that say the agent is expected to act, not just answer. */
const ACTS_ON_THE_WORLD = /\b(send|post|publish|deploy|delete|pay|order|book|update|create|file|escalate)\b/i;

export type ReadinessGapKind =
    | "capability_deficit"
    | "governance_gap"
    | "unbound_model"
    | "knowledge_deficit"
    | "identity_deficit";

export interface ReadinessGap {
    kind: ReadinessGapKind;
    severity: "critical" | "warning" | "advisory";
    message: string;
    remediation: string;
    /** Tools or topics this gap would add, when the person says yes. */
    suggests?: string[];
}

export interface AgentReadiness {
    gaps: ReadinessGap[];
    /** The prediction engine's read on the work this agent is being pointed at. */
    trajectory: {
        recommendedAction: "auto_execute" | "require_approval" | "halt_loop";
        safeTransitionScore: number;
        blastRadius: number;
        reason: string;
    };
}

/** The step this agent represents, in the shape the prediction engine evaluates. */
function trajectoryFor(instruction: string, definition: AgentDefinition): TrajectoryVector {
    const consequential = definition.tools.filter(isConsequentialTool);
    const acts = ACTS_ON_THE_WORLD.test(instruction) || consequential.length > 0;
    const step: TrajectoryStep = {
        stage: "Improve",
        targetFileOrNode: `agent:${definition.name || "unnamed"}`,
        proposedAction: instruction.slice(0, 300),
        diagnosticHypothesis: acts
            ? `Agent acts outside the platform using ${consequential.join(", ") || "tools it has not been given yet"}`
            : "Agent answers from what it can read",
        confidenceScore: definition.modelBindingModelId ? 0.7 : 0.5,
        riskClass: acts ? "critical" : "routine",
    };
    return {
        currentState: {
            stage: "Diagnose",
            targetFileOrNode: "agent-studio",
            proposedAction: "Draft an agent for this request",
            confidenceScore: 0.9,
            riskClass: "routine",
        },
        candidateNextStep: step,
    };
}

/**
 * The gaps between what this agent is being asked to do and what it has been given.
 *
 * Deliberately conservative about tools: a hint SUGGESTS a tool, it never adds one.
 * Granting reach without being asked is the one mistake an agent builder must not make,
 * so every suggestion becomes a question instead.
 */
export function findGaps(instruction: string, definition: AgentDefinition): ReadinessGap[] {
    const gaps: ReadinessGap[] = [];
    const has = new Set(definition.tools.map((tool) => tool.toLowerCase()));

    for (const hint of TOOL_HINTS) {
        if (!hint.pattern.test(instruction)) continue;
        const missing = hint.tools.filter((tool) => !has.has(tool.toLowerCase()));
        if (missing.length === 0) continue;
        gaps.push({
            kind: "capability_deficit",
            severity: "warning",
            message: `This agent has no way to do part of what was asked — ${hint.why}, and it cannot reach ${missing.join(" or ")}.`,
            remediation: `Give it ${missing.join(", ")}, or say what it should use instead.`,
            suggests: missing,
        });
    }

    const consequential = definition.tools.filter(isConsequentialTool);
    if (consequential.length > 0) {
        gaps.push({
            kind: "governance_gap",
            severity: "critical",
            message: `It can act outside the platform (${consequential.join(", ")}). Nothing here says when it may do that unsupervised.`,
            remediation: "Decide which of those need a person's approval each time, and which it may do alone.",
            suggests: consequential,
        });
    }

    if (!definition.modelBindingModelId) {
        gaps.push({
            kind: "unbound_model",
            severity: "warning",
            message: "No model is bound, so this agent runs on whatever the room defaults to and its cost cannot be predicted.",
            remediation: "Bind a model, or accept the room default knowingly.",
        });
    }

    if (definition.topicAffinities.length === 0) {
        gaps.push({
            kind: "knowledge_deficit",
            severity: "advisory",
            message: "It is not attached to any knowledge topic, so it answers from the conversation alone.",
            remediation: "Name the topics or datasets it should read before answering.",
        });
    }

    if (!definition.legend?.trim()) {
        gaps.push({
            kind: "identity_deficit",
            severity: "advisory",
            message: "It has no operating philosophy, which is what it says about itself when a room asks who should take a task.",
            remediation: "Write one line in its own voice, or let the studio draft one.",
        });
    }

    return gaps;
}

/**
 * Everything the studio needs to show an agent's readiness: the gaps, and what the
 * prediction engine makes of the work.
 */
export function assessAgent(instruction: string, definition: AgentDefinition): AgentReadiness {
    const evaluation = PredictionEngine.evaluateTrajectory(trajectoryFor(instruction, definition));
    const gaps = findGaps(instruction, definition);

    // A governance gap is only critical if the prediction engine agrees this work needs a
    // person. When it says auto_execute — a read-only agent with no reach — insisting on
    // an approval policy is noise, and noise is what makes people skip the real ones.
    const graded = gaps.map((gap) =>
        gap.kind === "governance_gap" && evaluation.recommendedAction === "auto_execute"
            ? { ...gap, severity: "advisory" as const }
            : gap,
    );

    return {
        gaps: graded,
        trajectory: {
            recommendedAction: evaluation.recommendedAction,
            safeTransitionScore: evaluation.safeTransitionScore,
            blastRadius: evaluation.blastRadius,
            reason: evaluation.reason,
        },
    };
}
