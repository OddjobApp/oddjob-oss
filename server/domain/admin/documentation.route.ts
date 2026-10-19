
import { Router, type Request, type Response } from "express";
import { documentationService } from "./documentation.service.js";
import { asyncHandler } from "../../middleware/error-handler.js";
import { requireAuth } from "../auth/core/security.service.js";
import { getUserOrgContext, assertOrgId } from "../../utils/auth-context.js";
import { BadRequestError } from "@server/utils/errors.js";

const router = Router();

const FEATURE_ID_RE = /^[a-z0-9_-]+$/i;

// GET /api/documentation/status
router.get("/status", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = assertOrgId(orgContext.organizationId);
    const status = await documentationService.getStatus(organizationId);
    res.json(status);
}));

// GET /api/documentation/features
router.get("/features", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = assertOrgId(orgContext.organizationId);
    const features = await documentationService.getFeatures(organizationId);
    res.json({ features });
}));

// Singleton spec types (aggregate, one per org).
const SPEC_TYPES = new Set(["api", "ui", "capability"]);

// GET /api/documentation/specs/capability/availability
// The org overlay for the capability catalog. Registered BEFORE /specs/:specType
// so the literal path is not swallowed by the parameterized one.
router.get("/specs/capability/availability", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = assertOrgId(orgContext.organizationId);
    const overlay = await documentationService.getCapabilityAvailability(organizationId);
    res.json(overlay);
}));

// GET /api/documentation/specs/:specType  (api | ui | capability)
router.get("/specs/:specType", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { specType } = req.params;
    if (!SPEC_TYPES.has(specType)) {
        throw new BadRequestError(`Unknown spec type: ${specType}`);
    }
    const orgContext = await getUserOrgContext(req);
    const organizationId = assertOrgId(orgContext.organizationId);
    const spec = specType === "ui"
        ? await documentationService.getUiSpec(organizationId)
        : specType === "capability"
            ? await documentationService.getCapabilitySpec(organizationId)
            : await documentationService.getApiSpec(organizationId);
    res.json(spec);
}));

// POST /api/documentation/generate-spec/:specType  (force-regenerate)
router.post("/generate-spec/:specType", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { specType } = req.params;
    if (!SPEC_TYPES.has(specType)) {
        throw new BadRequestError(`Unknown spec type: ${specType}`);
    }
    const orgContext = await getUserOrgContext(req);
    const organizationId = assertOrgId(orgContext.organizationId);
    const success = specType === "ui"
        ? await documentationService.generateUiSpec(organizationId)
        : specType === "capability"
            ? await documentationService.generateCapabilitySpec(organizationId)
            : await documentationService.generateApiSpec(organizationId);
    res.json({ success });
}));

// GET /api/documentation/search?q=...
router.get("/search", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const orgContext = await getUserOrgContext(req);
    const organizationId = assertOrgId(orgContext.organizationId);
    const results = await documentationService.searchSpecs(q, organizationId);
    res.json({ results });
}));

// GET /api/documentation/features/:featureId/spec
router.get("/features/:featureId/spec", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { featureId } = req.params;
    if (!FEATURE_ID_RE.test(featureId)) {
        throw new BadRequestError("Invalid featureId — must contain only letters, numbers, hyphens, and underscores");
    }
    const orgContext = await getUserOrgContext(req);
    const organizationId = assertOrgId(orgContext.organizationId);
    const spec = await documentationService.getFeatureSpec(featureId, organizationId);
    res.json(spec);
}));

// POST /api/documentation/generate/:featureId
router.post("/generate/:featureId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { featureId } = req.params;
    if (!FEATURE_ID_RE.test(featureId)) {
        throw new BadRequestError("Invalid featureId — must contain only letters, numbers, hyphens, and underscores");
    }
    const orgContext = await getUserOrgContext(req);
    const organizationId = assertOrgId(orgContext.organizationId);
    const success = await documentationService.generateForFeature(featureId, organizationId);
    res.json({ success });
}));

// POST /api/documentation/generate-all
router.post("/generate-all", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = assertOrgId(orgContext.organizationId);
    const result = await documentationService.generateAll(organizationId, true);
    res.json(result);
}));

// GET /api/documentation/changes
router.get("/changes", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = assertOrgId(orgContext.organizationId);
    const changes = await documentationService.getChangeRegister(organizationId);
    res.json({ changes });
}));

// PATCH /api/documentation/changes/:id — show/hide a register entry
router.patch("/changes/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const changeId = Number(req.params.id);
    const { hidden } = req.body ?? {};
    if (!Number.isInteger(changeId) || changeId <= 0) throw new BadRequestError("Invalid change id");
    if (typeof hidden !== "boolean") throw new BadRequestError("hidden (boolean) is required");
    const orgContext = await getUserOrgContext(req);
    const organizationId = assertOrgId(orgContext.organizationId);
    const result = await documentationService.setChangeVisibility(changeId, organizationId, hidden);
    res.json(result);
}));

// GET /api/documentation/releases
router.get("/releases", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = assertOrgId(orgContext.organizationId);
    const releases = await documentationService.getReleaseNotes(organizationId);
    res.json({ releases });
}));

// POST /api/documentation/releases
router.post("/releases", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { title, version, changeIds, hideAddedFromRegister } = req.body ?? {};
    if (typeof title !== "string" || (version != null && typeof version !== "string") || !Array.isArray(changeIds)) {
        throw new BadRequestError("title, optional version, and changeIds are required");
    }
    const orgContext = await getUserOrgContext(req);
    const organizationId = assertOrgId(orgContext.organizationId);
    const release = await documentationService.createReleaseNotes(organizationId, { title, version, changeIds, hideAddedFromRegister: hideAddedFromRegister === true });
    res.status(201).json(release);
}));

// PATCH /api/documentation/releases/:releaseId
router.patch("/releases/:releaseId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const releaseId = Number(req.params.releaseId);
    const { title, version, changeIds, hideAddedFromRegister } = req.body ?? {};
    if (!Number.isInteger(releaseId) || releaseId <= 0) throw new BadRequestError("Invalid releaseId");
    if (typeof title !== "string" || (version != null && typeof version !== "string") || !Array.isArray(changeIds)) {
        throw new BadRequestError("title, optional version, and changeIds are required");
    }
    const orgContext = await getUserOrgContext(req);
    const organizationId = assertOrgId(orgContext.organizationId);
    const release = await documentationService.updateReleaseNotes(releaseId, organizationId, { title, version, changeIds, hideAddedFromRegister: hideAddedFromRegister === true });
    res.json(release);
}));

// POST /api/documentation/releases/:releaseId/publish
router.post("/releases/:releaseId/publish", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const releaseId = Number(req.params.releaseId);
    if (!Number.isInteger(releaseId) || releaseId <= 0) throw new BadRequestError("Invalid releaseId");
    const orgContext = await getUserOrgContext(req);
    const organizationId = assertOrgId(orgContext.organizationId);
    const release = await documentationService.publishReleaseNotes(releaseId, organizationId);
    res.json(release);
}));

// --- BEST PRACTICES & AGENT PATTERN REPOSITORY ---
import { bestPracticesService } from "./best-practices.service.js";

// GET /api/documentation/best-practices
router.get("/best-practices", asyncHandler(async (req: Request, res: Response) => {
    const audience = typeof req.query.audience === "string" ? req.query.audience.toUpperCase() : undefined;
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const refresh = req.query.refresh === "true";

    let articles = search
        ? await bestPracticesService.searchArticles(search)
        : await bestPracticesService.getArticles(refresh);

    if (audience && audience !== "ALL") {
        articles = articles.filter(a => a.audience.includes(audience as any) || a.badge === audience);
    }
    if (category && category !== "all") {
        articles = articles.filter(a => a.category === category);
    }
    res.json({ articles });
}));

// GET /api/documentation/best-practices/categories
router.get("/best-practices/categories", asyncHandler(async (_req: Request, res: Response) => {
    const categories = await bestPracticesService.getCategories();
    res.json({ categories });
}));

// GET /api/documentation/best-practices/:id
router.get("/best-practices/:id", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const article = await bestPracticesService.getArticleById(id);
    if (!article) {
        throw new BadRequestError(`Article not found: ${id}`);
    }
    res.json(article);
}));

export default router;
