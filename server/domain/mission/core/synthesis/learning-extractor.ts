import { SynthesisContext, SynthesisAnalysis, SynthesisLearning, FailedApproach, Insight, Pattern, Adjustment } from "./types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("LearningExtractor");

export const learningExtractor = {
  async extractLearnings(
    context: SynthesisContext, 
    analysis: SynthesisAnalysis
  ): Promise<SynthesisLearning> {
    logger.debug(`[LearningExtractor] Extracting learnings for run ${context.missionRunId}`);

    const successfulStrategies: string[] = [];
    const failedApproaches: FailedApproach[] = [];
    const adjustments: Adjustment[] = [];
    const patterns: Pattern[] = [];
    const insights: Insight[] = [];

    // Identify successful strategies
    const successSteps = analysis.executionTrace.filter(s => s.result === 'success');
    successSteps.forEach(step => {
      if (!successfulStrategies.includes(step.action)) {
        successfulStrategies.push(step.action);
      }
    });

    // Identify failures and learn from them
    const failedSteps = analysis.executionTrace.filter(s => s.result === 'failure');
    failedSteps.forEach(step => {
      failedApproaches.push({
        strategy: step.action,
        reason: step.error || 'Unknown error',
        alternative: this.suggestAlternative(step.action, step.error)
      });
    });

    // Detect patterns
    if (successfulStrategies.length > 2) {
      patterns.push({
        type: 'success',
        description: `Sequence of ${successfulStrategies.length} successful actions`,
        frequency: 1,
        confidence: 0.7
      });
    }

    if (failedSteps.length > 0) {
      patterns.push({
        type: 'failure',
        description: `${failedSteps.length} failures in execution`,
        frequency: failedSteps.length,
        confidence: 0.8
      });
    }

    // Budget efficiency pattern
    if (analysis.performanceMetrics.budgetEfficiency > 0.9) {
      patterns.push({
        type: 'efficiency',
        description: 'High budget efficiency achieved',
        frequency: 1,
        confidence: 0.75
      });
    }

    // Generate insights
    if (analysis.objectiveMet) {
      insights.push({
        category: 'process',
        statement: 'Objective was successfully achieved',
        evidence: ['Mission completed within cycle limit', 'Final output produced'],
        confidence: analysis.confidenceScore
      });
    } else {
      insights.push({
        category: 'process',
        statement: 'Objective was not fully achieved',
        evidence: analysis.deviationAnalysis.map(d => d.cause || d.actual),
        confidence: 0.6
      });
    }

    // Suggest adjustments based on deviations
    analysis.deviationAnalysis.forEach(deviation => {
      if (deviation.impact === 'high') {
        adjustments.push({
          target: 'tactic-selection',
          change: `Account for ${deviation.cause || 'unexpected conditions'}`,
          rationale: `High-impact deviation detected: ${deviation.actual}`
        });
      }
    });

    return {
      successfulStrategies,
      failedApproaches,
      recommendedAdjustments: adjustments,
      detectedPatterns: patterns,
      keyInsights: insights
    };
  },

  suggestAlternative(action: string, error?: string): string | undefined {
    if (error?.includes('timeout')) return 'Add retry logic with exponential backoff';
    if (error?.includes('permission') || error?.includes('auth')) return 'Verify credentials and permissions';
    if (error?.includes('not found')) return 'Check resource availability before execution';
    return 'Try alternative approach or escalate to human';
  }
};
