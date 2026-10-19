import { validateIdParam } from "@server/utils/api-utils.js";
/**
 * Evaluation Studio API
 * Test sets, test cases, runs, and results for agent evaluation.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { ForbiddenError } from "@server/utils/errors.js";
import { evaluationService } from "@domain/pipeline/core/evaluation.service.js";
import { assessEvaluationPromotion } from "@domain/pipeline/core/evaluation-promotion.service.js";
import { evaluationStudioService } from "@domain/pipeline/core/evaluation-studio.service.js";

const router = Router();

router.use(requireAuth);

/** The caller's org, refusing a caller with none — and, for writes, a non-admin. */
async function requireOrg(req: Request, opts: { admin: boolean }) {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) throw new ForbiddenError("Organization required");
    if (opts.admin && !orgContext.isAdmin && !orgContext.isSuperAdmin) throw new ForbiddenError("Admin required");
    return { organizationId: orgContext.organizationId, userId: orgContext.userId };
}

function readPromotionThresholds(body: any) {
    const thresholds = body?.thresholds;
    if (!thresholds) return undefined;
    const parsed = {
        minimumCases: Number(thresholds.minimumCases),
        minimumPassRate: Number(thresholds.minimumPassRate),
        maximumRegressionPoints: Number(thresholds.maximumRegressionPoints),
    };
    return Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => Number.isFinite(value)),
    );
}

const optionalId = (value: unknown): number | null => {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : NaN;
};

// GET /api/evaluation-studio/test-sets
router.get("/test-sets", asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await requireOrg(req, { admin: true });
    res.json(await evaluationStudioService.listTestSets(organizationId));
}));

// POST /api/evaluation-studio/test-sets
router.post("/test-sets", asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await requireOrg(req, { admin: true });

    const { name, description } = req.body;
    const jobId = optionalId(req.body.jobId);
    const missionId = optionalId(req.body.missionId);
    if (Number.isNaN(jobId) || Number.isNaN(missionId)) {
        return res.status(400).json({ error: "jobId and missionId must be positive integers" });
    }

    const result = await evaluationStudioService.createTestSet(organizationId, { name, description, jobId, missionId });
    if (!result.ok) {
        return res.status(404).json({ error: result.failure === "job-not-found" ? "Job not found" : "Mission not found" });
    }
    res.status(201).json(result.set);
}));

router.post("/missions/:missionRunId/generate-test-case", asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await requireOrg(req, { admin: true });
    const missionRunId = validateIdParam(req.params.missionRunId);
    const generated = await evaluationStudioService.generateFromMissionRun(organizationId, missionRunId, req.body?.name);
    if (!generated) return res.status(404).json({ error: "Mission run not found" });
    res.status(201).json(generated);
}));

// GET /api/evaluation-studio/test-sets/:id/cases
router.get("/test-sets/:id/cases", asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await requireOrg(req, { admin: false });
    const cases = await evaluationStudioService.listCases(organizationId, validateIdParam(req.params.id));
    if (!cases) return res.status(404).json({ error: "Test set not found" });
    res.json(cases);
}));

// POST /api/evaluation-studio/test-sets/:id/cases
router.post("/test-sets/:id/cases", asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await requireOrg(req, { admin: true });
    const { inputPrompt, expectedCriteria, method } = req.body;
    const testCase = await evaluationStudioService.addCase(organizationId, validateIdParam(req.params.id), { inputPrompt, expectedCriteria, method });
    if (!testCase) return res.status(404).json({ error: "Test set not found" });
    res.status(201).json(testCase);
}));

// POST /api/evaluation-studio/test-sets/:id/run
router.post("/test-sets/:id/run", asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await requireOrg(req, { admin: true });
    const result = await evaluationService.runTestSet(validateIdParam(req.params.id), organizationId);
    res.status(201).json(result);
}));

router.get("/test-sets/:id/lifecycle", asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await requireOrg(req, { admin: false });
    const lifecycle = await evaluationStudioService.loadLifecycle(organizationId, validateIdParam(req.params.id));
    if (!lifecycle) return res.status(404).json({ error: "Test set not found" });
    res.json(lifecycle);
}));

router.post("/test-sets/:id/promotion-assessment", asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await requireOrg(req, { admin: true });
    const lifecycle = await evaluationStudioService.loadLifecycle(organizationId, validateIdParam(req.params.id));
    if (!lifecycle) return res.status(404).json({ error: "Test set not found" });

    const candidateRunId = Number(req.body?.candidateRunId);
    const candidate = lifecycle.runs.find((run) => run.runId === candidateRunId);
    if (!candidate) return res.status(404).json({ error: "Candidate evaluation run not found in this test set" });
    const requestedBaselineId = req.body?.baselineRunId == null ? null : Number(req.body.baselineRunId);
    const activeBaselineId = lifecycle.activePromotion?.candidateRunId ?? null;
    const baselineId = requestedBaselineId ?? activeBaselineId;
    const baseline = baselineId == null
        ? null
        : lifecycle.runs.find((run) => run.runId === baselineId);
    if (baselineId != null && !baseline) {
        return res.status(404).json({ error: "Baseline evaluation run not found in this test set" });
    }

    res.json(assessEvaluationPromotion({
        candidate,
        baseline,
        thresholds: readPromotionThresholds(req.body),
    }));
}));

router.post("/test-sets/:id/promote", asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, userId } = await requireOrg(req, { admin: true });
    const testSetId = validateIdParam(req.params.id);
    const lifecycle = await evaluationStudioService.loadLifecycle(organizationId, testSetId);
    if (!lifecycle) return res.status(404).json({ error: "Test set not found" });

    const candidateRunId = Number(req.body?.candidateRunId);
    const candidate = lifecycle.runs.find((run) => run.runId === candidateRunId);
    if (!candidate) return res.status(404).json({ error: "Candidate evaluation run not found in this test set" });
    if (lifecycle.activePromotion?.candidateRunId === candidateRunId) {
        return res.status(409).json({ error: "This run is already the active evaluation baseline" });
    }
    const baseline = lifecycle.activePromotion
        ? lifecycle.runs.find((run) => run.runId === lifecycle.activePromotion!.candidateRunId) ?? null
        : null;
    const assessment = assessEvaluationPromotion({
        candidate,
        baseline,
        thresholds: readPromotionThresholds(req.body),
    });
    if (!assessment.ready) {
        return res.status(409).json({
            error: "Candidate did not satisfy evaluation promotion policy",
            assessment,
        });
    }

    const promotion = await evaluationStudioService.recordPromotion(organizationId, {
        testSetId,
        candidateRunId,
        baselineRunId: baseline?.runId ?? null,
        assessment,
        reason: typeof req.body?.reason === "string" ? req.body.reason.trim() || null : null,
        promotedBy: userId,
    });
    res.status(201).json({ promotion, assessment });
}));

// GET /api/evaluation-studio/runs/:id/results
router.get("/runs/:id/results", asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await requireOrg(req, { admin: false });
    res.json(await evaluationService.getRunResults(validateIdParam(req.params.id), organizationId));
}));

// POST /api/evaluation-studio/import-system-tests
router.post("/import-system-tests", asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await requireOrg(req, { admin: true });
    const setId = await evaluationStudioService.importSystemTests(organizationId);
    res.status(201).json({ success: true, setId });
}));

export default router;
