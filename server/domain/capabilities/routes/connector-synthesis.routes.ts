/**
 * Connector Synthesis REST API Routes
 *
 * API endpoint for ingesting OpenAPI v3 specs or REST endpoint definitions and auto-synthesizing connectors.
 */

import { Router } from "express";
import { createLogger } from "@server/utils/logger.js";
import { apiConnectorSynthesizerService } from "../core/api-connector-synthesizer.service.js";

const logger = createLogger("ConnectorSynthesisRoutes");
const router = Router();

/**
 * POST /api/oddjob/capabilities/synthesize-connector
 * Synthesizes a new third-party API connector tool from an OpenAPI spec
 */
router.post("/synthesize-connector", async (req, res) => {
  try {
    const { organizationId = 1, spec } = req.body;
    if (!spec || !spec.title || !spec.baseUrl || !Array.isArray(spec.endpoints)) {
      return res.status(400).json({ error: "spec object with title, baseUrl, and endpoints array is required" });
    }

    const result = await apiConnectorSynthesizerService.synthesizeConnector(organizationId, spec);
    return res.json(result);
  } catch (error: any) {
    logger.error(`[ConnectorSynthesisRoutes] Connector synthesis failed:`, error.message);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
