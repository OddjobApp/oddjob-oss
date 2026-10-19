/**
 * Verifier Training Pipeline
 * 
 * Manages the lifecycle of training and updating the MissionVerifier:
 * - Historical data collection
 * - Model training and validation
 * - A/B testing of new models
 * - Gradual rollout
 * - Continuous monitoring
 */

import { createLogger } from "../../../utils/logger.js";
import { MissionVerifier, PretrainedMissionVerifier } from "./mission-verifier.js";
import { TraceEmbeddingEngine } from "../embeddings/trace-embedder.js";
import type { HermesTraceCollector, TraceStorage } from "../hermes/trace-collector.js";
import type { EnrichedHermesTrace } from "../common/types.js";

const logger = createLogger("VerifierTrainingPipeline");

export interface TrainingConfig {
  // Data collection
  minTrainingSamples: number;
  maxTrainingSamples: number;
  sampleWindowDays: number;
  
  // Training schedule
  trainingCron: string; // Cron expression
  retrainThreshold: number; // Accuracy drop before retraining
  
  // Validation
  validationSplit: number; // 0-1
  minAccuracyForDeployment: number;
  minPrecisionForDeployment: number;
  minRecallForDeployment: number;
  
  // Rollout
  canaryPercentage: number; // Initial rollout percentage
  canaryDurationHours: number;
}

const DEFAULT_CONFIG: TrainingConfig = {
  minTrainingSamples: 500,
  maxTrainingSamples: 50000,
  sampleWindowDays: 30,
  trainingCron: "0 2 * * 0", // Weekly at 2 AM Sunday
  retrainThreshold: 0.05, // Retrain if accuracy drops 5%
  validationSplit: 0.2,
  minAccuracyForDeployment: 0.75,
  minPrecisionForDeployment: 0.70,
  minRecallForDeployment: 0.70,
  canaryPercentage: 10,
  canaryDurationHours: 24
};

/**
 * Training pipeline orchestrator
 */
export class VerifierTrainingPipeline {
  private config: TrainingConfig;
  private storage: TraceStorage;
  private embedder: TraceEmbeddingEngine;
  private currentVerifier: MissionVerifier;
  private candidateVerifier?: MissionVerifier;
  private retrainingScheduled = false;
  
  // Metrics tracking
  private metrics: {
    lastTrainedAt?: Date;
    currentAccuracy: number;
    totalPredictions: number;
    totalRetrains: number;
  };
  
  constructor(
    storage: TraceStorage,
    embedder: TraceEmbeddingEngine,
    config: Partial<TrainingConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storage = storage;
    this.embedder = embedder;
    
    // Initialize with pretrained verifier
    this.currentVerifier = new PretrainedMissionVerifier(embedder);
    
    this.metrics = {
      currentAccuracy: 0,
      totalPredictions: 0,
      totalRetrains: 0
    };
  }

  /**
   * Initialize the pipeline
   * - Load existing model if available
   * - Check if retraining needed
   * - Start monitoring
   */
  async initialize(): Promise<void> {
    logger.info("Initializing verifier training pipeline");
    
    // Try to load saved model from storage
    const savedModel = await this.loadSavedModel();
    if (savedModel) {
      this.currentVerifier.importModel(savedModel);
      logger.info("Loaded saved verifier model");
    }
    
    // Check training data availability
    const availableSamples = await this.countTrainingSamples();
    logger.info(`Training data available: ${availableSamples} samples`);
    
    if (availableSamples >= this.config.minTrainingSamples) {
      // Check if model needs retraining
      const needsRetrain = await this.checkNeedsRetraining();
      if (needsRetrain) {
        logger.info("Triggering retraining based on drift detection");
        await this.runTraining();
      }
    }
  }

  /**
   * Run full training cycle
   */
  async runTraining(): Promise<{
    success: boolean;
    metrics: { accuracy: number; precision: number; recall: number };
    deployed: boolean;
  }> {
    logger.info("Starting verifier training pipeline");
    const startTime = Date.now();
    
    try {
      // 1. Collect training data
      const { traces, outcomes } = await this.collectTrainingData();
      
      if (traces.length < this.config.minTrainingSamples) {
        logger.warn(`Insufficient training data: ${traces.length} < ${this.config.minTrainingSamples}`);
        return { success: false, metrics: { accuracy: 0, precision: 0, recall: 0 }, deployed: false };
      }
      
      logger.info(`Training on ${traces.length} samples (${outcomes.filter(o => o).length} positive)`);
      
      // 2. Create candidate verifier
      this.candidateVerifier = new MissionVerifier(this.embedder);
      
      // 3. Train
      const trainMetrics = await this.candidateVerifier.train(traces, outcomes);
      
      logger.info(`Training complete: accuracy=${(trainMetrics.accuracy * 100).toFixed(1)}%, ` +
                  `precision=${(trainMetrics.precision * 100).toFixed(1)}%, ` +
                  `recall=${(trainMetrics.recall * 100).toFixed(1)}%`);
      
      // 4. Validate against deployment thresholds
      const meetsThresholds = 
        trainMetrics.accuracy >= this.config.minAccuracyForDeployment &&
        trainMetrics.precision >= this.config.minPrecisionForDeployment &&
        trainMetrics.recall >= this.config.minRecallForDeployment;
      
      if (!meetsThresholds) {
        logger.warn("Candidate model does not meet deployment thresholds");
        this.candidateVerifier = undefined;
        return { success: true, metrics: trainMetrics, deployed: false };
      }
      
      // 5. A/B test (canary deployment)
      const canarySuccess = await this.runCanaryTest();
      
      if (!canarySuccess) {
        logger.warn("Canary test failed - not deploying");
        this.candidateVerifier = undefined;
        return { success: true, metrics: trainMetrics, deployed: false };
      }
      
      // 6. Deploy to production
      await this.deployCandidate();
      
      // 7. Save model
      await this.saveModel();
      
      const duration = (Date.now() - startTime) / 1000;
      logger.info(`Training pipeline complete in ${duration}s - model deployed`);
      
      this.metrics.lastTrainedAt = new Date();
      this.metrics.totalRetrains++;
      
      return { success: true, metrics: trainMetrics, deployed: true };
      
    } catch (error) {
      logger.error("Training pipeline failed:", error);
      this.candidateVerifier = undefined;
      return { success: false, metrics: { accuracy: 0, precision: 0, recall: 0 }, deployed: false };
    }
  }

  /**
   * Online update from single observation
   * 
   * Lightweight incremental learning between full retrainings
   */
  async onlineUpdate(trace: EnrichedHermesTrace, outcome: boolean): Promise<void> {
    await this.currentVerifier.updateFromResult(trace, outcome);
    this.metrics.totalPredictions++;
    
    // Periodically check if we need full retraining
    if (this.metrics.totalPredictions % 100 === 0) {
      const needsRetrain = await this.checkNeedsRetraining();
      if (needsRetrain) {
        // Schedule retraining asynchronously
        this.scheduleRetraining();
      }
    }
  }

  /**
   * Get current verifier for scoring
   */
  getVerifier(): MissionVerifier {
    return this.currentVerifier;
  }

  /**
   * Get pipeline metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  /**
   * Collect training data from storage
   */
  private async collectTrainingData(): Promise<{
    traces: EnrichedHermesTrace[];
    outcomes: boolean[];
  }> {
    // Get historical traces with known outcomes
    const dbTraces = await this.storage.getTracesForTraining(this.config.maxTrainingSamples);
    
    // Convert to enriched format
    const traces: EnrichedHermesTrace[] = [];
    const outcomes: boolean[] = [];
    
    for (const dbTrace of dbTraces) {
      if (dbTrace.actualOutcome === null) continue;
      
      const enriched = await this.enrichTrace(dbTrace);
      if (enriched) {
        traces.push(enriched);
        outcomes.push(dbTrace.actualOutcome);
      }
    }
    
    return { traces, outcomes };
  }

  /**
   * Enrich database trace to full format
   */
  private async enrichTrace(dbTrace: any): Promise<EnrichedHermesTrace | null> {
    try {
      return {
        parsed: {
          thought: dbTrace.thoughtContent,
          toolCalls: (dbTrace.toolCalls || []).map((tc: any) => ({
            name: tc.name,
            arguments: tc.arguments
          })),
          content: dbTrace.finalContent || ""
        },
        traceId: dbTrace.traceId,
        missionContext: dbTrace.missionId ? {
          missionId: dbTrace.missionId,
          jobId: dbTrace.jobId,
          executionId: dbTrace.executionId
        } : undefined,
        startTime: dbTrace.createdAt,
        endTime: dbTrace.updatedAt,
        latencyMs: dbTrace.executionTime || 0,
        tokenUsage: {
          total: dbTrace.tokenUsage?.totalTokens || 0,
          prompt: dbTrace.tokenUsage?.promptTokens || 0,
          completion: dbTrace.tokenUsage?.completionTokens || 0,
          costUsd: dbTrace.tokenUsage?.costEstimateUsd
        },
        features: this.extractFeaturesFromDbTrace(dbTrace)
      };
    } catch (error) {
      logger.warn(`Failed to enrich trace ${dbTrace.traceId}:`, undefined, error);
      return null;
    }
  }

  /**
   * Extract features from database trace record
   */
  private extractFeaturesFromDbTrace(dbTrace: any): any {
    const steps = dbTrace.traceSteps || [];
    const toolCalls = dbTrace.toolCalls || [];
    
    return {
      thoughtDepth: steps.filter((s: any) => s.type === "thinking").length,
      toolDiversity: toolCalls.length > 0 
        ? new Set(toolCalls.map((tc: any) => tc.name)).size / toolCalls.length 
        : 0,
      selfReflectionIndicators: [], // Would need to parse content
      confidenceMarkers: 0, // Would need to parse content
      recursionDepth: 0, // Would need to parse content
      actionChaining: 0 // Would need to parse content
    };
  }

  /**
   * Count available training samples
   */
  private async countTrainingSamples(): Promise<number> {
    const samples = await this.storage.getTracesForTraining(this.config.minTrainingSamples + 1);
    return samples.length;
  }

  /**
   * Check if model needs retraining based on performance drift
   */
  private async checkNeedsRetraining(): Promise<boolean> {
    // Check if we have enough new data since last training
    if (!this.metrics.lastTrainedAt) {
      return true; // Never trained
    }
    
    const daysSinceLastTrain = 
      (Date.now() - this.metrics.lastTrainedAt.getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysSinceLastTrain > 7) {
      return true; // Retrain weekly regardless
    }
    
    // Check for concept drift (simplified)
    // In production, would monitor prediction error rate over time
    
    return false;
  }

  /**
   * Run canary test before full deployment
   */
  private async runCanaryTest(): Promise<boolean> {
    if (!this.candidateVerifier) return false;
    
    logger.info(`Running canary test at ${this.config.canaryPercentage}% traffic`);
    
    // In production, this would:
    // 1. Route X% of traffic to candidate
    // 2. Compare predictions vs actual outcomes
    // 3. Ensure no regression
    
    // For now, simplified validation
    const { traces, outcomes } = await this.collectTrainingData();
    const valSize = Math.floor(traces.length * this.config.validationSplit);
    const valTraces = traces.slice(-valSize);
    const valOutcomes = outcomes.slice(-valSize);
    
    let correct = 0;
    for (let i = 0; i < valTraces.length; i++) {
      const score = await this.candidateVerifier.scoreTrace(valTraces[i]);
      const predicted = score.successProbability > 0.5;
      if (predicted === valOutcomes[i]) correct++;
    }
    
    const accuracy = correct / valTraces.length;
    logger.info(`Canary accuracy: ${(accuracy * 100).toFixed(1)}%`);
    
    return accuracy >= this.metrics.currentAccuracy - 0.05; // Allow 5% regression
  }

  /**
   * Deploy candidate to production
   */
  private async deployCandidate(): Promise<void> {
    if (!this.candidateVerifier) return;
    
    logger.info("Deploying candidate verifier to production");
    
    // Swap verifiers
    this.currentVerifier = this.candidateVerifier;
    this.candidateVerifier = undefined;
    
    // Update metrics
    const stats = this.currentVerifier.getStats();
    this.metrics.currentAccuracy = stats.accuracy;
  }

  /**
   * Save model to persistent storage
   */
  private async saveModel(): Promise<void> {
    this.currentVerifier.exportModel();
    // TODO: Persist model to database or file — not yet implemented.
    // Without persistence, learned weights reset on every server restart.
    logger.warn("saveModel: persistence not implemented — model weights will be lost on restart");
  }

  /**
   * Load saved model from storage
   */
  private async loadSavedModel(): Promise<object | null> {
    // TODO: Load from database or file — not yet implemented.
    return null;
  }

  /**
   * Schedule retraining asynchronously (deduplicated)
   */
  private scheduleRetraining(): void {
    if (this.retrainingScheduled) return;
    this.retrainingScheduled = true;
    logger.info("Scheduling retraining in 60s");
    setTimeout(() => {
      this.retrainingScheduled = false;
      this.runTraining().catch(err => logger.error("Scheduled retraining failed:", err));
    }, 60000);
  }
}

/**
 * Singleton instance manager
 */
let pipelineInstance: VerifierTrainingPipeline | null = null;

export async function getTrainingPipeline(
  storage: TraceStorage,
  embedder: TraceEmbeddingEngine,
  config?: Partial<TrainingConfig>
): Promise<VerifierTrainingPipeline> {
  if (!pipelineInstance) {
    pipelineInstance = new VerifierTrainingPipeline(storage, embedder, config);
    await pipelineInstance.initialize();
  }
  return pipelineInstance;
}

export function resetTrainingPipeline(): void {
  pipelineInstance = null;
}
