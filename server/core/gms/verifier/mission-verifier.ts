/**
 * Mission Verifier
 * 
 * Neural classifier that predicts mission success probability from Hermes traces.
 * 
 * Architecture:
 * - Input: Hermes trace embedding + structured features
 * - Model: Simple MLP (can be upgraded to transformer later)
 * - Output: Success probability (0-1), confidence, risk factors
 * 
 * Training:
 * - Supervised learning on historical traces with known outcomes
 * - Online learning from new mission results
 * - Periodic retraining for concept drift handling
 */

import { createLogger } from "../../../utils/logger.js";
import { TraceEmbeddingEngine } from "../embeddings/trace-embedder.js";
import type { 
  EnrichedHermesTrace, 
  VerifierScore, 
  RiskFactor,
  HermesTraceFeatures 
} from "../common/types.js";

const logger = createLogger("MissionVerifier");

export interface VerifierConfig {
  modelPath?: string;
  threshold: number; // Classification threshold
  calibrationEnabled: boolean;
  riskAnalysisEnabled: boolean;
}

const DEFAULT_CONFIG: VerifierConfig = {
  threshold: 0.5,
  calibrationEnabled: true,
  riskAnalysisEnabled: true
};

/**
 * Simple neural network verifier (MLP)
 * 
 * For production, this would use TensorFlow.js or similar.
 * This implementation uses a weighted ensemble approach that can
 * be replaced with a proper neural net later.
 */
export class MissionVerifier {
  private config: VerifierConfig;
  private embedder: TraceEmbeddingEngine;
  
  // Model weights (simplified - would be trained)
  private featureWeights: Map<string, number>;
  private calibrationParams: { mean: number; std: number };
  
  // Training statistics
  private trainingStats: {
    totalSamples: number;
    positiveSamples: number;
    accuracy: number;
    lastTrainedAt?: Date;
  };
  
  constructor(
    embedder: TraceEmbeddingEngine,
    config: Partial<VerifierConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.embedder = embedder;
    
    // Initialize with heuristic weights (will be learned)
    this.featureWeights = new Map([
      ["thoughtDepth", 0.15],
      ["toolDiversity", 0.10],
      ["selfReflection", 0.20],
      ["confidence", -0.15], // Negative: high uncertainty markers = lower success
      ["recursionDepth", 0.05],
      ["actionChaining", 0.10]
    ]);
    
    this.calibrationParams = { mean: 0.5, std: 0.2 };
    
    this.trainingStats = {
      totalSamples: 0,
      positiveSamples: 0,
      accuracy: 0
    };
  }

  /**
   * Score a mission trace - main entry point
   * 
   * Returns predicted success probability with confidence and risk analysis
   */
  async scoreTrace(trace: EnrichedHermesTrace): Promise<VerifierScore> {
    try {
      // 1. Generate embedding
      const embedding = await this.embedder.embedTrace(trace);
      
      // 2. Extract prediction from embedding + features
      const rawScore = this.predictFromFeatures(trace.features, embedding);
      
      // 3. Calibrate to true probability
      const calibratedScore = this.config.calibrationEnabled 
        ? this.calibrate(rawScore) 
        : rawScore;
      
      // 4. Calculate confidence based on training coverage
      const confidence = this.calculateConfidence(trace, embedding);
      
      // 5. Estimate latency and cost
      const estimates = this.estimateMetrics(trace);
      
      // 6. Risk analysis
      const riskFactors = this.config.riskAnalysisEnabled 
        ? this.analyzeRisks(trace) 
        : [];
      
      return {
        successProbability: Math.max(0, Math.min(1, calibratedScore)),
        confidence,
        latencyEstimate: estimates.latency,
        costEstimate: estimates.cost,
        riskFactors,
        embedding
      };
    } catch (error) {
      logger.error("Failed to score trace:", error);
      
      // Return conservative fallback
      return {
        successProbability: 0.5,
        confidence: 0.1,
        latencyEstimate: 5000,
        costEstimate: 0.01,
        riskFactors: [{
          type: "tool_failure",
          severity: "medium",
          description: "Verifier failed to analyze trace - using conservative estimate"
        }],
        embedding: []
      };
    }
  }

  /**
   * Score a candidate blueprint (before execution)
   * 
   * Uses simulated trace from PMI simulation
   */
  async scoreBlueprint(blueprint: any, simulatedTrace?: EnrichedHermesTrace): Promise<VerifierScore> {
    if (simulatedTrace) {
      return this.scoreTrace(simulatedTrace);
    }
    
    // Fallback: heuristic scoring based on blueprint structure
    return this.heuristicScore(blueprint);
  }

  /**
   * Batch scoring for efficiency
   */
  async scoreTraces(traces: EnrichedHermesTrace[]): Promise<VerifierScore[]> {
    return Promise.all(traces.map(t => this.scoreTrace(t)));
  }

  /**
   * Train verifier on labeled data
   * 
   * @param traces Hermes traces with known outcomes
   * @param outcomes Array of true/false success labels
   */
  async train(
    traces: EnrichedHermesTrace[],
    outcomes: boolean[]
  ): Promise<{ accuracy: number; precision: number; recall: number }> {
    if (traces.length !== outcomes.length) {
      throw new Error("Traces and outcomes must have same length");
    }
    
    if (traces.length < 10) {
      logger.warn("Insufficient training data (< 10 samples)");
      return { accuracy: 0, precision: 0, recall: 0 };
    }
    
    logger.info(`Training verifier on ${traces.length} samples`);
    
    // 1. Split into train/validation
    const splitIdx = Math.floor(traces.length * 0.8);
    const trainTraces = traces.slice(0, splitIdx);
    const trainOutcomes = outcomes.slice(0, splitIdx);
    const valTraces = traces.slice(splitIdx);
    const valOutcomes = outcomes.slice(splitIdx);
    
    // 2. Learn feature weights via simple gradient descent
    await this.learnFeatureWeights(trainTraces, trainOutcomes);
    
    // 3. Learn calibration parameters
    this.learnCalibration(valTraces, valOutcomes);
    
    // 4. Evaluate on validation set
    const metrics = await this.evaluate(valTraces, valOutcomes);
    
    // 5. Update training stats
    this.trainingStats = {
      totalSamples: traces.length,
      positiveSamples: outcomes.filter(o => o).length,
      accuracy: metrics.accuracy,
      lastTrainedAt: new Date()
    };
    
    logger.info(`Training complete. Accuracy: ${(metrics.accuracy * 100).toFixed(1)}%`);
    
    return metrics;
  }

  /**
   * Online update from single mission result
   */
  async updateFromResult(trace: EnrichedHermesTrace, success: boolean): Promise<void> {
    // Incremental weight update (simplified online learning)
    const currentWeights = new Map(this.featureWeights);
    const prediction = this.predictFromFeatures(trace.features, []);
    const error = (success ? 1 : 0) - prediction;
    const learningRate = 0.01;
    
    // Update weights based on error
    for (const [feature, weight] of currentWeights) {
      const featureValue = this.getFeatureValue(trace.features, feature);
      const newWeight = weight + learningRate * error * featureValue;
      currentWeights.set(feature, newWeight);
    }
    
    this.featureWeights = currentWeights;
    this.trainingStats.totalSamples++;
    if (success) this.trainingStats.positiveSamples++;
    
    logger.debug(`Online update: error=${error.toFixed(3)}, new weights learned`);
  }

  /**
   * Get verifier confidence statistics
   */
  getStats(): typeof this.trainingStats {
    return { ...this.trainingStats };
  }

  /**
   * Export model for persistence
   */
  exportModel(): object {
    return {
      featureWeights: Object.fromEntries(this.featureWeights),
      calibrationParams: this.calibrationParams,
      trainingStats: this.trainingStats,
      config: this.config
    };
  }

  /**
   * Import model from persistence
   */
  importModel(model: object): void {
    const m = model as any;
    if (m.featureWeights) {
      this.featureWeights = new Map(Object.entries(m.featureWeights));
    }
    if (m.calibrationParams) {
      this.calibrationParams = m.calibrationParams;
    }
    if (m.trainingStats) {
      this.trainingStats = m.trainingStats;
    }
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  /**
   * Predict success probability from features
   */
  private predictFromFeatures(
    features: HermesTraceFeatures,
    embedding: number[]
  ): number {
    let score = 0.5; // Base rate
    
    // Add weighted feature contributions
    for (const [feature, weight] of this.featureWeights) {
      const value = this.getFeatureValue(features, feature);
      score += weight * value;
    }
    
    // Add embedding-based component (simplified)
    if (embedding.length > 0) {
      const embeddingSignal = this.extractEmbeddingSignal(embedding);
      score += 0.3 * embeddingSignal; // Embedding provides 30% of signal
    }
    
    // Sigmoid to bound to [0, 1]
    return 1 / (1 + Math.exp(-score));
  }

  /**
   * Extract signal from embedding (simplified)
   */
  private extractEmbeddingSignal(embedding: number[]): number {
    // Use first few dimensions as signal (would use learned projection in full version)
    const signal = embedding.slice(0, 10).reduce((sum, val) => sum + val, 0) / 10;
    return Math.tanh(signal); // Bound to [-1, 1]
  }

  /**
   * Get feature value by name
   */
  private getFeatureValue(features: HermesTraceFeatures, name: string): number {
    switch (name) {
      case "thoughtDepth": return features.thoughtDepth / 10;
      case "toolDiversity": return features.toolDiversity;
      case "selfReflection": 
        return Math.min(features.selfReflectionIndicators.length / 5, 1);
      case "confidence": 
        return Math.min(features.confidenceMarkers / 10, 1);
      case "recursionDepth": return features.recursionDepth / 5;
      case "actionChaining": return features.actionChaining / 10;
      default: return 0;
    }
  }

  /**
   * Calibrate raw score to true probability
   * 
   * Uses temperature scaling
   */
  private calibrate(rawScore: number): number {
    const { mean, std } = this.calibrationParams;
    
    // Adjust based on empirical calibration
    const zScore = (rawScore - mean) / (std || 1);
    
    // Temperature scaling
    const temperature = 0.8;
    return 1 / (1 + Math.exp(-zScore / temperature));
  }

  /**
   * Learn calibration parameters from validation data
   */
  private learnCalibration(traces: EnrichedHermesTrace[], outcomes: boolean[]): void {
    const rawScores = traces.map(t => this.predictFromFeatures(t.features, []));
    
    // Calculate mean and std of positive vs negative predictions
    const positiveScores = rawScores.filter((_, i) => outcomes[i]);
    const negativeScores = rawScores.filter((_, i) => !outcomes[i]);
    
    const mean = (this.mean(positiveScores) + this.mean(negativeScores)) / 2;
    const std = (this.std(positiveScores) + this.std(negativeScores)) / 2;
    
    this.calibrationParams = { mean, std };
    
    logger.debug(`Calibration learned: mean=${mean.toFixed(3)}, std=${std.toFixed(3)}`);
  }

  /**
   * Learn feature weights via gradient descent
   */
  private async learnFeatureWeights(
    traces: EnrichedHermesTrace[],
    outcomes: boolean[]
  ): Promise<void> {
    const learningRate = 0.05;
    const epochs = 50;
    
    let weights = new Map(this.featureWeights);
    
    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalError = 0;
      
      for (let i = 0; i < traces.length; i++) {
        const trace = traces[i];
        const outcome = outcomes[i] ? 1 : 0;
        
        // Forward pass
        const prediction = this.predictWithWeights(trace.features, weights, []);
        const error = outcome - prediction;
        totalError += Math.abs(error);
        
        // Backward pass (gradient descent)
        for (const [feature, weight] of weights) {
          const featureValue = this.getFeatureValue(trace.features, feature);
          const gradient = -error * featureValue; // d(loss)/d(weight)
          const newWeight = weight - learningRate * gradient;
          weights.set(feature, newWeight);
        }
      }
      
      if (epoch % 10 === 0) {
        logger.debug(`Epoch ${epoch}: avg error = ${(totalError / traces.length).toFixed(4)}`);
      }
    }
    
    this.featureWeights = weights;
  }

  /**
   * Predict using specific weights (for training)
   */
  private predictWithWeights(
    features: HermesTraceFeatures,
    weights: Map<string, number>,
    embedding: number[]
  ): number {
    let score = 0.5;
    
    for (const [feature, weight] of weights) {
      const value = this.getFeatureValue(features, feature);
      score += weight * value;
    }
    
    return 1 / (1 + Math.exp(-score));
  }

  /**
   * Calculate confidence in prediction
   */
  private calculateConfidence(trace: EnrichedHermesTrace, embedding: number[]): number {
    // Confidence based on:
    // 1. Training sample coverage (similar traces seen before)
    // 2. Feature coverage (are all features present?)
    // 3. Prediction distance from 0.5 (more extreme = less confident)
    
    let confidence = 0.5;
    
    // Factor 1: Training data size
    confidence += Math.min(this.trainingStats.totalSamples / 1000, 0.3);
    
    // Factor 2: Feature completeness (each present feature contributes additively).
    // NOTE: the parentheses are load-bearing — `+` binds tighter than `?:`, so without
    // them the two contributions become mutually exclusive (max 0.1) instead of additive.
    const featureScore =
      (trace.features.thoughtDepth > 0 ? 0.1 : 0) +
      (trace.features.toolDiversity > 0 ? 0.1 : 0);
    confidence += featureScore;
    
    // Factor 3: Embedding quality
    if (embedding.length > 0) {
      const embeddingNorm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
      confidence += Math.min(embeddingNorm / 10, 0.2);
    }
    
    return Math.min(confidence, 1.0);
  }

  /**
   * Analyze risks from trace features
   */
  private analyzeRisks(trace: EnrichedHermesTrace): RiskFactor[] {
    const risks: RiskFactor[] = [];
    const features = trace.features;
    
    // High uncertainty markers
    if (features.confidenceMarkers > 5) {
      risks.push({
        type: "hallucination",
        severity: features.confidenceMarkers > 10 ? "high" : "medium",
        description: `High uncertainty detected (${features.confidenceMarkers} markers)`,
        mitigation: "Add verification steps or human-in-the-loop approval"
      });
    }
    
    // Deep recursion (potential infinite loop)
    if (features.recursionDepth > 3) {
      risks.push({
        type: "timeout",
        severity: "medium",
        description: `Deep recursive thinking (${features.recursionDepth} levels)`,
        mitigation: "Set explicit recursion limits"
      });
    }
    
    // High tool chaining (complexity risk)
    if (features.actionChaining > 8) {
      risks.push({
        type: "tool_failure",
        severity: "medium",
        description: `Complex tool chain (${features.actionChaining} dependent actions)`,
        mitigation: "Add intermediate checkpoints"
      });
    }
    
    // No self-reflection (overconfidence)
    if (features.selfReflectionIndicators.length === 0 && features.thoughtDepth > 3) {
      risks.push({
        type: "data_quality",
        severity: "low",
        description: "No self-reflection detected in complex reasoning - potential overconfidence",
        mitigation: "Prompt for verification step"
      });
    }
    
    return risks;
  }

  /**
   * Estimate latency and cost
   */
  private estimateMetrics(trace: EnrichedHermesTrace): { latency: number; cost: number } {
    // Simple heuristic model (would use regression on historical data)
    
    const baseLatency = 1000; // 1s base
    const perThoughtLatency = 500; // 500ms per thinking step
    const perToolLatency = 2000; // 2s per tool call (API overhead)
    
    const latency = baseLatency + 
      trace.features.thoughtDepth * perThoughtLatency +
      (trace.parsed.toolCalls?.length || 0) * perToolLatency;
    
    // Cost: ~$0.001 per 1K tokens
    const estimatedTokens = trace.latencyMs > 0 
      ? (trace.tokenUsage?.total || 1000) 
      : 1000;
    const cost = (estimatedTokens / 1000) * 0.001;
    
    return { latency, cost };
  }

  /**
   * Heuristic scoring when no trace available
   */
  private heuristicScore(blueprint: any): VerifierScore {
    // Conservative estimate based on blueprint complexity
    const complexity = blueprint.steps?.length || 1;
    const uniqueTools = new Set(blueprint.tools?.map((t: any) => t.name)).size;
    
    const baseScore = 0.7;
    const complexityPenalty = Math.min(complexity * 0.02, 0.2);
    const toolBonus = Math.min(uniqueTools * 0.02, 0.1);
    
    return {
      successProbability: Math.max(0.3, baseScore - complexityPenalty + toolBonus),
      confidence: 0.3, // Low confidence without trace
      latencyEstimate: complexity * 3000,
      costEstimate: complexity * 0.01,
      riskFactors: [{
        type: "data_quality",
        severity: "low",
        description: "Heuristic score - actual performance may vary"
      }]
    };
  }

  /**
   * Evaluate on validation set
   */
  private async evaluate(
    traces: EnrichedHermesTrace[],
    outcomes: boolean[]
  ): Promise<{ accuracy: number; precision: number; recall: number }> {
    let tp = 0, fp = 0, tn = 0, fn = 0;
    
    for (let i = 0; i < traces.length; i++) {
      const prediction = await this.scoreTrace(traces[i]);
      const predicted = prediction.successProbability > this.config.threshold;
      const actual = outcomes[i];
      
      if (predicted && actual) tp++;
      else if (predicted && !actual) fp++;
      else if (!predicted && !actual) tn++;
      else fn++;
    }
    
    const accuracy = (tp + tn) / (tp + fp + tn + fn);
    const precision = tp / (tp + fp) || 0;
    const recall = tp / (tp + fn) || 0;
    
    return { accuracy, precision, recall };
  }

  /**
   * Statistical utilities
   */
  private mean(values: number[]): number {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private std(values: number[]): number {
    const m = this.mean(values);
    return Math.sqrt(values.reduce((sq, n) => sq + Math.pow(n - m, 2), 0) / values.length);
  }
}

/**
 * Pre-trained verifier with learned weights
 * 
 * This would be loaded from persistent storage with weights
 * trained on historical mission data
 */
export class PretrainedMissionVerifier extends MissionVerifier {
  constructor(embedder: TraceEmbeddingEngine) {
    super(embedder);
    
    // Load pre-trained weights (would come from database/file)
    this.importModel({
      featureWeights: {
        thoughtDepth: 0.18,
        toolDiversity: 0.12,
        selfReflection: 0.25,
        confidence: -0.20,
        recursionDepth: 0.08,
        actionChaining: 0.12
      },
      calibrationParams: { mean: 0.52, std: 0.18 },
      // NOTE: trainingStats zeroed out — real values come from the training pipeline
      trainingStats: {
        totalSamples: 0,
        positiveSamples: 0,
        accuracy: 0
      }
    });
  }
}
