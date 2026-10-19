import { Router } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { evolutionService } from "../core/evolution.service.js";
import { benchmarkService } from "../../learning/core/benchmark.service.js";
import { SelfHealingHandler } from "../infrastructure/self-healing.handler.js";
import { skillPromotionService } from "@domain/mission/core/skill-promotion.service.js";
import { createLogger } from "@server/utils/logger.js";
import { promptEvolutionEngine } from "../../learning/core/prompt-evolution-engine.service.js";
import { db } from "@server/database_service.js";
import { promptVersions } from "@shared/schema/learning/prompt-evolution.js";
import { eq, and } from "drizzle-orm";
import { assertOrgId, getUserOrgContext, requireOrgAdminOrSuper } from "@server/utils/auth-context.js";
import { capabilityProposalService } from "@domain/capabilities/core/capability-proposal.service.js";
import { evoDevoService } from "../core/evo-devo.service.js";
import { evoDevoReadService } from "../core/evo-devo-read.service.js";
import { evolutionPopulationService } from "../core/evolution-population.service.js";
import { evolutionLifecycleService } from "../core/evolution-lifecycle.service.js";
import { evolutionOutcomeService } from "../core/evolution-outcome.service.js";
import { evolutionReproductionService } from "../core/evolution-reproduction.service.js";

const router = Router();
const logger = createLogger("EvolutionRoutes");

// All evolution routes require authentication
router.use(requireAuth);

/**
 * Read endpoints backing the Flight Deck's Evo-Devo tab.
 *
 * Readable by any authenticated member of the organisation, unlike the write
 * routes below which require org admin. Seeing what the system has evolved is
 * not the same authority as evolving it, and gating the view behind admin would
 * make the feature invisible to the people it is being run for.
 */
router.get("/evo-devo/genomes", async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.json(await evoDevoReadService.listGenomes(assertOrgId(context.organizationId)));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.get("/evo-devo/genomes/:genomeId/phenotypes", async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.json(await evoDevoReadService.listPhenotypes(assertOrgId(context.organizationId), req.params.genomeId));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.get("/evo-devo/phenotypes/:phenotypeId/history", async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.json(await evoDevoReadService.stageHistory(assertOrgId(context.organizationId), req.params.phenotypeId));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.get("/evo-devo/populations", async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.json(await evoDevoReadService.listPopulations(assertOrgId(context.organizationId)));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.post("/evo-devo/environments", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.status(201).json(await evoDevoService.registerEnvironment(assertOrgId(context.organizationId), req.body));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.post("/evo-devo/genomes", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.status(201).json(await evoDevoService.registerFounderGenome(assertOrgId(context.organizationId), req.body));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.post("/evo-devo/genomes/:genomeKey/develop", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        const seed = Number.isInteger(req.body?.seed) ? req.body.seed : 0;
        const organizationId = assertOrgId(context.organizationId);
        const phenotype = await evoDevoService.develop(organizationId, req.params.genomeKey, req.body?.environmentKey, seed);
        const lifecycle = await evolutionLifecycleService.initialize(organizationId, phenotype.id, String(context.userId || "evolution-system"));
        res.status(201).json({ ...phenotype, lifecycle });
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.post("/evo-devo/genomes/:genomeKey/children", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.status(201).json(await evoDevoService.createChild(assertOrgId(context.organizationId), req.params.genomeKey, req.body?.childId, req.body?.mutation));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.get("/evo-devo/genomes/:genomeKey/lineage", async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.json(await evoDevoService.getLineage(assertOrgId(context.organizationId), req.params.genomeKey));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.post("/evo-devo/populations", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.status(201).json(await evolutionPopulationService.createPopulation(assertOrgId(context.organizationId), req.body));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.post("/evo-devo/populations/:populationKey/members", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.status(201).json(await evolutionPopulationService.addMember(assertOrgId(context.organizationId), req.params.populationKey, req.body?.phenotypeId, req.body?.cohort));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.post("/evo-devo/phenotypes/:phenotypeId/evaluations", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.status(201).json(await evolutionPopulationService.recordEvaluation(assertOrgId(context.organizationId), req.params.phenotypeId, req.body));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.post("/evo-devo/populations/:populationKey/select", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.status(201).json(await evolutionPopulationService.select(assertOrgId(context.organizationId), req.params.populationKey));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.get("/evo-devo/phenotypes/:phenotypeId/stage", async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.json(await evolutionLifecycleService.getCurrentStage(assertOrgId(context.organizationId), req.params.phenotypeId));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.post("/evo-devo/phenotypes/:phenotypeId/transitions", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.status(201).json(await evolutionLifecycleService.transition(assertOrgId(context.organizationId), req.params.phenotypeId, req.body, String(context.userId || "evolution-operator")));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.post("/evo-devo/phenotypes/:phenotypeId/outcomes/good-question", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.status(201).json(await evolutionOutcomeService.recordGoodQuestion(assertOrgId(context.organizationId), req.params.phenotypeId, req.body));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.post("/evo-devo/phenotypes/:phenotypeId/outcomes/prediction", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.status(201).json(await evolutionOutcomeService.recordPrediction(assertOrgId(context.organizationId), req.params.phenotypeId, req.body));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

router.post("/evo-devo/populations/:populationKey/reproduce", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        res.status(201).json(await evolutionReproductionService.selectAndReproduce(assertOrgId(context.organizationId), req.params.populationKey, req.body));
    } catch (error: any) { res.status(error.status || 400).json({ error: error.message }); }
});

/** List organization-scoped capability proposals. */
router.get("/capability-proposals", async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        const organizationId = assertOrgId(context.organizationId);
        const rawStatus = typeof req.query.status === "string" ? req.query.status : undefined;
        const status = rawStatus && ["proposed", "promoted", "rejected"].includes(rawStatus)
            ? rawStatus as "proposed" | "promoted" | "rejected"
            : undefined;
        res.json({ proposals: await capabilityProposalService.list(organizationId, status) });
    } catch (error: any) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

/** Run the safe Evolution-to-capability discovery pass. */
router.post("/capability-proposals/discover", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        const organizationId = assertOrgId(context.organizationId);
        res.json(await evolutionService.discoverCapabilityProposals(organizationId, context.userId));
    } catch (error: any) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

/** Accept a proposal from another evidence producer (Knowledge, Learning, tools). */
router.post("/capability-proposals", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        const organizationId = assertOrgId(context.organizationId);
        const proposal = await capabilityProposalService.create(organizationId, {
            ...req.body,
            createdBy: context.userId,
        });
        res.status(201).json(proposal);
    } catch (error: any) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

/** Human approval promotes the proposed manifest through the governed ACDD pipeline. */
router.post("/capability-proposals/:id/promote", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        const organizationId = assertOrgId(context.organizationId);
        const proposalId = Number(req.params.id);
        if (!Number.isInteger(proposalId) || proposalId <= 0) return res.status(400).json({ error: "Invalid proposal id" });
        res.json(await capabilityProposalService.promote(organizationId, proposalId, context.userId, req.body?.reviewNote));
    } catch (error: any) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

router.post("/capability-proposals/:id/reject", requireOrgAdminOrSuper, async (req, res) => {
    try {
        const context = await getUserOrgContext(req);
        const organizationId = assertOrgId(context.organizationId);
        const proposalId = Number(req.params.id);
        if (!Number.isInteger(proposalId) || proposalId <= 0) return res.status(400).json({ error: "Invalid proposal id" });
        res.json(await capabilityProposalService.reject(organizationId, proposalId, context.userId, req.body?.reviewNote));
    } catch (error: any) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

/**
 * GET /api/evolution/pending
 * Returns list of pending evolution fixes awaiting HIL approval.
 */
router.get("/pending", async (req, res) => {
    try {
        const fixes = SelfHealingHandler.getPendingFixes();
        res.json(fixes);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/evolution/approve/:id
 * Approves and applies a specific evolution fix.
 */
router.post("/approve/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const pending = SelfHealingHandler.getPendingFixes().find(f => f.id === id);
        if (!pending) {
            return res.status(404).json({ error: "Fix not found or already processed." });
        }
        if ((pending as any).advisory || !pending.newContent?.trim()) {
            return res.status(400).json({ error: "This is a detection-only finding with no code patch to apply. Manual remediation required." });
        }

        const context = await getUserOrgContext(req);
        const actor = context.userId ? String(context.userId) : "evolution-approver";

        let result: any;
        let message: string;
        const skillId = (pending as any).skillId as number | undefined;

        if (skillId) {
            // Skill-backed fix → durable promotion with pre/post version snapshots (rollback-safe).
            const promotion = await skillPromotionService.applyDirectCodeChange(skillId, pending.newContent, {
                promotedBy: actor,
                strategy: pending.description,
            });
            if (!promotion) {
                return res.status(500).json({ error: `Skill ${skillId} not found — could not promote.` });
            }
            result = { mode: "skill-promotion", ...promotion };
            message = `Skill ${skillId} evolved and promoted (version ${promotion.versionId}). Rollback is available if reliability regresses.`;
        } else {
            // File-backed fix → apply on an isolated evolution branch.
            result = await SelfHealingHandler.applyEvolutionFix(pending.id, pending.filePath, pending.newContent);
            message = "Evolution fix applied on an isolated branch for review.";
        }

        SelfHealingHandler.clearFix(id);
        res.json({ success: true, message, result });
    } catch (error: any) {
        logger.error(`Failed to approve evolution: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/evolution/diff/:id
 * Returns a unified diff for a pending fix.
 */
router.get("/diff/:id", (req, res) => {
    try {
        const { id } = req.params;
        const diff = SelfHealingHandler.getFixDiff(id);
        res.json({ diff });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/evolution/export-telemetry
 */
router.get("/export-telemetry", async (req, res) => {
    try {
        const data = await benchmarkService.exportAnonymizedTelemetry();
        res.json(data);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/evolution/summary
 */
router.get("/summary", async (req, res) => {
    try {
        const metrics = await benchmarkService.calculateGlobalMetrics();
        res.json(metrics);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/evolution/benchmarks
 *
 * Federated node league table for the Evolution Flight Deck. The page has always
 * polled this every 60s, but no route existed, so it 404'd and rendered the empty
 * state. benchmarkService.getLeagueTable() already returned exactly the shape the
 * UI reads ({ rank, node, reliability, score }); it just had nothing in front of it.
 */
router.get("/benchmarks", async (req, res) => {
    try {
        const league = await benchmarkService.getLeagueTable();
        res.json(league);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/evolution/trigger-sync
 * Manual trigger for architecture optimisation and doc synthesis.
 */
router.post("/trigger-sync", async (req, res) => {
    try {
        const orgId = parseInt(req.query.orgId as string);
        if (isNaN(orgId) || orgId <= 0) {
            return res.status(400).json({ error: "orgId is required and must be a positive integer" });
        }
        const result = await evolutionService.triggerSelfOptimization(orgId);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/evolution/feedback/:id
 * Accept rating and feedback on a prompt version (HIL RLHF gating).
 */
router.post("/feedback/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { rating, feedback } = req.body;

        if (rating === undefined || typeof rating !== "number" || rating < 0 || rating > 100) {
            return res.status(400).json({ error: "rating must be a number between 0 and 100" });
        }

        const { organizationId } = await getUserOrgContext(req);
        if (!organizationId) {
            return res.status(400).json({ error: "Organization context required" });
        }

        // Retrieve prompt version
        let version;
        if (!isNaN(Number(id))) {
            version = await db.query.promptVersions.findFirst({
                where: and(
                    eq(promptVersions.id, Number(id)),
                    eq(promptVersions.organizationId, organizationId)
                )
            });
        }
        if (!version) {
            version = await db.query.promptVersions.findFirst({
                where: and(
                    eq(promptVersions.versionId, id),
                    eq(promptVersions.organizationId, organizationId)
                )
            });
        }

        if (!version) {
            return res.status(404).json({ error: `Prompt version ${id} not found under this organization.` });
        }

        const result = await evolutionService.recordPromptFeedback(version.id, rating);
        if (!result) {
            return res.status(400).json({ error: "Failed to record prompt feedback." });
        }

        res.json({
            success: true,
            message: "Human feedback recorded successfully.",
            promptVersionId: result.promptVersionId,
            newFitnessScore: result.newFitnessScore
        });
    } catch (error: any) {
        logger.error(`Failed to submit prompt feedback: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/evolution/datasets/generate
 * Trigger fine-tuning dataset generation for a specific prompt type.
 */
router.post("/datasets/generate", async (req, res) => {
    try {
        const { promptType } = req.body;
        if (!promptType) {
            return res.status(400).json({ error: "promptType is required in body" });
        }

        const { organizationId } = await getUserOrgContext(req);
        if (!organizationId) {
            return res.status(400).json({ error: "Organization context required" });
        }

        const result = await promptEvolutionEngine.generateTrainingDataset(organizationId, promptType);
        res.json({
            success: true,
            message: `Fine-tuning dataset generated successfully with ${result.count} examples.`,
            filePath: result.filePath,
            count: result.count
        });
    } catch (error: any) {
        logger.error(`Failed to generate training dataset: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/evolution/promote-immediate/:versionId
 * Force evaluate and promote/retire an experimental prompt version immediately.
 */
router.post("/promote-immediate/:versionId", async (req, res) => {
    try {
        const { versionId } = req.params;
        const { organizationId } = await getUserOrgContext(req);
        if (!organizationId) {
            return res.status(400).json({ error: "Organization context required" });
        }

        const result = await promptEvolutionEngine.evaluateAndPromoteImmediate(organizationId, versionId);
        if (!result.success) {
            return res.status(400).json({ error: result.message });
        }

        res.json(result);
    } catch (error: any) {
        logger.error(`Failed to evaluate/promote prompt version: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/evolution/rollback/:versionId
 * Rollback an active prompt version to its parent version.
 */
router.post("/rollback/:versionId", async (req, res) => {
    try {
        const { versionId } = req.params;
        const { organizationId } = await getUserOrgContext(req);
        if (!organizationId) {
            return res.status(400).json({ error: "Organization context required" });
        }

        const result = await promptEvolutionEngine.rollbackPromptVersion(organizationId, versionId);
        if (!result.success) {
            return res.status(400).json({ error: result.message });
        }

        res.json(result);
    } catch (error: any) {
        logger.error(`Failed to rollback prompt version: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

export { router as evolutionRouter };
