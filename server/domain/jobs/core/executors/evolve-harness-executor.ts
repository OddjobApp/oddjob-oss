import { Job, JobExecutor, StepExecutionResult, VariableContext } from "./executor-types.js";
import { HarnessRegistryService } from "@server/domain/self-improvement/harness-registry.service.js";
import { evolutionService } from "@server/domain/evolution/core/evolution.service.js";
import { db } from "@server/database_service.js";
import { evaluationResults, harnessProposals } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("EvolveHarnessExecutor");

export class EvolveHarnessExecutor implements JobExecutor {
  canExecute(jobType: string): boolean {
    return jobType === "evolve_harness";
  }

  async execute(
    job: Job,
    resolvedConfig: any,
    pipeline: any,
    context: VariableContext
  ): Promise<StepExecutionResult> {
    const { harnessId, newHarnessVersion, acceptedProposals } = resolvedConfig;

    if (!harnessId || !newHarnessVersion) {
      return { success: false, output: "", status: "failure", error: "harnessId and newHarnessVersion are required" };
    }

    // An A/B comparison built from other tenants' runs is not a comparison.
    const organizationId = job.organizationId;
    if (!Number.isInteger(organizationId) || (organizationId as number) <= 0) {
      return {
        success: false,
        output: "",
        status: "failure",
        error: "evolve_harness requires an organization-scoped job; refusing to evaluate against unscoped harness telemetry.",
      };
    }

    logger.info(`Starting harness evolution for ${harnessId} to version ${newHarnessVersion}`);

    try {
      // 1. Retrieve evaluation results for the new harness version
      const newVersionResults = await db.select().from(evaluationResults)
        .where(and(
          eq(evaluationResults.organizationId, organizationId as number),
          eq(evaluationResults.harnessId, harnessId),
          eq(evaluationResults.harnessVersion, newHarnessVersion)
        ));

      if (newVersionResults.length === 0) {
        logger.warn(`No evaluation results found for ${harnessId}@${newHarnessVersion}. Skipping A/B testing.`);
        return { success: true, output: "No evaluation data available for A/B testing. Evolution skipped.", status: "success" };
      }

      // 2. Retrieve evaluation results for the parent version (baseline)
      const parentVersion = acceptedProposals[0]?.parentHarnessVersion;
      let parentResults: typeof evaluationResults.$inferSelect[] = [];
      
      if (parentVersion) {
        parentResults = await db.select().from(evaluationResults)
          .where(and(
            eq(evaluationResults.organizationId, organizationId as number),
            eq(evaluationResults.harnessId, harnessId),
            eq(evaluationResults.harnessVersion, parentVersion)
          ));
      }

      // 3. Calculate metrics for comparison
      const newMetrics = this.aggregateMetrics(newVersionResults);
      const parentMetrics = parentResults.length > 0 ? this.aggregateMetrics(parentResults) : null;

      // 4. Determine if evolution improved performance
      const improvement = this.calculateImprovement(newMetrics, parentMetrics);

      logger.info(`Evolution analysis for ${harnessId}:`, {
        newMetrics,
        parentMetrics,
        improvement,
      });

      // 5. Update proposal metadata with evolutionary learning data
      if (acceptedProposals.length > 0) {
        for (const proposal of acceptedProposals) {
          await db.update(harnessProposals)
            .set({
              validationResults: {
                ...(proposal.validationResults as any || {}),
                evolutionaryMetrics: {
                  improvement,
                  newMetrics,
                  parentMetrics,
                  evolutionTimestamp: new Date().toISOString(),
                },
              },
            })
            .where(and(
              eq(harnessProposals.id, proposal.id),
              eq(harnessProposals.organizationId, organizationId as number),
            ));
        }
      }

      // 6. Trigger broader evolution service if significant improvement detected
      if (improvement.overallImprovement > 0.1) { // 10% improvement threshold
        logger.info(`Significant improvement detected (${(improvement.overallImprovement * 100).toFixed(1)}%). Triggering system-wide evolution sync.`);
        // This would trigger the EvolutionService to consider this harness as a candidate for broader learning
        // For now, we log it - actual integration would depend on organization context
      }

      return {
        success: true,
        output: `Harness evolution complete for ${harnessId}@${newHarnessVersion}. Overall improvement: ${(improvement.overallImprovement * 100).toFixed(1)}%.`,
        status: "success",
      };

    } catch (error: any) {
      logger.error(`Evolution failed for ${harnessId}:`, error);
      return {
        success: false,
        output: "",
        status: "failure",
        error: `Evolution failed: ${error.message}`,
      };
    }
  }

  private aggregateMetrics(results: typeof evaluationResults.$inferSelect[]): any {
    if (results.length === 0) return { success_rate: 0, avg_latency_ms: 0 };

    const successCount = results.filter(r => r.status === 'pass').length;
    const successRate = successCount / results.length;

    const latencyValues = results
      .map(r => r.metrics?.latency_ms)
      .filter((l): l is number => l !== undefined && l !== null);
    const avgLatency = latencyValues.length > 0 
      ? latencyValues.reduce((sum, l) => sum + l, 0) / latencyValues.length 
      : 0;

    return {
      success_rate: successRate,
      avg_latency_ms: avgLatency,
      total_runs: results.length,
    };
  }

  private calculateImprovement(newMetrics: any, parentMetrics: any | null): any {
    if (!parentMetrics) {
      return { overallImprovement: 0, details: "No baseline for comparison" };
    }

    const successRateImprovement = (newMetrics.success_rate - parentMetrics.success_rate) / parentMetrics.success_rate;
    const latencyImprovement = parentMetrics.avg_latency_ms > 0
      ? (parentMetrics.avg_latency_ms - newMetrics.avg_latency_ms) / parentMetrics.avg_latency_ms
      : 0;

    // Weighted average: success rate (70%), latency (30%)
    const overallImprovement = (successRateImprovement * 0.7) + (latencyImprovement * 0.3);

    return {
      overallImprovement,
      successRateImprovement,
      latencyImprovement,
      details: {
        successRate: `${(successRateImprovement * 100).toFixed(1)}%`,
        latency: `${(latencyImprovement * 100).toFixed(1)}%`,
      },
    };
  }
}
