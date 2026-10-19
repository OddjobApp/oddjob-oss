/**
 * Rescue Prevention Service
 *
 * ML-based prediction system that identifies missions at risk of needing rescue
 * BEFORE they launch, enabling proactive intervention.
 *
 * Features:
 * - Mission risk scoring based on historical rescue patterns
 * - Real-time risk assessment during mission execution
 * - Preventive recommendations to reduce failure probability
 * - Pattern learning from rescue triage summaries
 * - Integration with governor for automatic policy adjustment
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { eq, and, or, desc, sql, inArray, gte } from "drizzle-orm";
import { rescueSessions } from "@shared/schema/rescue.js";
import { missions } from "@shared/schema/missions/core.js";
import { missionRuns } from "@shared/schema/missions/runs.js";
import { missionMembers } from "@shared/schema/missions/index.js";
import { pipelines } from "@shared/schema/pipelines/index.js";
import { jobs } from "@shared/schema/jobs/index.js";

const logger = createLogger("RescuePrevention");

export interface MissionRiskAssessment {
  missionId: number;
  overallRiskScore: number; // 0-100, higher = more risky
  riskLevel: "low" | "medium" | "high" | "critical";
  factors: RiskFactor[];
  similarFailedMissions: SimilarMission[];
  preventiveActions: PreventiveAction[];
  recommendedGovernorPolicy?: string;
  confidence: number;
}

export interface RiskFactor {
  category: string;
  score: number; // 0-100 contribution to risk
  description: string;
  severity: "info" | "warning" | "critical";
  mitigation?: string;
}

export interface SimilarMission {
  missionId: number;
  missionName: string;
  similarity: number;
  outcome: "success" | "failed" | "rescued";
  failureReason?: string;
  rescueNeeded: boolean;
}

export interface PreventiveAction {
  action: string;
  description: string;
  expectedRiskReduction: number; // percentage
  implementation: "automatic" | "manual" | "recommended";
  effort: "low" | "medium" | "high";
}

export interface RescuePattern {
  pattern: string;
  frequency: number;
  affectedMissionTypes: string[];
  commonCulpritNodes: number[];
  preventiveMeasures: string[];
}

// Risk scoring weights
const RISK_WEIGHTS = {
  complexity: 0.25,
  historicalFailure: 0.2,
  knowledgeGap: 0.2,
  resourceConstraints: 0.15,
  dependencies: 0.1,
  timing: 0.1,
};

export const rescuePreventionService = {
  /**
   * Main entry point: Assess mission risk before launch
   */
  async assessMissionRisk(missionId: number): Promise<MissionRiskAssessment> {
    logger.info(`[RescuePrevention] Assessing risk for mission ${missionId}`);

    try {
      // 1. Get mission details
      const mission = await this.getMissionDetails(missionId);
      if (!mission) {
        throw new Error(`Mission ${missionId} not found`);
      }

      // 2. Analyze risk factors
      const factors = await this.analyzeRiskFactors(mission);

      // 3. Calculate overall risk score
      const overallRiskScore = this.calculateOverallRisk(factors);
      const riskLevel = this.determineRiskLevel(overallRiskScore);

      // 4. Find similar missions that failed
      const similarFailedMissions = await this.findSimilarFailedMissions(mission);

      // 5. Generate preventive actions
      const preventiveActions = await this.generatePreventiveActions(
        mission,
        factors,
        similarFailedMissions
      );

      // 6. Determine confidence based on data quality
      const confidence = this.calculateConfidence(factors, similarFailedMissions);

      const assessment: MissionRiskAssessment = {
        missionId,
        overallRiskScore,
        riskLevel,
        factors,
        similarFailedMissions,
        preventiveActions,
        recommendedGovernorPolicy: this.recommendGovernorPolicy(riskLevel, factors),
        confidence,
      };

      logger.info(
        `[RescuePrevention] Mission ${missionId} risk assessment: ${riskLevel} (${overallRiskScore.toFixed(1)})`
      );

      return assessment;
    } catch (error: any) {
      logger.error(
        `[RescuePrevention] Failed to assess mission ${missionId}:`,
        error.message
      );
      throw error;
    }
  },

  /**
   * Get mission details with related information
   */
  async getMissionDetails(missionId: number): Promise<
    | {
        id: number;
        name: string;
        objective: string;
        description: string | null;
        executionStrategy: string | null;
        budgetLimitUsd: number | null;
        organizationId: number | null;
        blackboard: Record<string, any>;
        memberCount: number;
        pipelineCount: number;
        knowledgeTopicCount: number;
      }
    | undefined
  > {
    const [mission] = await db
      .select({
        id: missions.id,
        name: missions.name,
        objective: missions.objective,
        description: missions.description,
        executionStrategy: missions.executionStrategy,
        budgetLimitUsd: missions.budgetLimitUsd,
        organizationId: missions.organizationId,
        blackboard: missions.blackboard,
      })
      .from(missions)
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!mission) return undefined;

    // Get member count
    const [{ count: memberCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(missionMembers)
      .where(eq(missionMembers.missionId, missionId));

    // Count pipelines and knowledge topics from blackboard
    const blackboard = mission.blackboard as Record<string, any> | null;
    const pipelineCount = blackboard?.pipelines?.length || 0;
    const knowledgeTopicCount = blackboard?.knowledgeTopics?.length || 0;

    return {
      ...mission,
      objective: mission.objective || "",
      blackboard: (mission.blackboard as Record<string, any>) || {},
      budgetLimitUsd: mission.budgetLimitUsd ? parseFloat(mission.budgetLimitUsd) : null,
      memberCount,
      pipelineCount,
      knowledgeTopicCount,
    };
  },

  /**
   * Analyze individual risk factors
   */
  async analyzeRiskFactors(mission: NonNullable<Awaited<ReturnType<typeof this.getMissionDetails>>>): Promise<RiskFactor[]> {
    const factors: RiskFactor[] = [];

    // Factor 1: Complexity Risk (based on member count, pipelines, objectives)
    const complexityScore = this.calculateComplexityScore(mission);
    factors.push({
      category: "Complexity",
      score: complexityScore,
      description: `Mission has ${mission.memberCount} members, ${mission.pipelineCount} pipelines, and ${mission.objective?.length || 0} character objective`,
      severity: complexityScore > 70 ? "critical" : complexityScore > 40 ? "warning" : "info",
      mitigation: complexityScore > 50 ? "Consider breaking into sub-missions" : undefined,
    });

    // Factor 2: Historical Failure Risk (similar missions that failed)
    const historicalRisk = await this.calculateHistoricalRisk(mission);
    factors.push({
      category: "Historical Pattern",
      score: historicalRisk.score,
      description: historicalRisk.description,
      severity: historicalRisk.score > 60 ? "critical" : historicalRisk.score > 30 ? "warning" : "info",
      mitigation: historicalRisk.score > 40 ? historicalRisk.recommendation : undefined,
    });

    // Factor 3: Knowledge Gap Risk (insufficient context)
    const knowledgeGapRisk = await this.calculateKnowledgeGapRisk(mission);
    factors.push({
      category: "Knowledge Coverage",
      score: knowledgeGapRisk.score,
      description: knowledgeGapRisk.description,
      severity: knowledgeGapRisk.score > 60 ? "critical" : knowledgeGapRisk.score > 30 ? "warning" : "info",
      mitigation: knowledgeGapRisk.score > 40 ? "Enrich mission context from knowledge graph" : undefined,
    });

    // Factor 4: Resource Constraints (budget, time)
    const resourceRisk = this.calculateResourceRisk(mission);
    factors.push({
      category: "Resources",
      score: resourceRisk.score,
      description: resourceRisk.description,
      severity: resourceRisk.score > 60 ? "critical" : resourceRisk.score > 30 ? "warning" : "info",
      mitigation: resourceRisk.recommendation,
    });

    // Factor 5: Dependency Risk (based on mission members and their status)
    const dependencyRisk = await this.calculateDependencyRisk(mission);
    factors.push({
      category: "Dependencies",
      score: dependencyRisk.score,
      description: dependencyRisk.description,
      severity: dependencyRisk.score > 60 ? "critical" : dependencyRisk.score > 30 ? "warning" : "info",
      mitigation: dependencyRisk.recommendation,
    });

    // Factor 6: Timing Risk (peak load, scheduling conflicts)
    const timingRisk = await this.calculateTimingRisk(mission);
    factors.push({
      category: "Timing",
      score: timingRisk.score,
      description: timingRisk.description,
      severity: timingRisk.score > 60 ? "critical" : timingRisk.score > 30 ? "warning" : "info",
      mitigation: timingRisk.recommendation,
    });

    return factors.sort((a, b) => b.score - a.score);
  },

  /**
   * Calculate complexity score based on mission characteristics
   */
  calculateComplexityScore(mission: NonNullable<Awaited<ReturnType<typeof this.getMissionDetails>>>): number {
    let score = 0;

    // Member count contribution (more members = more complex coordination)
    score += Math.min(mission.memberCount * 8, 30);

    // Pipeline count contribution
    score += Math.min(mission.pipelineCount * 10, 30);

    // Objective length/ambiguity contribution
    const objectiveLength = mission.objective?.length || 0;
    if (objectiveLength > 500) score += 20;
    else if (objectiveLength > 200) score += 10;

    // Execution strategy complexity
    const strategyComplexity: Record<string, number> = {
      simple: 0,
      sequential: 5,
      parallel: 15,
      dynamic_autonomous: 20,
      adversarial_emergent: 25,
    };
    score += strategyComplexity[mission.executionStrategy || "simple"] || 10;

    return Math.min(score, 100);
  },

  /**
   * Calculate risk based on historical failures of similar missions
   */
  async calculateHistoricalRisk(mission: NonNullable<Awaited<ReturnType<typeof this.getMissionDetails>>>): Promise<{
    score: number;
    description: string;
    recommendation?: string;
  }> {
    // Find similar past missions
    const similarMissions = await this.findSimilarMissions(mission);

    if (similarMissions.length === 0) {
      return { score: 30, description: "No similar missions found - limited historical data" };
    }

    const failedCount = similarMissions.filter((m) => m.outcome === "failed" || m.outcome === "rescued").length;
    const failureRate = failedCount / similarMissions.length;

    const score = failureRate * 100;

    let description = `${failedCount} of ${similarMissions.length} similar missions required rescue or failed (${(failureRate * 100).toFixed(0)}%)`;
    let recommendation: string | undefined;

    if (failureRate > 0.5) {
      description += ". High historical failure rate for this mission type.";
      recommendation = "Consider enhanced supervision and smaller scope";
    } else if (failureRate > 0.2) {
      description += ". Moderate risk based on historical patterns.";
      recommendation = "Monitor closely and prepare rescue contingencies";
    }

    return { score, description, recommendation };
  },

  /**
   * Calculate knowledge gap risk
   */
  async calculateKnowledgeGapRisk(mission: NonNullable<Awaited<ReturnType<typeof this.getMissionDetails>>>): Promise<{
    score: number;
    description: string;
  }> {
    const hasEnrichment = mission.blackboard?.autoContext?.enrichmentScore;

    if (hasEnrichment) {
      const enrichmentScore = mission.blackboard.autoContext.enrichmentScore;
      const entityCount = mission.blackboard.autoContext.entities?.length || 0;

      if (enrichmentScore > 0.8 && entityCount > 10) {
        return { score: 10, description: `Well-enriched context (${entityCount} entities, ${(enrichmentScore * 100).toFixed(0)}% confidence)` };
      } else if (enrichmentScore > 0.5) {
        return { score: 40, description: `Partial context enrichment (${(enrichmentScore * 100).toFixed(0)}% confidence)` };
      } else {
        return { score: 75, description: `Poor context enrichment (${(enrichmentScore * 100).toFixed(0)}% confidence)` };
      }
    }

    // Check if mission is linked to knowledge topics
    if (mission.knowledgeTopicCount > 0) {
      return { score: 30, description: `Linked to ${mission.knowledgeTopicCount} knowledge topics but not enriched` };
    }

    return { score: 85, description: "No knowledge context available - high risk of missing critical information" };
  },

  /**
   * Calculate resource constraint risk
   */
  calculateResourceRisk(mission: NonNullable<Awaited<ReturnType<typeof this.getMissionDetails>>>): {
    score: number;
    description: string;
    recommendation?: string;
  } {
    const budget = mission.budgetLimitUsd;

    if (!budget || budget === 0) {
      return {
        score: 50,
        description: "No budget limit set - risk of runaway costs",
        recommendation: "Set explicit budget limit",
      };
    }

    if (budget < 1) {
      return {
        score: 70,
        description: "Very tight budget (<$1) - high risk of premature termination",
        recommendation: "Consider increasing budget or reducing scope",
      };
    }

    return {
      score: 20,
      description: `Budget set to $${budget} - adequate for standard execution`,
    };
  },

  /**
   * Calculate dependency risk
   */
  async calculateDependencyRisk(mission: NonNullable<Awaited<ReturnType<typeof this.getMissionDetails>>>): Promise<{
    score: number;
    description: string;
    recommendation?: string;
  }> {
    // Check if mission has members
    if (mission.memberCount === 0) {
      return {
        score: 80,
        description: "No mission members assigned - cannot execute",
        recommendation: "Add at least one pipeline or job member",
      };
    }

    // Check member health
    const members = await db
      .select({
        entityType: missionMembers.entityType,
        entityId: missionMembers.entityId,
        status: missionMembers.status,
      })
      .from(missionMembers)
      .where(eq(missionMembers.missionId, mission.id));

    const inactiveMembers = members.filter((m) => m.status !== "active").length;

    if (inactiveMembers > 0) {
      return {
        score: 40 + inactiveMembers * 10,
        description: `${inactiveMembers} of ${members.length} members are inactive or paused`,
        recommendation: "Reactivate paused members or remove from mission",
      };
    }

    return {
      score: 15,
      description: `All ${members.length} members are active and ready`,
    };
  },

  /**
   * Calculate timing/scheduling risk
   */
  async calculateTimingRisk(mission: NonNullable<Awaited<ReturnType<typeof this.getMissionDetails>>>): Promise<{
    score: number;
    description: string;
    recommendation?: string;
  }> {
    // Check concurrent mission load
    const orgId = mission.organizationId;
    
    // `sql`true`` here counted every tenant's active missions, so a mission
    // with no organization was scored against global platform load. The factor
    // is unknowable rather than zero, so say so instead of inventing a number
    // from other tenants' traffic.
    if (orgId == null) {
      return {
        score: 0,
        description: "Concurrent mission load unknown: this mission has no organization to measure load within",
      };
    }

    const [{ count: activeMissions }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(missions)
      .where(
        and(
          eq(missions.organizationId, orgId),
          eq(missions.status, "active")
        )
      );

    if (activeMissions > 10) {
      return {
        score: 60,
        description: `High concurrent mission load (${activeMissions} active) - resource contention likely`,
        recommendation: "Consider scheduling during off-peak hours",
      };
    }

    if (activeMissions > 5) {
      return {
        score: 35,
        description: `Moderate mission load (${activeMissions} active) - monitor resource usage`,
      };
    }

    return {
      score: 10,
      description: `Low mission load (${activeMissions} active) - optimal conditions`,
    };
  },

  /**
   * Calculate overall risk score from factors
   */
  calculateOverallRisk(factors: RiskFactor[]): number {
    const weightedScore = factors.reduce((sum, factor) => {
      const key = factor.category.toLowerCase().replaceAll(" ", "") as keyof typeof RISK_WEIGHTS;
      const weight = RISK_WEIGHTS[key] || 0.1;
      return sum + factor.score * weight;
    }, 0);

    // Normalize to 0-100
    return Math.min(Math.round(weightedScore), 100);
  },

  /**
   * Determine risk level from score
   */
  determineRiskLevel(score: number): "low" | "medium" | "high" | "critical" {
    if (score < 30) return "low";
    if (score < 50) return "medium";
    if (score < 75) return "high";
    return "critical";
  },

  /**
   * Find similar missions that failed
   */
  async findSimilarFailedMissions(mission: NonNullable<Awaited<ReturnType<typeof this.getMissionDetails>>>): Promise<SimilarMission[]> {
    const similar = await this.findSimilarMissions(mission);
    return similar
      .filter((m) => m.outcome === "failed" || m.outcome === "rescued")
      .slice(0, 5);
  },

  /**
   * Find missions similar to the target
   */
  async findSimilarMissions(mission: NonNullable<Awaited<ReturnType<typeof this.getMissionDetails>>>): Promise<SimilarMission[]> {
    // "In the same org" was not what the query did: `sql`true`` read up to 50
    // other tenants' missions, objectives and blackboards included, whenever
    // the target mission had no organization. There is no cross-tenant answer
    // to "what is similar to this".
    if (mission.organizationId == null) return [];
    const orgFilter = eq(missions.organizationId, mission.organizationId);

    const pastMissions = await db
      .select({
        id: missions.id,
        name: missions.name,
        objective: missions.objective,
        blackboard: missions.blackboard,
        status: missions.status,
      })
      .from(missions)
      .where(
        and(
          orgFilter,
          sql`${missions.id} != ${mission.id}`,
          or(eq(missions.status, "completed"), eq(missions.status, "failed"))
        )
      )
      .orderBy(desc(missions.createdAt))
      .limit(50);

    // Calculate similarity scores
    const missionTerms = new Set(this.extractKeyTerms(mission.objective + " " + mission.name));

    const scored = pastMissions.map((m) => {
      const missionText = `${m.name} ${m.objective || ""}`;
      const mTerms = new Set(this.extractKeyTerms(missionText));

      const intersection = new Set([...missionTerms].filter((x) => mTerms.has(x)));
      const union = new Set([...missionTerms, ...mTerms]);
      const similarity = intersection.size / (union.size || 1);

      // Check if mission was rescued
      const mBlackboard = m.blackboard as Record<string, any> | null;
      const wasRescued = mBlackboard?.rescueSessionId || mBlackboard?.rescueNeeded;

      return {
        missionId: m.id,
        missionName: m.name,
        similarity,
        outcome: (wasRescued ? "rescued" : m.status) as "failed" | "success" | "rescued",
        failureReason: mBlackboard?.failureReason,
        rescueNeeded: wasRescued,
      };
    });

    return scored
      .filter((m) => m.similarity > 0.1)
      .sort((a, b) => b.similarity - a.similarity);
  },

  /**
   * Extract key terms from text for similarity matching
   */
  extractKeyTerms(text: string): string[] {
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "must", "to", "of", "in", "for", "on",
      "with", "at", "by", "from", "as", "and", "or", "but", "so", "yet",
    ]);

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word));
  },

  /**
   * Generate preventive actions based on risk factors
   */
  async generatePreventiveActions(
    mission: NonNullable<Awaited<ReturnType<typeof this.getMissionDetails>>>,
    factors: RiskFactor[],
    similarFailed: SimilarMission[]
  ): Promise<PreventiveAction[]> {
    const actions: PreventiveAction[] = [];

    // Action 1: Knowledge enrichment if knowledge gap is high
    const knowledgeFactor = factors.find((f) => f.category === "Knowledge Coverage");
    if (knowledgeFactor && knowledgeFactor.score > 40) {
      actions.push({
        action: "Enrich Mission Context",
        description: "Auto-populate mission blackboard from knowledge graph",
        expectedRiskReduction: Math.min(knowledgeFactor.score * 0.5, 30),
        implementation: "automatic",
        effort: "low",
      });
    }

    // Action 2: Add supervisor if complexity is high
    const complexityFactor = factors.find((f) => f.category === "Complexity");
    if (complexityFactor && complexityFactor.score > 60) {
      actions.push({
        action: "Enable Enhanced Supervision",
        description: "Add supervisor mission and tighter governor policies",
        expectedRiskReduction: 25,
        implementation: "recommended",
        effort: "low",
      });
    }

    // Action 3: Set budget if not set
    const resourceFactor = factors.find((f) => f.category === "Resources");
    if (resourceFactor && resourceFactor.score > 40) {
      actions.push({
        action: "Configure Budget Limits",
        description: "Set explicit spending limits and alerts",
        expectedRiskReduction: 15,
        implementation: "manual",
        effort: "low",
      });
    }

    // Action 4: Schedule during off-peak if timing risk
    const timingFactor = factors.find((f) => f.category === "Timing");
    if (timingFactor && timingFactor.score > 40) {
      actions.push({
        action: "Optimize Launch Timing",
        description: "Delay launch until lower mission load period",
        expectedRiskReduction: 20,
        implementation: "recommended",
        effort: "low",
      });
    }

    // Action 5: Learn from similar failures
    if (similarFailed.length > 0) {
      const commonReasons = this.aggregateFailureReasons(similarFailed);
      actions.push({
        action: "Apply Learnings from Similar Failures",
        description: `Address common issues: ${commonReasons.slice(0, 2).join(", ")}`,
        expectedRiskReduction: 20,
        implementation: "recommended",
        effort: "medium",
      });
    }

    // Action 6: Break up mission if very complex
    if (complexityFactor && complexityFactor.score > 80) {
      actions.push({
        action: "Decompose Mission",
        description: "Split into smaller, sequential sub-missions",
        expectedRiskReduction: 35,
        implementation: "recommended",
        effort: "high",
      });
    }

    return actions.sort((a, b) => b.expectedRiskReduction - a.expectedRiskReduction);
  },

  /**
   * Aggregate common failure reasons from similar missions
   */
  aggregateFailureReasons(similarMissions: SimilarMission[]): string[] {
    const reasons = similarMissions
      .map((m) => m.failureReason)
      .filter(Boolean) as string[];

    // Simple frequency count
    const frequency: Record<string, number> = {};
    for (const reason of reasons) {
      frequency[reason] = (frequency[reason] || 0) + 1;
    }

    return Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .map(([reason]) => reason);
  },

  /**
   * Recommend governor policy based on risk
   */
  recommendGovernorPolicy(riskLevel: string, factors: RiskFactor[]): string | undefined {
    if (riskLevel === "critical") {
      return "strict_supervision";
    }
    if (riskLevel === "high") {
      return "enhanced_monitoring";
    }
    if (factors.some((f) => f.category === "Complexity" && f.score > 70)) {
      return "conservative_execution";
    }
    return undefined;
  },

  /**
   * Calculate confidence in assessment
   */
  calculateConfidence(factors: RiskFactor[], similarMissions: SimilarMission[]): number {
    let confidence = 0.5; // Base confidence

    // Boost for having similar mission data
    if (similarMissions.length >= 5) confidence += 0.2;
    else if (similarMissions.length >= 2) confidence += 0.1;

    // Boost for low variance in factors
    const scores = factors.map((f) => f.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length;
    if (variance < 400) confidence += 0.1; // Low variance = more predictable

    return Math.min(confidence, 1.0);
  },

  /**
   * Analyze rescue patterns from historical data
   */
  async analyzeRescuePatterns(): Promise<RescuePattern[]> {
    const recentRescues = await db
      .select({
        id: rescueSessions.id,
        missionId: rescueSessions.missionId,
        triageSummary: rescueSessions.triageSummary,
        culpritNodeId: rescueSessions.culpritNodeId,
      })
      .from(rescueSessions)
      .where(gte(rescueSessions.createdAt, sql`now() - interval '30 days'`))
      .orderBy(desc(rescueSessions.createdAt))
      .limit(100);

    // Pattern analysis would go here - simplified for now
    const patterns: RescuePattern[] = [];

    // Group by culprit node
    const byNode = new Map<number, typeof recentRescues>();
    for (const rescue of recentRescues) {
      if (rescue.culpritNodeId) {
        if (!byNode.has(rescue.culpritNodeId)) {
          byNode.set(rescue.culpritNodeId, []);
        }
        byNode.get(rescue.culpritNodeId)!.push(rescue);
      }
    }

    for (const [nodeId, rescues] of byNode) {
      if (rescues.length >= 3) {
        patterns.push({
          pattern: `Knowledge Node ${nodeId} frequently causes failures`,
          frequency: rescues.length,
          affectedMissionTypes: [],
          commonCulpritNodes: [nodeId],
          preventiveMeasures: [
            "Review knowledge node for errors",
            "Add validation before using this entity",
          ],
        });
      }
    }

    return patterns;
  },

  /**
   * Batch risk assessment for multiple missions
   */
  async batchAssess(missionIds: number[]): Promise<{
    missionId: number;
    assessment: MissionRiskAssessment;
    error?: string;
  }[]> {
    return Promise.all(
      missionIds.map(async (missionId) => {
        try {
          const assessment = await this.assessMissionRisk(missionId);
          return { missionId, assessment };
        } catch (error: any) {
          return {
            missionId,
            assessment: null as any,
            error: error.message,
          };
        }
      })
    );
  },

  /**
   * Get high-risk missions that need attention
   */
  async getHighRiskMissions(organizationId: number): Promise<{
    missionId: number;
    missionName: string;
    riskLevel: string;
    riskScore: number;
    topFactors: string[];
  }[]> {
    // The organization is required rather than optional. Omitting it used to
    // fall through to `sql`true``, which returned every tenant's active
    // missions by name - and the route took the organization from ?orgId=, so
    // omitting that parameter was all it took.
    const orgFilter = eq(missions.organizationId, organizationId);

    // Get recent active missions (not drafts — those aren't at risk yet)
    const recentMissions = await db
      .select({
        id: missions.id,
        name: missions.name,
      })
      .from(missions)
      .where(and(orgFilter, eq(missions.status, "active")))
      .orderBy(desc(missions.createdAt))
      .limit(20);

    const assessed = await this.batchAssess(recentMissions.map((m) => m.id));

    // Build a name lookup for the assessed missions
    const nameById = new Map(recentMissions.map((m) => [m.id, m.name]));

    return assessed
      .filter((r): r is typeof r & { assessment: MissionRiskAssessment } => !r.error && r.assessment.riskLevel !== "low")
      .map((r) => ({
        missionId: r.missionId,
        missionName: nameById.get(r.missionId) || `Mission #${r.missionId}`,
        riskLevel: r.assessment.riskLevel,
        riskScore: r.assessment.overallRiskScore,
        topFactors: r.assessment.factors.slice(0, 2).map((f) => f.category),
      }));
  },
};

export default rescuePreventionService;
