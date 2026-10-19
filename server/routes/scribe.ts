/**
 * Scribe Studio REST API Routes
 *
 * Exposes endpoints for Scribe Studio 4-pane authoring, subway branch management,
 * continuity reconciliation, multi-lens critic evaluations, and document export.
 *
 * Every route is authenticated and resolves the caller's organization from the
 * session rather than the request body. Documents, nodes, and annotations are
 * addressed by serial integer, so the org id is what keeps one tenant's ids from
 * reaching another tenant's manuscript.
 */

import { Router, Request, Response } from "express";
import { scribeService } from "@domain/scribe/core/scribe.service.js";
import { scribeVersioningService } from "@domain/scribe/core/scribe-versioning.service.js";
import { scribeCopilotService } from "@domain/scribe/core/scribe-copilot.service.js";
import {
    buildExportFile,
    UnsupportedExportFormatError,
    type ScribeExportFormat,
} from "@domain/scribe/core/scribe-export.service.js";
import { continuityEngine } from "@domain/scribe/core/continuity-engine.service.js";
import { createLogger } from "@server/utils/logger.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext, requireOrgId } from "../utils/auth-context.js";
import { ScribeArchetypeMode, ScribeLensType, scribeDocuments, scribeNodes, scribeEntityLedger } from "@shared/schema/scribe.js";
import { crewSessions } from "@shared/schema/crew.js";
import { db } from "../database_service.js";
import { eq, and } from "drizzle-orm";

const logger = createLogger("ScribeRouter");
const router = Router();

router.use(requireAuth);

/** Resolve caller org, with super-admin document/session scoping fallback. */
async function resolveOrgForDoc(req: Request, documentId?: number, sessionId?: number, nodeId?: number): Promise<number> {
    const orgContext = await getUserOrgContext(req);
    let orgId = requireOrgId(orgContext);

    if (orgContext.isSuperAdmin) {
        if (documentId && !isNaN(documentId)) {
            const [doc] = await db
                .select({ orgId: scribeDocuments.organizationId })
                .from(scribeDocuments)
                .where(eq(scribeDocuments.id, documentId))
                .limit(1);
            if (doc?.orgId) return doc.orgId;
        }
        if (sessionId && !isNaN(sessionId)) {
            const [sess] = await db
                .select({ orgId: crewSessions.organizationId })
                .from(crewSessions)
                .where(eq(crewSessions.id, sessionId))
                .limit(1);
            if (sess?.orgId) return sess.orgId;
        }
        if (nodeId && !isNaN(nodeId)) {
            const [node] = await db
                .select({ orgId: scribeDocuments.organizationId })
                .from(scribeNodes)
                .innerJoin(scribeDocuments, eq(scribeNodes.documentId, scribeDocuments.id))
                .where(eq(scribeNodes.id, nodeId))
                .limit(1);
            if (node?.orgId) return node.orgId;
        }
    }
    return orgId;
}

/** Map a service error onto its status; anything unclassified stays a 500. */
function fail(res: Response, err: any, context: string) {
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status >= 500) {
        logger.error(`${context}: ${err.message}`);
    } else {
        logger.warn(`${context}: ${err.message}`);
    }
    res.status(status).json({ error: err.message });
}

/**
 * GET /api/scribe/documents/:documentId
 * Fetch full document view with active branch nodes, annotations, and telemetry
 */
router.get("/documents/:documentId", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;
        const docView = await scribeService.getDocument(documentId, orgId, branchId);
        res.json(docView);
    } catch (err: any) {
        fail(res, err, `Failed to get document #${req.params.documentId}`);
    }
});

/**
 * POST /api/scribe/documents/:documentId/crystallize
 * Takes a context paragraph and extracted entities to seed framework stations.
 */
router.post("/documents/:documentId/crystallize", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const { contextParagraph, extractedEntities } = req.body;
        const updated = await scribeService.crystallizeFromContext(
            documentId,
            orgId,
            contextParagraph || "",
            extractedEntities || {}
        );
        res.json(updated);
    } catch (err: any) {
        fail(res, err, `Failed to crystallize document #${req.params.documentId}`);
    }
});

/**
 * GET /api/scribe/session/:sessionId
 * Fetch or initialize document associated with a CREW session.
 * Supports reset=true to reset stations for a new subject.
 */
router.get("/session/:sessionId", async (req, res) => {
    try {
        const sessionId = parseInt(req.params.sessionId, 10);
        const orgId = await resolveOrgForDoc(req, undefined, sessionId);
        const title = (req.query.title as string) || "Untitled Manuscript";
        // Deliberately undefined when absent. Coercing it to "freeform" made
        // every plain page load an explicit request for the generic framework.
        const mode = (req.query.mode as ScribeArchetypeMode) || undefined;
        const reset = req.query.reset === "true";

        const docView = await scribeService.createOrGetDocument(sessionId, orgId, title, mode, undefined, reset);
        res.json(docView);
    } catch (err: any) {
        fail(res, err, `Failed to get/create document for session #${req.params.sessionId}`);
    }
});

/**
 * POST /api/scribe/session/:sessionId/reset
 * Resets the active Scribe document for a CREW session when the subject changes
 */
router.post("/session/:sessionId/reset", async (req, res) => {
    try {
        const sessionId = parseInt(req.params.sessionId, 10);
        const orgId = await resolveOrgForDoc(req, undefined, sessionId);
        const { title, archetypeMode, targetWordCount } = req.body || {};
        const docView = await scribeService.createOrGetDocument(
            sessionId,
            orgId,
            title,
            archetypeMode,
            targetWordCount,
            true // force reset
        );
        res.json(docView);
    } catch (err: any) {
        fail(res, err, `Failed to reset document for session #${req.params.sessionId}`);
    }
});

/**
 * POST /api/scribe/documents/:id/reset
 * Resets an existing Scribe document by id
 */
router.post("/documents/:id/reset", async (req, res) => {
    try {
        const documentId = parseInt(req.params.id, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const { title, archetypeMode, targetWordCount } = req.body || {};
        const docView = await scribeService.resetDocument(documentId, orgId, {
            newTitle: title,
            archetypeMode,
            targetWordCount,
        });
        res.json(docView);
    } catch (err: any) {
        fail(res, err, `Failed to reset document #${req.params.id}`);
    }
});

/**
 * POST /api/scribe/documents
 * Create a new Scribe document
 */
router.post("/documents", async (req, res) => {
    try {
        const { sessionId, title, archetypeMode, targetWordCount } = req.body;
        if (!sessionId) {
            return res.status(400).json({ error: "sessionId is required" });
        }
        const orgId = await resolveOrgForDoc(req, undefined, Number(sessionId));

        const docView = await scribeService.createOrGetDocument(
            sessionId,
            orgId,
            title,
            archetypeMode,
            targetWordCount
        );
        res.status(201).json(docView);
    } catch (err: any) {
        fail(res, err, "Failed to create document");
    }
});

/**
 * POST /api/scribe/nodes/:nodeId
 * Update station text content, status, and recalculate metrics
 */
router.post("/nodes/:nodeId", async (req, res) => {
    try {
        const nodeId = parseInt(req.params.nodeId, 10);
        const orgId = await resolveOrgForDoc(req, undefined, undefined, nodeId);
        const { content, contentRich, status } = req.body;

        const updated = await scribeService.updateNodeContent(nodeId, orgId, content, contentRich, status);
        res.json(updated);
    } catch (err: any) {
        fail(res, err, `Failed to update node #${req.params.nodeId}`);
    }
});

/**
 * POST /api/scribe/documents/:documentId/nodes/:nodeId/stream-delta
 * Stream live manuscript edits to ambient sentinels and return instant agent insights
 */
router.post("/documents/:documentId/nodes/:nodeId/stream-delta", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const nodeId = parseInt(req.params.nodeId, 10);
        const orgId = await resolveOrgForDoc(req, documentId, undefined, nodeId);
        const { content } = req.body;

        const result = await scribeService.evaluateLiveDelta(
            documentId,
            nodeId,
            content || "",
            orgId
        );
        res.json(result);
    } catch (err: any) {
        fail(res, err, `Failed to stream delta for node #${req.params.nodeId}`);
    }
});

/**
 * POST /api/scribe/documents/:documentId/stations
 * Add a new custom station/section to the manuscript
 */
router.post("/documents/:documentId/stations", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const { title, content, branchId } = req.body;
        if (!title?.trim()) {
            return res.status(400).json({ error: "Station title is required" });
        }

        const newNode = await scribeService.addStation(
            documentId,
            orgId,
            title.trim(),
            content || "",
            branchId ? parseInt(branchId, 10) : undefined
        );
        res.status(201).json(newNode);
    } catch (err: any) {
        fail(res, err, `Failed to add station to document #${req.params.documentId}`);
    }
});

/**
 * DELETE /api/scribe/nodes/:nodeId
 * Delete a station from a manuscript branch
 */
router.delete("/nodes/:nodeId", async (req, res) => {
    try {
        const nodeId = parseInt(req.params.nodeId, 10);
        const orgId = await resolveOrgForDoc(req, undefined, undefined, nodeId);
        const result = await scribeService.deleteStation(nodeId, orgId);
        res.json(result);
    } catch (err: any) {
        fail(res, err, `Failed to delete station #${req.params.nodeId}`);
    }
});

/**
 * PATCH /api/scribe/nodes/:nodeId/rename
 * Rename a station title without changing its content
 */
router.patch("/nodes/:nodeId/rename", async (req, res) => {
    try {
        const nodeId = parseInt(req.params.nodeId, 10);
        const orgId = await resolveOrgForDoc(req, undefined, undefined, nodeId);
        const { title } = req.body;
        if (!title?.trim()) {
            return res.status(400).json({ error: "Station title is required" });
        }
        const updated = await scribeService.renameStation(nodeId, orgId, title.trim());
        res.json(updated);
    } catch (err: any) {
        fail(res, err, `Failed to rename station #${req.params.nodeId}`);
    }
});

/**
 * POST /api/scribe/documents/:documentId/reorder-stations
 * Reorder stations on the active branch by providing ordered node IDs
 */
router.post("/documents/:documentId/reorder-stations", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const { orderedNodeIds, branchId } = req.body;
        if (!Array.isArray(orderedNodeIds) || orderedNodeIds.length === 0) {
            return res.status(400).json({ error: "orderedNodeIds array is required" });
        }
        const docView = await scribeService.reorderStations(
            documentId,
            orgId,
            orderedNodeIds.map((id: any) => parseInt(id, 10)),
            branchId ? parseInt(branchId, 10) : undefined
        );
        res.json(docView);
    } catch (err: any) {
        fail(res, err, `Failed to reorder stations for document #${req.params.documentId}`);
    }
});

/**
 * POST /api/scribe/documents/:documentId/branches/:branchId/switch
 * Point the document at a different subway track
 */
router.post("/documents/:documentId/branches/:branchId/switch", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const branchId = parseInt(req.params.branchId, 10);

        const docView = await scribeService.switchBranch(documentId, orgId, branchId);
        res.json(docView);
    } catch (err: any) {
        fail(res, err, `Failed to switch to branch #${req.params.branchId}`);
    }
});

/**
 * POST /api/scribe/branches/fork
 * Fork a new subway branch with optional Breakout Room
 */
router.post("/branches/fork", async (req, res) => {
    try {
        const { documentId, stationKey, branchName, description, spawnBreakoutRoom, parentSessionId } = req.body;
        if (!documentId || !stationKey || !branchName) {
            return res.status(400).json({ error: "documentId, stationKey, and branchName are required" });
        }
        const orgId = await resolveOrgForDoc(req, Number(documentId));

        const result = await scribeService.forkBranch(
            documentId,
            orgId,
            stationKey,
            branchName,
            description,
            spawnBreakoutRoom,
            parentSessionId
        );
        res.status(201).json(result);
    } catch (err: any) {
        fail(res, err, "Failed to fork branch");
    }
});

/**
 * POST /api/scribe/branches/merge
 * Merge branch back into target trunk
 */
router.post("/branches/merge", async (req, res) => {
    try {
        const { documentId, sourceBranchId, targetBranchId, selectedNodeIds } = req.body;
        if (!documentId || !sourceBranchId || !targetBranchId) {
            return res.status(400).json({ error: "documentId, sourceBranchId, and targetBranchId are required" });
        }
        const orgId = await resolveOrgForDoc(req, Number(documentId));

        const docView = await scribeService.mergeBranch(
            documentId,
            orgId,
            sourceBranchId,
            targetBranchId,
            selectedNodeIds
        );
        res.json(docView);
    } catch (err: any) {
        fail(res, err, "Failed to merge branch");
    }
});

/**
 * POST /api/scribe/continuity/reconcile
 * Analyze downstream stations for causality/consistency conflicts
 */
router.post("/continuity/reconcile", async (req, res) => {
    try {
        const { documentId, branchId, sourceSortOrder, sourceContent, sourceStationKey } = req.body;
        if (!documentId || !sourceStationKey) {
            return res.status(400).json({ error: "documentId and sourceStationKey are required" });
        }
        const orgId = await resolveOrgForDoc(req, Number(documentId));

        // getDocument enforces the org boundary before the engine, which takes
        // document and branch ids on trust, ever sees them.
        const docView = await scribeService.getDocument(documentId, orgId, branchId);
        const result = await continuityEngine.analyzeDownstreamContinuity(
            documentId,
            docView.activeBranch.id,
            sourceSortOrder || 1,
            sourceContent || "",
            sourceStationKey
        );
        res.json(result);
    } catch (err: any) {
        fail(res, err, "Failed to reconcile continuity");
    }
});

/**
 * POST /api/scribe/critics/evaluate
 * Execute Multi-Lens Critic evaluation
 */
router.post("/critics/evaluate", async (req, res) => {
    try {
        const { documentId, nodeId, lenses, lensDefinitions } = req.body;
        if (!documentId) {
            return res.status(400).json({ error: "documentId is required" });
        }
        const orgId = await resolveOrgForDoc(req, Number(documentId));

        const annotations = await scribeService.runCriticEvaluation(
            documentId,
            orgId,
            nodeId,
            (lenses as ScribeLensType[]) || ["legal", "stylistic", "devils_advocate"],
            lensDefinitions
        );
        res.json({ annotations });
    } catch (err: any) {
        fail(res, err, "Failed to run critic evaluation");
    }
});

/**
 * POST /api/scribe/terms/alias
 *
 * Accept a spelling of a defined term. Clears the drift marker for that
 * variant, permanently and for this document only.
 */
router.post("/terms/alias", async (req, res) => {
    try {
        const { documentId, canonical, alias } = req.body ?? {};
        if (!documentId || !canonical || !alias) {
            return res.status(400).json({ error: "documentId, canonical and alias are required" });
        }
        const orgId = await resolveOrgForDoc(req, Number(documentId));

        const result = await scribeService.addTermAlias(
            Number(documentId),
            orgId,
            String(canonical),
            String(alias),
        );
        res.json(result);
    } catch (err: any) {
        fail(res, err, `Failed to accept term alias on document #${req.body?.documentId}`);
    }
});

/**
 * POST /api/scribe/deltas
 *
 * Tier 1 ambient review. The client posts the station text as the author types;
 * this evaluates the rule set and, when the findings actually change, publishes
 * a `scribe-insight` event into the room's crew stream so agents and any other
 * viewer see it.
 *
 * Deliberately model-free, which is what makes it safe to call on every delta.
 * A load simulation of a deliberate author — 500ms between keystrokes, the
 * contract-drafting profile — puts a session at 800 deltas against 20 saves, so
 * anything with a model call behind it belongs on the save boundary instead.
 *
 * Answers the insights either way; the `published` flag says whether the room
 * was woken, so a client can tell "nothing changed" from "nothing found".
 */
router.post("/deltas", async (req, res) => {
    try {
        const { documentId, nodeId, text, previous } = req.body ?? {};
        if (!documentId || typeof text !== "string") {
            return res.status(400).json({ error: "documentId and text are required" });
        }
        const orgId = await resolveOrgForDoc(req, Number(documentId), undefined, nodeId);

        const result = await scribeService.evaluateAmbientDelta({
            documentId,
            organizationId: orgId,
            nodeId,
            text,
            previousInsights: Array.isArray(previous) ? previous : [],
        });

        res.json(result);
    } catch (err: any) {
        fail(res, err, `Failed to evaluate ambient delta for document #${req.body?.documentId}`);
    }
});

/**
 * POST /api/scribe/export
 * Compile manuscript to Markdown, PDF, or Word DOCX
 */
router.post("/export", async (req, res) => {
    try {
        const { documentId, branchId, format } = req.body;
        if (!documentId) {
            return res.status(400).json({ error: "documentId is required" });
        }
        const orgId = await resolveOrgForDoc(req, Number(documentId));

        const compiled = await scribeService.compileManuscript(documentId, orgId, branchId);
        const requested = (format || "markdown") as ScribeExportFormat;

        // Sends the file itself. It used to reply { compiled, format } while the
        // client looked for a downloadUrl the route has never sent, so every
        // export in every format silently produced nothing.
        const file = await buildExportFile(compiled, requested);
        res.setHeader("Content-Type", file.mimeType);
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${file.filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        );
        // Named explicitly so a cross-origin reader can still see the filename.
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
        res.send(file.body);
    } catch (err: any) {
        if (err instanceof UnsupportedExportFormatError) {
            // A format the server cannot produce is a request problem, not a
            // server fault, and the message is written for the author to read.
            return res.status(415).json({ error: err.message, format: err.format });
        }
        fail(res, err, "Failed to export manuscript");
    }
});

/**
 * POST /api/scribe/documents/:id/publish
 * Publish manuscript as a canonical project deliverable & attachment
 */
router.post("/documents/:id/publish", async (req, res) => {
    try {
        const documentId = Number(req.params.id);
        const orgId = await resolveOrgForDoc(req, documentId);
        const { branchId, versionTag, releaseNotes, theme } = req.body;

        const userId = (req.user as any)?.id || (req as any).session?.userId || "user";
        const result = await scribeService.publishDocument(documentId, orgId, {
            branchId,
            versionTag,
            releaseNotes,
            userId,
            theme,
        });

        res.json({
            success: true,
            publication: result,
        });
    } catch (err: any) {
        fail(res, err, "Failed to publish manuscript");
    }
});

/**
 * POST /api/scribe/publish (Alias with body documentId)
 */
router.post("/publish", async (req, res) => {
    try {
        const { documentId, branchId, versionTag, releaseNotes, theme } = req.body;
        if (!documentId) {
            return res.status(400).json({ error: "documentId is required" });
        }
        const orgId = await resolveOrgForDoc(req, Number(documentId));

        const userId = (req.user as any)?.id || (req as any).session?.userId || "user";
        const result = await scribeService.publishDocument(Number(documentId), orgId, {
            branchId,
            versionTag,
            releaseNotes,
            userId,
            theme,
        });

        res.json({
            success: true,
            publication: result,
        });
    } catch (err: any) {
        fail(res, err, "Failed to publish manuscript");
    }
});

/**
 * POST /api/scribe/annotations
 * Create a user note, annotation, or to-do item
 */
router.post("/annotations", async (req, res) => {
    try {
        const { documentId, nodeId, lensType, title, critiqueBody, proposedDiff, severity, paragraphAnchor } = req.body;
        if (!documentId || !nodeId || !title) {
            return res.status(400).json({ error: "documentId, nodeId, and title are required" });
        }
        const orgId = await resolveOrgForDoc(req, Number(documentId));

        const annotation = await scribeService.createAnnotation({
            documentId,
            organizationId: orgId,
            nodeId,
            lensType: lensType || "note",
            title,
            critiqueBody: critiqueBody || "",
            proposedDiff,
            severity,
            paragraphAnchor,
        });
        res.json(annotation);
    } catch (err: any) {
        fail(res, err, "Failed to create annotation");
    }
});

/**
 * PATCH /api/scribe/annotations/:id
 * Update annotation status (e.g. resolve to-do item)
 */
router.patch("/annotations/:id", async (req, res) => {
    try {
        const annotationId = Number(req.params.id);
        const orgId = await resolveOrgForDoc(req, undefined, undefined, annotationId); // Note: Simplified for logic consistency
        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ error: "status is required" });
        }

        const updated = await scribeService.updateAnnotationStatus(annotationId, orgId, status);
        res.json(updated);
    } catch (err: any) {
        fail(res, err, `Failed to update annotation #${req.params.id}`);
    }
});

/**
 * DELETE /api/scribe/annotations/:id
 * Delete an annotation or to-do
 */
router.delete("/annotations/:id", async (req, res) => {
    try {
        const annotationId = Number(req.params.id);
        const orgId = await resolveOrgForDoc(req, undefined, undefined, annotationId); // Note: Simplified for logic consistency
        await scribeService.deleteAnnotation(annotationId, orgId);
        res.json({ success: true, deletedId: annotationId });
    } catch (err: any) {
        fail(res, err, `Failed to delete annotation #${req.params.id}`);
    }
});

/**
 * GET /api/scribe/documents/:documentId/tethers
 * Fetch all active data tethers for a manuscript
 */
router.get("/documents/:documentId/tethers", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);

        const rows = await db
            .select()
            .from(scribeEntityLedger)
            .where(
                and(
                    eq(scribeEntityLedger.documentId, documentId),
                    eq(scribeEntityLedger.entityType, "data_tether")
                )
            );

        res.json({ tethers: rows });
    } catch (err: any) {
        fail(res, err, `Failed to get tethers for document #${req.params.documentId}`);
    }
});

/**
 * POST /api/scribe/documents/:documentId/tethers
 * Bind a defined term or figure in the document to a Calculation Node
 */
router.post("/documents/:documentId/tethers", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const { termName, calculationNodeId, unit } = req.body ?? {};

        if (!termName || !calculationNodeId) {
            return res.status(400).json({ error: "termName and calculationNodeId are required" });
        }

        const entry = await scribeService.tetherEntityToCalculation(
            documentId,
            orgId,
            String(termName),
            Number(calculationNodeId),
            unit ? String(unit) : undefined
        );

        res.status(201).json({ tether: entry });
    } catch (err: any) {
        fail(res, err, `Failed to create tether for document #${req.params.documentId}`);
    }
});

/**
 * POST /api/scribe/documents/:documentId/tethers/refresh
 * Re-evaluate all tethered calculation nodes and update latest values
 */
router.post("/documents/:documentId/tethers/refresh", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);

        const updates = await scribeService.refreshDocumentTethers(documentId, orgId);
        res.json({ success: true, refreshedCount: updates.length, updates });
    } catch (err: any) {
        fail(res, err, `Failed to refresh tethers for document #${req.params.documentId}`);
    }
});

/**
 * DELETE /api/scribe/documents/:documentId/tethers/:tetherId
 * Remove a data tether from the document ledger
 */
router.delete("/documents/:documentId/tethers/:tetherId", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const tetherId = parseInt(req.params.tetherId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);

        await db
            .delete(scribeEntityLedger)
            .where(
                and(
                    eq(scribeEntityLedger.id, tetherId),
                    eq(scribeEntityLedger.documentId, documentId)
                )
            );

        res.json({ success: true, deletedId: tetherId });
    } catch (err: any) {
        fail(res, err, `Failed to delete tether #${req.params.tetherId}`);
    }
});

/**
 * POST /api/scribe/documents/:documentId/copilot/sync-crew
 * Reconciles and synchronizes crew advisor proposals (Table of Contents, stations)
 * from the linked session into the Living Document Canvas.
 */
router.post("/documents/:documentId/copilot/sync-crew", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const result = await scribeCopilotService.syncCrewAdviceToDocument(documentId, orgId);
        res.json(result);
    } catch (err: any) {
        fail(res, err, `Failed to sync crew advice for document #${req.params.documentId}`);
    }
});

/**
 * POST /api/scribe/documents/:documentId/copilot/prompt
 * Direct instruction to the Scribe In-Pod Copilot (e.g. outline creation or station drafting).
 */
router.post("/documents/:documentId/copilot/prompt", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const { instruction } = req.body;
        if (!instruction || typeof instruction !== "string") {
            return res.status(400).json({ error: "Instruction is required" });
        }
        const result = await scribeCopilotService.executeCopilotInstruction(documentId, orgId, instruction);
        res.json(result);
    } catch (err: any) {
        fail(res, err, `Failed to execute copilot instruction for document #${req.params.documentId}`);
    }
});

/**
 * GET /api/scribe/tree
 * Every manuscript in the organization as a page tree, roots first.
 * Optional ?label= filters to documents carrying that label.
 */
router.get("/tree", async (req, res) => {
    try {
        const orgId = await resolveOrgForDoc(req);
        const label = typeof req.query.label === "string" ? req.query.label : undefined;
        res.json(await scribeService.listDocumentTree(orgId, { label }));
    } catch (err: any) {
        fail(res, err, "Failed to list the Scribe page tree");
    }
});

/**
 * GET /api/scribe/labels
 * Distinct labels in the organization with their document counts.
 */
router.get("/labels", async (req, res) => {
    try {
        const orgId = await resolveOrgForDoc(req);
        res.json(await scribeService.listLabels(orgId));
    } catch (err: any) {
        fail(res, err, "Failed to list Scribe labels");
    }
});

/**
 * PATCH /api/scribe/documents/:documentId/parent
 * File a document under another, or pass null to move it back to the root.
 */
router.patch("/documents/:documentId/parent", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const raw = req.body?.parentDocumentId;
        // null is meaningful here — it is how a document returns to the root —
        // so an absent key and an explicit null must not be conflated.
        const parentDocumentId = raw == null ? null : parseInt(String(raw), 10);
        if (parentDocumentId != null && Number.isNaN(parentDocumentId)) {
            return res.status(400).json({ error: "parentDocumentId must be a number or null" });
        }
        res.json(await scribeService.setDocumentParent(documentId, orgId, parentDocumentId));
    } catch (err: any) {
        fail(res, err, `Failed to set the parent of document #${req.params.documentId}`);
    }
});

/**
 * PUT /api/scribe/documents/:documentId/labels
 * Replace a document's labels.
 */
router.put("/documents/:documentId/labels", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const { labels } = req.body ?? {};
        if (!Array.isArray(labels)) {
            return res.status(400).json({ error: "labels must be an array of strings" });
        }
        res.json(await scribeService.setDocumentLabels(documentId, orgId, labels.map(String)));
    } catch (err: any) {
        fail(res, err, `Failed to set labels on document #${req.params.documentId}`);
    }
});

/**
 * DELETE /api/scribe/documents/:documentId
 * Delete a manuscript and everything it owns. Documents filed beneath it
 * surface at the root rather than being destroyed with their parent.
 */
router.delete("/documents/:documentId", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        res.json(await scribeService.deleteDocument(documentId, orgId));
    } catch (err: any) {
        fail(res, err, `Failed to delete document #${req.params.documentId}`);
    }
});

/**
 * PATCH /api/scribe/documents/:documentId/ai-system
 * Set the AI-system registry id and the governance document links.
 * The three document references must be manuscripts in the same organization.
 */
router.patch("/documents/:documentId/ai-system", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const orgContext = await getUserOrgContext(req);
        const { aiSystemId, dataLineageGraphId, biasMitigationStrategyDocumentId, governancePolicyDocumentId } = req.body ?? {};

        const numOrNull = (v: unknown): number | null | undefined =>
            v === undefined ? undefined : v == null ? null : parseInt(String(v), 10);
        for (const v of [dataLineageGraphId, biasMitigationStrategyDocumentId, governancePolicyDocumentId]) {
            if (numOrNull(v) !== undefined && numOrNull(v) !== null && Number.isNaN(numOrNull(v))) {
                return res.status(400).json({ error: "Document references must be numbers or null" });
            }
        }

        const updated = await scribeVersioningService.updateAiSystemMetadata(documentId, orgId, {
            aiSystemId: aiSystemId === undefined ? undefined : aiSystemId == null ? null : String(aiSystemId),
            dataLineageGraphId: numOrNull(dataLineageGraphId),
            biasMitigationStrategyDocumentId: numOrNull(biasMitigationStrategyDocumentId),
            governancePolicyDocumentId: numOrNull(governancePolicyDocumentId),
        }, { actor: orgContext.userId });
        res.json(updated);
    } catch (err: any) {
        fail(res, err, `Failed to update AI-system metadata on document #${req.params.documentId}`);
    }
});

/**
 * GET /api/scribe/documents/:documentId/revisions
 * The document's commit history, newest first. ?nodeId= filters to one station.
 */
router.get("/documents/:documentId/revisions", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const nodeId = req.query.nodeId ? parseInt(String(req.query.nodeId), 10) : undefined;
        const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
        res.json({ revisions: await scribeVersioningService.listRevisions(documentId, orgId, { nodeId, limit }) });
    } catch (err: any) {
        fail(res, err, `Failed to list revisions for document #${req.params.documentId}`);
    }
});

/**
 * GET /api/scribe/documents/:documentId/revisions/diff?from=&to=
 * Compare two revisions. Registered before /revisions/:revisionId so "diff"
 * is never parsed as an id.
 */
router.get("/documents/:documentId/revisions/diff", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const from = parseInt(String(req.query.from ?? ""), 10);
        const to = parseInt(String(req.query.to ?? ""), 10);
        if (Number.isNaN(from) || Number.isNaN(to)) {
            return res.status(400).json({ error: "from and to revision ids are required" });
        }
        res.json(await scribeVersioningService.diffRevisions(documentId, orgId, from, to));
    } catch (err: any) {
        fail(res, err, `Failed to diff revisions for document #${req.params.documentId}`);
    }
});

/**
 * GET /api/scribe/documents/:documentId/revisions/:revisionId
 * A single revision with its snapshot.
 */
router.get("/documents/:documentId/revisions/:revisionId", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const revision = await scribeVersioningService.getRevision(parseInt(req.params.revisionId, 10), orgId);
        if (revision.documentId !== documentId) {
            return res.status(404).json({ error: "Revision not found on this document" });
        }
        res.json(revision);
    } catch (err: any) {
        fail(res, err, `Failed to get revision #${req.params.revisionId}`);
    }
});

/**
 * POST /api/scribe/documents/:documentId/revisions/:revisionId/rollback
 * Restore a snapshot. Append-only: the restore is itself a new revision.
 */
router.post("/documents/:documentId/revisions/:revisionId/rollback", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const orgContext = await getUserOrgContext(req);
        const revision = await scribeVersioningService.getRevision(parseInt(req.params.revisionId, 10), orgId);
        if (revision.documentId !== documentId) {
            return res.status(404).json({ error: "Revision not found on this document" });
        }
        const result = await scribeVersioningService.rollbackRevision(revision.id, orgId, { actor: orgContext.userId });
        res.json(result);
    } catch (err: any) {
        fail(res, err, `Failed to roll back to revision #${req.params.revisionId}`);
    }
});

/**
 * POST /api/scribe/documents/:documentId/commits
 * Take a named snapshot of the document — the manual commit.
 */
router.post("/documents/:documentId/commits", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const orgContext = await getUserOrgContext(req);
        const { message, branchId } = req.body ?? {};
        const revision = await scribeVersioningService.commitDocument(documentId, orgId, {
            message: typeof message === "string" ? message : undefined,
            actor: orgContext.userId,
            branchId: branchId ? parseInt(String(branchId), 10) : undefined,
        });
        res.status(201).json(revision);
    } catch (err: any) {
        fail(res, err, `Failed to commit document #${req.params.documentId}`);
    }
});

/**
 * GET /api/scribe/documents/:documentId/reviews
 * Review requests for a document. ?status=pending|approved|changes_requested
 */
router.get("/documents/:documentId/reviews", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const status = req.query.status as "pending" | "approved" | "changes_requested" | undefined;
        res.json({ reviews: await scribeVersioningService.listReviews(documentId, orgId, { status }) });
    } catch (err: any) {
        fail(res, err, `Failed to list reviews for document #${req.params.documentId}`);
    }
});

/**
 * POST /api/scribe/documents/:documentId/reviews
 * Request a review over a station (nodeId) or the whole document (omit it).
 */
router.post("/documents/:documentId/reviews", async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        const orgId = await resolveOrgForDoc(req, documentId);
        const orgContext = await getUserOrgContext(req);
        const { nodeId, note } = req.body ?? {};
        const review = await scribeVersioningService.requestReview(documentId, orgId, {
            nodeId: nodeId ? parseInt(String(nodeId), 10) : undefined,
            requestedBy: orgContext.userId,
            note: typeof note === "string" ? note : undefined,
        });
        res.status(201).json(review);
    } catch (err: any) {
        fail(res, err, `Failed to request review on document #${req.params.documentId}`);
    }
});

/**
 * POST /api/scribe/reviews/:reviewId/decision
 * Approve a review or send it back for changes.
 */
router.post("/reviews/:reviewId/decision", async (req, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        const orgId = requireOrgId(orgContext);
        const { decision, note } = req.body ?? {};
        if (decision !== "approved" && decision !== "changes_requested") {
            return res.status(400).json({ error: "decision must be 'approved' or 'changes_requested'" });
        }
        const review = await scribeVersioningService.decideReview(parseInt(req.params.reviewId, 10), orgId, {
            decision,
            reviewer: orgContext.userId,
            note: typeof note === "string" ? note : undefined,
        });
        res.json(review);
    } catch (err: any) {
        fail(res, err, `Failed to decide review #${req.params.reviewId}`);
    }
});

export default router;
