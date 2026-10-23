import { createLogger } from "@server/utils/logger.js";
import { PredictionEngine, type TrajectoryStep } from "./prediction-engine.service.js";
import { GoodQuestionEngine, type StructuredQuestionPayload } from "./good-question-engine.js";
import { buildCopilotActionPreview, type CopilotActionPreview } from "./copilot-contract.js";

const logger = createLogger("CopilotIntentPredictor");

export type InferredIntentType =
  | "daily_brief"
  | "informational"
  | "planning"
  | "actionable"
  | "diagnostic"
  | "clarification_needed";

export interface IntentPredictionResult {
  intent: InferredIntentType;
  confidence: number;
  reason: string;
  suggestedMode: "explain" | "plan" | "execute" | "audit";
  requiresConfirmation: boolean;
  actionPreview?: CopilotActionPreview;
  clarification?: {
    questionId: string;
    headline: string;
    question: string;
    options: Array<{ label: string; value: string; prompt: string }>;
    structuredPayload?: StructuredQuestionPayload;
  };
}

export class CopilotIntentPredictorService {
  /**
   * Deterministic matching for the daily brief intent.
   */
  public isDailyBrief(message: string): boolean {
    const trimmed = (message ?? "").trim().toLowerCase();
    if (!trimmed) return false;
    return (
      trimmed === "daily brief" ||
      trimmed === "daily briefing" ||
      trimmed === "morning brief" ||
      trimmed === "status brief" ||
      trimmed === "platform brief" ||
      trimmed === "brief me" ||
      trimmed === "give me a brief" ||
      trimmed === "give me a daily brief" ||
      trimmed === "run daily brief" ||
      /\bdaily\s+brief(ing)?\b/i.test(trimmed) ||
      /\bmorning\s+brief(ing)?\b/i.test(trimmed) ||
      /\bbrief\s+me\b/i.test(trimmed)
    );
  }

  /**
   * Evaluates message and context to predict user intent, computing confidence
   * and invoking Good Question Engine (GQE) when ambiguous.
   */
  public predictIntent(
    message: string,
    context?: {
      page?: string;
      currentUrl?: string;
      jobId?: number;
      cycleId?: number;
      missionId?: number;
      confirmedExecution?: boolean;
    }
  ): IntentPredictionResult {
    const trimmed = (message ?? "").trim();
    const lower = trimmed.toLowerCase();

    // 1. Fast-path: Daily brief
    if (this.isDailyBrief(trimmed)) {
      return {
        intent: "daily_brief",
        confidence: 1.0,
        reason: "Matched daily brief deterministic intent",
        suggestedMode: "explain",
        requiresConfirmation: false,
      };
    }

    // 2. High-blast-radius / Actionable Verbs
    const actionVerbs = [
      "restart", "reboot", "terminate", "kill", "deploy", "publish",
      "conclude", "archive", "delete", "destroy", "drop", "purge",
      "execute", "trigger", "launch", "run", "start", "stop", "pause", "resume"
    ];
    const isActionMatch = actionVerbs.some((verb) =>
      new RegExp(`\\b${verb}\\b`, "i").test(lower)
    );

    // 3. Diagnostic / Audit Verbs
    const diagnosticVerbs = [
      "audit", "diagnose", "blocker", "failing", "anomaly", "risk",
      "why did", "why is", "root cause", "investigate", "bottleneck", "broken"
    ];
    const isDiagnosticMatch = diagnosticVerbs.some((verb) =>
      new RegExp(`\\b${verb}\\b`, "i").test(lower)
    );

    // 4. Planning Verbs
    const planningVerbs = [
      "plan", "draft", "propose", "roadmap", "architecture", "design",
      "scaffold", "blueprint", "prepare", "assemble"
    ];
    const isPlanningMatch = planningVerbs.some((verb) =>
      new RegExp(`\\b${verb}\\b`, "i").test(lower)
    );

    // 5. Informational / Query Verbs
    const infoVerbs = [
      "explain", "what is", "how does", "summarize", "describe",
      "tell me about", "show me", "list", "who is", "where is", "overview"
    ];
    const isInfoMatch = infoVerbs.some((verb) =>
      new RegExp(`\\b${verb}\\b`, "i").test(lower)
    );

    // Evaluate candidate step risk using PredictionEngine
    const candidateStep: TrajectoryStep = {
      stage: isActionMatch ? "Deploy" : isDiagnosticMatch ? "Diagnose" : isPlanningMatch ? "Improve" : "Observe",
      proposedAction: trimmed,
      targetFileOrNode: context?.currentUrl || context?.page || "global",
    };
    const riskClass = PredictionEngine.classifyRisk(candidateStep);

    // 6. Ambiguity Detection & Divergence Handling (GQE)
    // Short, underspecified prompts like "fix it", "check it", "run", "update", "help"
    const isVeryShort = trimmed.split(/\s+/).length <= 2;
    const hasConcreteTarget = /(pipeline|job|mission|database|cluster|app|cycle|server|doc|form|user|team|prompt)/i.test(lower);
    const isUnderspecifiedAction = isActionMatch && !hasConcreteTarget;
    const isCompetingIntents = (Number(isActionMatch) + Number(isDiagnosticMatch) + Number(isPlanningMatch) + Number(isInfoMatch)) >= 2;
    // A bare command with no object ("fix it", "check", "help", "update").
    const isVagueCommand = /^(fix|check|update|help|change|handle|sort|do)\b/i.test(lower) && !hasConcreteTarget;

    // Only an underspecified *request* is disambiguated. Every other short
    // message ("yes", "ok", "thanks", "hi", "42", "form studio") is usually a reply
    // to Copilot's own question or a name, and goes to the conversation, which has
    // the history to read it; turning "yes" into "which action do you mean?" broke
    // every follow-up.
    if (isVeryShort && (isUnderspecifiedAction || isVagueCommand || isCompetingIntents)) {
      logger.info(`[CopilotIntentPredictor] Low confidence for prompt "${trimmed}". Invoking GQE disambiguation.`);
      
      const targetNode = context?.page || "current screen";
      const branchA = `Inspect & Explain ${targetNode} status`;
      const branchB = `Audit risks & check blockers in ${targetNode}`;

      const gqePayload = GoodQuestionEngine.synthesizeDivergenceQuestion(
        targetNode,
        0.82,
        branchA,
        branchB
      );

      return {
        intent: "clarification_needed",
        confidence: 0.45,
        reason: "Ambiguous user query with multiple viable trajectory paths",
        suggestedMode: "explain",
        requiresConfirmation: false,
        clarification: {
          questionId: gqePayload.questionId,
          headline: `How would you like to proceed with ${targetNode}?`,
          question: `I detected multiple possible intents for "${trimmed}". Which action best matches your goal?`,
          options: [
            { label: "Explain & Summarize", value: "explain", prompt: `Explain what is happening on ${targetNode} and summarize recent activity.` },
            { label: "Audit & Find Blockers", value: "audit", prompt: `Audit ${targetNode} for blockers, failures, or open issues.` },
            { label: "Plan Next Steps", value: "plan", prompt: `Create a prioritized action plan for ${targetNode}.` },
          ],
          structuredPayload: gqePayload,
        },
      };
    }

    // 7. Actionable intent with non-zero blast radius
    if (isActionMatch && (riskClass === "critical" || riskClass === "elevated")) {
      const requiresConfirm = context?.confirmedExecution !== true;
      const preview = buildCopilotActionPreview(trimmed, context as any);

      return {
        intent: "actionable",
        confidence: 0.88,
        reason: `Actionable intent detected with ${riskClass} risk classification`,
        suggestedMode: "execute",
        requiresConfirmation: requiresConfirm,
        actionPreview: requiresConfirm ? preview : undefined,
      };
    }

    if (isActionMatch) {
      return {
        intent: "actionable",
        confidence: 0.85,
        reason: "Actionable intent detected",
        suggestedMode: "execute",
        requiresConfirmation: false,
      };
    }

    if (isDiagnosticMatch) {
      return {
        intent: "diagnostic",
        confidence: 0.90,
        reason: "Diagnostic/audit inquiry detected",
        suggestedMode: "audit",
        requiresConfirmation: false,
      };
    }

    if (isPlanningMatch) {
      return {
        intent: "planning",
        confidence: 0.88,
        reason: "Planning/architectural request detected",
        suggestedMode: "plan",
        requiresConfirmation: false,
      };
    }

    // Default: Informational / Explanation
    return {
      intent: "informational",
      confidence: 0.82,
      reason: "Informational inquiry or standard conversational request",
      suggestedMode: "explain",
      requiresConfirmation: false,
    };
  }
}

export const copilotIntentPredictor = new CopilotIntentPredictorService();
