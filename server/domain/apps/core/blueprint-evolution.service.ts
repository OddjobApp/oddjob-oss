/**
 * BlueprintEvolutionService
 * 
 * Self-improving blueprints that learn from usage patterns and adapt.
 * Tracks blueprint performance, collects feedback, and suggests improvements.
 */
import { db } from "@server/database_service.js";
import { apps, appAuditLogs } from "@shared/schema/index.js";
import { eq, desc, sql, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { agentCoordinator } from "@domain/agents/core/agent-coordinator.service.js";

const logger = createLogger("BlueprintEvolutionService");

export interface BlueprintMetrics {
  blueprintId: string;
  totalAppsCreated: number;
  successRate: number;
  averageBuildTime: number;
  userSatisfaction: number;
  commonIssues: IssuePattern[];
  topFeatures: string[];
}

export interface IssuePattern {
  type: string;
  frequency: number;
  severity: "low" | "medium" | "high";
  affectedFiles: string[];
}

export interface EvolutionSuggestion {
  blueprintId: string;
  type: "performance" | "reliability" | "usability" | "feature";
  priority: "low" | "medium" | "high";
  description: string;
  recommendedChanges: CodeChange[];
  expectedImpact: {
    buildTimeReduction?: number;
    errorRateReduction?: number;
    satisfactionIncrease?: number;
  };
  confidence: number;
}

export interface CodeChange {
  filePath: string;
  operation: "add" | "modify" | "remove";
  description: string;
  snippet?: string;
}

export interface BlueprintGeneration {
  id: string;
  blueprintId: string;
  generationNumber: number;
  parentGenerationId?: string;
  changes: CodeChange[];
  metrics: BlueprintMetrics;
  approved: boolean;
  createdAt: number;
}

export class BlueprintEvolutionService {
  private generations: Map<string, BlueprintGeneration[]> = new Map();

  /**
   * Collect metrics for a blueprint
   */
  async collectMetrics(blueprintId: string): Promise<BlueprintMetrics> {
    // Get all apps created from this blueprint
    const appsList = await db
      .select()
      .from(apps)
      .where(eq(apps.blueprintSlug, blueprintId));

    // Get audit logs for these apps
    const auditLogs = await db
      .select()
      .from(appAuditLogs)
      .where(appsList.length > 0 ? inArray(appAuditLogs.appId, appsList.map(a => a.id)) : sql`FALSE`);

    // Calculate success rate
    const successfulApps = appsList.filter(a => a.status === "active").length;
    const successRate = appsList.length > 0 ? successfulApps / appsList.length : 1;

    // Analyze issues
    const issuePatterns = this.analyzeIssues(auditLogs);

    // Calculate average build time from runtime metadata
    const buildTimes = appsList
      .map(a => {
        const meta = a.runtimeMetadata as any;
        return meta?.lastBuildDuration || 0;
      })
      .filter(t => t > 0);

    const averageBuildTime = buildTimes.length > 0
      ? buildTimes.reduce((a, b) => a + b, 0) / buildTimes.length
      : 0;

    const metrics: BlueprintMetrics = {
      blueprintId,
      totalAppsCreated: appsList.length,
      successRate,
      averageBuildTime,
      userSatisfaction: this.calculateSatisfaction(appsList, auditLogs),
      commonIssues: issuePatterns,
      topFeatures: this.extractTopFeatures(appsList)
    };

    logger.info(`[BlueprintEvolution] Collected metrics for ${blueprintId}: ${metrics.totalAppsCreated} apps, ${(metrics.successRate * 100).toFixed(1)}% success`);

    return metrics;
  }

  /**
   * Generate evolution suggestions based on metrics
   */
  async generateSuggestions(blueprintId: string): Promise<EvolutionSuggestion[]> {
    const metrics = await this.collectMetrics(blueprintId);
    const suggestions: EvolutionSuggestion[] = [];

    // Performance optimization suggestion
    if (metrics.averageBuildTime > 120000) { // > 2 minutes
      suggestions.push({
        blueprintId,
        type: "performance",
        priority: "high",
        description: `Build time averaging ${(metrics.averageBuildTime / 1000).toFixed(0)}s. Consider optimizing dependencies and build steps.`,
        recommendedChanges: [
          {
            filePath: "Dockerfile",
            operation: "modify",
            description: "Add multi-stage build to reduce image size",
            snippet: "FROM node:18-alpine AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --only=production"
          },
          {
            filePath: "next.config.js",
            operation: "modify",
            description: "Enable production optimizations",
            snippet: "module.exports = {\n  swcMinify: true,\n  experimental: {\n    optimizeCss: true\n  }\n}"
          }
        ],
        expectedImpact: {
          buildTimeReduction: 0.3
        },
        confidence: 0.85
      });
    }

    // Reliability improvement suggestion
    if (metrics.successRate < 0.9) {
      const criticalIssues = metrics.commonIssues.filter(i => i.severity === "high");
      
      suggestions.push({
        blueprintId,
        type: "reliability",
        priority: "high",
        description: `Success rate at ${(metrics.successRate * 100).toFixed(1)}%. Addressing ${criticalIssues.length} critical issues could improve stability.`,
        recommendedChanges: criticalIssues.flatMap(issue => 
          issue.affectedFiles.map(file => ({
            filePath: file,
            operation: "modify" as const,
            description: `Fix ${issue.type} pattern affecting this file`,
            snippet: `// TODO: Address ${issue.type} - ${issue.frequency} occurrences`
          }))
        ),
        expectedImpact: {
          errorRateReduction: 0.5
        },
        confidence: 0.75
      });
    }

    // Usability enhancement suggestion
    if (metrics.userSatisfaction < 4.0) {
      suggestions.push({
        blueprintId,
        type: "usability",
        priority: "medium",
        description: `User satisfaction at ${metrics.userSatisfaction.toFixed(1)}/5. Consider UI/UX improvements.`,
        recommendedChanges: [
          {
            filePath: "components/ErrorBoundary.tsx",
            operation: "add",
            description: "Add error boundary for better user experience",
            snippet: "class ErrorBoundary extends React.Component {\n  // ... error handling implementation\n}"
          }
        ],
        expectedImpact: {
          satisfactionIncrease: 0.5
        },
        confidence: 0.7
      });
    }

    // Feature enhancement based on usage patterns
    if (metrics.topFeatures.length > 0) {
      suggestions.push({
        blueprintId,
        type: "feature",
        priority: "low",
        description: `Most used features: ${metrics.topFeatures.slice(0, 3).join(", ")}. Consider enhancing these capabilities.`,
        recommendedChanges: metrics.topFeatures.slice(0, 2).map(feature => ({
          filePath: `features/${feature}.tsx`,
          operation: "modify" as const,
          description: `Enhance ${feature} with additional capabilities`,
          snippet: `// Enhanced ${feature} implementation`
        })),
        expectedImpact: {
          satisfactionIncrease: 0.3
        },
        confidence: 0.6
      });
    }

    logger.info(`[BlueprintEvolution] Generated ${suggestions.length} suggestions for ${blueprintId}`);

    // Emit event for real-time monitoring
    await eventStream.publish(`blueprint.suggestions`, {
      blueprintId,
      suggestionCount: suggestions.length,
      timestamp: Date.now()
    });

    return suggestions;
  }

  /**
   * Create a new generation of a blueprint
   */
  async evolveBlueprint(
    blueprintId: string,
    suggestion: EvolutionSuggestion,
    author: string
  ): Promise<BlueprintGeneration> {
    // Get current generation number
    const generations = this.generations.get(blueprintId) || [];
    const nextGen = generations.length + 1;

    // Create generation record
    const generation: BlueprintGeneration = {
      id: `gen-${blueprintId}-${Date.now()}`,
      blueprintId,
      generationNumber: nextGen,
      parentGenerationId: generations[generations.length - 1]?.id,
      changes: suggestion.recommendedChanges,
      metrics: await this.collectMetrics(blueprintId),
      approved: false,
      createdAt: Date.now()
    };

    generations.push(generation);
    this.generations.set(blueprintId, generations);

    logger.info(`[BlueprintEvolution] Created generation ${nextGen} for ${blueprintId}`);

    // Submit evolution task to agent coordinator
    await agentCoordinator.submitTask(
      "write_code",
      {
        type: "blueprint_evolution",
        blueprintId,
        generationId: generation.id,
        changes: suggestion.recommendedChanges,
        author
      },
      suggestion.priority === "high" ? "high" : "medium"
    );

    await eventStream.publish(`blueprint.evolved`, {
      blueprintId,
      generationId: generation.id,
      generationNumber: nextGen,
      type: suggestion.type,
      timestamp: Date.now()
    });

    return generation;
  }

  /**
   * Approve or reject a blueprint generation
   */
  async approveGeneration(generationId: string, approved: boolean): Promise<void> {
    // Find generation
    for (const [blueprintId, generations] of this.generations) {
      const gen = generations.find(g => g.id === generationId);
      if (gen) {
        gen.approved = approved;
        
        logger.info(`[BlueprintEvolution] Generation ${generationId} ${approved ? "approved" : "rejected"}`);

        await eventStream.publish(`blueprint.generation.${approved ? "approved" : "rejected"}`, {
          blueprintId,
          generationId,
          timestamp: Date.now()
        });
        return;
      }
    }

    throw new Error(`Generation ${generationId} not found`);
  }

  /**
   * Get evolution history for a blueprint
   */
  getEvolutionHistory(blueprintId: string): BlueprintGeneration[] {
    return this.generations.get(blueprintId) || [];
  }

  /**
   * Get the latest approved generation
   */
  getLatestApprovedGeneration(blueprintId: string): BlueprintGeneration | null {
    const generations = this.generations.get(blueprintId) || [];
    return generations.reverse().find(g => g.approved) || null;
  }

  /**
   * Compare blueprint performance across generations
   */
  async compareGenerations(
    blueprintId: string,
    gen1Id: string,
    gen2Id: string
  ): Promise<{ gen1: BlueprintMetrics; gen2: BlueprintMetrics; improvement: number }> {
    const generations = this.generations.get(blueprintId) || [];
    const gen1 = generations.find(g => g.id === gen1Id);
    const gen2 = generations.find(g => g.id === gen2Id);

    if (!gen1 || !gen2) {
      throw new Error("Generation not found");
    }

    const improvement = this.calculateImprovement(gen1.metrics, gen2.metrics);

    return {
      gen1: gen1.metrics,
      gen2: gen2.metrics,
      improvement
    };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private analyzeIssues(auditLogs: any[]): IssuePattern[] {
    const issueCounts = new Map<string, { count: number; files: Set<string> }>();

    for (const log of auditLogs) {
      const type = log.findingType || "unknown";
      const key = `${type}-${log.severity}`;
      
      if (!issueCounts.has(key)) {
        issueCounts.set(key, { count: 0, files: new Set() });
      }
      
      const entry = issueCounts.get(key)!;
      entry.count++;
      
      // Extract affected files from trace if available
      const trace = log.qaTrace as any;
      if (trace?.file) {
        entry.files.add(trace.file);
      }
    }

    return Array.from(issueCounts.entries())
      .map(([key, data]) => {
        const [type, severity] = key.split("-");
        return {
          type,
          frequency: data.count,
          severity: severity as "low" | "medium" | "high",
          affectedFiles: Array.from(data.files)
        };
      })
      .sort((a, b) => b.frequency - a.frequency);
  }

  private calculateSatisfaction(appsList: any[], auditLogs: any[]): number {
    // Simple satisfaction calculation based on success rate and issue count
    const baseScore = 5;
    const issuePenalty = auditLogs.filter(l => l.severity === "high").length * 0.5;
    const successBonus = (appsList.filter(a => a.status === "active").length / Math.max(appsList.length, 1)) * 2;
    
    return Math.max(1, Math.min(5, baseScore - issuePenalty + successBonus));
  }

  private extractTopFeatures(appsList: any[]): string[] {
    // Extract commonly used features from app metadata
    const featureCounts = new Map<string, number>();

    for (const app of appsList) {
      const meta = app.runtimeMetadata as any;
      const features = meta?.usedFeatures || [];
      
      for (const feature of features) {
        featureCounts.set(feature, (featureCounts.get(feature) || 0) + 1);
      }
    }

    return Array.from(featureCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([feature]) => feature);
  }

  private calculateImprovement(oldMetrics: BlueprintMetrics, newMetrics: BlueprintMetrics): number {
    const successRateImprovement = (newMetrics.successRate - oldMetrics.successRate) * 100;
    const buildTimeImprovement = oldMetrics.averageBuildTime > 0
      ? (oldMetrics.averageBuildTime - newMetrics.averageBuildTime) / oldMetrics.averageBuildTime * 100
      : 0;
    const satisfactionImprovement = (newMetrics.userSatisfaction - oldMetrics.userSatisfaction) * 20;

    // Weighted average
    return (successRateImprovement * 0.4 + buildTimeImprovement * 0.3 + satisfactionImprovement * 0.3);
  }
}

// Export singleton
export const blueprintEvolutionService = new BlueprintEvolutionService();
