import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('MarketplaceMonetizationService');

export interface SkillUsageRecord {
  skillId: string;
  organizationId: number;
  executionsCount: number;
  totalTokensUsed: number;
  estimatedCostUsd: number;
  lastExecutedAt: string;
}

export class MarketplaceMonetizationService {
  private usageMap = new Map<string, SkillUsageRecord>();

  /**
   * Meters a skill execution event for developer analytics and revenue distribution.
   */
  recordUsage(skillId: string, organizationId: number, tokensUsed: number = 500): SkillUsageRecord {
    const key = `${skillId}:${organizationId}`;
    let record = this.usageMap.get(key);

    if (!record) {
      record = {
        skillId,
        organizationId,
        executionsCount: 0,
        totalTokensUsed: 0,
        estimatedCostUsd: 0,
        lastExecutedAt: new Date().toISOString()
      };
    }

    record.executionsCount += 1;
    record.totalTokensUsed += tokensUsed;
    record.estimatedCostUsd = parseFloat((record.totalTokensUsed * 0.000002).toFixed(6));
    record.lastExecutedAt = new Date().toISOString();

    this.usageMap.set(key, record);
    logger.info(`[MonetizationMeter] Recorded usage for skill '${skillId}' (org #${organizationId}): ${record.executionsCount} executions, $${record.estimatedCostUsd} USD.`);

    return record;
  }

  /**
   * Retrieves usage analytics for a specific skill.
   */
  getSkillAnalytics(skillId: string): SkillUsageRecord[] {
    const results: SkillUsageRecord[] = [];
    for (const [key, record] of this.usageMap.entries()) {
      if (key.startsWith(`${skillId}:`)) {
        results.push(record);
      }
    }
    return results;
  }
}

export const marketplaceMonetizationService = new MarketplaceMonetizationService();
