/**
 * Improvement loop API (§12).
 *
 * Every handler resolves the organization from the session and refuses without
 * one. Authority for a lifecycle transition comes from the session's admin
 * flags — never from the request body, and never from an actor's own claim
 * about itself.
 */

import { Router } from "express";

import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { improvementOpportunityService } from "../core/improvement-opportunity.service.js";
import { improvementExperimentService } from "../core/improvement-experiment.service.js";
import { workflowImportService } from "../core/workflow-import.service.js";
import { capabilityGapAnalysisService } from "../core/capability-gap-analysis.service.js";
import { improvementObservabilityService } from "../core/improvement-observability.service.js";
import { ImprovementTransitionError } from "../core/improvement-lifecycle.js";
import { ObservationFactsError } from "../core/observation-facts.js";
import { PreRegistrationError } from "../core/experiment-criteria.service.js";
import type { ImprovementActor } from "../core/improvement-lifecycle.js";
import type { ImprovementKind, ImprovementStatus } from "@shared/schema/improvement/index.js";

const logger = createLogger("ImprovementRoutes");
const router = Router();

router.use(requireAuth);

/**
 * Build the acting identity from the SESSION, not the payload.
 *
 * A request cannot describe itself as an authorized human. `hasApprovalAuthority`
 * is derived from session permission flags, so an agent-driven call carries an
 * agent actor and is refused by the lifecycle gate regardless of what it sends.
 */
async function actorFromRequest(req: any): Promise<ImprovementActor> {
    const orgContext = await getUserOrgContext(req);
    return {
        type: "user",
        id: String(orgContext.userId ?? req.user?.id ?? "unknown"),
        hasApprovalAuthority: Boolean(
            (orgContext as any).isOrgAdmin || (orgContext as any).isAdmin || (orgContext as any).isSuperAdmin,
        ),
    };
}

function handleError(res: any, error: unknown, context: string) {
    if (error instanceof ImprovementTransitionError) {
        // 409: the request was well-formed, the state or authority forbids it.
        return res.status(409).json({ error: error.message, code: error.code });
    }
    if (error instanceof ObservationFactsError) {
        return res.status(422).json({
            error: error.message,
            violations: error.violations,
        });
    }
    if (error instanceof PreRegistrationError) {
        // 422: the experiment exists but its criteria are not yet settled.
        // Returns every missing field, not just the first.
        return res.status(422).json({ error: error.message, issues: error.issues });
    }
    const status = (error as any)?.statusCode ?? (error as any)?.status ?? 500;
    const message = error instanceof Error ? error.message : String(error);
    if (status >= 500) logger.error(`[Improvement] ${context} failed: ${message}`);
    return res.status(status).json({ error: message });
}

/* ────────────────────────────  opportunities  ─────────────────────────────── */

router.get("/opportunities", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const rows = await improvementOpportunityService.list(orgId, {
            status: req.query.status as ImprovementStatus | undefined,
            kind: req.query.kind as ImprovementKind | undefined,
        });
        res.json({ count: rows.length, opportunities: rows });
    } catch (error) {
        handleError(res, error, "list opportunities");
    }
});

router.post("/opportunities", async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        const orgId = requireOrgId(orgContext);
        const row = await improvementOpportunityService.create(orgId, {
            ...req.body,
            createdByType: req.body?.createdByType ?? "user",
            createdById: req.body?.createdById ?? String(orgContext.userId ?? "unknown"),
        });
        res.status(201).json(row);
    } catch (error) {
        handleError(res, error, "create opportunity");
    }
});

router.get("/opportunities/:id", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        res.json(await improvementOpportunityService.get(orgId, Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "get opportunity");
    }
});

/** Move an opportunity through the lifecycle. Gated transitions need authority. */
router.post("/opportunities/:id/transition", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const to = req.body?.to as ImprovementStatus;
        if (!to) return res.status(400).json({ error: "to is required" });

        const row = await improvementOpportunityService.transition(
            orgId,
            Number(req.params.id),
            to,
            await actorFromRequest(req),
        );
        res.json(row);
    } catch (error) {
        handleError(res, error, "transition opportunity");
    }
});

/* ────────────────────────────  observations  ─────────────────────────────── */

router.get("/opportunities/:id/observations", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const rows = await improvementOpportunityService.listObservations(orgId, Number(req.params.id));
        res.json({ count: rows.length, observations: rows });
    } catch (error) {
        handleError(res, error, "list observations");
    }
});

router.post("/opportunities/:id/observations", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const { observation, deduplicated } = await improvementOpportunityService.addObservation(
            orgId,
            Number(req.params.id),
            req.body,
        );
        // 200 rather than 201 on a duplicate: nothing new was recorded, and the
        // caller should be able to tell.
        res.status(deduplicated ? 200 : 201).json({ observation, deduplicated });
    } catch (error) {
        handleError(res, error, "add observation");
    }
});

/* ─────────────────────────────  hypotheses  ──────────────────────────────── */

router.get("/opportunities/:id/hypotheses", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const rows = await improvementOpportunityService.listHypotheses(orgId, Number(req.params.id));
        res.json({ count: rows.length, hypotheses: rows });
    } catch (error) {
        handleError(res, error, "list hypotheses");
    }
});

router.post("/opportunities/:id/hypotheses", async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        const orgId = requireOrgId(orgContext);
        const row = await improvementOpportunityService.addHypothesis(orgId, Number(req.params.id), {
            ...req.body,
            authorType: req.body?.authorType ?? "user",
            authorId: req.body?.authorId ?? String(orgContext.userId ?? "unknown"),
        });
        res.status(201).json(row);
    } catch (error) {
        handleError(res, error, "add hypothesis");
    }
});

/* ─────────────────────────────  experiments  ─────────────────────────────── */

router.get("/opportunities/:id/experiments", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const rows = await improvementExperimentService.listForOpportunity(orgId, Number(req.params.id));
        res.json({ count: rows.length, experiments: rows });
    } catch (error) {
        handleError(res, error, "list experiments");
    }
});

router.post("/opportunities/:id/experiments", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const row = await improvementExperimentService.create(orgId, {
            ...req.body,
            opportunityId: Number(req.params.id),
        });
        res.status(201).json(row);
    } catch (error) {
        handleError(res, error, "create experiment");
    }
});

router.get("/experiments/:id", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        res.json(await improvementExperimentService.get(orgId, Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "get experiment");
    }
});

router.patch("/experiments/:id", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        res.json(await improvementExperimentService.update(orgId, Number(req.params.id), req.body));
    } catch (error) {
        handleError(res, error, "update experiment");
    }
});

/** Report what is still missing, without changing state. */
router.get("/experiments/:id/pre-registration", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        res.json(await improvementExperimentService.checkPreRegistration(orgId, Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "check pre-registration");
    }
});

router.post("/experiments/:id/request-approval", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        res.json(await improvementExperimentService.requestApproval(orgId, Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "request approval");
    }
});

router.post("/experiments/:id/approve", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const row = await improvementExperimentService.approve(
            orgId,
            Number(req.params.id),
            await actorFromRequest(req),
        );
        res.json(row);
    } catch (error) {
        handleError(res, error, "approve experiment");
    }
});

router.post("/experiments/:id/launch", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const missionId = Number(req.body?.missionId);
        if (!Number.isInteger(missionId)) {
            return res.status(400).json({ error: "missionId is required" });
        }
        res.json(await improvementExperimentService.launch(
            orgId,
            Number(req.params.id),
            missionId,
            req.body?.shadowMissionId ? Number(req.body.shadowMissionId) : undefined,
        ));
    } catch (error) {
        handleError(res, error, "launch experiment");
    }
});

router.get("/experiments/:id/results", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const rows = await improvementExperimentService.getResults(orgId, Number(req.params.id));
        res.json({ count: rows.length, results: rows });
    } catch (error) {
        handleError(res, error, "get results");
    }
});

/**
 * Attach measurements. The verdict is computed here — a caller supplies
 * numbers, never an outcome.
 */
router.post("/experiments/:id/results", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const row = await improvementExperimentService.recordResult(
            orgId,
            Number(req.params.id),
            req.body?.measured,
            req.body?.dataQuality ?? {},
        );
        res.status(201).json(row);
    } catch (error) {
        handleError(res, error, "record result");
    }
});

router.post("/results/:id/disposition", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const row = await improvementExperimentService.setDisposition(
            orgId,
            Number(req.params.id),
            await actorFromRequest(req),
            req.body?.disposition,
            req.body?.rationale,
        );
        res.json(row);
    } catch (error) {
        handleError(res, error, "set disposition");
    }
});

/* ─────────────────────────────  observability  ───────────────────────────── */

/**
 * §15 metrics, including the trust metrics.
 *
 * Every ratio reports its denominator, and a ratio over zero is null — "no
 * candidates lacked evidence" and "there were no candidates" are different
 * findings. `darkSubsystemSignals` names the built-but-not-running shapes.
 */
router.get("/metrics", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        res.json(await improvementObservabilityService.metrics(orgId));
    } catch (error) {
        handleError(res, error, "improvement metrics");
    }
});

/* ───────────────────────────  capability gaps  ───────────────────────────── */

/**
 * Scored capability-gap candidates (§6).
 *
 * `missing` gaps are scored; `unavailable` ones are returned unscored, because
 * a real tool outside a run's allotment is an access question and scoring it
 * for capability invention would propose building something that exists.
 */
router.get("/capability-gaps", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const report = await capabilityGapAnalysisService.analyze(
            orgId,
            {
                from: req.query.from ? new Date(req.query.from as string) : undefined,
                to: req.query.to ? new Date(req.query.to as string) : undefined,
            },
        );
        res.json(report);
    } catch (error) {
        handleError(res, error, "analyze capability gaps");
    }
});

/* ──────────────────────────────  workflows  ──────────────────────────────── */

/** Import returns the validation report, including every rejected row. */
router.post("/workflows/:key/import", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const report = await workflowImportService.importEvents(
            orgId,
            req.params.key,
            req.body?.sourceType,
            req.body?.sourceReference,
            Array.isArray(req.body?.events) ? req.body.events : [],
            req.body?.projectId ?? null,
        );
        res.status(201).json(report);
    } catch (error) {
        handleError(res, error, "import workflow events");
    }
});

router.get("/workflows/:key/measurements", async (req: any, res) => {
    try {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const report = await workflowImportService.measure(
            orgId,
            req.params.key,
            {
                from: req.query.from ? new Date(req.query.from as string) : undefined,
                to: req.query.to ? new Date(req.query.to as string) : undefined,
            },
            {
                minCasesForBottleneck: req.query.minCases ? Number(req.query.minCases) : undefined,
            },
        );
        res.json(report);
    } catch (error) {
        handleError(res, error, "measure workflow");
    }
});

export default router;
