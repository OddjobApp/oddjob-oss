import { Router, type Request, type Response } from "express";
import { validateIdParam } from "@server/utils/api-utils.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { fineTuningService } from "@domain/ai/core/fine-tuning.service.js";

const router = Router();
const logger = createLogger('FineTuningRoute');

// GET /api/fine-tuning/datasets - List all datasets
router.get("/datasets", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const datasets = await fineTuningService.listDatasets(organizationId, isSuperAdmin);

    logger.debug('Listed datasets', { correlationId: req.correlationId, count: datasets.length });
    res.json(datasets);
}));

// POST /api/fine-tuning/datasets - Create a new dataset
router.post("/datasets", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await getUserOrgContext(req);
    const userId = (req.session as any)?.userId;

    if (!organizationId) {
        throw new BadRequestError("Organization context required");
    }

    const dataset = await fineTuningService.createDataset(req.body, organizationId, userId);

    logger.info('Dataset created', {
        correlationId: req.correlationId,
        datasetId: dataset.id,
        name: dataset.name,
    });

    res.status(201).json(dataset);
}));

// DELETE /api/fine-tuning/datasets/:id - Delete a dataset
router.delete("/datasets/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const datasetId = validateIdParam(req.params.id);
    await fineTuningService.deleteDataset(datasetId, organizationId, isSuperAdmin);

    logger.info('Dataset deleted', { correlationId: req.correlationId, datasetId });
    res.json({ message: "Dataset deleted successfully" });
}));

// GET /api/fine-tuning/datasets/:id/examples
router.get("/datasets/:id/examples", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const datasetId = validateIdParam(req.params.id);
    const examples = await fineTuningService.listExamples(datasetId, organizationId, isSuperAdmin);
    res.json(examples);
}));

// POST /api/fine-tuning/datasets/:id/examples
router.post("/datasets/:id/examples", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const datasetId = validateIdParam(req.params.id);
    const example = await fineTuningService.createExample(datasetId, req.body, organizationId, isSuperAdmin);

    logger.info('Example created', { correlationId: req.correlationId, datasetId, exampleId: example.id });
    res.status(201).json(example);
}));

// POST /api/fine-tuning/datasets/:id/examples/import - Bulk Import (JSONL)
router.post("/datasets/:id/examples/import", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const datasetId = validateIdParam(req.params.id);
    const count = await fineTuningService.importExamples(datasetId, req.body.data, organizationId, isSuperAdmin);

    logger.info('Examples imported', { correlationId: req.correlationId, datasetId, count });
    res.status(201).json({ message: `Successfully imported ${count} examples` });
}));

// GET /api/fine-tuning/stats - Aggregate stats
router.get("/stats", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const stats = await fineTuningService.getStats(organizationId, isSuperAdmin);
    res.json(stats);
}));

// POST /api/fine-tuning/datasets/:id/train - Start training
router.post("/datasets/:id/train", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const datasetId = validateIdParam(req.params.id);
    if (!organizationId) {
        throw new BadRequestError("Organization context required for training");
    }

    const result = await fineTuningService.startTraining(datasetId, req.body, organizationId, isSuperAdmin);
    res.json(result);
}));

// GET /api/fine-tuning/datasets/:id/export?format=openai|anthropic|gemini - Export as JSONL
router.get("/datasets/:id/export", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const datasetId = validateIdParam(req.params.id);
    const formatParam = String(req.query.format ?? 'openai').toLowerCase();
    const format = (['openai', 'anthropic', 'gemini'] as const).includes(formatParam as any)
        ? (formatParam as 'openai' | 'anthropic' | 'gemini')
        : 'openai';
    const { data, count } = await fineTuningService.exportExamples(datasetId, organizationId, isSuperAdmin, format);

    logger.info('Dataset exported', { correlationId: req.correlationId, datasetId, format, exampleCount: count });

    res.setHeader('Content-Type', 'application/jsonl');
    res.setHeader('Content-Disposition', `attachment; filename="dataset-${datasetId}-${format}.jsonl"`);
    res.send(data);
}));

export function registerFineTuningRoutes(app: any) {
    app.use("/api/fine-tuning", router);
}

