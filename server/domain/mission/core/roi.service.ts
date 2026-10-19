import { db } from "@server/database_service.js";
import { missionShadowRuns, missionRuns } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { getModelRates } from "@server/config/roi-rates.js";

const logger = createLogger("ROIService");

export const roiService = {
  /**
   * Track the cost of a mission iteration (Shadow or Primary).
   */
  async recordIterationCost(
    runId: number, 
    modelId: string, 
    promptTokens: number, 
    completionTokens: number,
    isShadow: boolean = false
  ): Promise<void> {
    try {
      const rates = getModelRates(modelId);
      // Cost = (Tokens / 1M) * Rate
      const incrementalCost = (promptTokens / 1_000_000 * rates.prompt) + (completionTokens / 1_000_000 * rates.completion);
      
      const table = isShadow ? missionShadowRuns : missionRuns;
      
      await db.update(table)
        .set({
          // Use a float cast for precision in the DB increment
          costUsd: sql`${table.costUsd} + ${incrementalCost}`
        })
        .where(eq(table.id, runId));
        
      const runType = isShadow ? "Shadow" : "Primary";
      logger.info(`Recorded incremental cost $${incrementalCost.toFixed(6)} for ${runType} Run ${runId} [${modelId}]`);
    } catch (e) {
      logger.error(`Failed to record iteration cost for Run ${runId}: ${e}`);
    }
  },

  /**
   * Calculate ROI for a shadow run compared to its parent or a baseline.
   */
  async calculateROI(shadowId: number): Promise<{ roi: number; uplift: number; cost: number }> {
    const shadow = await db.query.missionShadowRuns.findFirst({
      where: eq(missionShadowRuns.id, shadowId)
    });

    if (!shadow || !shadow.evalScore) return { roi: 0, uplift: 0, cost: 0 };

    let parentScore = 0;
    if (shadow.derivedFromShadowId) {
      const parent = await db.query.missionShadowRuns.findFirst({
        where: eq(missionShadowRuns.id, shadow.derivedFromShadowId)
      });
      parentScore = parent?.evalScore || 0;
    }

    const uplift = shadow.evalScore - parentScore;
    const cost = parseFloat(shadow.costUsd || "0");
    
    // ROI = Uplift points per USD.
    // Normalized check: If cost is zero, ROI is infinity (capped at 100 for safety).
    const roi = cost > 0 ? (uplift / cost) : (uplift > 0 ? 100 : 0);

    return { roi, uplift, cost };
  },

  /**
   * Guardrail: Should we continue recursive optimization?
   */
  async shouldContinueRecursive(shadowId: number, targetROI = 20.0): Promise<{ proceed: boolean; reason: string }> {
    const { roi, uplift, cost } = await this.calculateROI(shadowId);

    if (uplift < 0) return { proceed: false, reason: "Negative progress (Regressed performance)" };
    if (uplift === 0 && cost > 0.05) return { proceed: false, reason: "Stagnant performance with high cost" };
    
    // If ROI is below target, we are reaching diminishing returns.
    if (roi < targetROI && cost > 0.10) {
      return { proceed: false, reason: `Dimishing returns (ROI: ${roi.toFixed(2)} < ${targetROI})` };
    }

    return { proceed: true, reason: "ROI is within viable range" };
  }
};
