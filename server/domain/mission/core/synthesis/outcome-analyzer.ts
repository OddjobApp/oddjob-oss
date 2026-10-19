import { SynthesisContext, SynthesisAnalysis, ExecutionStep, Deviation, BlockerAnalysis } from "./types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("OutcomeAnalyzer");
const TARGET_LATENCY_MS = 5000;

export const outcomeAnalyzer = {
  async analyzeOutcome(context: SynthesisContext): Promise<SynthesisAnalysis> {
    logger.debug(`[OutcomeAnalyzer] Analyzing outcome for run ${context.missionRunId}`);

    // Gather metrics (all synchronous operations)
    const budgetEfficiency = context.budgetLimit > 0 
      ? context.budgetUsed / context.budgetLimit 
      : 1;
    
    const completedSteps = context.executionTrace.filter(s => s.result === 'success').length;
    const totalSteps = context.executionTrace.length;
    const completionPercentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
    const totalLatencyMs = context.executionTrace.reduce((acc, s) => {
      const latencyMs = Number(s.latencyMs);
      return Number.isFinite(latencyMs) && latencyMs > 0 ? acc + latencyMs : acc;
    }, 0);
    const targetLatencyMs = totalSteps * TARGET_LATENCY_MS;
    const timeEfficiency = totalSteps > 0 && totalLatencyMs > 0
      ? Math.min(1, targetLatencyMs / totalLatencyMs)
      : 1;

    // Check if objective appears met (heuristic, no AI call)
    const blackboardResult = context.blackboard.result || context.blackboard.output;
    const objectiveMet = this.assessObjectiveMet(context.objective, blackboardResult, context.executionTrace);

    // Analyze deviations
    const deviations = this.analyzeDeviations(context.executionTrace);

    // Analyze blockers
    const blockerAnalysis = this.analyzeBlockers(context.executionTrace);

    // Calculate quality score using fast heuristic (default)
    let qualityScore = this.calculateHeuristicQualityScore(
      completionPercentage,
      deviations.length,
      context.executionTrace
    );

    return {
      objectiveMet,
      confidenceScore: objectiveMet ? 0.85 : 0.4,
      performanceMetrics: {
        budgetEfficiency,
        timeEfficiency,
        qualityScore,
        completionPercentage
      },
      executionTrace: context.executionTrace,
      deviationAnalysis: deviations,
      blockerAnalysis
    };
  },

  calculateHeuristicQualityScore(
    completionPercentage: number,
    deviationCount: number,
    trace: ExecutionStep[]
  ): number {
    let score = completionPercentage / 100;
    const deviationPenalty = Math.min(deviationCount * 0.1, 0.3);
    score -= deviationPenalty;
    const allSuccess = trace.length > 0 && trace.every(s => s.result === 'success');
    if (allSuccess) score += 0.1;
    const recentFailures = trace.slice(-3).filter(s => s.result === 'failure').length;
    if (recentFailures === 0) score += 0.05;
    return Math.max(0, Math.min(1, score));
  },

  assessObjectiveMet(objective: string, result: unknown, trace: ExecutionStep[]): boolean {
    if (!result) return false;
    // Require the result to be a non-empty string or a non-empty object
    const hasSubstantiveResult = typeof result === 'string'
      ? result.trim().length > 0
      : typeof result === 'object' && Object.keys(result as object).length > 0;
    if (!hasSubstantiveResult) return false;
    // Require no failures in the last 3 steps
    const recentFailures = trace.slice(-3).filter(s => s.result === 'failure').length;
    if (recentFailures > 0) return false;
    // Require the result contains meaningful content relative to the objective
    const objectiveKeywords = objective.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const resultText = (typeof result === 'string' ? result : JSON.stringify(result)).toLowerCase();
    const matchedKeywords = objectiveKeywords.filter(kw => resultText.includes(kw));
    return objectiveKeywords.length === 0 || matchedKeywords.length > 0;
  },

  analyzeDeviations(trace: ExecutionStep[]): Deviation[] {
    const deviations: Deviation[] = [];
    trace.forEach((step, index) => {
      if (step.result === 'failure') {
        deviations.push({
          expected: `Successful execution of ${step.action}`,
          actual: `Failure: ${step.error || 'Unknown error'}`,
          impact: index > trace.length - 3 ? 'high' : 'medium',
          cause: step.error
        });
      }
    });
    return deviations;
  },

  analyzeBlockers(trace: ExecutionStep[]): BlockerAnalysis {
    const failedSteps = trace.filter(s => s.result === 'failure');
    const resolvedSteps = trace.filter(s => s.result === 'success' && s.error);
    // A blocker is unresolved if no successful step follows it in the trace
    const unresolvedBlockers = failedSteps
      .filter(failedStep => {
        const failedIndex = trace.indexOf(failedStep);
        return !trace.slice(failedIndex + 1).some(later => later.result === 'success');
      })
      .map(s => s.action);
    return {
      blockersEncountered: failedSteps.length,
      blockersResolved: resolvedSteps.length,
      unresolvedBlockers,
      avgResolutionTime: 0
    };
  }
};
