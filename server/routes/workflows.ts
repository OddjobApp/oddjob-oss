import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getUserOrgContext } from "../utils/auth-context.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { validateIdParam, parseNumericParam } from "../utils/api-utils.js";
import { workflowLifecycleService } from "@domain/pipeline/core/workflow-lifecycle.service.js";
import { workflowSignalSubscriptionService } from "@domain/signal-intelligence/core/workflow-signal-subscription.service.js";
import { signalFiltersSchema } from "@shared/workflow-signals.js";

/**
 * Workflow lifecycle API: create a workflow over a draft pipeline, publish
 * immutable releases, activate them into environments, and start runs.
 * Thin controllers only — everything delegates to workflowLifecycleService
 * (lint:arch forbids db calls in route files).
 */

const router = Router();

const createSchema = z.object({
    pipelineId: z.number().int().positive(),
    projectId: z.number().int().positive().nullish(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).nullish(),
});

const publishSchema = z.object({
    description: z.string().max(4000).optional(),
}).optional().default({});

const activateSchema = z.object({
    releaseId: z.number().int().positive(),
    environment: z.string().min(1).max(64).optional(),
});

const runSchema = z.object({
    input: z.record(z.any()).optional(),
    environment: z.string().min(1).max(64).optional(),
}).optional().default({});

const signalSubscriptionCreateSchema = z.object({
    name: z.string().min(1).max(200),
    filters: signalFiltersSchema.optional().default({}),
    environment: z.string().min(1).max(64).optional(),
    cooldownMinutes: z.number().int().min(0).max(10080).optional(),
});

const signalSubscriptionPatchSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    filters: signalFiltersSchema.optional(),
    environment: z.string().min(1).max(64).optional(),
    cooldownMinutes: z.number().int().min(0).max(10080).optional(),
}).strict();

router.post("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const input = createSchema.parse(req.body);
    const workflow = await workflowLifecycleService.createFromPipeline(orgContext, input);
    res.status(201).json(workflow);
}));

router.get("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const projectId = req.query.projectId !== undefined
        ? validateIdParam(req.query.projectId, "projectId")
        : undefined;
    res.json(await workflowLifecycleService.list(orgContext, { projectId }));
}));

router.get("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    res.json(await workflowLifecycleService.get(orgContext, validateIdParam(req.params.id, "Workflow ID")));
}));

router.post("/:id/releases", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const input = publishSchema.parse(req.body ?? {});
    const { release, unchanged } = await workflowLifecycleService.publish(
        orgContext,
        validateIdParam(req.params.id, "Workflow ID"),
        input,
    );
    res.status(unchanged ? 200 : 201).json({ release, unchanged });
}));

router.get("/:id/releases", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    res.json(await workflowLifecycleService.listReleases(orgContext, validateIdParam(req.params.id, "Workflow ID")));
}));

router.post("/:id/deployments/activate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const input = activateSchema.parse(req.body);
    res.json(await workflowLifecycleService.activate(
        orgContext,
        validateIdParam(req.params.id, "Workflow ID"),
        input,
    ));
}));

for (const action of ["pause", "resume", "retire"] as const) {
    router.post(`/:id/deployments/:deploymentId/${action}`, requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        res.json(await workflowLifecycleService[action](
            orgContext,
            validateIdParam(req.params.id, "Workflow ID"),
            validateIdParam(req.params.deploymentId, "Deployment ID"),
        ));
    }));
}

router.post("/:id/runs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const input = runSchema.parse(req.body ?? {});
    const result = await workflowLifecycleService.startRun(
        orgContext,
        validateIdParam(req.params.id, "Workflow ID"),
        input,
    );
    res.status(202).json(result);
}));

router.get("/:id/runs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    res.json(await workflowLifecycleService.listRuns(
        orgContext,
        validateIdParam(req.params.id, "Workflow ID"),
        { limit: parseNumericParam(req.query.limit, 50) },
    ));
}));

router.get("/:id/signal-subscriptions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    res.json(await workflowSignalSubscriptionService.list(
        orgContext,
        validateIdParam(req.params.id, "Workflow ID"),
    ));
}));

router.post("/:id/signal-subscriptions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const input = signalSubscriptionCreateSchema.parse(req.body);
    const created = await workflowSignalSubscriptionService.create(
        orgContext,
        validateIdParam(req.params.id, "Workflow ID"),
        input,
    );
    res.status(201).json(created);
}));

router.patch("/:id/signal-subscriptions/:subId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const input = signalSubscriptionPatchSchema.parse(req.body);
    res.json(await workflowSignalSubscriptionService.update(
        orgContext,
        validateIdParam(req.params.id, "Workflow ID"),
        validateIdParam(req.params.subId, "Subscription ID"),
        input,
    ));
}));

router.delete("/:id/signal-subscriptions/:subId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    res.json(await workflowSignalSubscriptionService.remove(
        orgContext,
        validateIdParam(req.params.id, "Workflow ID"),
        validateIdParam(req.params.subId, "Subscription ID"),
    ));
}));

router.get("/:id/signal-deliveries", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    res.json(await workflowSignalSubscriptionService.deliveries(
        orgContext,
        validateIdParam(req.params.id, "Workflow ID"),
        parseNumericParam(req.query.limit, 50),
    ));
}));

export default router;
