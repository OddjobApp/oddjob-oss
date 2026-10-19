import { Router } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { assertOrgId, getUserOrgContext } from "@server/utils/auth-context.js";
import { queueStreamBatch } from "../stream-queue.js";
import type { OntologyMappingSchema } from "../core/indexing/ontology-mapper.js";

const streamRouter = Router();

// A generic webhook ingestion endpoint.
// In a full production setup with high throughput, you would drop 'requireAuth'
// for HMAC-based webhook validation and bypass standard user context.
streamRouter.post("/webhooks/ingest", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgContext = await getUserOrgContext(req);
    
    // Expects { payload: any | any[], schema: OntologyMappingSchema }
    const { payload, schema } = req.body;
    
    if (!payload || !schema) {
        return res.status(400).json({ error: "Missing required 'payload' or 'schema' fields" });
    }

    const payloadArray = Array.isArray(payload) ? payload : [payload];

    // Push immediately to high-speed BullMQ queue for backpressure control
    const jobId = await queueStreamBatch({
        payloads: payloadArray,
        schema: schema as OntologyMappingSchema,
        organizationId: assertOrgId(orgContext.organizationId) // Fallback for testing
    });

    res.status(202).json({ 
        message: "Stream payload accepted", 
        batchSize: payloadArray.length,
        jobId: jobId.id 
    });
}));

export default streamRouter;
