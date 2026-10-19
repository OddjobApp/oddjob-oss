import { Router, type Request, type Response } from "express";
import {
    insertExtractionBatchSchema
} from "@shared/schema/index.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { knowledgeExtractionService } from "../core/extraction/knowledge-extraction.service.js";
import { parseExtractionId, parseSingleExtractionInput } from "../core/extraction/knowledge-extraction-input.js";

const extractionRouter = Router();

// ============================================================================
// BATCH EXTRACTION
// ============================================================================

// GET /api/knowledge-extraction/batch
extractionRouter.get("/batch", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const batches = await knowledgeExtractionService.listBatches(requireOrgId(orgContext), 50);
    res.json(batches);
}));

// POST /api/knowledge-extraction/batch
extractionRouter.post("/batch", asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await getUserOrgContext(req);
    const user = (req as any).user;

    const input = insertExtractionBatchSchema.parse({
        ...req.body,
        organizationId: organizationId!,
        createdBy: String(user?.id)
    });

    const { documentIds, schemaId, name, description, priority } = input;

    try {
        const result = await knowledgeExtractionService.createBatchWithJobs({
            name,
            description: description ?? undefined,
            schemaId,
            organizationId: organizationId!,
            documentIds,
            priority: priority || 0,
            createdBy: String(user?.id)
        });
        res.json(result);
    } catch (err: any) {
        if (err.message === "Schema not found") throw new NotFoundError("Schema not found");
        throw err;
    }
}));

// GET /api/knowledge-extraction/batch/:id
extractionRouter.get("/batch/:id", asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid batch ID");

    const batch = await knowledgeExtractionService.getBatchById(id, organizationId!);
    if (!batch) throw new NotFoundError("Batch not found");
    res.json(batch);
}));

// GET /api/knowledge-extraction/batch/:id/details
extractionRouter.get("/batch/:id/details", asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid batch ID");

    const batch = await knowledgeExtractionService.getBatchById(id, organizationId!);
    if (!batch) throw new NotFoundError("Batch not found");

    const extractions = await knowledgeExtractionService.getBatchExtractions(id, organizationId!);

    res.json({ batch, extractions });
}));

// ============================================================================
// SINGLE EXTRACTION
// ============================================================================

// POST /api/knowledge-extraction
extractionRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const user = (req as any).user;
    const input = parseSingleExtractionInput(req.body);
    const extraction = await knowledgeExtractionService.createSingleExtraction({
        ...input,
        organizationId: requireOrgId(orgContext),
        createdBy: String(user?.id),
    });

    res.json(extraction);
}));

// GET /api/knowledge-extraction/document/:documentId
extractionRouter.get("/document/:documentId", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const documentId = parseExtractionId(req.params.documentId, "document");
    const extraction = await knowledgeExtractionService.getLatestDocumentExtraction(
        documentId,
        requireOrgId(orgContext),
    );

    if (!extraction) {
        res.status(404).json({ error: "No extraction found for this document" });
        return;
    }

    res.json(extraction);
}));

// GET /api/knowledge-extraction/:id (Generic route at the end)
extractionRouter.get("/:id", asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid extraction ID");

    const extraction = await knowledgeExtractionService.getExtractionById(id, organizationId!);
    if (!extraction) throw new NotFoundError("Extraction not found");

    res.json(extraction);
}));

export default extractionRouter;
