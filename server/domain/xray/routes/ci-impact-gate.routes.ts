/**
 * CI/CD Impact Gate API Routes
 *
 * Exposes endpoints for CI pipeline checks to evaluate pull-request change impact.
 */

import { Router } from "express";
import { createLogger } from "@server/utils/logger.js";
import { ciImpactGateService } from "../core/ci-impact-gate.service.js";

const logger = createLogger("CIImpactGateRoutes");
const router = Router();

/**
 * POST /api/oddjob/lineage/ci-impact-check
 * Evaluates PR modified files against System Graph topology
 */
router.post("/ci-impact-check", async (req, res) => {
  try {
    const { modifiedFiles, branchName, maxBlastRadiusScore } = req.body;

    if (!Array.isArray(modifiedFiles)) {
      return res.status(400).json({ error: "modifiedFiles must be an array of file path strings" });
    }

    logger.info(`[CIImpactGateRoutes] Evaluating CI impact for branch '${branchName || "unknown"}' (${modifiedFiles.length} files)`);

    const result = await ciImpactGateService.evaluatePullRequestImpact({
      modifiedFiles,
      branchName,
      maxBlastRadiusScore: typeof maxBlastRadiusScore === "number" ? maxBlastRadiusScore : 50,
    });

    const statusCode = result.passed ? 200 : 422; // 422 Unprocessable Entity if gate fails
    return res.status(statusCode).json(result);
  } catch (error: any) {
    logger.error(`[CIImpactGateRoutes] CI impact check failed:`, error.message);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
