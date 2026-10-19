import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { institutionalMemoryService } from "../core/institutional-memory.service.js";
import { promptEvolutionEngine } from "../core/prompt-evolution-engine.service.js";
import { assertOrgId } from "@server/utils/auth-context.js";

export const institutionalMemoryRouter = Router();

institutionalMemoryRouter.use(requireAuth);

/**
 * GET /api/learning/institutional-memory/health
 * Returns the org's institutional memory health stats.
 */
institutionalMemoryRouter.get("/institutional-memory/health", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const health = await institutionalMemoryService.getOrgMemoryHealth(orgId);
  res.json(health);
}));

/**
 * POST /api/learning/institutional-memory/distill
 * Triggers a distillation run for the org — reads failure clusters and
 * writes condensed lessons to knowledge topics.
 */
institutionalMemoryRouter.post("/institutional-memory/distill", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const result = await institutionalMemoryService.distillForOrg(orgId);
  res.json({ success: true, ...result });
}));

/**
 * GET /api/learning/institutional-memory/lessons
 * Returns formatted lessons for a given domain (query param: domain).
 */
institutionalMemoryRouter.get("/institutional-memory/lessons", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const domain = req.query.domain as string | undefined;
  const lessons = await institutionalMemoryService.getLessonsForPromptInjection(orgId, domain);
  res.json({ lessons });
}));

/**
 * POST /api/learning/prompt-evolution/scan
 * Scans for low-fitness prompts and generates AI-mutated candidates.
 */
institutionalMemoryRouter.post("/prompt-evolution/scan", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const results = await promptEvolutionEngine.scanAndMutate(orgId);
  res.json({ success: true, mutations: results });
}));

/**
 * POST /api/learning/prompt-evolution/evaluate
 * Evaluates shadow-run experimental prompts and promotes winners.
 */
institutionalMemoryRouter.post("/prompt-evolution/evaluate", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const result = await promptEvolutionEngine.evaluateAndPromote(orgId);
  res.json({ success: true, ...result });
}));
