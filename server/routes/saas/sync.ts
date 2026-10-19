// @ts-nocheck
import { Router, Request, Response } from "express";
import { getUserOrgContext, requireOrgId } from "../../utils/auth-context.js";
import { asyncHandler } from "../../middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { resolveProjectScope } from "../../middleware/project-scope.js";
import { db } from "../../database_service.js";
import { saasConnectors, saasSyncConfigs } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { BadRequestError, NotFoundError } from "../../utils/errors.js";

const router = Router();

// GET /api/saas/sync-configs - Get all sync configurations for the organization
router.get("/sync-configs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    const configs = await db
        .select({
            id: saasSyncConfigs.id,
            connectorId: saasSyncConfigs.connectorId,
            enabled: saasSyncConfigs.enabled,
            sync_interval: saasSyncConfigs.syncInterval,
            conflict_resolution: saasSyncConfigs.conflictResolution,
            mappings: saasSyncConfigs.mappings,
            filters: saasSyncConfigs.filters,
            platform: saasConnectors.platform
        })
        .from(saasSyncConfigs)
        .innerJoin(saasConnectors, eq(saasSyncConfigs.connectorId, saasConnectors.id))
        .where(eq(saasConnectors.orgId, organizationId));

    res.json(configs);
}));

// POST /api/saas/connectors/:platform/sync-config - Save sync configuration
router.post("/connectors/:platform/sync-config", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform } = req.params;
    const { enabled, sync_interval, conflict_resolution, field_mappings, filters } = req.body;
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    // Deep Validation
    if (!field_mappings || typeof field_mappings !== 'object') {
        throw new BadRequestError("Invalid FIELD_MAPPINGS protocol detected.");
    }

    if (!filters || typeof filters !== 'object') {
        throw new BadRequestError("Invalid LOGIC_GATE configuration detected.");
    }

    const [connector] = await db
        .select()
        .from(saasConnectors)
        .where(
            and(
                eq(saasConnectors.orgId, organizationId),
                eq(saasConnectors.platform, platform)
            )
        )
        .limit(1);

    if (!connector) {
        throw new NotFoundError("Neural bridge not found for target platform. Link the platform first.");
    }

    const [existingConfig] = await db
        .select()
        .from(saasSyncConfigs)
        .where(eq(saasSyncConfigs.connectorId, connector.id))
        .limit(1);

    const configData = {
        connectorId: connector.id,
        enabled: enabled ?? true,
        syncInterval: sync_interval || 15,
        conflictResolution: conflict_resolution || "last_write_wins",
        fieldMappings: field_mappings, // Note: The schema field name is fieldMappings
        filters: filters,
        updatedAt: new Date()
    };

    if (existingConfig) {
        await db.update(saasSyncConfigs)
            .set(configData)
            .where(eq(saasSyncConfigs.id, existingConfig.id));
    } else {
        await db.insert(saasSyncConfigs)
            .values({
                ...configData,
                createdAt: new Date()
            });
    }

    // Mark connector as stable
    await db.update(saasConnectors)
        .set({ 
            status: 'stable',
            errorMessage: null
        })
        .where(eq(saasConnectors.id, connector.id));

    res.json({ 
        success: true, 
        message: "Neural linkage established and synchronized.",
        health: "OPTIMAL"
    });
}));

// POST /api/saas/connectors/:platform/schema-snapshot - Save a schema snapshot
router.post("/connectors/:platform/schema-snapshot", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform } = req.params;
    const { fields, name } = req.body;
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    const [connector] = await db
        .select()
        .from(saasConnectors)
        .where(
            and(
                eq(saasConnectors.orgId, organizationId),
                eq(saasConnectors.platform, platform)
            )
        )
        .limit(1);

    if (!connector) {
        throw new NotFoundError("Connector not found.");
    }

    const snapshotName = name || `${platform.toUpperCase()} Schema Snapshot - ${new Date().toLocaleDateString()}`;

    const [lastSnapshot] = await db
        .select()
        .from(saasSchemaSnapshots)
        .where(eq(saasSchemaSnapshots.connectorId, connector.id))
        .orderBy(desc(saasSchemaSnapshots.version))
        .limit(1);

    const version = (lastSnapshot?.version || 0) + 1;

    await db.insert(saasSchemaSnapshots)
        .values({
            connectorId: connector.id,
            platform,
            name: snapshotName,
            fields: fields || [],
            version,
            createdAt: new Date()
        });

    res.json({ success: true, message: `Schema snapshot v${version} saved successfully.` });
}));

// GET /api/saas/connectors/:platform/schema-snapshots - List schema snapshots
router.get("/connectors/:platform/schema-snapshots", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform } = req.params;
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    const snapshots = await db
        .select()
        .from(saasSchemaSnapshots)
        .innerJoin(saasConnectors, eq(saasSchemaSnapshots.connectorId, saasConnectors.id))
        .where(
            and(
                eq(saasConnectors.orgId, organizationId),
                eq(saasConnectors.platform, platform)
            )
        )
        .orderBy(desc(saasSchemaSnapshots.version));

    res.json(snapshots.map(s => s.saas_schema_snapshots));
}));

// POST /api/saas/connectors/:platform/sync-now - Trigger manual sync
router.post("/connectors/:platform/sync-now", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform } = req.params;
    const { sync_type } = req.body;
    const orgContext = await getUserOrgContext(req);
    const organizationId = (req.body.parameters?.organization_id && orgContext.isSuperAdmin)
        ? parseInt(req.body.parameters.organization_id)
        : (requireOrgId(orgContext));

    const { saasSyncService } = await import("../../domain/integrations/saas-sync.service.js");

    // Optional project scope — a project-scoped connection is preferred over
    // the org-wide one, mirroring per-platform connection resolution.
    const project = req.query.projectId || req.query.projectKey
        ? await resolveProjectScope(req)
        : null;

    try {
        const result = await saasSyncService.syncPlatform(
            platform,
            organizationId,
            (req as any).user?.id || 'system',
            sync_type,
            orgContext.isSuperAdmin,
            { projectId: project?.id ?? null }
        );

        return res.json(result);
    } catch (err: any) {
        throw new BadRequestError(`Sync failed: ${err.message}`);
    }
}));

// POST /api/saas/connectors/:platform/trigger-extraction - Trigger Knowledge Graph extraction
router.post("/connectors/:platform/trigger-extraction", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform } = req.params;
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const userId = orgContext.userId || "system";

    const { saasIntegrationService } = await import("../../domain/integrations/saas-integration-service.js");
    const result = await saasIntegrationService.triggerPlatformExtraction(platform, organizationId, userId);

    res.json(result);
}));

export default router;

