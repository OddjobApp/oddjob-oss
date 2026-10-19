import { Router } from "express";

import knowledgeGraphRouter from "./routes/knowledge-graph.route.js";
import knowledgeExtractionRouter from "./routes/knowledge-extraction.route.js";
import searchRouter from "./routes/search.route.js";
import ragRouter from "./routes/rag.route.js";
import datasetsRouter from "./routes/datasets.route.js";
import collectionsRouter from "./routes/collections.route.js";
import documentTemplatesRouter from "./routes/document-templates.route.js";
import maturityRouter from "./routes/maturity.route.js";
import streamRouter from "./routes/stream.route.js";
import ingestionOrchestratorRouter from "./routes/ingestion-orchestrator.route.js";
import ontologyRouter from "./routes/ontology.route.js";
import predictedLinksRouter from "./routes/predicted-links.route.js";
import { calculationsRouter } from "./routes/calculations.route.js";
import { podRegistry } from "../core/infrastructure/pod-registry.service.js";

// Service Exports - Using explicit naming to avoid collisions
export { calculationService } from "./core/calculations/calculation.service.js";
export { knowledgeService } from "./knowledge.service.js";
export { KnowledgeExtractionService } from "./core/extraction/knowledge-extraction.js";
export { KnowledgeExtractor } from "./core/extraction/knowledge-extractor.js";
export * from "./core/extraction/knowledge-graph-extractor.js";
export { documentService } from "./core/extraction/document-service.js";
export { enrichmentService } from "./core/extraction/enrichment-service.js";
export { taggingService } from "./core/extraction/tagging-service.js";
export { datasetService } from "./core/dataset-service.js";
export { documentTemplateService } from "./core/document-template.service.js";
export { queueExtractionJob, startExtractionWorker } from "./knowledge-queue.js";
export { queueStreamBatch, startStreamWorker } from "./stream-queue.js";
export { OntologyMapper } from "./core/indexing/ontology-mapper.js";
export { fileStorage, fileStorageSuccess } from "./core/file-storage.js";
export { storageService } from "./core/storage-service.js";

export { qdrantPublisher } from "./core/indexing/qdrant-publisher.js";
export { pgvectorService } from "./core/indexing/pgvector-service.js";

export { searchService } from "./core/search/search-service.js";
export { searchAnalyticsService } from "./core/search/search-analytics-service.js";

import { ragService as workspace } from "./core/rag/rag-workspace.service.js";
import { ragService as agent } from "./core/rag/rag-agent.service.js";

export const ragService = { ...workspace, ...agent };
export { workspace as ragWorkspaceService, agent as ragAgentService };
export { contextService } from "./core/rag/context-service.js";

export { graphService } from "./core/graph/graph-service.js";
export { conceptService } from "./core/graph/concept-service.js";

export { systemKnowledgeService } from "./core/system-knowledge-service.js";
export { topicService } from "./core/topic-service.js";
export { analysisService } from "./core/analysis-service.js";
export { statsService } from "./core/stats-service.js";

import { systemKnowledgeService } from "./core/system-knowledge-service.js";
import { searchService } from "./core/search/search-service.js";
import { graphService } from "./core/graph/graph-service.js";
import { KnowledgeExtractionService } from "./core/extraction/knowledge-extraction.js";

// Register Pod Facade
podRegistry.register('knowledge', {
    knowledge: systemKnowledgeService,
    search: searchService,
    graph: graphService,
    extraction: KnowledgeExtractionService
});

export * from "./core/types.js";

const knowledgeRouter = Router();

knowledgeRouter.use("/knowledge/predictions", predictedLinksRouter);
knowledgeRouter.use("/knowledge", knowledgeGraphRouter);
knowledgeRouter.use("/knowledge-graph", knowledgeGraphRouter);
knowledgeRouter.use("/knowledge-extraction", knowledgeExtractionRouter);
knowledgeRouter.use("/search", searchRouter);
knowledgeRouter.use("/datasets", datasetsRouter);
knowledgeRouter.use("/collections", collectionsRouter);
knowledgeRouter.use("/document-templates", documentTemplatesRouter);
knowledgeRouter.use("/knowledge/maturity", maturityRouter);
knowledgeRouter.use("/stream", streamRouter);
knowledgeRouter.use("/research", ingestionOrchestratorRouter);
knowledgeRouter.use("/ontology", ontologyRouter);
knowledgeRouter.use("/", calculationsRouter);
knowledgeRouter.use("/", ragRouter);
knowledgeRouter.use("/", knowledgeGraphRouter); // Mount at root to support /api/topics etc.

export default knowledgeRouter;


