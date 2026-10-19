import { Router, type Request } from "express";
import { memoryEvolutionService } from "../core/evolution/memory-evolution.service.js";
import { knowledgeSynthesisService } from "../core/evolution/knowledge-synthesis.service.js";
import { orgMaturityService } from "../../org/core/org-maturity.service.js";
import { createLogger } from "@server/utils/logger.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";

const logger = createLogger("MaturityRoute");
const router = Router();

async function resolveOrgId(req: Request): Promise<number> {
  const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
  const requested = Number(req.body?.orgId ?? req.query?.orgId);
  if (isSuperAdmin && Number.isFinite(requested) && requested > 0) return requested;
  if (organizationId && Number.isFinite(organizationId) && organizationId > 0) return organizationId;
  return 1;
}

function fail(res: any, err: any) {
  res.status(err?.status || 500).json({ error: err?.message || "Internal error" });
}

// Get maturity stats
router.get("/stats", requireAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const stats = await memoryEvolutionService.getMaturityStats(orgId);
    const orgReport = await orgMaturityService.getMaturityReport(orgId);
    res.json({
      ...stats,
      agencyMaturityIndex: orgReport.maturityIndex,
      maturityScore: orgReport.maturityIndex,
      memoryScore: stats.maturityScore,
      dimensions: orgReport.dimensions
    });
  } catch (err: any) {
    fail(res, err);
  }
});

// Get proactive missions
router.get("/proactive-missions", requireAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const proactiveMissions = await memoryEvolutionService.getProactiveMissions(orgId, 10);
    res.json(proactiveMissions);
  } catch (err: any) {
    fail(res, err);
  }
});

// Trigger refresh
router.post("/refresh", requireAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    await memoryEvolutionService.refreshUtilityScores(orgId);
    await memoryEvolutionService.pruneStaleKnowledge(orgId, 5.0);
    const stats = await memoryEvolutionService.getMaturityStats(orgId);
    res.json({ success: true, stats });
  } catch (err: any) {
    fail(res, err);
  }
});

// Trigger synthesis
router.post("/synthesize", requireAuth, async (req, res) => {
  try {
    const { userId } = await getUserOrgContext(req);
    const orgId = await resolveOrgId(req);
    const nodeIds = await memoryEvolutionService.getSampleNodeIds(orgId, 50);

    const result = await knowledgeSynthesisService.detectKnowledgeGaps(orgId, nodeIds);

    if (result.success && result.proposedMission) {
      await knowledgeSynthesisService.launchGapMission(orgId, result, userId);
    }

    res.json(result);
  } catch (err: any) {
    fail(res, err);
  }
});

// Get evolution history
router.get("/history", requireAuth, async (req, res) => {
  try {
    const organizationId = await resolveOrgId(req);
    const history = await memoryEvolutionService.getEvolutionHistory(organizationId, 20);
    res.json(history);
  } catch (error: any) {
    logger.error(`Failed to fetch history: ${error.message}`);
    fail(res, error);
  }
});

export default router;
