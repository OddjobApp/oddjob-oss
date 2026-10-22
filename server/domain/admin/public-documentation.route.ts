import { Router, type Request, type Response } from "express";
import { documentationService } from "./documentation.service.js";
import { PUBLIC_FEATURE_DOCS } from "@shared/public-feature-docs.js";
import { asyncHandler } from "../../middleware/error-handler.js";
import { createRateLimiter } from "../../middleware/rate-limiter.js";
import { BadRequestError } from "../../utils/errors.js";

export const publicDocumentationRouter = Router();
publicDocumentationRouter.use(createRateLimiter({ windowMs: 60_000, maxRequests: 60 }));
// Public readers cannot select an organization, document id, or source path.
publicDocumentationRouter.use((req, _res, next) => {
  if (Object.keys(req.query).length) return next(new BadRequestError("Public documentation does not accept query parameters"));
  next();
});
publicDocumentationRouter.get("/", (_req, res) => {
  res.set("Cache-Control", "public, max-age=60").json({ guides: PUBLIC_FEATURE_DOCS.map(({slug,title}) => ({slug,title})) });
});
publicDocumentationRouter.get("/:slug", asyncHandler(async (req: Request, res: Response) => {
  const doc = await documentationService.getPublicFeatureSpec(req.params.slug);
  res.set({ "Cache-Control": "public, max-age=60, must-revalidate", ETag: `"${doc.revision}"` });
  if (req.get("If-None-Match") === `"${doc.revision}"`) { res.status(304).end(); return; }
  res.json(doc);
}));
