import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { mediaStudio as service } from "../core/media-studio.service.js";
import { sendBytes, type ByteResponse } from "../core/byte-range.js";

/**
 * Media Studio: productions, their scenes, plot points, keyframes and shots, reviewing
 * takes, the storyboard deck, and the files renders produce. Every route is signed in
 * and scoped to the caller's organization; a private Project Space's production is not
 * found outside it.
 */
export const mediaStudioRouter = Router();
mediaStudioRouter.use(requireAuth);

const id = z.coerce.number().int().positive();
const param = (req: Request) => id.parse(req.params.id);
const order = (req: Request) => z.object({ ids: z.array(z.unknown()) }).parse(req.body).ids;
const listQuery = z.object({
    crewSessionKey: z.string().trim().min(1).max(200).optional(),
    crewSessionId: z.coerce.number().int().positive().optional(),
});

mediaStudioRouter.get("/productions", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.listProductions(await getUserOrgContext(req), listQuery.parse(req.query)));
}));
mediaStudioRouter.post("/productions", asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await service.createProduction(await getUserOrgContext(req), req.body));
}));
mediaStudioRouter.get("/productions/:id", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.getProduction(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.patch("/productions/:id", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.updateProduction(await getUserOrgContext(req), param(req), req.body));
}));
mediaStudioRouter.post("/productions/:id/promote-to-project-bible", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.promoteProductionStyleToProject(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.get("/projects/:id/style-bible", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.getProjectStyleBible(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.put("/projects/:id/style-bible", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.updateProjectStyleBible(await getUserOrgContext(req), param(req), req.body));
}));
mediaStudioRouter.get("/productions/:id/storyboard.pptx", asyncHandler(async (req: Request, res: Response) => {
    const { filename, content } = await service.exportStoryboard(await getUserOrgContext(req), param(req));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(content.length));
    res.status(200).end(content);
}));

mediaStudioRouter.get("/productions/:id/scribe-documents", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.scribeDocumentsFor(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.get("/productions/:id/scribe-stations", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.scribeStationsFor(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.put("/productions/:id/scribe-document", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.linkScribeDocument(await getUserOrgContext(req), param(req), req.body));
}));
mediaStudioRouter.post("/productions/:id/scenes/from-scribe", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.importScenesFromScribe(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.put("/scenes/:id/station", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.linkSceneToStation(await getUserOrgContext(req), param(req), req.body));
}));
mediaStudioRouter.delete("/productions/:id/characters/:characterId", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.removeCharacterFromStory(await getUserOrgContext(req), param(req), z.coerce.number().int().positive().parse(req.params.characterId)));
}));

// Reference images of characters and places, which keyframes are rendered with once approved.
mediaStudioRouter.post("/productions/:id/references", asyncHandler(async (req: Request, res: Response) => {
    res.status(202).json(await service.requestReference(await getUserOrgContext(req), param(req), req.body ?? {}));
}));
mediaStudioRouter.post("/references/:id/approve", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.approveReference(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.post("/references/:id/reject", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.rejectReference(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.delete("/references/:id", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.deleteReference(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.delete("/productions/:id/references/subject", asyncHandler(async (req: Request, res: Response) => {
    const kind = z.enum(["character", "location"]).parse(req.query.kind);
    const name = z.string().min(1).parse(req.query.name);
    res.json(await service.deleteSubject(await getUserOrgContext(req), param(req), kind, name));
}));

// Story ↔ scene. Bringing a scene back into step with the station that tells it,
// and leaving a note on that station. The note is the only thing Media Studio
// writes into a manuscript, and it changes not one word of it.
mediaStudioRouter.post("/scenes/:id/resync-from-station", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.resyncSceneFromStation(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.post("/scenes/:id/note", asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await service.noteSceneToStation(await getUserOrgContext(req), param(req), req.body ?? {}));
}));

// Wardrobe: what a character wears, from one scene onward until superseded. It
// works as data — composed into that character's reference sheet and into the
// prompt of every scene it covers — so a plate of the garment is rendered only
// when someone asks for one.
mediaStudioRouter.post("/productions/:id/wardrobe", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.addWardrobe(await getUserOrgContext(req), param(req), req.body ?? {}));
}));
mediaStudioRouter.patch("/wardrobe/:id", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.updateWardrobe(await getUserOrgContext(req), param(req), req.body ?? {}));
}));
mediaStudioRouter.delete("/wardrobe/:id", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.removeWardrobe(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.post("/wardrobe/:id/plate", asyncHandler(async (req: Request, res: Response) => {
    res.status(202).json(await service.requestWardrobePlate(await getUserOrgContext(req), param(req)));
}));

// How takes render: Seedance on fal.ai, or ComfyUI with an imported workflow.
mediaStudioRouter.put("/productions/:id/video-engine", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.setVideoEngine(await getUserOrgContext(req), param(req), req.body ?? {}));
}));
mediaStudioRouter.get("/productions/:id/video-engine/check", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.checkVideoEngine(await getUserOrgContext(req), param(req)));
}));

mediaStudioRouter.post("/productions/:id/scenes", asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await service.addScene(await getUserOrgContext(req), param(req), req.body));
}));
mediaStudioRouter.put("/productions/:id/scenes/order", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.reorderScenes(await getUserOrgContext(req), param(req), order(req)));
}));
mediaStudioRouter.patch("/scenes/:id", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.updateScene(await getUserOrgContext(req), param(req), req.body));
}));
mediaStudioRouter.delete("/scenes/:id", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.deleteScene(await getUserOrgContext(req), param(req)));
}));

mediaStudioRouter.post("/scenes/:id/plot-points", asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await service.addPlotPoint(await getUserOrgContext(req), param(req), req.body));
}));
mediaStudioRouter.put("/scenes/:id/plot-points/order", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.reorderPlotPoints(await getUserOrgContext(req), param(req), order(req)));
}));
mediaStudioRouter.patch("/plot-points/:id", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.updatePlotPoint(await getUserOrgContext(req), param(req), req.body));
}));
mediaStudioRouter.delete("/plot-points/:id", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.deletePlotPoint(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.post("/plot-points/:id/keyframes", asyncHandler(async (req: Request, res: Response) => {
    res.status(202).json(await service.requestKeyframe(await getUserOrgContext(req), param(req), req.body ?? {}));
}));
mediaStudioRouter.post("/plot-points/:id/shot", asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await service.makeShotFromPlotPoint(await getUserOrgContext(req), param(req)));
}));

mediaStudioRouter.post("/keyframes/:id/select", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.selectKeyframe(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.post("/keyframes/:id/approve", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.approveKeyframe(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.post("/keyframes/:id/reject", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.rejectKeyframe(await getUserOrgContext(req), param(req)));
}));

mediaStudioRouter.post("/scenes/:id/assemble", asyncHandler(async (req: Request, res: Response) => {
    res.status(202).json(await service.assembleScene(await getUserOrgContext(req), param(req)));
}));

mediaStudioRouter.post("/scenes/:id/shots", asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await service.addShot(await getUserOrgContext(req), param(req), req.body));
}));
mediaStudioRouter.post("/scenes/:id/coverage", asyncHandler(async (req: Request, res: Response) => {
    const template = (req.body?.template as any) ?? "dialogue";
    res.status(201).json(await service.addCoveragePackage(await getUserOrgContext(req), param(req), template));
}));
mediaStudioRouter.post("/scenes/:id/batch-takes", asyncHandler(async (req: Request, res: Response) => {
    res.status(202).json(await service.queueSceneTakes(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.put("/scenes/:id/shots/order", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.reorderShots(await getUserOrgContext(req), param(req), order(req)));
}));
mediaStudioRouter.patch("/shots/:id", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.updateShot(await getUserOrgContext(req), param(req), req.body));
}));
mediaStudioRouter.delete("/shots/:id", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.deleteShot(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.post("/shots/:id/duplicate", asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await service.duplicateShot(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.post("/shots/:id/orchestrate", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.orchestrateShot(await getUserOrgContext(req), param(req), req.body));
}));
mediaStudioRouter.get("/cinematic-catalog", asyncHandler(async (_req: Request, res: Response) => {
    res.json(service.getCinematicCatalog());
}));
mediaStudioRouter.post("/characters/verify-drift", asyncHandler(async (req: Request, res: Response) => {
    res.json(service.verifyFaceDrift(req.body));
}));

mediaStudioRouter.post("/shots/:id/takes", asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await service.requestTake(await getUserOrgContext(req), param(req), req.body ?? {}));
}));
mediaStudioRouter.post("/takes/:id/reshoot", asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await service.reshootTake(await getUserOrgContext(req), param(req), req.body ?? {}));
}));
mediaStudioRouter.post("/takes/:id/refresh", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.refreshTakeStatus(await getUserOrgContext(req), param(req)));
}));
// Undoing a review decision.
mediaStudioRouter.post("/takes/:id/unapprove", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.unapproveTake(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.post("/takes/:id/reopen", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.reopenTake(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.post("/takes/:id/withdraw", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.withdrawTake(await getUserOrgContext(req), param(req)));
}));
// Reviewing several takes of a scene at once; the answer says how each went.
mediaStudioRouter.post("/scenes/:id/takes/approve", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.approveTakes(await getUserOrgContext(req), param(req), req.body ?? {}));
}));
mediaStudioRouter.post("/scenes/:id/takes/reshoot", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.reshootTakes(await getUserOrgContext(req), param(req), req.body ?? {}));
}));
mediaStudioRouter.post("/takes/:id/approve", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.approveTake(await getUserOrgContext(req), param(req)));
}));
mediaStudioRouter.post("/takes/:id/reject", asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.rejectTake(await getUserOrgContext(req), param(req), req.body ?? {}));
}));

// A stored image, video or reel. Ranges let a <video> element seek.
mediaStudioRouter.get("/assets/:id", asyncHandler(async (req: Request, res: Response) => {
    if (!req.query.orgId && !req.query.organizationId && req.headers.referer) {
        try {
            const refUrl = new URL(req.headers.referer);
            const refOrg = refUrl.searchParams.get("orgId") || refUrl.searchParams.get("organizationId");
            if (refOrg) req.query.orgId = refOrg;
        } catch {
            // ignore malformed referer
        }
    }
    const { asset, content } = await service.readAsset(await getUserOrgContext(req), param(req));
    sendBytes(res as unknown as ByteResponse, req.header("range"), asset.mimeType, content);
}));
