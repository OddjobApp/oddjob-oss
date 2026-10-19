import { Router, Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { getUserOrgContext } from "../../../utils/auth-context.js";
import { requireAuth, apiRateLimiter } from "../../auth/core/security.service.js";
import { httpConnectorService } from "../http-connector.service.js";

const httpConnectorRouter = Router();

const httpQuerySchema = z.object({
  url: z.string().url("A valid HTTP/HTTPS URL is required"),
  method: z.enum(["GET", "POST"]).optional().default("GET"),
  headers: z.record(z.string()).optional(),
  params: z.record(z.any()).optional(),
  body: z.any().optional(),
  jsonPath: z.string().optional(),
  credentialId: z.number().optional(),
  cacheTtlSeconds: z.number().min(0).max(86400).optional().default(60),
});

/**
 * POST /api/integrations/http-connector/query
 * Executes a governed external HTTP query (e.g. for live weather, market data, APIs)
 * with SSRF filtering, credential injection, and response caching.
 *
 * requireAuth is load-bearing, not boilerplate: getUserOrgContext returns an
 * anonymous context with a null org rather than throwing, and the `/api`
 * apiKeyAuth middleware is a no-op without a header — so without it this
 * endpoint is an unauthenticated server-side fetcher. The rate limiter bounds
 * it as a scanning and amplification surface.
 */
httpConnectorRouter.post(
  "/query",
  requireAuth,
  apiRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const payload = httpQuerySchema.parse(req.body);

    const result = await httpConnectorService.executeQuery(
      payload,
      orgContext.organizationId
    );

    if (!result.success) {
      return res.status(result.status || 502).json(result);
    }

    return res.status(200).json(result);
  })
);

export default httpConnectorRouter;
