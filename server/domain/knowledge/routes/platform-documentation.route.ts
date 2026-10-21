import { Router } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { getPlatformDocumentationLibrary } from "../core/platform-documentation.service.js";

const router = Router();
router.use(requireAuth);
router.get("/", asyncHandler(async (req, res) => {
  const orgId = requireOrgId(await getUserOrgContext(req));
  const library = getPlatformDocumentationLibrary();
  const query = req.query.q;
  if (query !== undefined && (typeof query !== "string" || query.length > 1000)) throw new BadRequestError("Invalid documentation query");
  res.json({ documents: query ? library.search(query, orgId, 50) : library.list(orgId), scope: "platform", readOnly: true });
}));
router.get("/:id", asyncHandler(async (req, res) => {
  const orgId = requireOrgId(await getUserOrgContext(req));
  const document = getPlatformDocumentationLibrary().get(req.params.id, orgId);
  if (!document) throw new NotFoundError("Platform document not found");
  res.json(document);
}));
// No write routes: tenant APIs cannot publish, edit or delete platform guides.
export default router;
