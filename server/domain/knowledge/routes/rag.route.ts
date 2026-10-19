
import { Router, type Request, type Response } from "express";
import { ragService } from "../core/rag/rag-workspace.service.js";
import { graphRagService } from "../core/rag/graph-rag.service.js";
import { agenticRagService } from "../core/rag/agentic-rag.service.js";
import { getUserOrgContext } from "../../../utils/auth-context.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { BadRequestError, ValidationError, ErrorCode, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger('RAG');
const router = Router();

// --- RAG Assets ---
router.get("/rag-assets", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const jobId = req.query.jobId ? parseInt(req.query.jobId as string) : null;
    const orgContext = await getUserOrgContext(req);
    const assets = await ragService.listAssets(jobId, orgContext.organizationId);
    res.json({ assets });
}));

router.post("/rag-assets", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const asset = await ragService.createAsset({ ...req.body, organizationId: orgContext.organizationId });
    logger.info('RAG asset created', { correlationId: req.correlationId, assetId: asset?.id, jobId: req.body.jobId, organizationId: orgContext.organizationId });
    res.status(201).json({ asset });
}));

router.put("/rag-assets/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const assetId = parseInt(req.params.id);
    const orgContext = await getUserOrgContext(req);
    const asset = await ragService.updateAsset(assetId, req.body, orgContext.organizationId);
    res.json({ asset });
}));

router.delete("/rag-assets/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const assetId = parseInt(req.params.id);
    if (isNaN(assetId)) throw new BadRequestError("Invalid asset ID", { assetId: req.params.id }, ErrorCode.INVALID_INPUT);

    const orgContext = await getUserOrgContext(req);
    await ragService.deleteAsset(assetId, orgContext.organizationId);
    logger.info('RAG asset deleted', { correlationId: req.correlationId, assetId });
    res.json({ success: true });
}));

router.post("/rag-assets/reorder", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { assetIds } = req.body;
    if (!Array.isArray(assetIds)) throw new ValidationError("assetIds must be an array", { field: 'assetIds' });

    const updatedAssets = await ragService.reorderAssets(assetIds);
    res.json({ success: true, assets: updatedAssets });
}));

router.post("/rag-assets/upload", requireAuth, async (req: Request, res: Response) => {
    try {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
            try {
                const boundary = req.headers['content-type']?.split('boundary=')[1];
                if (!boundary) return res.status(400).json({ message: "Invalid content type" });

                const buffer = Buffer.concat(chunks);
                const parts = buffer.toString('binary').split(`--${boundary}`);
                let fileData: string | null = null;
                let fileName: string = 'upload';
                let contentType: string = 'application/octet-stream';

                for (const part of parts) {
                    if (part.includes('Content-Disposition: form-data') && part.includes('name="file"')) {
                        const lines = part.split('\r\n');
                        const contentStart = part.indexOf('\r\n\r\n') + 4;
                        const contentEnd = part.lastIndexOf('\r\n--');
                        const fileContent = part.substring(contentStart, contentEnd);

                        const disposition = lines.find(l => l.includes('Content-Disposition'));
                        if (disposition) {
                            const filenameMatch = disposition.match(/filename="([^"]+)"/);
                            if (filenameMatch) fileName = filenameMatch[1];
                        }

                        const contentTypeLine = lines.find(l => l.includes('Content-Type:'));
                        if (contentTypeLine) {
                            const ctMatch = contentTypeLine.match(/Content-Type:\s*(.+)/);
                            if (ctMatch) contentType = ctMatch[1].trim();
                        }

                        fileData = Buffer.from(fileContent, 'binary').toString('base64');
                        break;
                    }
                }

                if (!fileData) return res.status(400).json({ message: "No file provided" });
                const fileSize = Buffer.from(fileData, 'base64').length;
                if (fileSize > 10 * 1024 * 1024) return res.status(400).json({ message: "File size exceeds 10MB limit" });

                res.json({ fileData: `data:${contentType};base64,${fileData}`, contentType, fileSize, fileName });
            } catch (error: any) {
                res.status(500).json({ message: error.message });
            }
        });
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
});

// --- Job Output Management ---
router.get("/job-outputs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const jobId = parseInt(req.query.jobId as string);
    if (isNaN(jobId)) throw new ValidationError("jobId query parameter required", { field: 'jobId' });

    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const tags = req.query.tags ? (req.query.tags as string).split(",") : undefined;

    const orgContext = await getUserOrgContext(req);
    const { outputs, total } = await ragService.listJobOutputs(jobId, {
        organizationId: orgContext.organizationId,
        limit,
        offset,
        tags
    });

    res.json({ outputs, total });
}));

router.get("/jobs/:id/outputs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const jobId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const tags = req.query.tags ? (req.query.tags as string).split(",") : undefined;

    const { outputs, total } = await ragService.listJobOutputs(jobId, {
        organizationId: orgContext.organizationId,
        limit,
        offset,
        tags
    });

    res.json({ outputs, total });
}));

router.delete("/job-outputs/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const outputId = parseInt(req.params.id);

    await ragService.deleteJobOutput(outputId, orgContext.organizationId);
    logger.info('Job output deleted', { correlationId: req.correlationId, outputId });
    res.json({ success: true });
}));


// The list endpoint. Only /knowledge-documents/:id and /:id/nodes existed, so the
// Document Templates page — which fetches ['/api/knowledge-documents'] through the
// default query function — got a 404 on every load and rendered no documents.
// documentService.listDocuments already existed with org scoping; it simply had no
// route in front of it.
router.get("/knowledge-documents", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const { documentService } = await import("@domain/knowledge/core/extraction/document-service.js");

    const topicId = req.query.topicId ? parseInt(req.query.topicId as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

    const docs = await documentService.listDocuments(orgContext, {
        ...(topicId !== undefined && !isNaN(topicId) ? { topicId } : {}),
        ...(limit !== undefined && !isNaN(limit) ? { limit } : {}),
        ...(offset !== undefined && !isNaN(offset) ? { offset } : {}),
    });
    res.json(docs);
}));

router.get("/knowledge-documents/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const docId = parseInt(req.params.id);
    if (isNaN(docId)) throw new BadRequestError("Invalid document ID");

    const orgContext = await getUserOrgContext(req);
    const doc = await ragService.getDocumentById(docId, orgContext.organizationId);
    res.json(doc);
}));

router.get("/knowledge-documents/:id/nodes", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const documentId = parseInt(req.params.id, 10);
    const result = await ragService.getDocumentNodes(documentId, orgContext.organizationId);
    res.json(result);
}));

router.get("/jobs/:id/latest-knowledge-document", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const jobId = parseInt(req.params.id, 10);
    const knowledgeDocumentId = await ragService.getLatestJobDocument(jobId, orgContext.organizationId);
    res.json({ knowledgeDocumentId });
}));

router.get("/entities/options", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const type = req.query.type as string;
    if (!type) throw new ValidationError("Type query parameter is required", { field: 'type' });
    const orgContext = await getUserOrgContext(req);
    const options = await ragService.getEntityOptions(type, orgContext.organizationId);
    res.json(options);
}));

// --- GraphRAG (Research-Enhanced Multi-Hop RAG) ---

router.post("/graph-query", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { query, maxHops = 2, maxResults = 5, includePaths = true } = req.body;

    if (!query || typeof query !== 'string') {
        throw new ValidationError("Query string is required", { field: 'query' });
    }

    const orgContext = await getUserOrgContext(req);

    logger.info('GraphRAG query initiated', {
        correlationId: req.correlationId,
        query: query.substring(0, 100),
        organizationId: orgContext.organizationId,
        maxHops,
        maxResults
    });

    const results = await graphRagService.retrieveWithGraphTraversal(
        query,
        orgContext,
        {
            maxHops,
            maxResults,
            includePaths,
            similarityThreshold: 0.7
        }
    );

    logger.info('GraphRAG query completed', {
        correlationId: req.correlationId,
        resultsCount: results.length,
        organizationId: orgContext.organizationId
    });

    res.json({
        query,
        results,
        meta: {
            maxHops,
            totalResults: results.length,
            sources: results.reduce((acc, r) => {
                acc[r.source] = (acc[r.source] || 0) + 1;
                return acc;
            }, {} as Record<string, number>)
        }
    });
}));

router.post("/semantic-neighbors", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { nodeId, maxNeighbors = 5 } = req.body;

    if (!nodeId || typeof nodeId !== 'number') {
        throw new ValidationError("nodeId is required", { field: 'nodeId' });
    }

    const orgContext = await getUserOrgContext(req);

    const neighbors = await graphRagService.findSemanticNeighbors(
        nodeId,
        orgContext,
        maxNeighbors
    );

    res.json({
        nodeId,
        neighbors,
        count: neighbors.length
    });
}));

// --- Agentic RAG (KA-RAG with Query Planning) ---

router.post("/agentic-query", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { query, maxHops = 2, maxResults = 5, minConfidence = 0.6, includeReasoning = true } = req.body;

    if (!query || typeof query !== 'string') {
        throw new ValidationError("Query string is required", { field: 'query' });
    }

    const orgContext = await getUserOrgContext(req);

    logger.info('Agentic RAG query initiated', {
        correlationId: req.correlationId,
        query: query.substring(0, 100),
        organizationId: orgContext.organizationId
    });

    const result = await agenticRagService.retrieveAgentically(
        query,
        orgContext,
        {
            maxHops,
            maxResults,
            minConfidence,
            includeReasoning
        }
    );

    logger.info('Agentic RAG query completed', {
        correlationId: req.correlationId,
        resultsCount: result.results.length,
        coverage: `${result.coverage.foundNeeds}/${result.coverage.totalNeeds}`,
        confidence: result.coverage.confidence
    });

    res.json({
        query,
        ...result,
        hasSufficientInfo: agenticRagService.hasSufficientInformation(result.coverage, minConfidence)
    });
}));

router.post("/agentic-concept-expand", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { concept, maxResults = 5 } = req.body;

    if (!concept || typeof concept !== 'string') {
        throw new ValidationError("Concept string is required", { field: 'concept' });
    }

    const orgContext = await getUserOrgContext(req);

    const neighbors = await agenticRagService.findSemanticNeighbors(
        concept,
        orgContext,
        maxResults
    );

    res.json({
        concept,
        expandedConcepts: neighbors,
        count: neighbors.length
    });
}));

export default router;
