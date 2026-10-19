/**
 * Skill Evolution Analytics Service
 * 
 * Tracks skill performance across job executions, correlates skill usage with mission success rates,
 * identifies skill gaps from mission failures, and suggests skill improvements based on knowledge graph patterns.
 * 
 * Expected Impact: Autonomous skill improvement, better skill selection, reduced mission failures
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { jobs, missions, knowledgeNodes, missionMembers } from "@shared/schema/index.js";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";

const logger = createLogger("SkillEvolution");

export interface SkillPerformance {
  skillId: number;
  skillName: string;
  totalExecutions: number;
  successRate: number;
  averageLatency: number;
  averageCost: number;
  lastUsed: Date;
  trend: "improving" | "stable" | "declining";
}

export interface SkillGap {
  skillId: number;
  skillName: string;
  gapType: "missing" | "underperforming" | "outdated";
  severity: "high" | "medium" | "low";
  suggestedImprovement: string;
  relatedMissions: number[];
}

export interface SkillRecommendation {
  skillId: number;
  skillName: string;
  action: "upgrade" | "deprecate" | "create" | "optimize";
  reason: string;
  expectedImpact: "high" | "medium" | "low";
  priority: number;
}

export class SkillEvolutionService {
  private performanceCache: Map<number, SkillPerformance> = new Map();
  private gapCache: Map<number, { data: SkillGap[]; cachedAt: number }> = new Map();
  private cacheTTL = 600000; // 10 minutes

  /**
   * Track skill performance from job execution
   */
  async trackSkillExecution(
    skillId: number,
    success: boolean,
    latency: number,
    cost: number
  ): Promise<void> {
    logger.debug(`[SkillEvolution] Tracking execution for skill ${skillId}: success=${success}`);

    // Update performance cache
    const cached = this.performanceCache.get(skillId);
    if (cached) {
      cached.totalExecutions++;
      cached.successRate = this.updateRollingAverage(cached.successRate, success ? 1 : 0, cached.totalExecutions);
      cached.averageLatency = this.updateRollingAverage(cached.averageLatency, latency, cached.totalExecutions);
      cached.averageCost = this.updateRollingAverage(cached.averageCost, cost, cached.totalExecutions);
      cached.lastUsed = new Date();
      cached.trend = this.calculateTrend(cached);
    }
  }

  /**
   * Get skill performance metrics
   */
  async getSkillPerformance(skillId: number): Promise<SkillPerformance> {
    const cached = this.performanceCache.get(skillId);
    if (cached && Date.now() - cached.lastUsed.getTime() < this.cacheTTL) {
      return cached;
    }

    // Get jobs using this skill
    const skillJobs = await db.select().from(jobs).where(eq(jobs.skillId, skillId));
    
    if (skillJobs.length === 0) {
      throw new Error(`No jobs found for skill ${skillId}`);
    }

    const skillName = skillJobs[0].name; // Use first job name as skill name proxy
    const totalExecutions = skillJobs.length;
    
    // Calculate metrics (simplified - in production would use actual execution logs)
    const successRate = skillJobs.filter(j => j.isActive).length / totalExecutions;
    // Not yet tracked — real values accumulate via trackSkillExecution()
    const averageLatency = 0;
    const averageCost = 0;
    const lastUsed = skillJobs.reduce((latest, job) => 
      job.updatedAt && job.updatedAt > latest ? job.updatedAt : latest, 
      new Date(0)
    );

    const performance: SkillPerformance = {
      skillId,
      skillName,
      totalExecutions,
      successRate,
      averageLatency,
      averageCost,
      lastUsed,
      trend: "stable"
    };

    this.performanceCache.set(skillId, performance);
    return performance;
  }

  /**
   * Identify skill gaps from mission failures
   */
  async identifySkillGaps(organizationId: number): Promise<SkillGap[]> {
    const cacheKey = organizationId;
    const cached = this.gapCache.get(cacheKey);

    if (cached && Date.now() - cached.cachedAt < this.cacheTTL) {
      return cached.data;
    }

    logger.info(`[SkillEvolution] Identifying skill gaps for org ${organizationId}`);

    const gaps: SkillGap[] = [];

    // Find failed missions
    const failedMissions = await db.select().from(missions).where(
      and(
        eq(missions.organizationId, organizationId),
        eq(missions.status, "failed")
      )
    );

    // Analyze failed missions for skill gaps
    for (const mission of failedMissions) {
      const members = await db.select().from(missionMembers).where(eq(missionMembers.missionId, mission.id));
      
      for (const member of members) {
        if (member.entityType === "job") {
          const job = await db.select().from(jobs).where(eq(jobs.id, member.entityId)).limit(1);
          if (job.length > 0 && job[0].skillId) {
            const skillPerformance = await this.getSkillPerformance(job[0].skillId);
            
            if (skillPerformance.successRate < 0.5) {
              gaps.push({
                skillId: job[0].skillId,
                skillName: job[0].name,
                gapType: "underperforming",
                severity: skillPerformance.successRate < 0.3 ? "high" : "medium",
                suggestedImprovement: "Skill success rate below 50%. Consider retraining or replacing.",
                relatedMissions: [mission.id]
              });
            }
          }
        }
      }
    }

    // Identify missing skills from successful missions
    const successfulMissions = await db.select().from(missions).where(
      and(
        eq(missions.organizationId, organizationId),
        eq(missions.status, "completed")
      )
    );

    const usedSkills = new Set<number>();
    for (const mission of successfulMissions) {
      const members = await db.select().from(missionMembers).where(eq(missionMembers.missionId, mission.id));
      for (const member of members) {
        if (member.entityType === "job") {
          const job = await db.select().from(jobs).where(eq(jobs.id, member.entityId)).limit(1);
          if (job.length > 0 && job[0].skillId) {
            usedSkills.add(job[0].skillId);
          }
        }
      }
    }

    // Find skills not used in successful missions
    const allSkills = await db.select({ skillId: jobs.skillId }).from(jobs).where(
      and(
        eq(jobs.organizationId, organizationId),
        sql`${jobs.skillId} IS NOT NULL`
      )
    );

    for (const { skillId } of allSkills) {
      if (skillId !== null && !usedSkills.has(skillId)) {
        gaps.push({
          skillId: skillId!,
          skillName: `Skill ${skillId}`,
          gapType: "missing",
          severity: "low",
          suggestedImprovement: "Skill not used in successful missions. Consider deprecation.",
          relatedMissions: []
        });
      }
    }

    this.gapCache.set(cacheKey, { data: gaps, cachedAt: Date.now() });
    return gaps;
  }

  /**
   * Suggest skill improvements based on knowledge graph patterns
   */
  async suggestSkillImprovements(organizationId: number): Promise<SkillRecommendation[]> {
    logger.info(`[SkillEvolution] Generating skill improvement recommendations for org ${organizationId}`);

    const recommendations: SkillRecommendation[] = [];
    const gaps = await this.identifySkillGaps(organizationId);

    // Generate recommendations from gaps
    for (const gap of gaps) {
      if (gap.gapType === "underperforming" && gap.severity === "high") {
        recommendations.push({
          skillId: gap.skillId,
          skillName: gap.skillName,
          action: "upgrade",
          reason: "Critical skill with low success rate",
          expectedImpact: "high",
          priority: 1
        });
      } else if (gap.gapType === "missing") {
        recommendations.push({
          skillId: gap.skillId,
          skillName: gap.skillName,
          action: "deprecate",
          reason: "Unused skill",
          expectedImpact: "low",
          priority: 3
        });
      }
    }

    // Analyze knowledge graph for skill opportunities
    const highUsageNodes = await db.select().from(knowledgeNodes).where(
      and(
        eq(knowledgeNodes.organizationId, organizationId),
        gte(knowledgeNodes.usageCount, 10)
      )
    ).orderBy(desc(knowledgeNodes.usageCount)).limit(10);

    for (const node of highUsageNodes) {
      if (node.ownerId) {
        // Check if this agent's skill could be improved
        const skillPerformance = await this.getSkillPerformance(node.ownerId).catch(() => null);
        if (skillPerformance && skillPerformance.successRate < 0.7) {
          recommendations.push({
            skillId: node.ownerId,
            skillName: `Agent ${node.ownerId}`,
            action: "optimize",
            reason: "High-usage knowledge node with suboptimal skill performance",
            expectedImpact: "medium",
            priority: 2
          });
        }
      }
    }

    // Sort by priority
    recommendations.sort((a, b) => a.priority - b.priority);

    return recommendations;
  }

  /**
   * Get skill evolution statistics
   */
  async getEvolutionStats(organizationId: number): Promise<{
    totalSkills: number;
    activeSkills: number;
    improvingSkills: number;
    decliningSkills: number;
    totalGaps: number;
    highSeverityGaps: number;
  }> {
    const skillIds = await db.select({ skillId: jobs.skillId }).from(jobs).where(
      and(
        eq(jobs.organizationId, organizationId),
        sql`${jobs.skillId} IS NOT NULL`
      )
    );

    const uniqueSkillIds = [...new Set(skillIds.map(s => s.skillId).filter((id): id is number => id !== null))];
    const totalSkills = uniqueSkillIds.length;

    let activeSkills = 0;
    let improvingSkills = 0;
    let decliningSkills = 0;

    for (const skillId of uniqueSkillIds) {
      try {
        const performance = await this.getSkillPerformance(skillId);
        if (performance.totalExecutions > 0) activeSkills++;
        if (performance.trend === "improving") improvingSkills++;
        if (performance.trend === "declining") decliningSkills++;
      } catch (error) {
        // Skip skills without data
      }
    }

    const gaps = await this.identifySkillGaps(organizationId);
    const highSeverityGaps = gaps.filter(g => g.severity === "high").length;

    return {
      totalSkills,
      activeSkills,
      improvingSkills,
      decliningSkills,
      totalGaps: gaps.length,
      highSeverityGaps
    };
  }

  /**
   * Update rolling average
   */
  private updateRollingAverage(current: number, newValue: number, count: number): number {
    return (current * (count - 1) + newValue) / count;
  }

  /**
   * Calculate trend based on recent performance
   */
  private calculateTrend(performance: SkillPerformance): "improving" | "stable" | "declining" {
    // Simplified trend calculation
    // In production would compare recent vs historical performance
    if (performance.successRate > 0.8) return "improving";
    if (performance.successRate < 0.5) return "declining";
    return "stable";
  }

  /**
   * Clear caches
   */
  clearCaches(): void {
    this.performanceCache.clear();
    this.gapCache.clear();
    logger.info("[SkillEvolution] Caches cleared");
  }
}

// Singleton instance
export const skillEvolutionService = new SkillEvolutionService();
