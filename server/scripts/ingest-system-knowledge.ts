import 'dotenv/config';
import { systemIngestionService } from "@domain/knowledge/core/system-ingestion.service.js";
import { documentService } from "@domain/knowledge/core/extraction/document-service.js";
import { db } from "@server/database_service.js";

async function main() {
    console.log("Starting System Knowledge Ingestion...");

    try { await systemIngestionService.ingestDatabaseSchema(); console.log("Database Schema Ingested."); } catch (e) { console.error("DB Schema Ingest Failed", e); }
    try { await systemIngestionService.ingestJobTypes(); console.log("Job Types Ingested."); } catch (e) { console.error("Job Types Ingest Failed", e); }
    try { await systemIngestionService.ingestFrontendArchitecture(); console.log("Frontend Architecture Ingested."); } catch (e) { console.error("Frontend Ingest Failed", e); }
    try { await systemIngestionService.ingestBackendArchitecture(); console.log("Backend Architecture Ingested."); } catch (e) { console.error("Backend Ingest Failed", e); }

    console.log("Starting Bulk Re-indexing...");
    try {
        const result = await documentService.reindexAllDocuments({ organizationId: 1, isAdmin: true, isOrgAdmin: true } as any);
        console.log("Bulk Re-indexing Started:", result);
    } catch (e) {
        console.error("Bulk Re-indexing Failed", e);
    }

    console.log("Ingestion Complete.");
    process.exit(0);
}

main();

