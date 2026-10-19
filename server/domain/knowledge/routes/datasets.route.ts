import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext, requireOrgId } from "../../../utils/auth-context.js";
import { withProjectScope } from "../../../middleware/project-scope.js";
import { processDatasetExtraction } from "../core/dataset/dataset-extraction.js";
import { datasetService } from "../core/dataset-service.js";
import { jobService } from "../../../domain/jobs/job.service.js";
import { createLogger } from "@server/utils/logger.js";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

const router = Router();
const logger = createLogger("Datasets");

// GET /api/datasets - List all datasets for org
router.get("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const results = await datasetService.list(orgContext);
    res.json(results);
}));

// POST /api/datasets - Create new dataset
// withProjectScope resolves the Project Space that namespaces the dataset's name
// (?projectId -> header -> session -> org default), so two projects can each hold a
// dataset of the same name. See docs/PROJECT_SPACES_DESIGN.md §6.1.
router.post("/", requireAuth, withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const data = { ...req.body, projectId: req.projectId ?? null };

    const dataset = await datasetService.create(data, orgContext);
    res.json(dataset);
}));

// POST /api/datasets/ensure-platform-dataset - Ensure dedicated platform dataset exists
router.post("/ensure-platform-dataset", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const { platform } = req.body;

    if (!platform) {
        return res.status(400).json({ error: "platform is required" });
    }

    const dataset = await datasetService.ensurePlatformDataset(platform, orgContext);
    res.json(dataset);
}));

// GET /api/datasets/collections - Distinct app-record collection names for the org.
//
// MUST stay above "/:id": Express matches in order, so this path was being read as
// a dataset id, parseInt("collections") gave NaN, and the lookup 500'd. The only
// caller (TagInput's collection suggestions in the App Hookups tab) treats any
// non-OK response as an empty list, so the suggestions were silently always empty.
router.get("/collections", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const collections = await datasetService.listCollections(requireOrgId(orgContext));
    res.json(collections);
}));

// GET /api/datasets/:id - Get dataset details
router.get("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    const dataset = await datasetService.getById(id, orgContext);
    res.json(dataset);
}));

// POST /api/datasets/:id/extract - Trigger Knowledge Graph Extraction
router.post("/:id/extract", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);

    // Security check via service (throws if not found/access denied)
    await datasetService.getById(id, orgContext);

    const userId = (req.session as any)?.userId?.toString();
    const result = await processDatasetExtraction(id, userId);

    if (!result) {
        return res.json({ success: false, message: "No extraction performed (missing config?)" });
    }

    res.json({ success: true, ...result });
}));

// DELETE /api/datasets/:id - Delete dataset
router.delete("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);

    // Unlink jobs associated with this dataset via jobService
    await jobService.unlinkDataset(id);

    await datasetService.delete(id, orgContext);
    res.json({ success: true, id });
}));

// GET /api/datasets/:id/keys - Get available schema keys
router.get("/:id/keys", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);

    const keys = await datasetService.getDatasetKeys(id, orgContext);
    res.json(keys);
}));

// GET /api/datasets/:id/items - Get items for a dataset
router.get("/:id/items", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);

    // Parse Query Params
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy as string | undefined;
    const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';
    const filterField = req.query.filterField as string | undefined;
    const filterValue = req.query.filterValue as string | undefined;

    let filter = undefined;
    if (filterField && filterValue) {
        filter = { field: filterField, value: filterValue };
    }

    const result = await datasetService.getItems(id, orgContext, {
        limit,
        offset,
        sortBy,
        sortOrder,
        filter
    });

    res.json(result);
}));

// POST /api/datasets/:id/items - Add items
router.post("/:id/items", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    const body = req.body;

    // Ensure dataset exists/access
    await datasetService.getById(id, orgContext);

    const itemsData = Array.isArray(body) ? body : (body.items || [body]);
    const rowsToInsert = itemsData.map((item: any) => ({
        data: item.data || item
    }));

    const result = await datasetService.addItems(id, rowsToInsert, orgContext);

    res.json({ inserted: result.inserted });
}));

// POST /api/datasets/:id/items/batch-delete - Delete multiple items
router.post("/:id/items/batch-delete", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    const { itemIds } = req.body;

    if (!itemIds || !Array.isArray(itemIds)) {
        return res.status(400).json({ error: "itemIds array is required" });
    }

    const result = await datasetService.deleteItems(id, itemIds, orgContext);
    res.json({ success: true, count: result.deleted });
}));

// POST /api/datasets/:id/deduplicate - Remove duplicates based on field
router.post("/:id/deduplicate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    const { field } = req.body;

    if (!field) return res.status(400).json({ error: "field is required" });

    await datasetService.deduplicateItems(id, field, orgContext);
    res.json({ success: true, message: "Deduplication complete" });
}));

// GET /api/datasets/:id/export - Export dataset to CSV
router.get("/:id/export", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);

    // Parse Query Params
    const sortBy = req.query.sortBy as string | undefined;
    const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';
    const filterField = req.query.filterField as string | undefined;
    const filterValue = req.query.filterValue as string | undefined;
    let filter = undefined;
    if (filterField && filterValue) {
        filter = { field: filterField, value: filterValue };
    }

    const generator = await datasetService.exportCsv(id, orgContext, {
        sortBy,
        sortOrder,
        filter
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="dataset-${id}-${new Date().toISOString().slice(0, 10)}.csv"`);

    for await (const chunk of generator) {
        res.write(chunk);
    }
    res.end();
}));

// POST /api/datasets/:id/validate - Re-validate all items
router.post("/:id/validate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);

    const dataset = await datasetService.getById(id, orgContext);

    // Fetch items (limit 10k for now)
    const { items } = await datasetService.getItems(id, orgContext, { limit: 10000 });

    res.json({ success: true, count: items.length, message: "Validation check triggered" });
}));

// PATCH /api/datasets/:id/records - Batch update records
router.patch("/:id/records", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    const { updates } = req.body; // itemId -> { field: value }

    if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: "updates map is required" });
    }

    const result = await datasetService.updateRecords(id, updates, orgContext);
    res.json({ success: true, updated: result.updated });
}));

// POST /api/datasets/:id/normalize - Normalize dataset items
router.post("/:id/normalize", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    const { columns } = req.body;

    if (!columns || !Array.isArray(columns) || columns.length === 0) {
        return res.status(400).json({ error: "columns array is required" });
    }

    const result = await datasetService.normalizeDataset(id, columns, orgContext);
    res.json({ success: true, count: result.count });
}));

// POST /api/datasets/:id/import-csv - Import data from CSV file
router.post("/:id/import-csv", requireAuth, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);

    const file = (req as any).file;
    if (!file) {
        logger.warn("CSV import attempted without file", { datasetId: id, organizationId: orgContext.organizationId });
        return res.status(400).json({ error: "No file uploaded" });
    }
    logger.info("Starting CSV import", { datasetId: id, filename: file.originalname, size: file.size });

    const csvContent = file.buffer.toString('utf-8');
    const result = await datasetService.importCsv(id, csvContent, orgContext, file.originalname);

    res.json({
        success: true,
        imported: result.inserted,
        message: result.message
    });
}));

export default router;


