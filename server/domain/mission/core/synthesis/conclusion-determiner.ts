import { SynthesisContext, SynthesisAnalysis, SynthesisLearning, SynthesisConclusion, Adjustment } from "./types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ConclusionDeterminer");

export const conclusionDeterminer = {
  async determineConclusion(
    context: SynthesisContext,
    analysis: SynthesisAnalysis,
    learning: SynthesisLearning
  ): Promise<SynthesisConclusion> {
    logger.debug(`[ConclusionDeterminer] Determining conclusion for run ${context.missionRunId}`);

    let recommendation: SynthesisConclusion['recommendation'];
    let confidence: number;
    let reasoning: string;
    let nextCycleAdjustments: Adjustment[] | undefined;

    // Decision logic
    if (analysis.objectiveMet) {
      recommendation = 'conclude';
      confidence = analysis.confidenceScore;
      reasoning = 'Objective successfully achieved. Mission can be concluded.';
    } else if (context.cycleCount >= context.maxCycles) {
      recommendation = 'escalate';
      confidence = 0.9;
      reasoning = `Maximum cycles (${context.maxCycles}) reached without achieving objective. Requires human review.`;
    } else if (analysis.performanceMetrics.budgetEfficiency > 0.95) {
      recommendation = 'escalate';
      confidence = 0.8;
      reasoning = 'Budget nearly exhausted without achieving objective. Recommend human intervention.';
    } else if (learning.failedApproaches.length > context.cycleCount / 2) {
      recommendation = 'retry';
      confidence = 0.6;
      reasoning = 'High failure rate suggests strategy issues. Recommend retry with adjustments.';
      nextCycleAdjustments = learning.recommendedAdjustments.slice(0, 3);
    } else {
      recommendation = 'continue';
      confidence = 0.7;
      reasoning = 'Objective not yet achieved but progress is being made. Continue with next cycle.';
      nextCycleAdjustments = learning.recommendedAdjustments.slice(0, 2);
    }

    const completionStatus: SynthesisConclusion['completionStatus'] = 
      analysis.objectiveMet ? 'success' : 
      analysis.performanceMetrics.completionPercentage > 60 ? 'partial' : 
      'failure';

    return {
      recommendation,
      completionStatus,
      confidence,
      reasoning,
      nextCycleAdjustments,
      finalOutputs: analysis.objectiveMet ? [context.blackboard.result || context.blackboard.output] : undefined,
      postMissionActions: analysis.objectiveMet ? ['notify_stakeholders', 'archive_deliverables'] : undefined
    };
  }
};
