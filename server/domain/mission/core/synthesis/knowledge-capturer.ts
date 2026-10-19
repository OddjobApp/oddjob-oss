import { SynthesisContext, SynthesisAnalysis, SynthesisLearning, KnowledgeCapture, MissionPattern } from "./types.js";
import { createLogger } from "@server/utils/logger.js";
import { institutionalMemoryService } from "../../../learning/core/institutional-memory.service.js";
import { strategyMLService } from "../../../agents/core/ml-strategy-predictor/strategy-ml.service.js";

const logger = createLogger("KnowledgeCapturer");

export const knowledgeCapturer = {
  async captureKnowledge(
    context: SynthesisContext,
    analysis: SynthesisAnalysis,
    learning: SynthesisLearning
  ): Promise<KnowledgeCapture> {
    logger.debug(`[KnowledgeCapturer] Capturing knowledge for run ${context.missionRunId}`);

    const patterns: MissionPattern[] = [];
    
    // Create mission pattern if successful
    if (analysis.objectiveMet && learning.successfulStrategies.length > 0) {
      const pattern: MissionPattern = {
        name: `Success Pattern: ${context.objective.substring(0, 50)}`,
        triggerConditions: [context.objective, ...learning.successfulStrategies.slice(0, 3)],
        successfulApproach: learning.successfulStrategies.join(' → '),
        effectiveness: analysis.confidenceScore,
        usageCount: 1
      };
      patterns.push(pattern);
    }

    // Record in institutional memory
    try {
      await institutionalMemoryService.recordMissionOutcome({
        missionId: context.missionId,
        objective: context.objective,
        success: analysis.objectiveMet,
        patterns: learning.detectedPatterns,
        insights: learning.keyInsights,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      logger.warn(`[KnowledgeCapturer] Failed to record institutional memory`, err);
    }

    // Update strategy ML predictor
    try {
      await strategyMLService.recordPerformance({
        strategy: 'dynamic_orchestration' as any,
        taskFeatures: {
          description: context.objective,
          complexity: this.calculateComplexity(context),
          domain: 'general',
          hasStructuredData: Object.keys(context.blackboard).length > 5,
          requiresCreativity: false,
          hasTimeConstraint: false,
          expectedSteps: context.executionTrace.length,
          riskLevel: analysis.deviationAnalysis.some(d => d.impact === 'high') ? 'high' : 'medium',
          novelty: 'familiar',
          wordCount: context.objective.split(' ').length,
          questionCount: 0,
          keywordDensity: {}
        },
        success: analysis.objectiveMet,
        qualityScore: analysis.performanceMetrics.qualityScore * 100,
        executionTimeMs: 0,
        tokenUsage: 0,
        correctionCount: analysis.deviationAnalysis.length,
        agentId: `mission-run-${context.missionRunId}`,
        organizationId: context.organizationId
      });
    } catch (err: any) {
      logger.warn(`[KnowledgeCapturer] Failed to update ML predictor`, err);
    }

    return {
      newPatterns: patterns,
      institutionalMemory: {
        missionPattern: patterns[0]?.name || 'No pattern captured',
        successFactors: learning.successfulStrategies,
        failureFactors: learning.failedApproaches.map(f => f.reason)
      },
      skillUpdates: []
    };
  },

  calculateComplexity(context: SynthesisContext): 'low' | 'medium' | 'high' {
    const factors = [
      context.executionTrace.length > 10,
      Object.keys(context.blackboard).length > 10,
      context.cycleCount > 5,
      context.objective.length > 200
    ];
    const score = factors.filter(Boolean).length;
    return score >= 3 ? 'high' : score >= 2 ? 'medium' : 'low';
  }
};
