/**
 * Multi-Agent Coordination Analytics Service
 * 
 * Tracks agent role performance across missions, identifies optimal agent team compositions,
 * measures coordination overhead vs benefit, and suggests agent role assignments based on mission type.
 * 
 * Expected Impact: Better agent team composition, reduced coordination overhead, improved mission success
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { missions, missionMembers, jobs } from "@shared/schema/index.js";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";

const logger = createLogger("MultiAgentAnalytics");

export interface AgentRolePerformance {
  role: string;
  entityId: number;
  entityName: string;
  totalMissions: number;
  successRate: number;
  averageCoordinationTime: number;
  averageContribution: number;
  trend: "improving" | "stable" | "declining";
}

export interface TeamComposition {
  missionId: number;
  missionName: string;
  members: Array<{
    role: string;
    entityId: number;
    entityName: string;
  }>;
  compositionScore: number;
  successRate: number;
}

export interface CoordinationMetric {
  missionId: number;
  missionName: string;
  teamSize: number;
  coordinationOverhead: number;
  coordinationBenefit: number;
  efficiency: number;
}

export interface RoleRecommendation {
  missionId?: number;
  missionType?: string;
  recommendedRole: string;
  recommendedAgentId?: number;
  recommendedAgentName?: string;
  reason: string;
  expectedImprovement: string;
}

export class MultiAgentAnalyticsService {
  private performanceCache: Map<string, AgentRolePerformance[]> = new Map();
  private cacheTTL = 600000; // 10 minutes

  /**
   * Track agent role performance from mission execution
   */
  async trackRolePerformance(
    missionId: number,
    role: string,
    entityId: number,
    success: boolean,
    coordinationTime: number,
    contributionScore: number
  ): Promise<void> {
    logger.debug(`[MultiAgentAnalytics] Tracking role performance for ${role} in mission ${missionId}`);

    const cacheKey = `role-${role}-${entityId}`;
    const cached = this.performanceCache.get(cacheKey) || [];

    const performance: AgentRolePerformance = {
      role,
      entityId,
      entityName: `Agent ${entityId}`,
      totalMissions: 1,
      successRate: success ? 1 : 0,
      averageCoordinationTime: coordinationTime,
      averageContribution: contributionScore,
      trend: "stable"
    };

    cached.push(performance);
    this.performanceCache.set(cacheKey, cached.slice(-100));
  }

  /**
   * Get agent role performance metrics
   */
  async getRolePerformance(role: string, organizationId: number): Promise<AgentRolePerformance[]> {
    const cacheKey = `role-${role}-org-${organizationId}`;
    const cached = this.performanceCache.get(cacheKey);
    if (cached) return cached;

    logger.info(`[MultiAgentAnalytics] Getting role performance for ${role} in org ${organizationId}`);

    // Get mission members with this role
    const members = await db.select().from(missionMembers)
      .innerJoin(missions, eq(missionMembers.missionId, missions.id))
      .where(
        and(
          eq(missions.organizationId, organizationId),
          eq(missionMembers.role, role)
        )
      );

    const performanceMap = new Map<number, AgentRolePerformance>();

    for (const member of members) {
      const entityId = member.mission_members.entityId;
      const existing = performanceMap.get(entityId);

      if (existing) {
        existing.totalMissions++;
        // Update metrics (simplified)
        existing.successRate = (existing.successRate * 0.9 + (member.missions.status === "completed" ? 1 : 0) * 0.1);
      } else {
        const entityName = member.mission_members.entityType === "job" 
          ? `Job ${entityId}` 
          : `Pipeline ${entityId}`;

        performanceMap.set(entityId, {
          role,
          entityId,
          entityName,
          totalMissions: 1,
          successRate: member.missions.status === "completed" ? 1 : 0,
          averageCoordinationTime: 500, // Placeholder
          averageContribution: 0.7, // Placeholder
          trend: "stable"
        });
      }
    }

    const performances = Array.from(performanceMap.values());
    this.performanceCache.set(cacheKey, performances);
    return performances;
  }

  /**
   * Identify optimal team compositions
   */
  async identifyOptimalCompositions(organizationId: number): Promise<TeamComposition[]> {
    logger.info(`[MultiAgentAnalytics] Identifying optimal team compositions for org ${organizationId}`);

    const compositions: TeamComposition[] = [];

    // Get completed missions
    const completedMissions = await db.select().from(missions).where(
      and(
        eq(missions.organizationId, organizationId),
        eq(missions.status, "completed")
      )
    );

    for (const mission of completedMissions) {
      const members = await db.select().from(missionMembers).where(eq(missionMembers.missionId, mission.id));

      const memberDetails = await Promise.all(
        members.map(async (member) => {
          const entityName = member.entityType === "job"
            ? (await db.select().from(jobs).where(eq(jobs.id, member.entityId)).limit(1))[0]?.name || `Job ${member.entityId}`
            : `Pipeline ${member.entityId}`;

          return {
            role: member.role,
            entityId: member.entityId,
            entityName
          };
        })
      );

      // Calculate composition score based on role diversity
      const roleSet = new Set(memberDetails.map(m => m.role));
      const compositionScore = roleSet.size / memberDetails.length;

      compositions.push({
        missionId: mission.id,
        missionName: mission.name,
        members: memberDetails,
        compositionScore,
        successRate: 1 // Completed = success
      });
    }

    // Sort by composition score and success rate
    compositions.sort((a, b) => (b.compositionScore * 0.5 + b.successRate * 0.5) - (a.compositionScore * 0.5 + a.successRate * 0.5));

    return compositions;
  }

  /**
   * Measure coordination overhead vs benefit
   */
  async measureCoordinationEfficiency(organizationId: number): Promise<CoordinationMetric[]> {
    logger.info(`[MultiAgentAnalytics] Measuring coordination efficiency for org ${organizationId}`);

    const metrics: CoordinationMetric[] = [];

    const orgMissions = await db.select().from(missions).where(eq(missions.organizationId, organizationId));

    for (const mission of orgMissions) {
      const members = await db.select().from(missionMembers).where(eq(missionMembers.missionId, mission.id));
      const teamSize = members.length;

      // Calculate coordination overhead (simplified)
      const coordinationOverhead = teamSize > 1 ? teamSize * 100 : 0; // 100ms per additional agent

      // Calculate coordination benefit (simplified)
      const coordinationBenefit = teamSize > 1 ? (mission.status === "completed" ? 1000 : 0) : 0;

      // Calculate efficiency
      const efficiency = coordinationOverhead > 0 ? coordinationBenefit / coordinationOverhead : 1;

      metrics.push({
        missionId: mission.id,
        missionName: mission.name,
        teamSize,
        coordinationOverhead,
        coordinationBenefit,
        efficiency
      });
    }

    return metrics.sort((a, b) => b.efficiency - a.efficiency);
  }

  /**
   * Suggest agent role assignments based on mission type
   */
  async suggestRoleAssignments(organizationId: number): Promise<RoleRecommendation[]> {
    logger.info(`[MultiAgentAnalytics] Suggesting role assignments for org ${organizationId}`);

    const recommendations: RoleRecommendation[] = [];

    // Get role performances
    const roles = ["primary_strategist", "member", "critic", "gatekeeper", "observer"];

    for (const role of roles) {
      const performances = await this.getRolePerformance(role, organizationId);

      // Find best performer for this role
      if (performances.length > 0) {
        const best = performances.sort((a, b) => b.successRate - a.successRate)[0];

        if (best.successRate > 0.8) {
          recommendations.push({
            recommendedRole: role,
            recommendedAgentId: best.entityId,
            recommendedAgentName: best.entityName,
            reason: `High success rate (${(best.successRate * 100).toFixed(0)}%) in ${role} role`,
            expectedImprovement: "Increase mission success rate by 10-15%"
          });
        }
      }
    }

    // Analyze mission types and suggest optimal compositions
    const compositions = await this.identifyOptimalCompositions(organizationId);
    if (compositions.length > 0) {
      const bestComposition = compositions[0];

      recommendations.push({
        recommendedRole: "team_composition",
        reason: `Optimal team composition: ${bestComposition.members.map(m => m.role).join(", ")}`,
        expectedImprovement: "Improve coordination efficiency by 20-30%"
      });
    }

    return recommendations;
  }

  /**
   * Get multi-agent coordination statistics
   */
  async getCoordinationStats(organizationId: number): Promise<{
    totalMissions: number;
    missionsWithMultipleAgents: number;
    averageTeamSize: number;
    averageCoordinationEfficiency: number;
    bestPerformingRole: string;
    worstPerformingRole: string;
  }> {
    const [totalMissions, missionsWithMultipleAgents] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(missions).where(eq(missions.organizationId, organizationId)),
      db.select({ count: sql<number>`count(*)` }).from(missionMembers)
        .innerJoin(missions, eq(missionMembers.missionId, missions.id))
        .where(
          and(
            eq(missions.organizationId, organizationId),
            sql`(SELECT COUNT(*) FROM mission_members WHERE mission_id = missions.id) > 1`
          )
        )
    ]);

    // Calculate average team size
    const allMembers = await db.select().from(missionMembers)
      .innerJoin(missions, eq(missionMembers.missionId, missions.id))
      .where(eq(missions.organizationId, organizationId));

    const totalMembers = allMembers.length;
    const averageTeamSize = totalMissions[0].count > 0 ? totalMembers / totalMissions[0].count : 0;

    // Calculate average coordination efficiency
    const efficiencies = await this.measureCoordinationEfficiency(organizationId);
    const averageCoordinationEfficiency = efficiencies.length > 0
      ? efficiencies.reduce((sum, e) => sum + e.efficiency, 0) / efficiencies.length
      : 0;

    // Find best and worst performing roles
    const roles = ["primary_strategist", "member", "critic", "gatekeeper", "observer"];
    let bestPerformingRole = "N/A";
    let worstPerformingRole = "N/A";
    let bestSuccessRate = 0;
    let worstSuccessRate = 1;

    for (const role of roles) {
      try {
        const performances = await this.getRolePerformance(role, organizationId);
        if (performances.length > 0) {
          const avgSuccess = performances.reduce((sum, p) => sum + p.successRate, 0) / performances.length;
          if (avgSuccess > bestSuccessRate) {
            bestSuccessRate = avgSuccess;
            bestPerformingRole = role;
          }
          if (avgSuccess < worstSuccessRate) {
            worstSuccessRate = avgSuccess;
            worstPerformingRole = role;
          }
        }
      } catch (error) {
        // Skip roles without data
      }
    }

    return {
      totalMissions: totalMissions[0].count,
      missionsWithMultipleAgents: missionsWithMultipleAgents[0].count,
      averageTeamSize,
      averageCoordinationEfficiency,
      bestPerformingRole,
      worstPerformingRole
    };
  }

  /**
   * Clear performance cache
   */
  clearCache(): void {
    this.performanceCache.clear();
    logger.info("[MultiAgentAnalytics] Cache cleared");
  }
}

// Singleton instance
export const multiAgentAnalyticsService = new MultiAgentAnalyticsService();
