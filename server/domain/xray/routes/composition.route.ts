import { Router } from "express";
import { xrayCompositionService } from "../core/xray-composition.service.js";
import { fullReindex, invalidateCompositionCache } from "../core/xray-indexing.service.js";
import type { CompositionGraph } from "../types/composition.js";
import { requireAuth } from "@domain/auth/core/security.service.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { xrayOperationalGuideService } from "../core/xray-operational-guide.service.js";
import { xrayContextPackageService } from "../core/xray-context-package.service.js";
import { xrayOperationsPersistenceService } from "../core/xray-operations-persistence.service.js";

const logger = createLogger("XrayCompositionRoute");
export const compositionRouter = Router();

/**
 * GET /api/xray/composition/scopes
 * Lists all available scopes: Oddjob platform + all forged apps for this org.
 */
/**
 * GET /api/xray/composition/diagnostics
 * Returns raw counts from the database showing what relationship data exists.
 * Use this to verify why edges may or may not be visible in the graph.
 */
compositionRouter.get("/xray/composition/diagnostics", requireAuth, async (req, res) => {
    try {
        const { organizationId } = await getUserOrgContext(req);
        if (!organizationId) return res.status(400).json({ error: "Organization context required" });

        const diag = await xrayCompositionService.getDiagnostics(organizationId);

        res.json({
            org: organizationId,
            cycles: { count: diag.operationalCycles, note: "operational_cycles table" },
            missions: { count: diag.missions },
            cycleLinkedMissionRuns: {
                count: diag.cycleLinkedRuns,
                note: "missionRuns with cycleId set — needed for cycle→mission edges"
            },
            datasets: { count: diag.datasets },
            jobsReferencingDatasets: {
                count: diag.jobsWithDatasetConfig,
                note: "jobs with datasetId in config — needed for job→dataset edges"
            },
            knowledgeTopics: { count: diag.knowledgeTopics },
            knowledgeEdges: {
                count: diag.knowledgeEdges,
                note: "knowledge_edges rows — needed for knowledge cluster relationships. Populated by RAG retrieval."
            },
            cache: diag.cache,
            recommendation: diag.cycleLinkedRuns === 0
                ? "No cycle-linked mission runs exist yet. Launch a cycle and run its blueprints to create cycle→mission edges."
                : "Data exists. Click Re-index in X-Ray to rebuild the graph.",
        });
    } catch (err: any) {
        logger.error("[Composition] diagnostics error", err.message);
        res.status(500).json({ error: err.message });
    }
});

compositionRouter.get("/xray/composition/scopes", requireAuth, async (req, res) => {
    try {
        const { organizationId } = await getUserOrgContext(req);
        if (!organizationId) return res.status(400).json({ error: "Organization context required" });
        const scopes = await xrayCompositionService.listScopes(organizationId);
        res.json(scopes);
    } catch (err: any) {
        logger.error("[Composition] scopes error", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/xray/composition/:scope
 * Returns the full composition graph for a scope.
 * ?types=screen,api_endpoint,job_definition  (optional filter)
 */
compositionRouter.get("/xray/composition/:scope", requireAuth, async (req, res) => {
    try {
        const { scope } = req.params;
        const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
        logger.debug(`[XrayRoute] GET scope=${scope} orgId=${organizationId} isSuperAdmin=${isSuperAdmin}`);
        if (!organizationId && !isSuperAdmin) return res.status(400).json({ error: "Organization context required" });

        // Parse types from comma-separated query param into a proper array
        const typesParam = req.query.types as string | undefined;
        const types = typesParam
            ? typesParam.split(",").map(t => t.trim()).filter(Boolean) as any[]
            : undefined;

        const skipCache = req.query.skipCache === "true";

        const graph = await xrayCompositionService.buildGraph(scope, organizationId ?? 0, {
            skipCache,
            types,
            isSuperAdmin,
        });

        res.json(graph);
    } catch (err: any) {
        logger.error("[Composition] graph error", err.message);
        if (err.message === "Access denied for X-Ray composition scope") {
            return res.status(403).json({ error: "Access denied" });
        }
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/xray/composition/:scope/mermaid
 * Returns Mermaid flowchart syntax for the composition graph.
 */
compositionRouter.get("/xray/composition/:scope/mermaid", requireAuth, async (req, res) => {
    try {
        const { scope } = req.params;
        const { organizationId } = await getUserOrgContext(req);
        if (!organizationId) return res.status(400).json({ error: "Organization context required" });

        const graph = await xrayCompositionService.buildGraph(scope, organizationId);
        const mermaid = xrayCompositionService.toMermaid(graph);
        res.json({ mermaid, scope: graph.scope });
    } catch (err: any) {
        logger.error("[Composition] mermaid error", err.message);
        if (err.message === "Access denied for X-Ray composition scope") {
            return res.status(403).json({ error: "Access denied" });
        }
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/xray/composition/:scope/operational-guide
 * Returns the versioned advisory operating contract for Copilot and supervisors.
 */
compositionRouter.get("/xray/composition/:scope/operational-guide", requireAuth, async (req, res) => {
    try {
        const { scope } = req.params;
        const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
        if (!organizationId && !isSuperAdmin) {
            return res.status(400).json({ error: "Organization context required" });
        }

        const graph = await xrayCompositionService.buildGraph(scope, organizationId ?? 0, {
            skipCache: req.query.skipCache === "true",
            isSuperAdmin,
        });
        res.json(xrayOperationalGuideService.buildGuide(graph));
    } catch (err: any) {
        logger.error("[Composition] operational-guide error", err.message);
        if (err.message === "Access denied for X-Ray composition scope") {
            return res.status(403).json({ error: "Access denied" });
        }
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/xray/composition/:scope/copilot-context
 * Builds a bounded, task-relevant graph package for Copilot and supervisors.
 */
compositionRouter.post("/xray/composition/:scope/copilot-context", requireAuth, async (req, res) => {
    try {
        const { scope } = req.params;
        const { task, nodeIds, maxGraphHops, maxNodes } = req.body ?? {};
        if (typeof task !== "string" || !task.trim()) {
            return res.status(400).json({ error: "task is required" });
        }
        if (nodeIds !== undefined && (!Array.isArray(nodeIds) || nodeIds.some(id => typeof id !== "string"))) {
            return res.status(400).json({ error: "nodeIds must be an array of strings" });
        }

        const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
        if (!organizationId && !isSuperAdmin) {
            return res.status(400).json({ error: "Organization context required" });
        }
        const graph = await xrayCompositionService.buildGraph(scope, organizationId ?? 0, { isSuperAdmin });
        const guide = xrayOperationalGuideService.buildGuide(graph);
        res.json(xrayContextPackageService.buildContext(graph, guide, {
            task,
            nodeIds,
            maxGraphHops: typeof maxGraphHops === "number" ? maxGraphHops : undefined,
            maxNodes: typeof maxNodes === "number" ? maxNodes : undefined,
        }));
    } catch (err: any) {
        logger.error("[Composition] copilot-context error", err.message);
        if (err.message === "Access denied for X-Ray composition scope") {
            return res.status(403).json({ error: "Access denied" });
        }
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/xray/composition/:scope/evaluate-event
 * Evaluates a normalized event against advisory notification rules without delivery.
 */
compositionRouter.post("/xray/composition/:scope/evaluate-event", requireAuth, async (req, res) => {
    try {
        const { scope } = req.params;
        const { eventType, subjectNodeId, evidence, task } = req.body ?? {};
        if (typeof eventType !== "string" || !eventType.trim()) {
            return res.status(400).json({ error: "eventType is required" });
        }
        if (subjectNodeId !== undefined && typeof subjectNodeId !== "string") {
            return res.status(400).json({ error: "subjectNodeId must be a string" });
        }
        if (evidence !== undefined && (typeof evidence !== "object" || evidence === null || Array.isArray(evidence))) {
            return res.status(400).json({ error: "evidence must be an object" });
        }

        const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
        if (!organizationId && !isSuperAdmin) {
            return res.status(400).json({ error: "Organization context required" });
        }
        const graph = await xrayCompositionService.buildGraph(scope, organizationId ?? 0, { isSuperAdmin });
        const guide = xrayOperationalGuideService.buildGuide(graph);
        res.json(xrayContextPackageService.evaluateEvent(graph, guide, {
            eventType: eventType.trim(),
            subjectNodeId,
            evidence,
            task: typeof task === "string" ? task : undefined,
        }));
    } catch (err: any) {
        logger.error("[Composition] evaluate-event error", err.message);
        if (err.message === "Access denied for X-Ray composition scope") {
            return res.status(403).json({ error: "Access denied" });
        }
        if (err.message.startsWith("Unknown operational event") || err.message.startsWith("Unknown subject node")) {
            return res.status(400).json({ error: err.message });
        }
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/xray/composition/:scope/operations-config
 * Returns organization-scoped ownership, authority, and routing configuration.
 */
compositionRouter.get("/xray/composition/:scope/operations-config", requireAuth, async (req, res) => {
    try {
        const { scope } = req.params;
        const { organizationId } = await getUserOrgContext(req);
        if (!organizationId) return res.status(400).json({ error: "Organization context required" });
        const config = await xrayOperationsPersistenceService.getConfig(organizationId, scope);
        res.json(config);
    } catch (err: any) {
        logger.error("[Composition] operations-config get error", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * PUT /api/xray/composition/:scope/operations-config
 * Saves versioned ownership, authority, and notification routing configuration.
 */
compositionRouter.put("/xray/composition/:scope/operations-config", requireAuth, async (req, res) => {
    try {
        const { scope } = req.params;
        const { schemaVersion, config } = req.body ?? {};
        if (typeof schemaVersion !== "string" || !schemaVersion.trim()) {
            return res.status(400).json({ error: "schemaVersion is required" });
        }
        if (typeof config !== "object" || config === null || Array.isArray(config)) {
            return res.status(400).json({ error: "config must be an object" });
        }
        const { organizationId, userId } = await getUserOrgContext(req);
        if (!organizationId) return res.status(400).json({ error: "Organization context required" });
        const record = await xrayOperationsPersistenceService.upsertConfig({
            organizationId,
            scope,
            schemaVersion: schemaVersion.trim(),
            config,
            updatedBy: userId === undefined || userId === null ? undefined : String(userId),
        });
        res.json(record);
    } catch (err: any) {
        logger.error("[Composition] operations-config save error", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/xray/composition/:scope/record-event
 * Evaluates and immutably records an event, creating at most one notification
 * per cooldown bucket. It never executes the recommended operational action.
 */
compositionRouter.post("/xray/composition/:scope/record-event", requireAuth, async (req, res) => {
    try {
        const { scope } = req.params;
        const { eventType, subjectNodeId, evidence, task, cycleId, missionRunId } = req.body ?? {};
        if (typeof eventType !== "string" || !eventType.trim()) {
            return res.status(400).json({ error: "eventType is required" });
        }
        if (cycleId !== undefined && (!Number.isInteger(cycleId) || cycleId <= 0)) {
            return res.status(400).json({ error: "cycleId must be a positive integer" });
        }
        if (missionRunId !== undefined && (!Number.isInteger(missionRunId) || missionRunId <= 0)) {
            return res.status(400).json({ error: "missionRunId must be a positive integer" });
        }
        const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
        if (!organizationId) return res.status(400).json({ error: "Organization context required" });

        const graph = await xrayCompositionService.buildGraph(scope, organizationId, { isSuperAdmin });
        const guide = xrayOperationalGuideService.buildGuide(graph);
        const evaluation = xrayContextPackageService.evaluateEvent(graph, guide, {
            eventType: eventType.trim(),
            subjectNodeId: typeof subjectNodeId === "string" ? subjectNodeId : undefined,
            evidence: typeof evidence === "object" && evidence !== null && !Array.isArray(evidence) ? evidence : undefined,
            task: typeof task === "string" ? task : undefined,
        });
        const persisted = await xrayOperationsPersistenceService.recordEvaluation({
            organizationId,
            scope,
            evaluation,
            cycleId,
            missionRunId,
        });
        res.status(persisted.deduplicated ? 200 : 201).json({
            evaluation,
            persisted,
        });
    } catch (err: any) {
        logger.error("[Composition] record-event error", err.message);
        if (err.message.startsWith("Unknown operational event") || err.message.startsWith("Unknown subject node")) {
            return res.status(400).json({ error: err.message });
        }
        res.status(500).json({ error: err.message });
    }
});

compositionRouter.get("/xray/operations/notifications", requireAuth, async (req, res) => {
    try {
        const { organizationId } = await getUserOrgContext(req);
        if (!organizationId) return res.status(400).json({ error: "Organization context required" });
        const notifications = await xrayOperationsPersistenceService.listUnreadNotifications(organizationId);
        res.json(notifications);
    } catch (err: any) {
        logger.error("[Composition] operational notifications error", err.message);
        res.status(500).json({ error: err.message });
    }
});

compositionRouter.put("/xray/operations/notifications/:id/acknowledge", requireAuth, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: "A valid notification id is required" });
        }
        const { organizationId, userId } = await getUserOrgContext(req);
        if (!organizationId) return res.status(400).json({ error: "Organization context required" });
        const notification = await xrayOperationsPersistenceService.acknowledgeNotification(
            organizationId,
            id,
            userId === undefined || userId === null ? undefined : String(userId),
        );
        if (!notification) return res.status(404).json({ error: "Notification not found" });
        res.json(notification);
    } catch (err: any) {
        logger.error("[Composition] notification acknowledgement error", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/xray/composition/reindex
 * Triggers a full relationship re-index for the requesting organization.
 * Returns stats on how many edges were written.
 */
compositionRouter.post("/xray/composition/reindex", requireAuth, async (req, res) => {
    try {
        const { organizationId } = await getUserOrgContext(req);
        if (!organizationId) return res.status(400).json({ error: "Organization context required" });

        const result = await fullReindex(organizationId);
        try {
          await xrayCompositionService.invalidateCache("oddjob", organizationId, true);
        } catch { }
        res.json({ success: true, ...result });
    } catch (err: any) {
        logger.error("[Composition] reindex error", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/xray/composition/:scope/cache
 * Invalidates the Redis cache for a scope. Scoped to the caller's org — a user
 * cannot bust the cache for another org's app slug.
 */
compositionRouter.delete("/xray/composition/:scope/cache", requireAuth, async (req, res) => {
    try {
        const { scope } = req.params;
        const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
        if (!organizationId && !isSuperAdmin) return res.status(400).json({ error: "Organization context required" });

        if (!isSuperAdmin && scope !== "oddjob") {
            const hasAccess = await xrayCompositionService.verifyScopeAccess(scope, organizationId!);
            if (!hasAccess) return res.status(403).json({ error: "Access denied: scope does not belong to your organization" });
        }

        await invalidateCompositionCache(scope, organizationId ?? undefined);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/xray/composition/:scope/node-detail
 * Returns rich node details, documentation, specs, and connections.
 */
compositionRouter.get("/xray/composition/:scope/node-detail", requireAuth, async (req, res) => {
    try {
        const { scope } = req.params;
        const nodeId = req.query.nodeId as string;
        if (!nodeId) return res.status(400).json({ error: "nodeId query parameter is required" });

        const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
        if (!organizationId && !isSuperAdmin) return res.status(400).json({ error: "Organization context required" });

        const { xrayNodeDetailService } = await import("../core/xray-node-detail.service.js");
        const details = await xrayNodeDetailService.getNodeDetail(scope, nodeId, organizationId ?? 0, isSuperAdmin);
        if (!details) return res.status(404).json({ error: "Node not found" });

        res.json(details);
    } catch (err: any) {
        logger.error("[Composition] node-detail error", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * PUT /api/xray/composition/node-documentation
 * Saves/updates user-written or AI markdown documentation for a node.
 */
compositionRouter.put("/xray/composition/node-documentation", requireAuth, async (req, res) => {
    try {
        const { nodeId, nodeType, summary, content } = req.body ?? {};
        if (typeof nodeId !== "string" || !nodeId.trim()) {
            return res.status(400).json({ error: "A valid nodeId is required" });
        }
        if (typeof content !== "string" || !content.trim()) {
            return res.status(400).json({ error: "Markdown documentation content is required" });
        }

        const { organizationId, userId } = await getUserOrgContext(req);
        if (!organizationId) return res.status(400).json({ error: "Organization context required" });

        const { xrayNodeDetailService } = await import("../core/xray-node-detail.service.js");
        const updated = await xrayNodeDetailService.saveNodeDocumentation(
            nodeId.trim(),
            nodeType || "unknown",
            typeof summary === "string" ? summary.trim() : "",
            content.trim(),
            organizationId,
            typeof userId === "number" ? userId : (userId ? parseInt(userId, 10) || undefined : undefined)
        );

        res.json({ success: true, documentation: updated });
    } catch (err: any) {
        logger.error("[Composition] node-documentation save error", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/xray/composition/:scope/generate-node-docs
 * Uses AI to auto-generate node documentation.
 */
compositionRouter.post("/xray/composition/:scope/generate-node-docs", requireAuth, async (req, res) => {
    try {
        const { scope } = req.params;
        const { nodeId } = req.body;
        if (!nodeId) return res.status(400).json({ error: "nodeId is required in body" });

        const { organizationId } = await getUserOrgContext(req);
        if (!organizationId) return res.status(400).json({ error: "Organization context required" });

        const { xrayNodeDetailService } = await import("../core/xray-node-detail.service.js");
        const doc = await xrayNodeDetailService.generateNodeDocumentation(scope, nodeId, organizationId);

        res.json({ success: true, documentation: doc });
    } catch (err: any) {
        logger.error("[Composition] generate-node-docs error", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/xray/composition/:scope/generate-app-doc
 * Synthesizes a complete Application Architecture Document based on discovered components & relationships.
 */
compositionRouter.post("/xray/composition/:scope/generate-app-doc", requireAuth, async (req, res) => {
    try {
        const { scope } = req.params;
        const { organizationId } = await getUserOrgContext(req);
        if (!organizationId) return res.status(400).json({ error: "Organization context required" });

        const { xrayNodeDetailService } = await import("../core/xray-node-detail.service.js");
        const result = await xrayNodeDetailService.generateAppArchitectureDoc(scope, organizationId);

        res.json({ success: true, ...result });
    } catch (err: any) {
        logger.error("[Composition] generate-app-doc error", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/xray/composition/node-documentation/changes
 * Fetches historical change register entries for a specific X-Ray node spec or across the organization.
 */
compositionRouter.get("/xray/composition/node-documentation/changes", requireAuth, async (req, res) => {
    try {
        const nodeId = req.query.nodeId as string | undefined;
        const limitStr = req.query.limit as string | undefined;
        const limit = limitStr ? parseInt(limitStr, 10) : 50;

        const { organizationId } = await getUserOrgContext(req);
        if (!organizationId) return res.status(400).json({ error: "Organization context required" });

        const { xrayNodeDetailService } = await import("../core/xray-node-detail.service.js");
        const changes = nodeId
            ? await xrayNodeDetailService.getNodeDocChangeRegister(nodeId, organizationId, limit)
            : await xrayNodeDetailService.getOrgXraySpecChangeRegister(organizationId, limit);

        res.json({ success: true, changes });
    } catch (err: any) {
        logger.error("[Composition] node-documentation changes error", err.message);
        res.status(500).json({ error: err.message });
    }
});



