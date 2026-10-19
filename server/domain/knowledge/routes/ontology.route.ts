import { Router } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { assertOrgId, getUserOrgContext } from "@server/utils/auth-context.js";
import { ontologyService, type OntologyCtx } from "../core/ontology.service.js";

/**
 * Org-scoped HTTP API for the AIP-style Ontology. Every handler resolves the org from
 * the session (never a request parameter) and hands the service an OntologyCtx, so
 * cross-tenant access is impossible. See docs/specs/ONTOLOGY_SERVICE_DESIGN.md.
 */
const ontologyRouter = Router();

async function ctxOf(req: any): Promise<OntologyCtx> {
    const orgContext = await getUserOrgContext(req);
    return {
        organizationId: assertOrgId(orgContext.organizationId),
        userId: orgContext.userId,
        isSuperAdmin: orgContext.isSuperAdmin,
        missionId: Number.isInteger(Number(req.body?.missionId)) ? Number(req.body.missionId) : undefined,
        missionRunId: Number.isInteger(Number(req.body?.missionRunId)) ? Number(req.body.missionRunId) : undefined,
    };
}

// List the org's Object Types.
ontologyRouter.get("/object-types", requireAuth, asyncHandler(async (req: any, res: any) => {
    const types = await ontologyService.listObjectTypes(await ctxOf(req));
    res.json({ objectTypes: types });
}));

// List the actions available in the org (optionally scoped to an object type).
ontologyRouter.get("/actions", requireAuth, asyncHandler(async (req: any, res: any) => {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const actions = await ontologyService.listActions(await ctxOf(req), type);
    res.json({ actions });
}));

ontologyRouter.get("/actions/tool-mapping", requireAuth, asyncHandler(async (req: any, res: any) => {
    const mappings = await ontologyService.getToolActionAnalytics(await ctxOf(req));
    res.json({ mappings });
}));

// List the org's declared relationships (optionally touching one Object Type).
ontologyRouter.get("/link-types", requireAuth, asyncHandler(async (req: any, res: any) => {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const linkTypes = await ontologyService.listLinkTypes(await ctxOf(req), type);
    res.json({ linkTypes });
}));

// Follow a declared relationship from one object to the objects on its other end.
// Registered before /objects/:type/:id so the more specific path wins.
ontologyRouter.get("/objects/:type/:id/links/:link", requireAuth, asyncHandler(async (req: any, res: any) => {
    const result = await ontologyService.traverse(await ctxOf(req), {
        objectType: req.params.type,
        id: req.params.id,
        link: req.params.link,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(result);
}));

// List instances of an Object Type.
ontologyRouter.get("/objects/:type", requireAuth, asyncHandler(async (req: any, res: any) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const objects = await ontologyService.listObjects(await ctxOf(req), req.params.type, { limit });
    res.json({ objects });
}));

// Get a single Object instance by id.
ontologyRouter.get("/objects/:type/:id", requireAuth, asyncHandler(async (req: any, res: any) => {
    const object = await ontologyService.getObject(await ctxOf(req), req.params.type, req.params.id);
    res.json({ object });
}));

// Execute an Action (write actions go through the governor approval gate in the service).
ontologyRouter.post("/actions/:name/execute", requireAuth, asyncHandler(async (req: any, res: any) => {
    const params = req.body?.parameters ?? req.body ?? {};
    const result = await ontologyService.executeAction(await ctxOf(req), req.params.name, params);
    res.json(result);
}));

export default ontologyRouter;
