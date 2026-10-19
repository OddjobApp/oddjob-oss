/**
 * Synthesis Governor Service
 * 
 * Implements the 5th phase of the Pentagonal OODA Loop:
 * SYNTHESIZE/CONCLUDE - Post-action analysis, learning, and knowledge capture.
 * 
 * This service runs after the ACT phase to:
 * 1. Analyze mission outcomes vs objectives
 * 2. Learn from successes and failures
 * 3. Capture knowledge for institutional memory
 * 4. Determine whether to continue, conclude, or escalate
 */

import { db } from "@server/database_service.js";
import { missionRuns } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { createHash } from "crypto";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";

// Import extracted synthesis modules
import { outcomeAnalyzer } from "./synthesis/outcome-analyzer.js";
import { learningExtractor } from "./synthesis/learning-extractor.js";
import { knowledgeCapturer } from "./synthesis/knowledge-capturer.js";
import { conclusionDeterminer } from "./synthesis/conclusion-determiner.js";
import {
  SynthesisContext,
  SynthesisResult,
  SynthesisAnalysis
} from "./synthesis/types.js";

const logger = createLogger("SynthesisGovernor");

const SYNTHESIS_CACHE_TTL_SECONDS = 300; // 5 minutes
const TARGET_LATENCY_MS = 5000;

export const synthesisGovernorService = {
  /**
   * Main synthesis orchestrator (optimized for <5s latency)
   * Runs all 4 synthesis steps in sequence with caching
   */
  async synthesize(context: SynthesisContext): Promise<SynthesisResult> {
    const startTime = Date.now();
    let cacheKey = '';

    try {
      // Check cache first.
      //
      // This sat OUTSIDE the try, so anything failing here escaped the catch
      // below that exists to guarantee synthesis answers rather than throws —
      // a malformed context died in generateCacheKey, and a Redis outage would
      // die in the GET, both past the graceful path.
      cacheKey = `synthesis:${this.generateCacheKey(context)}`;
      const cachedJson = await redis.get(cacheKey);
      if (cachedJson) {
        logger.debug(`[SynthesisGovernor] Cache hit for run ${context.missionRunId}`);
        return JSON.parse(cachedJson) as SynthesisResult;
      }

      logger.info(`[SynthesisGovernor] Starting synthesis for run ${context.missionRunId}`, {
        objective: context.objective,
        cycles: context.cycleCount
      });

      // Step 1: Analyze outcomes (fast, <100ms)
      const analysis = await outcomeAnalyzer.analyzeOutcome(context);
      
      // Step 2: Extract learnings, then capture knowledge with real data
      const learning = await learningExtractor.extractLearnings(context, analysis);
      const updatedKnowledgeCapture = await knowledgeCapturer.captureKnowledge(context, analysis, learning);
      
      // Step 4: Determine conclusion (<50ms)
      const conclusion = await conclusionDeterminer.determineConclusion(context, analysis, learning);

      const latencyMs = Date.now() - startTime;
      
      // Warn if exceeding target latency
      if (latencyMs > TARGET_LATENCY_MS) {
        logger.warn(`[SynthesisGovernor] Synthesis exceeded target latency (${latencyMs}ms > ${TARGET_LATENCY_MS}ms)`, {
          missionRunId: context.missionRunId,
          latencyMs
        });
      }

      const result: SynthesisResult = {
        success: true,
        analysis,
        learning,
        knowledgeCapture: updatedKnowledgeCapture,
        conclusion,
        latencyMs,
        timestamp: new Date().toISOString()
      };

      // Cache result in Redis (TTL handled server-side)
      redis.set(cacheKey, JSON.stringify(result), "EX", SYNTHESIS_CACHE_TTL_SECONDS).catch(err => {
        logger.warn(`[SynthesisGovernor] Failed to cache synthesis result`, err);
      });

      // Record synthesis in trace (async, don't wait)
      this.recordSynthesis(context.missionRunId, result).catch(err => {
        logger.warn(`[SynthesisGovernor] Failed to record synthesis trace`, err);
      });

      // Turn the completed trajectory into a durable, structured reasoning
      // assessment. This stays asynchronous so learning never blocks execution.
      import("./reasoning-assessment.service.js")
        .then(({ reasoningAssessmentService }) => reasoningAssessmentService.assessAndPersist(context.missionRunId))
        .catch(err => logger.warn(`[SynthesisGovernor] Reasoning assessment failed`, err));

      logger.info(`[SynthesisGovernor] Synthesis complete for run ${context.missionRunId}`, {
        recommendation: conclusion.recommendation,
        confidence: conclusion.confidence,
        latency: result.latencyMs,
        targetMet: latencyMs <= TARGET_LATENCY_MS
      });

      return result;

    } catch (error: any) {
      // Optional chaining throughout: the handler that exists to guarantee an
      // answer must not itself fail on the context that caused the failure.
      logger.error(`[SynthesisGovernor] Synthesis failed for run ${context?.missionRunId}`, error);
      
      // Return degraded result with error info
      return {
        success: false,
        analysis: this.createDegradedAnalysis(context),
        learning: { successfulStrategies: [], failedApproaches: [], recommendedAdjustments: [], detectedPatterns: [], keyInsights: [] },
        knowledgeCapture: { newPatterns: [], institutionalMemory: { missionPattern: '', successFactors: [], failureFactors: [] }, skillUpdates: [] },
        conclusion: {
          recommendation: 'escalate',
          completionStatus: 'failure',
          confidence: 0,
          reasoning: `Synthesis failed: ${error.message}. Escalating to human.`
        },
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
    }
  },

  /**
   * Generate cache key for synthesis context
   */
  generateCacheKey(context: SynthesisContext): string {
    const keyData = {
      missionId: context.missionId,
      objective: context.objective,
      traceLength: context.executionTrace.length,
      successCount: context.executionTrace.filter(s => s.result === 'success').length,
      budgetUsed: Math.round(context.budgetUsed)
    };
    return createHash('md5').update(JSON.stringify(keyData)).digest('hex');
  },

  createDegradedAnalysis(context: SynthesisContext): SynthesisAnalysis {
    return {
      objectiveMet: false,
      confidenceScore: 0,
      performanceMetrics: {
        budgetEfficiency: (context?.budgetLimit ?? 0) > 0 ? context.budgetUsed / context.budgetLimit : 1,
        timeEfficiency: 1,
        qualityScore: 0,
        completionPercentage: 0
      },
      executionTrace: context?.executionTrace ?? [],
      deviationAnalysis: [],
      blockerAnalysis: {
        blockersEncountered: 0,
        blockersResolved: 0,
        unresolvedBlockers: [],
        avgResolutionTime: 0
      }
    };
  },

  async recordSynthesis(missionRunId: number, result: SynthesisResult): Promise<void> {
    try {
      // Store synthesis in mission run trace
      await db.update(missionRuns)
        .set({
          dynamicTrace: sql`COALESCE(dynamic_trace, '[]'::jsonb) || ${JSON.stringify([{
            type: 'synthesis',
            timestamp: result.timestamp,
            recommendation: result.conclusion.recommendation,
            confidence: result.conclusion.confidence,
            completionStatus: result.conclusion.completionStatus
          }])}::jsonb`
        })
        .where(eq(missionRuns.id, missionRunId));
    } catch (err: any) {
      logger.warn(`[SynthesisGovernor] Failed to record synthesis trace`, err);
    }
  }
};

export default synthesisGovernorService;
