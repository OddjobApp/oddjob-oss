/**
 * Adaptive Learning System
 * 
 * Core service that implements continuous learning for Oddjob:
 * - Tracks component effectiveness
 * - Evolves prompts based on performance
 * - Clusters failures for prevention
 * - Builds organization-specific profiles
 */

import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { 
  componentUsageRecords,
  componentEffectivenessAggregates,
  promptVersions,
  promptPerformanceLogs,
  failureIncidents,
  failureClusters,
  preventionRules,
  orgLearningProfiles,
  orgPreferenceEvents,
  type InsertComponentUsage,
  type InsertPromptPerformanceLog,
  type InsertFailureIncident,
  type InsertOrgPreferenceEvent,
} from "@shared/schema/learning/index.js";
import { eq, and, desc, sql, gte, lte, inArray } from "drizzle-orm";

const logger = createLogger("AdaptiveLearning");

export class AdaptiveLearningService {
  
  // ========================================================================
  // COMPONENT TRACKING
  // ========================================================================
  
  /**
   * Records a component usage instance for learning.
   */
  async trackComponentUsage(
    data: InsertComponentUsage
  ): Promise<{ success: boolean; id?: number }> {
    try {
      const [record] = await db.insert(componentUsageRecords).values(data).returning({ id: componentUsageRecords.id });
      logger.info(`[Learning] Tracked ${data.componentName} usage for org ${data.organizationId}`);
      return { success: true, id: record.id };
    } catch (err: any) {
      logger.error("[Learning] Failed to track component usage:", err.message);
      return { success: false };
    }
  }
  
  /**
   * Updates component effectiveness after deployment/runtime feedback.
   */
  async updateComponentEffectiveness(
    recordId: number,
    updates: {
      deploymentSuccess?: boolean;
      runtimeErrors?: number;
      userEngagementScore?: number;
      effectivenessRating?: number;
    }
  ): Promise<void> {
    try {
      await db.update(componentUsageRecords)
        .set({
          ...updates,
          userEngagementScore: updates.userEngagementScore?.toString(),
          updatedAt: new Date(),
        } as any)
        .where(eq(componentUsageRecords.id, recordId));
    } catch (err: any) {
      logger.error("[Learning] Failed to update component effectiveness:", err.message);
    }
  }
  
  /**
   * Gets the most effective components for a given context.
   */
  async getTopComponents(
    organizationId: number,
    category?: string,
    limit: number = 10
  ): Promise<Array<{ componentName: string; category: string; avgRating: number; usageCount: number }>> {
    try {
      // Use pre-computed aggregates if available
      const aggregates = await db.query.componentEffectivenessAggregates.findMany({
        where: and(
          eq(componentEffectivenessAggregates.organizationId, organizationId),
          category ? eq(componentEffectivenessAggregates.componentCategory, category) : undefined
        ),
        orderBy: desc(componentEffectivenessAggregates.averageEffectivenessRating),
        limit,
      });
      
      if (aggregates.length > 0) {
        return aggregates.map(a => ({
          componentName: a.componentName,
          category: a.componentCategory,
          avgRating: Number(a.averageEffectivenessRating) || 0,
          usageCount: a.totalUsages || 0,
        }));
      }
      
      // Fallback: compute from raw records
      const results = await db.select({
        componentName: componentUsageRecords.componentName,
        category: componentUsageRecords.componentCategory,
        avgRating: sql<number>`avg(${componentUsageRecords.effectivenessRating})`,
        usageCount: sql<number>`count(*)`,
      })
      .from(componentUsageRecords)
      .where(eq(componentUsageRecords.organizationId, organizationId))
      .groupBy(componentUsageRecords.componentName, componentUsageRecords.componentCategory)
      .orderBy(desc(sql`avg(${componentUsageRecords.effectivenessRating})`))
      .limit(limit);
      
      return results;
    } catch (err: any) {
      logger.error("[Learning] Failed to get top components:", err.message);
      return [];
    }
  }
  
  /**
   * Suggests component pairings that work well together.
   */
  async getSuggestedPairings(
    organizationId: number,
    componentName: string
  ): Promise<string[]> {
    try {
      const aggregate = await db.query.componentEffectivenessAggregates.findFirst({
        where: and(
          eq(componentEffectivenessAggregates.organizationId, organizationId),
          eq(componentEffectivenessAggregates.componentName, componentName)
        ),
      });

      const precomputed = (aggregate?.commonPairings as string[] | undefined) ?? [];
      if (precomputed.length > 0) return precomputed;

      // Nothing writes componentEffectivenessAggregates yet, so consulting only
      // that table made this endpoint return [] even when usage records existed.
      // Derive pairings from the raw records instead.
      const rows = await db
        .select({ usedWith: componentUsageRecords.usedWithComponents })
        .from(componentUsageRecords)
        .where(and(
          eq(componentUsageRecords.organizationId, organizationId),
          eq(componentUsageRecords.componentName, componentName)
        ));

      const counts = new Map<string, number>();
      for (const row of rows) {
        // Count each partner once per usage record, so one file that repeats a
        // component many times cannot dominate the ranking.
        for (const partner of new Set((row.usedWith as string[] | null) ?? [])) {
          if (!partner || partner === componentName) continue;
          counts.set(partner, (counts.get(partner) ?? 0) + 1);
        }
      }

      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name]) => name);
    } catch (err: any) {
      logger.error("[Learning] Failed to get suggested pairings:", err.message);
      return [];
    }
  }
  
  // ========================================================================
  // PROMPT EVOLUTION
  // ========================================================================
  
  /**
   * Records a prompt usage for performance tracking.
   */
  async logPromptPerformance(
    data: InsertPromptPerformanceLog
  ): Promise<void> {
    try {
      await db.insert(promptPerformanceLogs).values(data);
      
      // Update the prompt version's aggregate stats
      await this.updatePromptVersionStats(data.promptVersionId);
    } catch (err: any) {
      logger.error("[Learning] Failed to log prompt performance:", err.message);
    }
  }
  
  /**
   * Updates aggregate statistics for a prompt version.
   */
  private async updatePromptVersionStats(promptVersionId: number): Promise<void> {
    try {
      // Calculate aggregates from performance logs
      const stats = await db.select({
        totalUses: sql<number>`count(*)`,
        successCount: sql<number>`sum(case when ${promptPerformanceLogs.success} then 1 else 0 end)`,
        avgTokens: sql<number>`avg(${promptPerformanceLogs.tokensUsed})`,
        avgCost: sql<number>`avg(${promptPerformanceLogs.costUsd})`,
        avgQuality: sql<number>`avg(${promptPerformanceLogs.outputQualityScore})`,
      })
      .from(promptPerformanceLogs)
      .where(eq(promptPerformanceLogs.promptVersionId, promptVersionId));
      
      const s = stats[0];
      if (!s) return;
      
      const successRate = s.totalUses > 0 ? (s.successCount / s.totalUses) * 100 : 0;
      
      // Calculate fitness score (weighted combination of metrics)
      const fitnessScore = this.calculateFitnessScore({
        successRate,
        avgQuality: s.avgQuality || 0,
        avgCost: s.avgCost || 0,
      });
      
      await db.update(promptVersions)
        .set({
          usageCount: s.totalUses,
          successRate: String(successRate),
          averageTokensUsed: String(s.avgTokens || 0),
          averageCostUsd: String(s.avgCost || 0),
          fitnessScore: String(fitnessScore),
          updatedAt: new Date(),
        })
        .where(eq(promptVersions.id, promptVersionId));
        
    } catch (err: any) {
      logger.error("[Learning] Failed to update prompt version stats:", err.message);
    }
  }
  
  /**
   * Calculates a fitness score for prompt selection.
   */
  private calculateFitnessScore(metrics: {
    successRate: number;
    avgQuality: number;
    avgCost: number;
  }): number {
    // Weighted scoring: success (50%), quality (30%), cost efficiency (20%)
    const successScore = metrics.successRate * 0.5;
    const qualityScore = (metrics.avgQuality / 100) * 100 * 0.3;
    const costScore = Math.max(0, (1 - metrics.avgCost / 0.5)) * 100 * 0.2; // Assume $0.50 is max expected
    
    return successScore + qualityScore + costScore;
  }
  
  /**
   * Selects the best prompt version for a given type.
   * Uses weighted random selection based on fitness scores.
   */
  async selectPromptVersion(
    organizationId: number,
    promptType: string,
    allowExperimental: boolean = false
  ): Promise<{ id: number; versionId: string; prompt: string } | null> {
    try {
      const versions = await db.query.promptVersions.findMany({
        where: and(
          eq(promptVersions.organizationId, organizationId),
          eq(promptVersions.promptType, promptType),
          eq(promptVersions.status, allowExperimental ? "experimental" : "active")
        ),
      });
      
      if (versions.length === 0) return null;
      
      // Calculate selection probabilities
      const totalFitness = versions.reduce((sum, v) => sum + (Number(v.fitnessScore) || 0), 0);
      
      if (totalFitness === 0) {
        // Equal probability if no fitness data
        const randomVersion = versions[Math.floor(Math.random() * versions.length)];
        return { id: randomVersion.id, versionId: randomVersion.versionId, prompt: randomVersion.systemPrompt };
      }
      
      // Weighted random selection
      let random = Math.random() * totalFitness;
      for (const version of versions) {
        random -= Number(version.fitnessScore) || 0;
        if (random <= 0) {
          return { id: version.id, versionId: version.versionId, prompt: version.systemPrompt };
        }
      }
      
      return { id: versions[0].id, versionId: versions[0].versionId, prompt: versions[0].systemPrompt };
    } catch (err: any) {
      logger.error("[Learning] Failed to select prompt version:", err.message);
      return null;
    }
  }
  
  /**
   * Creates a new prompt variant by mutating an existing one.
   */
  async evolvePrompt(
    organizationId: number,
    promptType: string,
    parentVersionId: string,
    mutationStrategy: string,
    mutatedPrompt: string,
    mutationDescription: string
  ): Promise<{ success: boolean; newVersionId?: string }> {
    try {
      const newVersionId = `v_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      await db.insert(promptVersions).values({
        organizationId,
        promptType,
        versionId: newVersionId,
        parentVersionId,
        systemPrompt: mutatedPrompt,
        generationMethod: "llm-mutated",
        mutationDescription,
        status: "experimental",
        usageCount: 0,
        createdBy: "evolution-engine",
      } as any);
      
      logger.info(`[Learning] Evolved new prompt version ${newVersionId} from ${parentVersionId}`);
      return { success: true, newVersionId };
    } catch (err: any) {
      logger.error("[Learning] Failed to evolve prompt:", err.message);
      return { success: false };
    }
  }
  
  // ========================================================================
  // FAILURE CLUSTERING
  // ========================================================================
  
  /**
   * Records a failure incident for clustering and analysis.
   */
  async recordFailure(
    data: InsertFailureIncident
  ): Promise<{ success: boolean; clusterId?: number; isNewPattern?: boolean }> {
    try {
      // Generate incident hash for deduplication
      const incidentHash = this.generateIncidentHash(data);
      
      // Check for existing incident
      const existing = await db.query.failureIncidents.findFirst({
        where: and(
          eq(failureIncidents.organizationId, data.organizationId),
          eq(failureIncidents.incidentHash, incidentHash)
        ),
      });
      
      if (existing) {
        // Duplicate incident - update existing
        return { success: true, clusterId: existing.clusterId || undefined, isNewPattern: false };
      }
      
      // Try to match to existing cluster
      let clusterId = await this.findMatchingCluster(data);
      let isNewPattern = false;
      
      if (!clusterId) {
        // Create new cluster
        clusterId = await this.createFailureCluster(data);
        isNewPattern = true;
      } else {
        // Update existing cluster stats
        await this.updateClusterStats(clusterId);
      }
      
      // Record the incident
      await db.insert(failureIncidents).values({
        ...data,
        incidentHash,
        clusterId,
      } as any);
      
      return { success: true, clusterId, isNewPattern };
    } catch (err: any) {
      logger.error("[Learning] Failed to record failure:", err.message);
      return { success: false };
    }
  }
  
  /**
   * Generates a hash for incident deduplication.
   */
  private generateIncidentHash(data: InsertFailureIncident): string {
    const hashInput = `${data.domain}:${data.subcategory}:${data.errorMessage?.substring(0, 100)}:${data.componentName}:${data.filePath}`;
    // Simple hash - in production use crypto.createHash
    return hashInput.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0).toString(36);
  }
  
  /**
   * Finds an existing cluster that matches the failure pattern.
   */
  private async findMatchingCluster(data: InsertFailureIncident): Promise<number | null> {
    try {
      // Look for clusters in same domain with similar characteristics
      const clusters = await db.query.failureClusters.findMany({
        where: and(
          eq(failureClusters.organizationId, data.organizationId),
          eq(failureClusters.domain, data.domain),
          eq(failureClusters.status, "active")
        ),
        limit: 10,
      });
      
      // Simple matching: same subcategory or component
      for (const cluster of clusters) {
        const contributing = cluster.contributingFactors as string[] || [];
        if (
          contributing.includes(data.subcategory || '') ||
          contributing.includes(data.componentName || '')
        ) {
          return cluster.id;
        }
      }
      
      return null;
    } catch (err: any) {
      logger.error("[Learning] Failed to find matching cluster:", err.message);
      return null;
    }
  }
  
  /**
   * Creates a new failure cluster.
   */
  private async createFailureCluster(data: InsertFailureIncident): Promise<number> {
    const signature = this.generateIncidentHash(data);
    
    const [cluster] = await db.insert(failureClusters).values({
      organizationId: data.organizationId,
      clusterSignature: signature,
      name: `${data.domain} - ${data.subcategory || 'Unknown'}`,
      description: `Auto-generated cluster for ${data.domain} failures`,
      severity: data.severity,
      domain: data.domain,
      incidentCount: 1,
      contributingFactors: [data.subcategory, data.componentName].filter(Boolean),
      status: "active",
      confidenceScore: "50", // Low confidence initially
    } as any).returning({ id: failureClusters.id });
    
    logger.info(`[Learning] Created new failure cluster ${cluster.id} for ${data.domain}`);
    return cluster.id;
  }
  
  /**
   * Updates cluster statistics after a new incident.
   */
  private async updateClusterStats(clusterId: number): Promise<void> {
    try {
      const count = await db.select({ count: sql<number>`count(*)` })
        .from(failureIncidents)
        .where(eq(failureIncidents.clusterId, clusterId));
      
      await db.update(failureClusters)
        .set({
          incidentCount: count[0]?.count || 0,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(failureClusters.id, clusterId));
    } catch (err: any) {
      logger.error("[Learning] Failed to update cluster stats:", err.message);
    }
  }
  
  /**
   * Gets active prevention rules for a context.
   */
  async getActivePreventionRules(
    organizationId: number,
    domain?: string,
    componentName?: string
  ): Promise<Array<{ id: number; ruleType: string; matchesPattern: string | null; actionConfig: any }>> {
    try {
      const rules = await db.query.preventionRules.findMany({
        where: and(
          eq(preventionRules.organizationId, organizationId),
          eq(preventionRules.isActive, true),
          domain ? eq(preventionRules.matchesDomain, domain) : undefined
        ),
      });
      
      return rules.map(r => ({
        id: r.id,
        ruleType: r.ruleType,
        matchesPattern: r.matchesPattern,
        actionConfig: r.actionConfig,
      }));
    } catch (err: any) {
      logger.error("[Learning] Failed to get prevention rules:", err.message);
      return [];
    }
  }
  
  // ========================================================================
  // ORGANIZATION PROFILES
  // ========================================================================
  
  /**
   * Gets or creates an organization's learning profile.
   */
  async getOrgProfile(organizationId: number): Promise<typeof orgLearningProfiles.$inferSelect | null> {
    try {
      let profile = await db.query.orgLearningProfiles.findFirst({
        where: eq(orgLearningProfiles.organizationId, organizationId),
      });
      
      if (!profile) {
        // Create default profile
        const [newProfile] = await db.insert(orgLearningProfiles).values({
          organizationId,
          learningEnabled: true,
        } as any).returning();
        
        profile = newProfile;
      }
      
      return profile;
    } catch (err: any) {
      logger.error("[Learning] Failed to get org profile:", err.message);
      return null;
    }
  }
  
  /**
   * Records a preference learning event.
   */
  async recordPreferenceEvent(data: InsertOrgPreferenceEvent): Promise<void> {
    try {
      await db.insert(orgPreferenceEvents).values(data);
      
      // Trigger profile recalculation if significant
      if (data.isUserOverride || (data.evidenceCount || 0) > 5) {
        await this.recalculateOrgProfile(data.organizationId);
      }
    } catch (err: any) {
      logger.error("[Learning] Failed to record preference event:", err.message);
    }
  }
  
  /**
   * Recalculates an organization's learning profile from accumulated data.
   */
  async recalculateOrgProfile(organizationId: number): Promise<void> {
    try {
      logger.info(`[Learning] Recalculating profile for org ${organizationId}`);
      
      // Get top components
      const topComponents = await this.getTopComponents(organizationId, undefined, 10);
      
      // Get recent failures
      const recentFailures = await db.query.failureClusters.findMany({
        where: and(
          eq(failureClusters.organizationId, organizationId),
          gte(failureClusters.lastSeenAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        ),
        orderBy: desc(failureClusters.incidentCount),
        limit: 10,
      });
      
      // Get communication preferences
      const commEvents = await db.query.orgPreferenceEvents.findMany({
        where: and(
          eq(orgPreferenceEvents.organizationId, organizationId),
          eq(orgPreferenceEvents.category, "communication")
        ),
        orderBy: desc(orgPreferenceEvents.confidence),
        limit: 1,
      });
      
      // Update profile
      await db.update(orgLearningProfiles)
        .set({
          topPerformingComponents: topComponents.map(c => c.componentName),
          recurringIssues: recentFailures.map(f => f.name),
          communicationStyle: (commEvents[0]?.value as any) || "balanced",
          lastAnalyzedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(orgLearningProfiles.organizationId, organizationId));
        
    } catch (err: any) {
      logger.error("[Learning] Failed to recalculate org profile:", err.message);
    }
  }
  
  /**
   * Gets personalized context for an organization.
   */
  async getPersonalizedContext(organizationId: number): Promise<{
    preferredComponents: string[];
    avoidedPatterns: string[];
    communicationStyle: string;
    customPromptAdditions?: string;
  }> {
    const profile = await this.getOrgProfile(organizationId);
    
    if (!profile || !profile.learningEnabled) {
      return {
        preferredComponents: [],
        avoidedPatterns: [],
        communicationStyle: "balanced",
      };
    }
    
    return {
      preferredComponents: (profile.topPerformingComponents as string[]) || [],
      avoidedPatterns: (profile.avoidedPatterns as string[]) || [],
      communicationStyle: profile.communicationStyle || "balanced",
      customPromptAdditions: profile.customSystemPromptAdditions || undefined,
    };
  }
}

// Singleton instance
export const adaptiveLearningService = new AdaptiveLearningService();
