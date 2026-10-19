/**
 * Governed Rules & Decision Intelligence Engine (GRIE) REST API
 *
 * Persists the rule suites and specifications the Rule Builder authors, so a
 * rule composed in the UI actually reaches `subscription-rule-engine.service`.
 *
 * GET    /api/rule-suites                             — list suites for org
 * POST   /api/rule-suites                             — create suite
 * GET    /api/rule-suites/:suiteId                    — suite + its rules
 * PATCH  /api/rule-suites/:suiteId                    — update suite metadata
 * DELETE /api/rule-suites/:suiteId                    — delete suite (cascades)
 * GET    /api/rule-suites/:suiteId/rules              — list rules
 * PUT    /api/rule-suites/:suiteId/rules/:ruleId      — upsert a rule
 * PATCH  /api/rule-suites/:suiteId/rules/:ruleId      — toggle / reweight
 * DELETE /api/rule-suites/:suiteId/rules/:ruleId      — delete rule
 * POST   /api/rule-suites/:suiteId/rules/:ruleId/evaluate — dry-run
 * POST   /api/rule-suites/validate                    — validate without saving
 * GET    /api/rule-suites/:suiteId/audits             — execution history
 *
 * TENANT ISOLATION: `rule_specifications` carries no organization_id — it is
 * scoped only through `suite_db_id -> rule_suites.organization_id`. Every rule
 * lookup here therefore resolves the suite by (suiteId, orgId) FIRST and uses
 * its surrogate id. `suite_id` is globally unique, so resolving a rule by
 * suiteId alone would read across tenants.
 *
 * PROJECT SCOPE: suites also live in a Project Space. `withProjectScope()` is
 * total — it falls back to the org default — so every request resolves to a
 * real project and reads filter on it. Suites written before this column exists
 * have a NULL project_id and stay visible to the whole org rather than
 * disappearing from every project view.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { withProjectScope } from "@server/middleware/project-scope.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { NotFoundError, ConflictError, ValidationError } from "@server/utils/errors.js";
import {
  ruleSpecificationSchema,
  ruleSpecificationUpdateSchema,
  ruleSuiteCreateSchema,
  ruleSuiteUpdateSchema,
} from "@shared/contracts/rule-specification.js";
import { subscriptionRuleEngine } from "../core/subscription-rule-engine.service.js";
import { ruleSuiteService } from "../core/rule-suite.service.js";

const logger = createLogger("RuleSuitesRoutes");

const router = Router();
router.use(requireAuth);
// Resolution order: ?projectId → X-Project-Id → session → org default. Total,
// so mounting it cannot strand a caller that names no project.
router.use(withProjectScope());

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** Formats a Zod failure into a flat, field-addressable error body. */
function validationBody(error: z.ZodError) {
  return {
    error: "Rule validation failed",
    issues: error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  };
}

/** Org + project context for one request. */
async function scopeFor(req: Request): Promise<{ orgId: number; projectId?: number }> {
  const orgId = requireOrgId(await getUserOrgContext(req));
  return { orgId, projectId: req.projectId };
}

// ---------------------------------------------------------------------------
// SUITES
// ---------------------------------------------------------------------------

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const { orgId, projectId } = await scopeFor(req);
  const suites = await ruleSuiteService.listSuitesWithCounts(orgId, projectId);
  res.json(suites);
}));

router.post("/", asyncHandler(async (req: Request, res: Response) => {
  const { orgId, projectId } = await scopeFor(req);

  const parsed = ruleSuiteCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(validationBody(parsed.error));

  const existing = await ruleSuiteService.findSuite(parsed.data.suiteId, orgId, projectId);
  if (existing) {
    throw new ConflictError(`Rule suite '${parsed.data.suiteId}' already exists`);
  }

  const suite = await ruleSuiteService.createSuite({
    organizationId: orgId,
    projectId: projectId ?? null,
    suiteId: parsed.data.suiteId,
    suiteName: parsed.data.suiteName,
    category: parsed.data.category ?? "Supply Chain & Logistics",
    version: parsed.data.version ?? "1.0.0",
    owner: parsed.data.owner ?? "Operations Team",
    description: parsed.data.description,
    executionPolicy: parsed.data.executionPolicy ?? "HIGHEST_PRIORITY_MAUF",
    enabled: parsed.data.enabled ?? true,
    createdBy: String((req as any).user?.email ?? "operator"),
  });

  logger.info(`Rule suite '${suite.suiteId}' created for org ${orgId}`);
  res.status(201).json(suite);
}));

const ruleDeploySchema = z.object({
  suite: ruleSuiteCreateSchema,
  rule: ruleSpecificationSchema,
});

router.post("/deploy", asyncHandler(async (req: Request, res: Response) => {
  const { orgId, projectId } = await scopeFor(req);
  const parsed = ruleDeploySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(validationBody(parsed.error));

  const userEmail = String((req as any).user?.email ?? "operator");
  const result = await ruleSuiteService.deployRuleTransaction(orgId, projectId, parsed.data, userEmail);
  res.status(result.isNewRule ? 201 : 200).json(result);
}));

router.get("/:suiteId", asyncHandler(async (req: Request, res: Response) => {
  const { orgId, projectId } = await scopeFor(req);
  const suite = await ruleSuiteService.requireSuite(req.params.suiteId, orgId, projectId);
  const rules = await ruleSuiteService.listRules(suite.id);
  res.json({ ...suite, rules });
}));

router.patch("/:suiteId", asyncHandler(async (req: Request, res: Response) => {
  const { orgId, projectId } = await scopeFor(req);
  const suite = await ruleSuiteService.requireSuite(req.params.suiteId, orgId, projectId);

  const parsed = ruleSuiteUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(validationBody(parsed.error));
  if (Object.keys(parsed.data).length === 0) {
    throw new ValidationError("No updatable fields supplied");
  }

  const updated = await ruleSuiteService.updateSuite(suite.id, { ...parsed.data, updatedAt: new Date() });
  logger.info(`Rule suite '${suite.suiteId}' updated for org ${orgId}`);
  res.json(updated);
}));

router.delete("/:suiteId", asyncHandler(async (req: Request, res: Response) => {
  const { orgId, projectId } = await scopeFor(req);
  const suite = await ruleSuiteService.requireSuite(req.params.suiteId, orgId, projectId);

  // Specifications cascade via the suite_db_id FK.
  await ruleSuiteService.deleteSuite(suite.id);

  logger.info(`Rule suite '${suite.suiteId}' deleted for org ${orgId}`);
  res.status(204).send();
}));

// ---------------------------------------------------------------------------
// VALIDATION (no persistence)
// ---------------------------------------------------------------------------

/**
 * Validates a rule payload without saving it, so the builder can surface the
 * same errors the API enforces before an operator commits.
 */
router.post("/validate", asyncHandler(async (req: Request, res: Response) => {
  requireOrgId(await getUserOrgContext(req));

  const parsed = ruleSpecificationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(200).json({ valid: false, ...validationBody(parsed.error) });
  }
  res.json({ valid: true, specification: parsed.data });
}));

// ---------------------------------------------------------------------------
// RULES
// ---------------------------------------------------------------------------

router.get("/:suiteId/rules", asyncHandler(async (req: Request, res: Response) => {
  const { orgId, projectId } = await scopeFor(req);
  const suite = await ruleSuiteService.requireSuite(req.params.suiteId, orgId, projectId);
  const rules = await ruleSuiteService.listRules(suite.id);
  res.json(rules);
}));

/**
 * Upserts a rule. PUT because the Rule Builder saves the whole rule each time —
 * replaying a save must not create duplicates.
 */
router.put("/:suiteId/rules/:ruleId", asyncHandler(async (req: Request, res: Response) => {
  const { orgId, projectId } = await scopeFor(req);
  const suite = await ruleSuiteService.requireSuite(req.params.suiteId, orgId, projectId);
  const { ruleId } = req.params;

  // The URL is authoritative for identity; a mismatched body id would otherwise
  // write a rule under a different key than the caller addressed.
  const parsed = ruleSpecificationSchema.safeParse({ ...req.body, ruleId });
  if (!parsed.success) return res.status(400).json(validationBody(parsed.error));

  const { row, isUpdate } = await ruleSuiteService.upsertRule(suite.id, parsed.data);

  logger.info(
    `Rule '${ruleId}' ${isUpdate ? "updated" : "created"} in suite '${suite.suiteId}' (org ${orgId})`
  );
  res.status(isUpdate ? 200 : 201).json(row);
}));

router.patch("/:suiteId/rules/:ruleId", asyncHandler(async (req: Request, res: Response) => {
  const { orgId, projectId } = await scopeFor(req);
  const suite = await ruleSuiteService.requireSuite(req.params.suiteId, orgId, projectId);

  const parsed = ruleSpecificationUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(validationBody(parsed.error));
  if (Object.keys(parsed.data).length === 0) {
    throw new ValidationError("No updatable fields supplied");
  }

  const rule = await ruleSuiteService.findRule(suite.id, req.params.ruleId);
  if (!rule) throw new NotFoundError(`Rule '${req.params.ruleId}' not found`);

  const updated = await ruleSuiteService.updateRuleSpecification(rule.id, {
    ...parsed.data,
    updatedAt: new Date(),
  });

  res.json(updated);
}));

router.delete("/:suiteId/rules/:ruleId", asyncHandler(async (req: Request, res: Response) => {
  const { orgId, projectId } = await scopeFor(req);
  const suite = await ruleSuiteService.requireSuite(req.params.suiteId, orgId, projectId);

  await ruleSuiteService.deleteRule(suite.id, req.params.ruleId);
  logger.info(`Rule '${req.params.ruleId}' deleted from suite '${suite.suiteId}' (org ${orgId})`);
  res.status(204).send();
}));

// ---------------------------------------------------------------------------
// DRY RUN
// ---------------------------------------------------------------------------

const sampleEventSchema = z.object({
  eventType: z.string().default("SIMULATED"),
  targetSector: z.string().default("Defense"),
  jurisdiction: z.string().default("US"),
  severity: z.string().default("High"),
  confidenceScore: z.number().min(0).max(1).default(0.9),
  rawText: z.string().default(""),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  h3Index: z.string().nullable().optional(),
  previousH3Index: z.string().nullable().optional(),
  dwellMinutes: z.number().nullable().optional(),
  velocityKnots: z.number().nullable().optional(),
  headingDegrees: z.number().nullable().optional(),
  projectedLatitude: z.number().nullable().optional(),
  projectedLongitude: z.number().nullable().optional(),
  fluxDensityPhi: z.number().nullable().optional(),
  cellMetrics: z.record(z.string(), z.unknown()).nullable().optional(),
  subjectId: z.string().nullable().optional(),
  spatialSource: z.string().nullable().optional(),
  spatialPrecisionM: z.number().nullable().optional(),
});

/**
 * Evaluates an in-memory rule specification directly against a sample event.
 * Used for live backtesting and simulation in RuleBuilder before or after saving.
 */
router.post("/simulate", asyncHandler(async (req: Request, res: Response) => {
  const { orgId, projectId } = await scopeFor(req);
  const parsedRule = ruleSpecificationSchema.safeParse(req.body?.specification ?? req.body?.rule);
  if (!parsedRule.success) return res.status(400).json(validationBody(parsedRule.error));

  const parsedEvent = sampleEventSchema.safeParse(req.body?.sampleEvent ?? req.body?.event ?? {});
  if (!parsedEvent.success) return res.status(400).json(validationBody(parsedEvent.error));

  const sample = {
    ...parsedEvent.data,
    id: "00000000-0000-0000-0000-000000000000",
    organizationId: orgId,
    projectId: projectId ?? null,
    sourceEntryId: "dry-run",
    sourceUrl: "dryrun://rule-builder",
    extractionTimestamp: new Date(),
    createdAt: new Date(),
    flags: [],
    contentHash: "dry-run",
  };

  const result = await subscriptionRuleEngine.evaluateRuleSpecification(
    "signal-routing-triage",
    parsedRule.data as any,
    sample as any,
    []
  );

  res.json({
    ruleId: parsedRule.data.ruleId,
    matched: result.passed,
    matchedBranch: result.matchedBranch,
    masterPriorityScore: result.masterPriorityScore,
    disposition: result.disposition,
    spatialScore: result.spatialScore,
    spatialTrace: result.spatialTrace,
    fuzzyScores: result.fuzzyScores,
  });
}));

/**
 * Evaluates a stored rule against a caller-supplied sample event.
 *
 * Nothing is written and no action fires — this backs the builder's simulation
 * tab, where an operator needs to see whether a rule would match and why before
 * turning it loose on live signals.
 */
router.post("/:suiteId/rules/:ruleId/evaluate", asyncHandler(async (req: Request, res: Response) => {
  const { orgId, projectId } = await scopeFor(req);
  const suite = await ruleSuiteService.requireSuite(req.params.suiteId, orgId, projectId);

  const rule = await ruleSuiteService.findRule(suite.id, req.params.ruleId);
  if (!rule) throw new NotFoundError(`Rule '${req.params.ruleId}' not found`);

  const parsed = sampleEventSchema.safeParse(req.body?.sampleEvent ?? req.body ?? {});
  if (!parsed.success) return res.status(400).json(validationBody(parsed.error));

  const sample = {
    ...parsed.data,
    id: "00000000-0000-0000-0000-000000000000",
    organizationId: orgId,
    projectId: projectId ?? null,
    sourceEntryId: "dry-run",
    sourceUrl: "dryrun://rule-builder",
    extractionTimestamp: new Date(),
    createdAt: new Date(),
    flags: [],
    contentHash: "dry-run",
  };

  const result = await subscriptionRuleEngine.evaluateRuleSpecification(
    suite.suiteId,
    rule.specification as any,
    sample as any,
    []
  );

  res.json({
    ruleId: rule.ruleId,
    matched: result.passed,
    matchedBranch: result.matchedBranch,
    masterPriorityScore: result.masterPriorityScore,
    disposition: result.disposition,
    spatialScore: result.spatialScore,
    spatialTrace: result.spatialTrace,
    fuzzyScores: result.fuzzyScores,
  });
}));

// ---------------------------------------------------------------------------
// AUDITS
// ---------------------------------------------------------------------------

router.get("/:suiteId/audits", asyncHandler(async (req: Request, res: Response) => {
  const { orgId, projectId } = await scopeFor(req);
  const suite = await ruleSuiteService.findSuite(req.params.suiteId, orgId, projectId);
  if (!suite) {
    return res.json([]);
  }

  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

  /**
   * `?outcome=` filters to matched | no_match | error.
   *
   * The history now records every evaluation rather than only the matches, so
   * the default listing answers "what did this suite do to my signals" and
   * `?outcome=error` answers "which of my rules are failing to run at all" —
   * previously a question with no data behind it anywhere.
   */
  const outcomes = ["matched", "no_match", "error"];
  const outcome = typeof req.query.outcome === "string" ? req.query.outcome : undefined;
  if (outcome && !outcomes.includes(outcome)) {
    return res.status(400).json({
      error: `Invalid outcome filter. Must be one of: ${outcomes.join(", ")}`,
    });
  }

  const audits = await ruleSuiteService.listAuditsWithFilter(orgId, suite.suiteId, outcome, limit);
  res.json(audits);
}));

export const ruleSuitesRouter = router;
export default { ruleSuitesRouter: router };
