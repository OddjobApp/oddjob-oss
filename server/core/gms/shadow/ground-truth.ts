/**
 * Ground Truth Collector
 * 
 * Tracks actual outcomes from shadow runs and compares to predictions.
 * 
 * Key responsibilities:
 * - Store shadow run results with predicted vs actual outcomes
 * - Calculate prediction accuracy metrics
 * - Identify systematic biases in verifier
 * - Feed corrections back to verifier training
 * 
 * Also tracks:
 * - Concept drift (when reality diverges from predictions)
 * - Calibration quality (are confidence scores accurate?)
 * - Failure mode predictions (did we predict the right failures?)
 */

import { createLogger } from "../../../utils/logger.js";
import type { ShadowResult, VerifierScore } from "../common/types.js";

const logger = createLogger("GroundTruthCollector");

export interface GroundTruthEntry {
  candidateId: string;
  timestamp: Date;
  blueprintName?: string;
  
  // Prediction (from verifier)
  predictedSuccess: number;     // 0-1 probability
  predictedLatency: number;     // ms
  predictedCost: number;        // $
  predictedRisks: string[];
  
  // Actual outcome (from shadow runs)
  actualSuccess: boolean;
  actualSuccessRate: number;    // From N variations
  actualLatency: number;        // ms
  actualCost: number;           // $
  actualFailures: string[];
  
  // Comparison
  predictionError: number;      // |predicted - actual|
  withinConfidence: boolean;    // Was actual within predicted confidence?
  surprise: "none" | "low" | "medium" | "high"; // Unexpected outcome
}

export interface CalibrationMetrics {
  // Overall accuracy
  meanAbsoluteError: number;
  rootMeanSquareError: number;
  
  // Calibration (is confidence well-calibrated?)
  expectedCalibrationError: number;
  reliabilityDiagram: Array<{ bin: number; accuracy: number; confidence: number }>;
  
  // Bias detection
  systematicBias: number;       // Consistent over/under prediction
  driftDetected: boolean;       // Has prediction quality degraded?
  
  // By category
  accuracyByScenario: Record<string, number>;
  accuracyByTool: Record<string, number>;
}

/**
 * Ground Truth Collector
 * 
 * Tracks and analyzes prediction accuracy for continuous improvement.
 */
const DISTILLATION_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours per blueprint

export class GroundTruthCollector {
  private entries: GroundTruthEntry[] = [];
  private maxEntries: number;
  private lastDistilledAt = new Map<string, number>();

  constructor(maxEntries: number = 10000) {
    this.maxEntries = maxEntries;
  }

  /**
   * Record a ground truth observation
   */
  record(
    candidateId: string,
    prediction: VerifierScore,
    actual: ShadowResult,
    blueprintName?: string
  ): GroundTruthEntry {
    // Calculate prediction error
    const predictionError = Math.abs(
      prediction.successProbability - actual.successRate
    );
    
    // Determine if within confidence bounds
    const confidenceWidth = 1 - prediction.confidence;
    const withinConfidence = predictionError <= confidenceWidth;
    
    // Calculate surprise level
    let surprise: GroundTruthEntry["surprise"] = "none";
    if (predictionError > 0.5) {
      surprise = "high";
    } else if (predictionError > 0.3) {
      surprise = "medium";
    } else if (predictionError > 0.15) {
      surprise = "low";
    }
    
    const entry: GroundTruthEntry = {
      candidateId,
      timestamp: new Date(),
      blueprintName,
      
      predictedSuccess: prediction.successProbability,
      predictedLatency: prediction.latencyEstimate,
      predictedCost: prediction.costEstimate,
      predictedRisks: prediction.riskFactors.map(r => r.type),
      
      actualSuccess: actual.successRate > 0.5,
      actualSuccessRate: actual.successRate,
      actualLatency: actual.avgLatency,
      actualCost: actual.totalCost,
      actualFailures: actual.failureModes.map(f => f.type),
      
      predictionError,
      withinConfidence,
      surprise
    };
    
    this.entries.push(entry);
    
    // Limit storage
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    
    // Log significant surprises
    if (surprise === "high") {
      logger.warn(`High surprise prediction for ${candidateId}: ` +
                  `predicted ${(prediction.successProbability * 100).toFixed(1)}%, ` +
                  `actual ${(actual.successRate * 100).toFixed(1)}%`);
    }

    // Check for Heuristic Distillation: if blueprint is highly reliable (> 98%) over 50+ runs.
    // Opt-in: the distiller overwrites any same-named skill with LLM-written code (no version
    // snapshot, shadow run or approval), builds it from preferences matched across every
    // tenant, and saves it with no org, so it is off unless explicitly enabled.
    if (blueprintName && blueprintName !== "unknown" && process.env.ENABLE_HEURISTIC_DISTILLATION === "true") {
      const relevantEntries = this.entries.filter(e => e.blueprintName === blueprintName);
      if (relevantEntries.length >= 50) {
        const last50 = relevantEntries.slice(-50);
        const avgSuccessRate = last50.reduce((sum, e) => sum + e.actualSuccessRate, 0) / 50;
        if (avgSuccessRate >= 0.98) {
          const lastRun = this.lastDistilledAt.get(blueprintName) ?? 0;
          const cooldownElapsed = Date.now() - lastRun >= DISTILLATION_COOLDOWN_MS;
          if (cooldownElapsed) {
            this.lastDistilledAt.set(blueprintName, Date.now());
            logger.info(`[GroundTruthCollector] Blueprint ${blueprintName} achieved ${(avgSuccessRate * 100).toFixed(1)}% success rate over 50+ runs. Triggering Heuristic Distillation.`);
            import("../../../domain/agents/core/heuristic-distiller.service.js")
              .then(({ heuristicDistillerService }) => {
                heuristicDistillerService.distill(blueprintName).catch(err => {
                  logger.error(`[GroundTruthCollector] Distillation error for ${blueprintName}: ${err.message}`);
                });
              })
              .catch(err => {
                logger.error(`[GroundTruthCollector] Failed to import heuristicDistillerService: ${err.message}`);
              });
          }
        }
      }
    }
    
    return entry;
  }

  /**
   * Calculate calibration metrics
   */
  calculateMetrics(): CalibrationMetrics {
    if (this.entries.length === 0) {
      return this.getEmptyMetrics();
    }
    
    // Mean Absolute Error
    const mae = this.entries.reduce((sum, e) => sum + e.predictionError, 0) / 
                this.entries.length;
    
    // Root Mean Square Error
    const rmse = Math.sqrt(
      this.entries.reduce((sum, e) => sum + e.predictionError * e.predictionError, 0) / 
      this.entries.length
    );
    
    // Expected Calibration Error
    const ece = this.calculateECE();
    
    // Reliability diagram (10 bins)
    const reliabilityDiagram = this.calculateReliabilityDiagram();
    
    // Systematic bias
    const bias = this.entries.reduce((sum, e) => 
      sum + (e.predictedSuccess - e.actualSuccessRate), 0
    ) / this.entries.length;
    
    // Detect drift (compare recent to historical)
    const driftDetected = this.detectDrift();
    
    // Accuracy by scenario
    const accuracyByScenario: Record<string, number> = {};
    // Would categorize by scenario type if available
    
    return {
      meanAbsoluteError: mae,
      rootMeanSquareError: rmse,
      expectedCalibrationError: ece,
      reliabilityDiagram,
      systematicBias: bias,
      driftDetected,
      accuracyByScenario,
      accuracyByTool: {} // Would track by tool usage
    };
  }

  /**
   * Get entries with high surprise
   */
  getSurprises(threshold: "low" | "medium" | "high" = "medium"): GroundTruthEntry[] {
    const levels: Record<string, number> = { low: 1, medium: 2, high: 3 };
    const minLevel = levels[threshold];
    
    return this.entries.filter(e => {
      const entryLevel = levels[e.surprise] || 0;
      return entryLevel >= minLevel;
    });
  }

  /**
   * Check if specific failure mode was predicted
   */
  checkFailurePrediction(
    actualFailures: string[],
    predictedRisks: string[]
  ): {
    predictedCorrectly: string[];
    missed: string[];
    falsePositives: string[];
  } {
    const predictedCorrectly: string[] = [];
    const missed: string[] = [];
    
    for (const failure of actualFailures) {
      if (predictedRisks.some(r => failure.includes(r) || r.includes(failure))) {
        predictedCorrectly.push(failure);
      } else {
        missed.push(failure);
      }
    }
    
    const falsePositives = predictedRisks.filter(r => 
      !actualFailures.some(f => f.includes(r) || r.includes(f))
    );
    
    return { predictedCorrectly, missed, falsePositives };
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalObservations: number;
    avgPredictionError: number;
    highSurpriseCount: number;
    withinConfidenceRate: number;
  } {
    if (this.entries.length === 0) {
      return {
        totalObservations: 0,
        avgPredictionError: 0,
        highSurpriseCount: 0,
        withinConfidenceRate: 0
      };
    }
    
    const avgError = this.entries.reduce((s, e) => s + e.predictionError, 0) / 
                     this.entries.length;
    
    const highSurprise = this.entries.filter(e => e.surprise === "high").length;
    
    const withinConf = this.entries.filter(e => e.withinConfidence).length;
    
    return {
      totalObservations: this.entries.length,
      avgPredictionError: avgError,
      highSurpriseCount: highSurprise,
      withinConfidenceRate: withinConf / this.entries.length
    };
  }

  /**
   * Export data for verifier retraining
   */
  exportForTraining(): Array<{
    features: any;
    actualOutcome: boolean;
    predictionWas: number;
  }> {
    return this.entries.map(e => ({
      features: {
        predictedSuccess: e.predictedSuccess,
        predictedLatency: e.predictedLatency,
        predictedCost: e.predictedCost
      },
      actualOutcome: e.actualSuccess,
      predictionWas: e.predictedSuccess
    }));
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
    logger.debug("Ground truth entries cleared");
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private calculateECE(): number {
    // Expected Calibration Error
    // Measures how much predicted confidence differs from actual accuracy
    
    const bins = this.createConfidenceBins();
    
    let ece = 0;
    for (const bin of bins) {
      if (bin.count === 0) continue;
      
      const binAccuracy = bin.correct / bin.count;
      const binConfidence = bin.avgPrediction;
      
      ece += (bin.count / this.entries.length) * Math.abs(binAccuracy - binConfidence);
    }
    
    return ece;
  }

  private createConfidenceBins(): Array<{ 
    min: number; 
    max: number; 
    count: number; 
    correct: number; 
    avgPrediction: number;
  }> {
    // Create 10 bins of confidence (0-10%, 10-20%, etc.)
    const bins = Array(10).fill(null).map((_, i) => ({
      min: i * 0.1,
      max: (i + 1) * 0.1,
      count: 0,
      correct: 0,
      avgPrediction: 0
    }));
    
    for (const entry of this.entries) {
      const binIdx = Math.min(9, Math.floor(entry.predictedSuccess * 10));
      const bin = bins[binIdx];
      
      bin.count++;
      if (entry.actualSuccess) {
        bin.correct++;
      }
      bin.avgPrediction += entry.predictedSuccess;
    }
    
    // Average predictions
    for (const bin of bins) {
      if (bin.count > 0) {
        bin.avgPrediction /= bin.count;
      }
    }
    
    return bins;
  }

  private calculateReliabilityDiagram(): Array<{ 
    bin: number; 
    accuracy: number; 
    confidence: number;
  }> {
    const bins = this.createConfidenceBins();
    
    return bins.map((bin, i) => ({
      bin: i,
      accuracy: bin.count > 0 ? bin.correct / bin.count : 0,
      confidence: bin.avgPrediction
    }));
  }

  private detectDrift(): boolean {
    if (this.entries.length < 100) {
      return false; // Not enough data
    }
    
    // Compare recent 50 to previous 50
    const recent = this.entries.slice(-50);
    const historical = this.entries.slice(-100, -50);
    
    const recentError = recent.reduce((s, e) => s + e.predictionError, 0) / recent.length;
    const histError = historical.reduce((s, e) => s + e.predictionError, 0) / historical.length;
    
    // Drift if recent error is significantly higher
    return recentError > histError * 1.5;
  }

  private getEmptyMetrics(): CalibrationMetrics {
    return {
      meanAbsoluteError: 0,
      rootMeanSquareError: 0,
      expectedCalibrationError: 0,
      reliabilityDiagram: [],
      systematicBias: 0,
      driftDetected: false,
      accuracyByScenario: {},
      accuracyByTool: {}
    };
  }
}

/**
 * Factory function
 */
export function createGroundTruthCollector(
  maxEntries?: number
): GroundTruthCollector {
  return new GroundTruthCollector(maxEntries);
}
