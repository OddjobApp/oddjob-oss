import { validateIdParam } from "@server/utils/api-utils.js";
import { Router, Request, Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { scoringService } from "@domain/knowledge/core/scoring/scoring.service.js";
import { interventionAgentService } from "@domain/knowledge/core/scoring/intervention-agent.service.js";
import { evaluationService } from "@domain/pipeline/core/evaluation.service.js";
import { governorService } from "@domain/governor/index.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { db } from "@server/database_service.js";
import {
    interventionMemory,
    interventionPolicies,
    interventionPolicySuggestions,
    scoreThresholds,
} from "@shared/schema/index.js";
import { desc, eq } from "drizzle-orm";

const router = Router();

// --- Scoring Rules ---

router.get("/rules", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const rules = await scoringService.listRules();
    res.json(rules);
}));

router.post("/rules", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const rule = await scoringService.createRule(req.body, (req as any).user?.id);
    res.json(rule);
}));

router.put("/rules/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    const rule = await scoringService.updateRule(id, req.body);
    res.json(rule);
}));

router.delete("/rules/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    await scoringService.deleteRule(id);
    res.json({ success: true });
}));

// Toggle enable/disable
router.patch("/rules/:id/toggle", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    const { enabled } = req.body;
    const rule = await scoringService.toggleRule(id, enabled);
    res.json(rule);
}));

// Copy/duplicate rule
router.post("/rules/:id/copy", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    const copy = await scoringService.copyRule(id, (req as any).user?.id);
    res.json(copy);
}));

// --- Interventions ---

router.get("/interventions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const interventions = await scoringService.listInterventions();
    res.json(interventions);
}));

router.post("/interventions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const intervention = await scoringService.createIntervention(req.body);
    res.json(intervention);
}));

router.put("/interventions/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    const intervention = await scoringService.updateIntervention(id, req.body);
    res.json(intervention);
}));

router.delete("/interventions/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    await scoringService.deleteIntervention(id);
    res.json({ success: true });
}));

// Utility to force cache refresh
router.post("/refresh-cache", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    await scoringService.refreshAllCaches();
    res.json({ success: true, message: 'Redis cache refreshed' });
}));

// --- Score Thresholds ---

router.get("/thresholds", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const thresholds = await scoringService.listThresholds();
    res.json(thresholds);
}));

router.post("/thresholds", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const threshold = await scoringService.createThreshold(req.body);
    res.json(threshold);
}));

router.put("/thresholds/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    const threshold = await scoringService.updateThreshold(id, req.body);
    res.json(threshold);
}));

router.delete("/thresholds/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    await scoringService.deleteThreshold(id);
    res.json({ success: true });
}));

router.patch("/thresholds/:id/toggle", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    const { enabled } = req.body;
    const threshold = await scoringService.toggleThreshold(id, enabled);
    res.json(threshold);
}));

// AI Description Generation
router.post("/generate-description", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { threshold, rules } = req.body;

    if (!threshold) return res.status(400).json({ error: "Threshold data required" });

    const description = await scoringService.generateDescription(threshold, rules);
    res.json({ description });
}));

// --- Scoring Templates ---

router.get("/templates", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const templates = await scoringService.listTemplates((req as any).user?.id);
    res.json(templates);
}));

router.post("/templates", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const template = await scoringService.createTemplate(req.body, (req as any).user?.id);
    res.json(template);
}));

router.put("/templates/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id; // UUID String
    const template = await scoringService.updateTemplate(id, req.body);
    res.json(template);
}));

router.delete("/templates/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    await scoringService.deleteTemplate(id);
    res.json({ success: true });
}));

// --- Intervention Agent ---

/**
 * POST /api/scoring/interventions/outcome
 * Called by useInterventionEngine when the user acts on (or ignores) an intervention.
 * Body: { interventionId: string, outcome: 'accepted'|'dismissed'|'expired'|'ignored', timestamp?: number }
 */
router.post("/interventions/outcome", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { interventionId, outcome, timestamp } = req.body;
    if (!interventionId || !outcome) {
        return res.status(400).json({ error: "interventionId and outcome are required" });
    }

    const timeToActionMs = timestamp ? Date.now() - timestamp : undefined;
    await interventionAgentService.recordOutcome(interventionId, outcome, timeToActionMs);
    res.json({ success: true });
}));

// --- Agent Brain (memory / policies / suggestions) ---

/** GET /api/scoring/agent/memory — last 50 intervention memory rows with threshold names */
router.get("/agent/memory", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    const rows = await db
        .select({
            id: interventionMemory.id,
            interventionId: interventionMemory.interventionId,
            thresholdId: interventionMemory.thresholdId,
            thresholdName: scoreThresholds.name,
            sessionId: interventionMemory.sessionId,
            vector: interventionMemory.vector,
            vectorState: interventionMemory.vectorState,
            location: interventionMemory.location,
            agentDecision: interventionMemory.agentDecision,
            agentConfidence: interventionMemory.agentConfidence,
            policiesCited: interventionMemory.policiesCited,
            outcome: interventionMemory.outcome,
            timeToActionMs: interventionMemory.timeToActionMs,
            createdAt: interventionMemory.createdAt,
            resolvedAt: interventionMemory.resolvedAt,
        })
        .from(interventionMemory)
        .leftJoin(scoreThresholds, eq(scoreThresholds.id, interventionMemory.thresholdId))
        .orderBy(desc(interventionMemory.createdAt))
        .limit(50);
    res.json(rows);
}));

/** GET /api/scoring/agent/policies — all enabled policies */
router.get("/agent/policies", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    const rows = await db
        .select()
        .from(interventionPolicies)
        .orderBy(desc(interventionPolicies.createdAt))
        .limit(100);
    res.json(rows);
}));

/** PATCH /api/scoring/agent/policies/:id/toggle — enable/disable a policy */
router.patch("/agent/policies/:id/toggle", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    const { enabled } = req.body;
    const [updated] = await db
        .update(interventionPolicies)
        .set({ enabled })
        .where(eq(interventionPolicies.id, id))
        .returning();
    res.json(updated);
}));

/** GET /api/scoring/agent/suggestions — pending suggestions */
router.get("/agent/suggestions", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    const rows = await db
        .select()
        .from(interventionPolicySuggestions)
        .orderBy(desc(interventionPolicySuggestions.createdAt))
        .limit(50);
    res.json(rows);
}));

/** PATCH /api/scoring/agent/suggestions/:id — approve or reject */
router.patch("/agent/suggestions/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    const { status } = req.body; // 'approved' | 'rejected'
    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
    }
    const [updated] = await db
        .update(interventionPolicySuggestions)
        .set({
            status,
            // No `as any`: req.user.id is typed string, and reviewed_by is now text,
            // so a future type drift between them fails the build instead of 500ing
            // at runtime.
            reviewedBy: req.user?.id ?? null,
            reviewedAt: new Date(),
        })
        .where(eq(interventionPolicySuggestions.id, id))
        .returning();
    res.json(updated);
}));

/** POST /api/scoring/agent/distill — manually trigger a policy distillation */
router.post("/agent/distill", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    await interventionAgentService.distillPolicies();
    res.json({ success: true });
}));

/** POST /api/scoring/agent/test-fire — fire a synthetic intervention for UI preview */
router.post("/agent/test-fire", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const vector = req.body.vector || 'C';
    const priority = req.body.priority || 'medium';

    await eventStream.publish('intervention.triggered', {
        interventionId: `test-${Date.now()}`,
        vector,
        title: req.body.title || `Test ${vector}-vector intervention`,
        description: req.body.description || "This is a preview fired from Scoring Studio. It won't be logged.",
        aiPrompt: "You are reviewing a test intervention. Explain what the SCORE vector system is in 2 sentences.",
        rationale: "Manually triggered from Scoring Studio for UI preview purposes.",
        priority,
        confidence: 0.99,
        sessionId: 'admin-test',
        isTestFire: true,
    }, { source: 'admin-test-fire' });

    res.json({ success: true });
}));

// --- Feedback Loop & Self-Correction ---

router.get("/feedback/negative", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const feedback = await evaluationService.getNegativeFeedback(limit);
    res.json(feedback);
}));

router.post("/feedback/generate-policy", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { feedbackId, context } = req.body;
    if (!context) return res.status(400).json({ error: "Context is required for policy generation." });

    const policy = await governorService.generatePolicyFromFeedback(feedbackId, context);
    res.json(policy);
}));

export default router;

