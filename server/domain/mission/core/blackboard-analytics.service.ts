/**
 * Mission Blackboard Analytics Service
 * 
 * Analyzes blackboard state transitions during missions, identifies common failure patterns
 * from blackboard snapshots, provides mission progress visualization, and suggests optimization points.
 * 
 * Expected Impact: Better mission understanding, failure pattern detection, optimization insights
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { missions, missionBlackboardHistory } from "@shared/schema/index.js";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";

const logger = createLogger("BlackboardAnalytics");


export interface BlackboardStateTransition {
  fromState: any;
  toState: any;
  timestamp: Date;
  changedBy: string;
  changeReason: string;
}

export interface FailurePattern {
  pattern: string;
  frequency: number;
  exampleMissionId: number;
  suggestedFix: string;
}

export interface MissionProgress {
  missionId: number;
  missionName: string;
  phases: Array<{
    phase: string;
    timestamp: Date;
    duration: number;
    blackboardState: any;
  }>;
  totalDuration: number;
}

export interface OptimizationSuggestion {
  category: "planning" | "execution" | "resource" | "coordination";
  suggestion: string;
  expectedImprovement: string;
  priority: number;
}

export class BlackboardAnalyticsService {
  private transitionCache: Map<number, BlackboardStateTransition[]> = new Map();
  private cacheTTL = 600000; // 10 minutes

  /**
   * Analyze blackboard state transitions for a mission
   */
  async analyzeTransitions(missionId: number): Promise<BlackboardStateTransition[]> {
    const cached = this.transitionCache.get(missionId);
    if (cached && Date.now() - (cached[0]?.timestamp.getTime() || 0) < this.cacheTTL) {
      return cached;
    }

    logger.info(`[BlackboardAnalytics] Analyzing transitions for mission ${missionId}`);

    const history = await db.select().from(missionBlackboardHistory)
      .where(eq(missionBlackboardHistory.missionId, missionId))
      .orderBy(missionBlackboardHistory.createdAt);

    const transitions: BlackboardStateTransition[] = [];

    for (let i = 1; i < history.length; i++) {
      transitions.push({
        fromState: history[i - 1].blackboard,
        toState: history[i].blackboard,
        timestamp: history[i].createdAt,
        changedBy: history[i].changedBy,
        changeReason: history[i].changeReason || "State update"
      });
    }

    this.transitionCache.set(missionId, transitions);
    return transitions;
  }

  /**
   * Identify common failure patterns from blackboard history
   */
  async identifyFailurePatterns(organizationId: number): Promise<FailurePattern[]> {
    logger.info(`[BlackboardAnalytics] Identifying failure patterns for org ${organizationId}`);

    const patterns: FailurePattern[] = [];

    // Get failed missions
    const failedMissions = await db.select().from(missions).where(
      and(
        eq(missions.organizationId, organizationId),
        eq(missions.status, "failed")
      )
    );

    // Analyze blackboard states of failed missions
    for (const mission of failedMissions) {
      const history = await db.select().from(missionBlackboardHistory)
        .where(eq(missionBlackboardHistory.missionId, mission.id))
        .orderBy(missionBlackboardHistory.createdAt);

      if (history.length > 0) {
        const finalState = history[history.length - 1].blackboard as any;

        // Pattern: Budget exhaustion
        if (finalState.outcome?.includes("budget") || finalState.outcome?.includes("cost")) {
          const existing = patterns.find(p => p.pattern === "Budget exhaustion");
          if (existing) {
            existing.frequency++;
          } else {
            patterns.push({
              pattern: "Budget exhaustion",
              frequency: 1,
              exampleMissionId: mission.id,
              suggestedFix: "Increase budget limit or optimize resource usage"
            });
          }
        }

        // Pattern: Tool failure
        if (finalState.outcome?.includes("tool") || finalState.outcome?.includes("error")) {
          const existing = patterns.find(p => p.pattern === "Tool failure");
          if (existing) {
            existing.frequency++;
          } else {
            patterns.push({
              pattern: "Tool failure",
              frequency: 1,
              exampleMissionId: mission.id,
              suggestedFix: "Implement tool retry logic and fallback mechanisms"
            });
          }
        }

        // Pattern: Stuck in planning phase
        if (finalState.phase === "PLANNING" && history.length > 10) {
          const existing = patterns.find(p => p.pattern === "Stuck in planning");
          if (existing) {
            existing.frequency++;
          } else {
            patterns.push({
              pattern: "Stuck in planning",
              frequency: 1,
              exampleMissionId: mission.id,
              suggestedFix: "Add planning timeout and fallback to simpler strategies"
            });
          }
        }
      }
    }

    // Sort by frequency
    patterns.sort((a, b) => b.frequency - a.frequency);

    return patterns;
  }

  /**
   * Visualize mission progress from blackboard history
   */
  async visualizeMissionProgress(missionId: number): Promise<MissionProgress> {
    logger.info(`[BlackboardAnalytics] Visualizing progress for mission ${missionId}`);

    const mission = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
    if (mission.length === 0) {
      throw new Error(`Mission ${missionId} not found`);
    }

    const history = await db.select().from(missionBlackboardHistory)
      .where(eq(missionBlackboardHistory.missionId, missionId))
      .orderBy(missionBlackboardHistory.createdAt);

    const phases: Array<{
      phase: string;
      timestamp: Date;
      duration: number;
      blackboardState: any;
    }> = [];

    for (let i = 0; i < history.length; i++) {
      const state = history[i].blackboard as any;
      const phase = state.phase || "unknown";
      const timestamp = history[i].createdAt;
      const duration = i > 0 ? timestamp.getTime() - history[i - 1].createdAt.getTime() : 0;

      phases.push({
        phase,
        timestamp,
        duration,
        blackboardState: state
      });
    }

    const totalDuration = phases.reduce((sum, p) => sum + p.duration, 0);

    return {
      missionId,
      missionName: mission[0].name,
      phases,
      totalDuration
    };
  }

  /**
   * Generate optimization suggestions based on blackboard analytics
   */
  async generateOptimizationSuggestions(organizationId: number): Promise<OptimizationSuggestion[]> {
    logger.info(`[BlackboardAnalytics] Generating optimization suggestions for org ${organizationId}`);

    const suggestions: OptimizationSuggestion[] = [];
    const failurePatterns = await this.identifyFailurePatterns(organizationId);

    // Generate suggestions from failure patterns
    for (const pattern of failurePatterns) {
      if (pattern.frequency > 2) {
        suggestions.push({
          category: "execution",
          suggestion: pattern.suggestedFix,
          expectedImprovement: `Reduce ${pattern.pattern} failures by ~50%`,
          priority: 1
        });
      }
    }

    // Analyze mission durations
    const allMissions = await db.select().from(missions).where(eq(missions.organizationId, organizationId));
    const longRunningMissions = allMissions.filter(m => {
      const createdAt = m.createdAt?.getTime() || 0;
      const updatedAt = m.updatedAt?.getTime() || 0;
      return (updatedAt - createdAt) > 3600000; // More than 1 hour
    });

    if (longRunningMissions.length > allMissions.length * 0.3) {
      suggestions.push({
        category: "resource",
        suggestion: "Consider increasing resource limits or parallelizing independent tasks",
        expectedImprovement: "Reduce mission duration by ~30%",
        priority: 2
      });
    }

    // Check for missions with many blackboard updates (potential thrashing)
    for (const mission of allMissions) {
      const history = await db.select().from(missionBlackboardHistory)
        .where(eq(missionBlackboardHistory.missionId, mission.id));

      if (history.length > 50) {
        suggestions.push({
          category: "coordination",
          suggestion: "Mission has excessive state transitions - consider batching updates",
          expectedImprovement: "Reduce overhead and improve stability",
          priority: 3
        });
        break; // Only add once
      }
    }

    // Sort by priority
    suggestions.sort((a, b) => a.priority - b.priority);

    return suggestions;
  }

  /**
   * Get blackboard analytics statistics
   */
  async getAnalyticsStats(organizationId: number): Promise<{
    totalMissions: number;
    missionsWithBlackboardHistory: number;
    averageStateTransitions: number;
    totalFailurePatterns: number;
    averageMissionDuration: number;
  }> {
    const [totalMissions, missionsWithHistory] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(missions).where(eq(missions.organizationId, organizationId)),
      db.select({ count: sql<number>`count(*)` }).from(missionBlackboardHistory)
        .innerJoin(missions, eq(missionBlackboardHistory.missionId, missions.id))
        .where(eq(missions.organizationId, organizationId))
    ]);

    // Calculate average state transitions
    const allHistory = await db.select().from(missionBlackboardHistory)
      .innerJoin(missions, eq(missionBlackboardHistory.missionId, missions.id))
      .where(eq(missions.organizationId, organizationId));

    const transitionsByMission = new Map<number, number>();
    for (const history of allHistory) {
      const count = transitionsByMission.get(history.mission_blackboard_history.missionId) || 0;
      transitionsByMission.set(history.mission_blackboard_history.missionId, count + 1);
    }

    const averageStateTransitions = transitionsByMission.size > 0
      ? Array.from(transitionsByMission.values()).reduce((sum, count) => sum + count, 0) / transitionsByMission.size
      : 0;

    // Get failure patterns
    const failurePatterns = await this.identifyFailurePatterns(organizationId);

    // Calculate average mission duration (simplified)
    const averageMissionDuration = 3600000; // 1 hour placeholder

    return {
      totalMissions: totalMissions[0].count,
      missionsWithBlackboardHistory: missionsWithHistory[0].count,
      averageStateTransitions,
      totalFailurePatterns: failurePatterns.length,
      averageMissionDuration
    };
  }

  /**
   * Clear transition cache
   */
  clearCache(): void {
    this.transitionCache.clear();
    logger.info("[BlackboardAnalytics] Cache cleared");
  }
}


// Singleton instance
export const blackboardAnalyticsService = new BlackboardAnalyticsService();
