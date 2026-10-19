import { db } from "@server/database_service.js";
import { missionShadowRuns } from "@shared/schema/missions/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { type EvaluationResult, evaluationService } from "./evaluation.service.js";

const logger = createLogger("CritiqueService");

export interface ConsensusResult extends EvaluationResult {
  individualScores: Record<string, number>;
  consensusReasoning: string;
}

/**
 * Panel of expert models used for multi-agent peer review.
 * Each expert brings a different model perspective to the consensus evaluation.
 * The first entry ("baseline") is always run via evaluationService.compareShadowRun
 * which uses the system copilot config. Remaining entries are dispatched in parallel
 * via judgeWithLLM with explicit model overrides.
 */
const OLLAMA_URL = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");

export function getCritiquePanel() {
  return [
    {
      id: "baseline",
      provider: process.env.CRITIQUE_BASELINE_PROVIDER || "google",
      model: process.env.CRITIQUE_BASELINE_MODEL || "gemini-1.5-pro",
      baseUrl: process.env.CRITIQUE_BASELINE_BASE_URL || undefined,
    },
    {
      id: "challenger",
      provider: process.env.CRITIQUE_CHALLENGER_PROVIDER || "google",
      model: process.env.CRITIQUE_CHALLENGER_MODEL || "gemini-2.0-flash",
      baseUrl: process.env.CRITIQUE_CHALLENGER_BASE_URL || undefined,
    },
    {
      id: "skeptic",
      provider: process.env.CRITIQUE_SKEPTIC_PROVIDER || "ollama",
      model: process.env.CRITIQUE_SKEPTIC_MODEL || "deepseek-r1:8b",
      baseUrl: process.env.CRITIQUE_SKEPTIC_BASE_URL || OLLAMA_URL,
    },
  ];
}

export const critiqueService = {
  /**
   * Perform a real multi-model critique of a shadow run.
   * Dispatches parallel LLM judge calls across the dynamic critique panel and
   * returns a consensus score + per-expert breakdown.
   */
  async peerReview(shadowRunId: number): Promise<ConsensusResult | null> {
    logger.info(`[CritiqueService] Initiating peer review for shadow run ${shadowRunId}`);

    const panel = getCritiquePanel();

    // 1. Baseline evaluation using the system copilot model
    const baseEval = await evaluationService.compareShadowRun(shadowRunId);
    if (!baseEval) return null;

    const individualResults: Record<string, EvaluationResult> = {
      [panel[0].id]: baseEval,
    };

    // 2. Fetch the raw content needed by the peer models
    const [shadow] = await db
      .select()
      .from(missionShadowRuns)
      .where(eq(missionShadowRuns.id, shadowRunId))
      .limit(1);

    if (!shadow) return null;

    const { missionRuns, missions } = await import("@shared/schema/missions/index.js");
    const { eq: drEq } = await import("drizzle-orm");

    const [primary] = await db.select().from(missionRuns).where(drEq(missionRuns.id, shadow.parentRunId)).limit(1);
    if (!primary) return null;

    const primaryResult  = (primary.missionContext as any)?.result || "";
    const shadowResult   = (shadow.missionContext  as any)?.result || "";
    if (!primaryResult || !shadowResult) return null;

    const [mission] = await db.select().from(missions).where(drEq(missions.id, primary.missionId as number)).limit(1);
    const objective      = mission?.objective || "No objective defined";
    const targetMetric   = mission?.targetMetric ? JSON.stringify(mission.targetMetric) : "General quality";
    const steeringNudge  = (mission as any)?.humanSteeringNudge || null;

    // 3. Dispatch remaining panel members in parallel
    const peerPromises = panel.slice(1).map(async (expert) => {
      try {
        const result = await evaluationService.judgeWithLLM(
          primaryResult,
          shadowResult,
          objective,
          targetMetric,
          steeringNudge,
          { provider: expert.provider as string, model: expert.model as string, baseUrl: expert.baseUrl as string | undefined },
        );
        return { id: expert.id, result };
      } catch (err: any) {
        logger.warn(`[CritiqueService] Peer ${expert.id} (${expert.model}) failed: ${err.message}`);
        return null;
      }
    });

    const peers = await Promise.all(peerPromises);
    peers.forEach(p => {
      if (p) individualResults[p.id] = p.result;
    });

    // 4. Consensus: weighted average (all peers equal weight for now)
    const allScores = Object.values(individualResults).map(r => r.score);
    const averageScore = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length);
    const isImproved = averageScore > 60;

    logger.info(`[CritiqueService] Consensus for shadow ${shadowRunId}: score=${averageScore}, improved=${isImproved}, panelSize=${allScores.length}`);

    return {
      score: averageScore,
      isImproved,
      reasoning: `Consensus of ${allScores.length} judge(s). Scores: ${allScores.join(", ")}.`,
      delta: `Average panel score: ${averageScore}/100`,
      individualScores: Object.fromEntries(
        Object.entries(individualResults).map(([k, v]) => [k, v.score])
      ),
      consensusReasoning: Object.values(individualResults).map(r => r.reasoning).join(" | "),
    };
  },
};


