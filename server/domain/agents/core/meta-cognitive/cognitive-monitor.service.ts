/**
 * Cognitive Monitor Service
 * 
 * Real-time monitoring of agent cognitive state during task execution.
 * Detects cognitive issues like confusion, fatigue, or cognitive overload
 * and suggests interventions.
 */

import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { metaCognitivePlanner, AgentCognitiveState } from "./meta-cognitive-planner.service.js";

const logger = createLogger("CognitiveMonitor");

// Types
export interface CognitiveMetrics {
  timestamp: Date;
  processingLatencyMs: number;
  tokenThroughput: number; // tokens per second
  contextUtilization: number; // 0-1, how much of context window used
  toolCallFrequency: number; // calls per minute
  errorRate: number; // errors per minute
  repetitionScore: number; // 0-1, how repetitive is output
  coherenceScore: number; // 0-1, logical flow quality
  confidenceEstimate: number; // 0-1, derived from response patterns
}

export interface CognitiveAnomaly {
  type: "fatigue" | "confusion" | "overload" | "stuck" | "rushing" | "cognitive_drift";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  timestamp: Date;
  metrics: Partial<CognitiveMetrics>;
  suggestedIntervention: string;
}

export interface Intervention {
  type: "pause" | "simplify" | "clarify" | "break" | "switch_strategy" | "escalate";
  reason: string;
  action: string;
  automatic: boolean; // can be auto-executed
}

/**
 * Cognitive Monitor Service
 * 
 * Monitors agent execution in real-time to detect:
 * - Cognitive fatigue (slowing down, repetition)
 * - Confusion (incoherence, high error rates)
 * - Cognitive overload (context window saturation)
 * - Getting stuck (no progress, repeated tool calls)
 * - Rushing (low quality, skipping verification)
 * - Cognitive drift (going off-topic)
 */
export class CognitiveMonitorService {
  private agentMetrics: Map<string, CognitiveMetrics[]> = new Map();
  private anomalies: Map<string, CognitiveAnomaly[]> = new Map();
  private interventions: Map<string, Intervention[]> = new Map();
  private monitoringActive: Map<string, boolean> = new Map();
  private metricWindows: Map<string, number> = new Map(); // sliding window size in minutes

  constructor() {
    // Default 5-minute sliding window
    this.metricWindows.set("default", 5);
  }

  // ============================================================================
  // MONITORING LIFECYCLE
  // ============================================================================

  /**
   * Start monitoring an agent
   */
  startMonitoring(agentId: string, windowMinutes: number = 5): void {
    this.agentMetrics.set(agentId, []);
    this.anomalies.set(agentId, []);
    this.interventions.set(agentId, []);
    this.monitoringActive.set(agentId, true);
    this.metricWindows.set(agentId, windowMinutes);

    logger.info(`[CognitiveMonitor] Started monitoring agent ${agentId}`);
  }

  /**
   * Stop monitoring an agent
   */
  stopMonitoring(agentId: string): void {
    this.monitoringActive.set(agentId, false);
    logger.info(`[CognitiveMonitor] Stopped monitoring agent ${agentId}`);
  }

  /**
   * Record cognitive metrics
   */
  async recordMetrics(agentId: string, metrics: Partial<CognitiveMetrics>): Promise<void> {
    if (!this.monitoringActive.get(agentId)) return;

    const fullMetrics: CognitiveMetrics = {
      timestamp: new Date(),
      processingLatencyMs: metrics.processingLatencyMs ?? 0,
      tokenThroughput: metrics.tokenThroughput ?? 0,
      contextUtilization: metrics.contextUtilization ?? 0,
      toolCallFrequency: metrics.toolCallFrequency ?? 0,
      errorRate: metrics.errorRate ?? 0,
      repetitionScore: metrics.repetitionScore ?? 0,
      coherenceScore: metrics.coherenceScore ?? 0.8,
      confidenceEstimate: metrics.confidenceEstimate ?? 0.5,
    };

    const history = this.agentMetrics.get(agentId) || [];
    history.push(fullMetrics);

    // Keep only window size
    const windowMinutes = this.metricWindows.get(agentId) || 5;
    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
    const trimmed = history.filter(m => m.timestamp > cutoff);

    this.agentMetrics.set(agentId, trimmed);

    // Analyze for anomalies
    const anomaly = this.detectAnomaly(agentId, fullMetrics, trimmed);
    if (anomaly) {
      await this.handleAnomaly(agentId, anomaly);
    }
  }

  // ============================================================================
  // ANOMALY DETECTION
  // ============================================================================

  /**
   * Detect cognitive anomalies from metrics
   */
  private detectAnomaly(
    agentId: string,
    current: CognitiveMetrics,
    history: CognitiveMetrics[]
): CognitiveAnomaly | null {
    const anomalies: Array<{ type: CognitiveAnomaly["type"]; severity: CognitiveAnomaly["severity"]; desc: string; intervention: string }> = [];

    // Check for fatigue
    if (history.length >= 3) {
      const recent = history.slice(-3);
      const latencyTrend = this.calculateTrend(recent.map(m => m.processingLatencyMs));
      const throughputTrend = this.calculateTrend(recent.map(m => m.tokenThroughput));
      
      if (latencyTrend > 0.3 && throughputTrend < -0.2) {
        anomalies.push({
          type: "fatigue",
          severity: current.processingLatencyMs > 30000 ? "high" : "medium",
          desc: `Slowing down: latency increased ${(latencyTrend * 100).toFixed(0)}%, throughput decreased ${(Math.abs(throughputTrend) * 100).toFixed(0)}%`,
          intervention: "pause",
        });
      }
    }

    // Check for confusion
    if (current.coherenceScore < 0.4 && current.confidenceEstimate < 0.3) {
      anomalies.push({
        type: "confusion",
        severity: "high",
        desc: `Low coherence (${(current.coherenceScore * 100).toFixed(0)}%) and confidence (${(current.confidenceEstimate * 100).toFixed(0)}%)`,
        intervention: "clarify",
      });
    }

    // Check for overload
    if (current.contextUtilization > 0.85) {
      anomalies.push({
        type: "overload",
        severity: current.contextUtilization > 0.95 ? "critical" : "high",
        desc: `Context window ${(current.contextUtilization * 100).toFixed(0)}% utilized`,
        intervention: "simplify",
      });
    }

    // Check for stuck
    if (history.length >= 5) {
      const recent = history.slice(-5);
      const toolCalls = recent.reduce((sum, m) => sum + m.toolCallFrequency, 0) / recent.length;
      const errors = recent.reduce((sum, m) => sum + m.errorRate, 0) / recent.length;
      
      if (toolCalls > 10 && errors > 0.5) {
        anomalies.push({
          type: "stuck",
          severity: "high",
          desc: `High tool usage (${toolCalls.toFixed(1)}/min) with errors (${(errors * 100).toFixed(0)}%)`,
          intervention: "break",
        });
      }
    }

    // Check for rushing
    if (current.processingLatencyMs < 2000 && current.coherenceScore < 0.6) {
      anomalies.push({
        type: "rushing",
        severity: "medium",
        desc: `Fast responses (${current.processingLatencyMs}ms) with low coherence`,
        intervention: "pause",
      });
    }

    // Check for repetition/cognitive drift
    if (current.repetitionScore > 0.7) {
      anomalies.push({
        type: "cognitive_drift",
        severity: current.repetitionScore > 0.9 ? "high" : "medium",
        desc: `High repetition score (${(current.repetitionScore * 100).toFixed(0)}%) - may be stuck in loop`,
        intervention: "switch_strategy",
      });
    }

    // Return highest severity anomaly
    if (anomalies.length === 0) return null;

    const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    const highest = anomalies.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity])[0];

    return {
      type: highest.type,
      severity: highest.severity,
      description: highest.desc,
      timestamp: new Date(),
      metrics: current,
      suggestedIntervention: highest.intervention,
    };
  }

  /**
   * Calculate trend from values (simple linear regression slope)
   */
  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;
    
    const n = values.length;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;
    
    let numerator = 0;
    let denominator = 0;
    
    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (values[i] - yMean);
      denominator += (i - xMean) ** 2;
    }
    
    if (denominator === 0) return 0;
    
    const slope = numerator / denominator;
    // Normalize by mean to get relative trend
    return yMean === 0 ? 0 : slope / yMean;
  }

  // ============================================================================
  // INTERVENTION HANDLING
  // ============================================================================

  /**
   * Handle detected anomaly
   */
  private async handleAnomaly(agentId: string, anomaly: CognitiveAnomaly): Promise<void> {
    // Store anomaly
    const history = this.anomalies.get(agentId) || [];
    history.push(anomaly);
    this.anomalies.set(agentId, history);

    // Generate intervention
    const intervention = this.generateIntervention(anomaly);
    const interventions = this.interventions.get(agentId) || [];
    interventions.push(intervention);
    this.interventions.set(agentId, interventions);

    logger.warn(`[CognitiveMonitor] Anomaly detected for agent ${agentId}: ${anomaly.type} (${anomaly.severity}) - ${intervention.action}`);

    // Publish event
    await eventStream.publish(
      "cognitive.anomaly_detected",
      {
        agentId,
        anomalyType: anomaly.type,
        severity: anomaly.severity,
        description: anomaly.description,
        intervention: intervention.type,
      },
      { agentId },
      "cognitive_monitor"
    );

    // Auto-execute if appropriate
    if (intervention.automatic && anomaly.severity === "critical") {
      await this.executeIntervention(agentId, intervention);
    }
  }

  /**
   * Generate intervention for anomaly
   */
  private generateIntervention(anomaly: CognitiveAnomaly): Intervention {
    const interventions: Record<CognitiveAnomaly["type"], Intervention[]> = {
      fatigue: [
        { type: "pause", reason: "Processing slowing down", action: "Pause for 30s, then continue", automatic: true },
        { type: "break", reason: "Sustained performance decline", action: "End current session, suggest break", automatic: false },
      ],
      confusion: [
        { type: "clarify", reason: "Low coherence detected", action: "Ask for clarification on task requirements", automatic: false },
        { type: "simplify", reason: "Task may be too complex", action: "Break task into smaller subtasks", automatic: true },
      ],
      overload: [
        { type: "simplify", reason: "Context window near capacity", action: "Summarize and condense context", automatic: true },
        { type: "break", reason: "Memory pressure critical", action: "Split task into multiple sessions", automatic: false },
      ],
      stuck: [
        { type: "switch_strategy", reason: "Repeated failed attempts", action: "Switch to alternative approach", automatic: true },
        { type: "escalate", reason: "Unable to progress", action: "Escalate to human supervisor", automatic: false },
      ],
      rushing: [
        { type: "pause", reason: "Quality concerns", action: "Add verification step before continuing", automatic: true },
      ],
      cognitive_drift: [
        { type: "switch_strategy", reason: "Repetitive patterns", action: "Reset and try different approach", automatic: true },
        { type: "clarify", reason: "May have misunderstood task", action: "Re-read original requirements", automatic: false },
      ],
    };

    const options = interventions[anomaly.type] || [];
    
    // Select based on severity
    if (anomaly.severity === "critical") {
      return options.find(i => !i.automatic) || options[0] || 
        { type: "escalate", reason: "Critical issue", action: "Escalate immediately", automatic: false };
    }
    
    return options[0] || { type: "pause", reason: "General concern", action: "Take brief pause", automatic: true };
  }

  /**
   * Execute an intervention
   */
  private async executeIntervention(agentId: string, intervention: Intervention): Promise<void> {
    logger.info(`[CognitiveMonitor] Executing intervention for agent ${agentId}: ${intervention.type}`);

    switch (intervention.type) {
      case "pause":
        // Signal to pause - actual pause handled by orchestrator
        await eventStream.publish(
          "cognitive.intervention_pause",
          { agentId, duration: 30 },
          { agentId },
          "cognitive_monitor"
        );
        break;
        
      case "simplify":
        // Signal to simplify - meta-cognitive planner may adapt
        const plan = this.getActivePlanForAgent(agentId);
        if (plan) {
          // Could trigger plan adaptation here
          logger.info(`[CognitiveMonitor] Simplification suggested for plan ${plan.id}`);
        }
        break;
        
      case "switch_strategy":
        await eventStream.publish(
          "cognitive.intervention_switch",
          { agentId, reason: intervention.reason },
          { agentId },
          "cognitive_monitor"
        );
        break;
        
      default:
        // Other interventions require human decision
        break;
    }
  }

  /**
   * Get active plan for agent (placeholder - would integrate with planner)
   */
  private getActivePlanForAgent(agentId: string): any {
    // This would integrate with metaCognitivePlanner
    // For now, return null
    return null;
  }

  // ============================================================================
  // QUERIES
  // ============================================================================

  /**
   * Get current cognitive health for an agent
   */
  getCognitiveHealth(agentId: string): {
    status: "healthy" | "degraded" | "critical";
    score: number; // 0-1
    activeAnomalies: CognitiveAnomaly[];
    recentMetrics: CognitiveMetrics | null;
    recommendations: string[];
  } {
    const metrics = this.agentMetrics.get(agentId) || [];
    const anomalies = this.anomalies.get(agentId) || [];
    const activeAnomalies = anomalies.filter(a => 
      a.timestamp > new Date(Date.now() - 5 * 60 * 1000) // Last 5 min
    );

    if (metrics.length === 0) {
      return {
        status: "healthy",
        score: 1,
        activeAnomalies: [],
        recentMetrics: null,
        recommendations: ["No recent activity"],
      };
    }

    const recent = metrics[metrics.length - 1];
    
    // Calculate health score
    let score = 1;
    score -= (1 - recent.coherenceScore) * 0.3;
    score -= recent.errorRate * 0.3;
    score -= recent.contextUtilization * 0.2;
    score -= recent.repetitionScore * 0.2;
    score = Math.max(0, score);

    // Determine status
    let status: "healthy" | "degraded" | "critical" = "healthy";
    if (score < 0.4 || activeAnomalies.some(a => a.severity === "critical")) {
      status = "critical";
    } else if (score < 0.7 || activeAnomalies.length > 0) {
      status = "degraded";
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (recent.contextUtilization > 0.7) {
      recommendations.push("Consider summarizing context to free up memory");
    }
    if (recent.errorRate > 0.3) {
      recommendations.push("High error rate - review approach or escalate");
    }
    if (recent.coherenceScore < 0.6) {
      recommendations.push("Coherence declining - may need task clarification");
    }

    return {
      status,
      score,
      activeAnomalies,
      recentMetrics: recent,
      recommendations,
    };
  }

  /**
   * Get monitoring summary
   */
  getMonitoringSummary(): {
    totalMonitored: number;
    healthyCount: number;
    degradedCount: number;
    criticalCount: number;
    totalAnomaliesLastHour: number;
  } {
    let healthy = 0, degraded = 0, critical = 0, totalAnomalies = 0;

    for (const agentId of this.monitoringActive.keys()) {
      if (!this.monitoringActive.get(agentId)) continue;
      
      const health = this.getCognitiveHealth(agentId);
      if (health.status === "healthy") healthy++;
      else if (health.status === "degraded") degraded++;
      else critical++;

      const anomalies = this.anomalies.get(agentId) || [];
      totalAnomalies += anomalies.filter(a => 
        a.timestamp > new Date(Date.now() - 60 * 60 * 1000)
      ).length;
    }

    return {
      totalMonitored: healthy + degraded + critical,
      healthyCount: healthy,
      degradedCount: degraded,
      criticalCount: critical,
      totalAnomaliesLastHour: totalAnomalies,
    };
  }

  /**
   * Get agent metrics history
   */
  getMetricsHistory(agentId: string, minutes: number = 60): CognitiveMetrics[] {
    const metrics = this.agentMetrics.get(agentId) || [];
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    return metrics.filter(m => m.timestamp > cutoff);
  }

  /**
   * Clear agent data
   */
  clearAgent(agentId: string): void {
    this.agentMetrics.delete(agentId);
    this.anomalies.delete(agentId);
    this.interventions.delete(agentId);
    this.monitoringActive.delete(agentId);
    this.metricWindows.delete(agentId);
  }
}

export const cognitiveMonitor = new CognitiveMonitorService();
