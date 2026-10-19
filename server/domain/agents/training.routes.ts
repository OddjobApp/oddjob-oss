import { Router } from "express";
import { db } from "../../database_service.js";
import { fineTuningDatasets, fineTuningExamples, fineTuningPreferences, routingTelemetry } from "@shared/schema/training.js";
import { studentTrainingService } from "./core/training.service.js";
import { redTeamService } from "./core/red-team.service.js";
import { eq, sql, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { requireOrgAdminOrSuper } from "@server/utils/auth-context.js";

const router = Router();
const logger = createLogger("TrainingRoutes");

router.use(requireAuth);

/**
 * GET /api/training/routing-stats
 * Returns cumulative statistics and recent timeline for agent model routing.
 */
router.get("/routing-stats", async (req, res) => {
    try {
        const payload = await studentTrainingService.getRoutingStats();
        res.json(payload);
    } catch (error) {
        logger.error("[TrainingAPI] Error fetching routing stats:", error);
        res.status(500).json({ error: "Failed to fetch routing statistics" });
    }
});

/**
 * GET /api/training/datasets
 * Returns all fine-tuning datasets with their example and preference counts.
 */
router.get("/datasets", async (req, res) => {
    try {
        const datasets = await studentTrainingService.getDatasetsSummary();
        res.json(datasets);
    } catch (error) {
        logger.error("[TrainingAPI] Error fetching datasets:", error);
        res.status(500).json({ error: "Failed to fetch training datasets" });
    }
});

/**
 * POST /api/training/trigger
 * Triggers a manual fine-tuning run (SFT or DPO) for an agent.
 */
router.post("/trigger", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const { agentId, type } = req.body;
        if (!agentId) {
            return res.status(400).json({ error: "agentId is required" });
        }

        const isDpo = type === "dpo";
        // Run in background asynchronously so response returns fast
        studentTrainingService.triggerManualTraining(Number(agentId), isDpo)
            .then(() => logger.info(`Manual training complete for Agent ${agentId}`))
            .catch(err => logger.error(`Error during manual training for Agent ${agentId}: ${err.message}`));

        res.json({ success: true, message: `Training job (${isDpo ? 'DPO' : 'SFT'}) triggered in background.` });
    } catch (error: any) {
        logger.error("[TrainingAPI] Error triggering training:", error);
        res.status(500).json({ error: error.message || "Failed to trigger training" });
    }
});

/**
 * POST /api/training/red-team
 * Triggers red-teaming for a distilled skill.
 */
router.post("/red-team", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const { skillName } = req.body;
        if (!skillName) {
            return res.status(400).json({ error: "skillName is required" });
        }

        const result = await redTeamService.redTeam(skillName);
        res.json(result);
    } catch (error: any) {
        logger.error("[TrainingAPI] Error in red-teaming:", error);
        res.status(500).json({ error: error.message || "Failed to execute red-teaming" });
    }
});

export default router;
