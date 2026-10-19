/**
 * Per-org SaaS connector configuration: connector status, bidirectional-sync
 * settings and event workflows, as managed from /api/saas/connectors/*.
 *
 * Every method takes `organizationId: number`. Sync configs carry no org column
 * of their own; they are reached only through a connector found within the org.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
  missions,
  saasConnectors,
  saasEventWorkflows,
  saasSyncConfigs,
  type SaasConnector,
} from "@shared/schema/index.js";

export interface SyncConfigInput {
  enabled?: boolean;
  syncInterval?: number;
  conflictResolution?: string;
  mappings?: Record<string, unknown>;
  filters?: Record<string, unknown>;
}

export interface EventWorkflowInput {
  triggerEvent: string;
  workflowId: string;
  conditions?: Record<string, unknown>;
  transformation?: Record<string, unknown>;
  enabled?: boolean;
}

class SaasConnectorConfigService {
  /**
   * `projectId` undefined keeps the legacy "any connector for the platform"
   * lookup; a number prefers the project-scoped connector and falls back to
   * the org-wide one — the same resolution per-platform services use.
   */
  async findConnector(organizationId: number, platform: string, projectId?: number): Promise<SaasConnector | null> {
    const conditions = [
      eq(saasConnectors.orgId, organizationId),
      eq(saasConnectors.platform, platform),
      ...(projectId == null ? [] : [or(eq(saasConnectors.projectId, projectId), isNull(saasConnectors.projectId))]),
    ];
    const [connector] = projectId == null
      ? await db.select().from(saasConnectors).where(and(...conditions)).limit(1)
      : await db.select().from(saasConnectors).where(and(...conditions))
          .orderBy(sql`${saasConnectors.projectId} DESC NULLS LAST`)
          .limit(1);
    return connector ?? null;
  }

  /** Record the outcome of a credential re-check on the connector. */
  async recordReconnect(organizationId: number, connector: SaasConnector, errorMessage: string | null): Promise<void> {
    await db.update(saasConnectors)
      .set({
        status: errorMessage === null ? "connected" : "error",
        updatedAt: new Date(),
        config: { ...(connector.config as Record<string, unknown>), error_message: errorMessage },
      })
      .where(and(eq(saasConnectors.id, connector.id), eq(saasConnectors.orgId, organizationId)));
  }

  /** The connector and its sync config; either may be null when not configured. */
  async getSyncConfig(organizationId: number, platform: string, projectId?: number) {
    const connector = await this.findConnector(organizationId, platform, projectId);
    if (!connector) return { connector: null, syncConfig: null };
    const [syncConfig] = await db
      .select()
      .from(saasSyncConfigs)
      .where(eq(saasSyncConfigs.connectorId, connector.id))
      .limit(1);
    return { connector, syncConfig: syncConfig ?? null };
  }

  /** Create or update the platform's sync config; null when the org has no connector for it. */
  async upsertSyncConfig(organizationId: number, platform: string, input: SyncConfigInput, projectId?: number) {
    const connector = await this.findConnector(organizationId, platform, projectId);
    if (!connector) return null;

    const [existing] = await db
      .select()
      .from(saasSyncConfigs)
      .where(eq(saasSyncConfigs.connectorId, connector.id))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(saasSyncConfigs)
        .set({
          enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
          syncInterval: input.syncInterval || existing.syncInterval,
          conflictResolution: input.conflictResolution || existing.conflictResolution,
          mappings: input.mappings || existing.mappings,
          filters: input.filters || existing.filters,
          updatedAt: new Date(),
        })
        .where(eq(saasSyncConfigs.id, existing.id))
        .returning();
      return updated;
    }

    const [inserted] = await db
      .insert(saasSyncConfigs)
      .values({
        connectorId: connector.id,
        enabled: input.enabled !== undefined ? input.enabled : true,
        syncInterval: input.syncInterval || 15,
        conflictResolution: input.conflictResolution || "last_write_wins",
        mappings: input.mappings || {},
        filters: input.filters || {},
      })
      .returning();
    return inserted;
  }

  /** False when the org has no connector for the platform. */
  async deleteSyncConfig(organizationId: number, platform: string, projectId?: number): Promise<boolean> {
    const connector = await this.findConnector(organizationId, platform, projectId);
    if (!connector) return false;
    await db.delete(saasSyncConfigs).where(eq(saasSyncConfigs.connectorId, connector.id));
    return true;
  }

  listEventWorkflows(organizationId: number, platform: string) {
    return db
      .select()
      .from(saasEventWorkflows)
      .where(and(eq(saasEventWorkflows.orgId, organizationId), eq(saasEventWorkflows.platform, platform)));
  }

  /**
   * Create or update the workflow keyed by (org, platform, workflowId).
   *
   * A numeric workflowId is a mission id: saas-event-orchestrator launches it as
   * `system` when a matching event arrives, and launchMission loads the mission
   * by id alone. Unchecked, a member could point a workflow at another tenant's
   * mission and run it — with their own payload in its context — by posting to
   * /test-event-workflow. So a numeric id must name a mission in this org.
   * Non-numeric ids are free-text descriptors the orchestrator does not launch.
   */
  async upsertEventWorkflow(organizationId: number, platform: string, input: EventWorkflowInput) {
    if (/^\d+$/.test(input.workflowId)) {
      const [mission] = await db
        .select({ id: missions.id })
        .from(missions)
        .where(and(eq(missions.id, Number(input.workflowId)), eq(missions.organizationId, organizationId)))
        .limit(1);
      if (!mission) return { ok: false as const, failure: "mission-not-found" as const };
    }

    const [existing] = await db
      .select({ id: saasEventWorkflows.id })
      .from(saasEventWorkflows)
      .where(and(
        eq(saasEventWorkflows.orgId, organizationId),
        eq(saasEventWorkflows.platform, platform),
        eq(saasEventWorkflows.workflowId, input.workflowId),
      ))
      .limit(1);

    const fields = {
      triggerEvent: input.triggerEvent,
      conditions: input.conditions || {},
      transformation: input.transformation || {},
      enabled: input.enabled !== undefined ? input.enabled : true,
    };

    if (existing) {
      const [updated] = await db
        .update(saasEventWorkflows)
        .set({ ...fields, updatedAt: new Date() })
        .where(and(eq(saasEventWorkflows.id, existing.id), eq(saasEventWorkflows.orgId, organizationId)))
        .returning();
      return { ok: true as const, workflow: updated };
    }

    const [inserted] = await db
      .insert(saasEventWorkflows)
      .values({ orgId: organizationId, platform, workflowId: input.workflowId, ...fields })
      .returning();
    return { ok: true as const, workflow: inserted };
  }
}

export const saasConnectorConfigService = new SaasConnectorConfigService();
