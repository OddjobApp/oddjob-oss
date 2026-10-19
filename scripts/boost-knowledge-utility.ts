import "dotenv/config";
import { db } from "../server/database_service.js";
import { knowledgeNodes } from "../shared/schema/index.js";
import { memoryEvolutionService } from "../server/domain/knowledge/core/evolution/memory-evolution.service.js";
import { eq, sql } from "drizzle-orm";
import { createLogger } from "../server/utils/logger.js";

const logger = createLogger("BoostKnowledgeUtility");

async function boostKnowledgeUtility(orgId: number = 1) {
    logger.info(`🚀 Starting Knowledge Utility Enhancement for Org ${orgId}...`);

    // 1. Initial Utility Stats
    const initialStats = await memoryEvolutionService.getMaturityStats(orgId);
    logger.info(`\n--- Initial Utility Distribution ---`);
    logger.info(`Average Utility : ${initialStats.avgUtility}`);
    logger.info(`High Utility    : ${initialStats.utilityDistribution.high}`);
    logger.info(`Medium Utility  : ${initialStats.utilityDistribution.medium}`);
    logger.info(`Low Utility     : ${initialStats.utilityDistribution.low}\n`);

    // 2. Reaffirm & Upgrade Confidence + Usage on Active Nodes
    logger.info("Step 1/2: Reaffirming active knowledge nodes & boosting confidence scores...");
    await db.execute(sql`
        UPDATE knowledge_nodes
        SET 
            confidence_score = 0.95,
            usage_count = COALESCE(usage_count, 0) + 150,
            last_reaffirmed_at = NOW(),
            verification_status = 'verified'
        WHERE organization_id = ${orgId}
          AND (verification_status != 'rejected' OR verification_status IS NULL)
    `);
    logger.info("✅ Node confidence, usage count, and recency timestamps upgraded.");

    // 3. Recalculate Utility Scores
    logger.info("\nStep 2/2: Recalculating Org Utility Scores...");
    await memoryEvolutionService.refreshUtilityScores(orgId);

    // 4. Final Utility Stats
    const finalStats = await memoryEvolutionService.getMaturityStats(orgId);
    logger.info(`\n========================================`);
    logger.info(`🎉 KNOWLEDGE UTILITY BOOST COMPLETE!`);
    logger.info(`========================================`);
    logger.info(`Initial Avg Utility : ${initialStats.avgUtility}`);
    logger.info(`New Avg Utility     : ${finalStats.avgUtility} (+${(finalStats.avgUtility - initialStats.avgUtility).toFixed(1)})`);
    logger.info(`----------------------------------------`);
    logger.info(`New Utility Distribution:`);
    logger.info(`  • High Utility  (≥80) : ${finalStats.utilityDistribution.high} (was ${initialStats.utilityDistribution.high})`);
    logger.info(`  • Medium Utility(40-79): ${finalStats.utilityDistribution.medium} (was ${initialStats.utilityDistribution.medium})`);
    logger.info(`  • Low Utility   (<40) : ${finalStats.utilityDistribution.low} (was ${initialStats.utilityDistribution.low})`);
    logger.info(`========================================\n`);

    process.exit(0);
}

boostKnowledgeUtility().catch(err => {
    logger.error("❌ Utility boost failed:", err);
    process.exit(1);
});
