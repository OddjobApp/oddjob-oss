import { Router, Request, Response } from "express";
import { skillService } from "../domain/agents/core/skill-service.js";
import { insertSkillSchema } from "@shared/schema/index.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { SkillExportService } from "../domain/jobs/skill-export.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { validateIdParam } from "../utils/api-utils.js";
import { db } from "../db/index.js";
import { skills } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { SentinelService } from "@domain/mission/core/sentinel-service.js";

const router = Router();

/**
 * GET /api/admin/skills
 * List all skills (including private ones for admin)
 */
router.get("/skills", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const list = await skillService.listSkills(true);
  res.json(list);
}));

/**
 * POST /api/admin/skills
 * Create a new skill
 */
router.post("/skills", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const validated = insertSkillSchema.parse(req.body);
  const skill = await skillService.createSkill(validated);
  res.status(201).json(skill);
}));

/**
 * GET /api/admin/skills/:id/export
 * Export a skill primitive as a bundle
 */
router.get("/skills/:id/export", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Skill ID");
  const format = req.query.format as string || "openai";

  const [skill] = await db.select().from(skills).where(eq(skills.id, id)).limit(1);
  if (!skill) throw new NotFoundError(`Skill ${id} not found`);

  let buffer: Buffer;
  if (format === "openai") {
    buffer = await SkillExportService.exportSkillAsOpenAI(skill);
  } else if (format === "openclaw") {
    buffer = await SkillExportService.exportSkillAsOpenClaw(skill);
  } else {
    throw new BadRequestError("Invalid export format. Supported: openai, openclaw");
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${skill.name}_${format}.zip"`);
  res.send(buffer);
}));

/**
 * POST /api/admin/skills/:id/provision-agent
 * Create a specialized agent draft from this skill
 */
router.post("/skills/:id/provision-agent", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Skill ID");
  const orgContext = await getUserOrgContext(req);
  const userId = (req.session as any)?.userId;

  const job = await skillService.provisionAgentFromSkill(id, orgContext.organizationId!, userId);
  res.json(job);
}));

/**
 * GET /api/admin/skills/health
 *
 * Sentinel health for every skill in one query, keyed by skill name, so the
 * admin registry does not issue one request per row.
 *
 * Note for callers: getBatchSkillHealth seeds every requested skill with
 * reliabilityIndex 100, so a skill that has never run reports as perfectly
 * reliable. Read `totalRuns` first — 0 means unmeasured, not healthy.
 *
 * Declared before /skills/:id/health so "health" is not parsed as an id.
 */
router.get("/skills/health", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  const all = await db.select({ name: skills.name }).from(skills);
  res.json(await SentinelService.getBatchSkillHealth(all.map(s => s.name)));
}));

/**
 * GET /api/admin/skills/:id/health
 * Get real-time Sentinel health metrics for a skill
 */
router.get("/skills/:id/health", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Skill ID");
  const [skill] = await db.select().from(skills).where(eq(skills.id, id)).limit(1);
  if (!skill) throw new NotFoundError(`Skill ${id} not found`);

  const health = await SentinelService.getSkillHealth(skill.name);
  res.json(health);
}));

/**
 * GET /api/admin/sentinel/summary
 * Get ecosystem-wide Sentinel health summary
 */
router.get("/sentinel/summary", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  const summary = await SentinelService.getEcosystemSummary();
  res.json(summary);
}));

/**
 * DELETE /api/admin/skills/:id
 * Delete a skill
 */
router.delete("/skills/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Skill ID");
  await skillService.deleteSkill(id);
  res.status(204).end();
}));

import { SkillDecisionEngine } from "../domain/agents/core/skill-decision-engine.js";
import { SkillGovernanceService } from "../domain/agents/core/skill-governance.service.js";
import { SkillAugmentationService } from "../domain/agents/core/skill-augmentation.service.js";

/**
 * POST /api/admin/skills/evaluate
 * Evaluate a skill payload against an organization's existing agent cards
 */
router.post("/skills/evaluate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const result = await SkillDecisionEngine.analyzeForOrganization(req.body, orgContext.organizationId!);
  res.json(result);
}));

/**
 * POST /api/admin/skills/reviews
 * Submit an imported or analyzed skill for governance review
 */
router.post("/skills/reviews", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const userId = (req.session as any)?.userId || "system";
  const review = await SkillGovernanceService.submitSkillForReview({
    ...req.body,
    organizationId: orgContext.organizationId!,
    submittedBy: String(userId),
  });
  res.status(201).json(review);
}));

/**
 * GET /api/admin/skills/reviews
 * List pending or completed skill reviews for the current organization
 */
router.get("/skills/reviews", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const status = req.query.status as any;
  const reviews = await SkillGovernanceService.listReviews(orgContext.organizationId!, status);
  res.json(reviews);
}));

/**
 * POST /api/admin/skills/reviews/:id/decision
 * Process an approval, rejection, or augmentation decision on a skill review
 */
router.post("/skills/reviews/:id/decision", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Review ID");
  const orgContext = await getUserOrgContext(req);
  const userId = (req.session as any)?.userId || "system";
  const result = await SkillGovernanceService.processDecision({
    organizationId: orgContext.organizationId!,
    reviewId: id,
    reviewerId: String(userId),
    action: req.body.action,
    targetAgentCardId: req.body.targetAgentCardId,
    reviewNotes: req.body.reviewNotes,
  });
  res.json(result);
}));

/**
 * POST /api/admin/skills/augmentations/:id/rollback
 * Roll back an augmentation and restore the Agent Card to its pre-augmentation state
 */
router.post("/skills/augmentations/:id/rollback", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Augmentation ID");
  const orgContext = await getUserOrgContext(req);
  const userId = (req.session as any)?.userId || "system";
  const result = await SkillAugmentationService.rollbackAugmentation(id, orgContext.organizationId!, String(userId));
  res.json(result);
}));

/**
 * GET /api/admin/skills/augmentations/agent/:agentCardId
 * List all augmentations applied to a specific Agent Card
 */
router.get("/skills/augmentations/agent/:agentCardId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const agentCardId = validateIdParam(req.params.agentCardId, "Agent Card ID");
  const orgContext = await getUserOrgContext(req);
  const list = await SkillAugmentationService.listAugmentationsForAgent(agentCardId, orgContext.organizationId!);
  res.json(list);
}));

export default router;

