/**
 * Mission-to-App Dataset Sync Service
 *
 * Automatically synchronizes mission results to app datasets,
 * enabling real-time operational apps without manual data updates.
 *
 * Features:
 * - Auto-sync mission blackboard data to app datasets
 * - Configurable sync rules and transformations
 * - Real-time push notifications to apps
 * - Bidirectional sync support (app → mission feedback)
 * - Conflict resolution for concurrent updates
 * - Sync audit logging and rollback capability
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { eq, and, or, inArray, sql, desc } from "drizzle-orm";
import { missions } from "@shared/schema/missions/core.js";
import { missionRuns } from "@shared/schema/missions/runs.js";
import { apps, appDeployments, appRecords, pipelineExecutions, pipelines } from "@shared/schema/index.js";
import { datasets } from "@shared/schema/datasets.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("MissionAppSync");

const MISSION_NAME_TO_YAML_ID: Record<string, string> = {
  "Evaluation Run": "mission-eval-1",
  "Failure Analysis": "mission-eval-2",
  "Training Direction Sign-off": "mission-eval-3",
  "Synthetic Data Generation": "mission-eval-4",
  "Shadow Run Validation": "mission-eval-5",
  "Training Promotion": "mission-eval-6",
};

export interface SyncConfig {
  syncEnabled: boolean;
  syncDirection: "mission-to-app" | "app-to-mission" | "bidirectional";
  syncTrigger: "on-complete" | "on-milestone" | "real-time" | "manual";
  datasetMappings: DatasetMapping[];
  transformationRules?: TransformationRule[];
  conflictResolution: "mission-wins" | "app-wins" | "last-write-wins" | "manual";
  retryPolicy: {
    maxRetries: number;
    backoffMs: number;
  };
}

export interface DatasetMapping {
  missionDataPath: string; // e.g., "blackboard.results"
  appDatasetId: number;
  appCollectionName: string;
  fieldMapping: Record<string, string>; // missionField -> datasetField
  filterCondition?: string; // Optional filter expression
}

export interface TransformationRule {
  field: string;
  operation: "uppercase" | "lowercase" | "format-date" | "calculate" | "concatenate";
  params?: Record<string, any>;
}

export interface SyncOperation {
  id: string;
  missionId: number;
  appId: number;
  operationType: "push" | "pull" | "bidirectional";
  status: "pending" | "in-progress" | "completed" | "failed" | "conflict";
  recordsAffected: number;
  startedAt: Date;
  completedAt?: Date;
  errorMessage?: string;
  conflictDetails?: any;
}

export interface SyncStatus {
  lastSyncAt?: Date;
  lastSyncStatus?: string;
  totalSyncs: number;
  failedSyncs: number;
  pendingSyncs: number;
  lastError?: string;
}

export const missionAppSyncService = {
  /**
   * Main entry point: Sync mission data to connected apps
   */
  async syncMissionToApps(missionId: number, trigger: string = "manual"): Promise<{
    success: boolean;
    operations: SyncOperation[];
    summary: {
      appsAffected: number;
      datasetsUpdated: number;
      recordsSynced: number;
      errors: string[];
    };
  }> {
    logger.info(`[MissionAppSync] Syncing mission ${missionId} to apps (trigger: ${trigger})`);

    try {
      // 1. Get mission details
      const mission = await this.getMissionDetails(missionId);
      if (!mission) {
        throw new Error(`Mission ${missionId} not found`);
      }

      // 2. Find apps linked to this mission
      const linkedApps = await this.findLinkedApps(missionId, mission.organizationId, mission.name);
      if (linkedApps.length === 0) {
        logger.info(`[MissionAppSync] No linked apps found for mission ${missionId}`);
        return {
          success: true,
          operations: [],
          summary: { appsAffected: 0, datasetsUpdated: 0, recordsSynced: 0, errors: [] },
        };
      }

      // 3. Execute sync for each app
      const operations: SyncOperation[] = [];
      const errors: string[] = [];
      let totalRecordsSynced = 0;
      let totalDatasetsUpdated = 0;

      for (const app of linkedApps) {
        try {
          const result = await this.syncSingleApp(mission, app, trigger);
          totalRecordsSynced += result.recordsSynced;
          totalDatasetsUpdated += result.datasetsUpdated;
          if (result.operation) operations.push(result.operation);
          if (result.error) errors.push(result.error);
        } catch (error: any) {
          errors.push(`App ${app.name}: ${error.message}`);
          logger.error(`[MissionAppSync] Failed to sync to app ${app.id}:`, error.message);
        }
      }

      // 4. Update mission sync status
      await this.updateMissionSyncStatus(missionId, operations);

      // 5. Emit event for real-time updates
      await this.emitSyncEvent(missionId, operations);

      const summary = {
        appsAffected: operations.filter((o) => o.status === "completed").length,
        datasetsUpdated: totalDatasetsUpdated,
        recordsSynced: totalRecordsSynced,
        errors,
      };

      logger.info(
        `[MissionAppSync] Mission ${missionId} sync complete: ${summary.appsAffected} apps, ${summary.recordsSynced} records`
      );

      return {
        success: errors.length === 0 || summary.appsAffected > 0,
        operations,
        summary,
      };
    } catch (error: any) {
      logger.error(`[MissionAppSync] Mission sync failed:`, error.message);
      throw error;
    }
  },

  /**
   * Sync mission data to a single app (extracted from main loop).
   * Returns collected results; caller is responsible for accumulating operations/errors.
   */
  async syncSingleApp(
    mission: NonNullable<Awaited<ReturnType<typeof this.getMissionDetails>>>,
    app: Awaited<ReturnType<typeof this.findLinkedApps>>[0],
    trigger: string
  ): Promise<{ recordsSynced: number; datasetsUpdated: number; operation?: SyncOperation; error?: string }> {
    const syncConfig = this.parseSyncConfig(app.syncConfig);

    if (!syncConfig.syncEnabled) {
      logger.info(`[MissionAppSync] Sync disabled for app ${app.id}`);
      return { recordsSynced: 0, datasetsUpdated: 0 };
    }

    if (!this.shouldSyncForTrigger(syncConfig.syncTrigger, trigger)) {
      return { recordsSynced: 0, datasetsUpdated: 0 };
    }

    const operation = await this.syncToApp(mission, app, syncConfig);

    if (operation.status === "completed") {
      return {
        recordsSynced: operation.recordsAffected,
        datasetsUpdated: syncConfig.datasetMappings.length,
        operation
      };
    }

    const error = operation.status === "failed" && operation.errorMessage
      ? `App ${app.name}: ${operation.errorMessage}`
      : undefined;
    return { recordsSynced: 0, datasetsUpdated: 0, operation, error };
  },

  /**
   * Get mission details with blackboard data
   */
  async getMissionDetails(missionId: number): Promise<
    | {
        id: number;
        name: string;
        status: string;
        blackboard: any;
        organizationId: number | null;
        completedAt?: Date;
      }
    | undefined
  > {
    const [mission] = await db
      .select({
        id: missions.id,
        name: missions.name,
        status: missions.status,
        blackboard: missions.blackboard,
        organizationId: missions.organizationId,
      })
      .from(missions)
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!mission) return undefined;

    // Get latest mission run completion time
    const [latestRun] = await db
      .select({ completedAt: missionRuns.updatedAt })
      .from(missionRuns)
      .where(and(eq(missionRuns.missionId, missionId), eq(missionRuns.status, 'completed')))
      .orderBy(desc(missionRuns.updatedAt))
      .limit(1);

    return {
      ...mission,
      completedAt: latestRun?.completedAt || undefined,
    };
  },

  /**
   * Find apps linked to a mission
   */
  async findLinkedApps(
    missionId: number,
    organizationId: number | null,
    missionName?: string
  ): Promise<
    Array<{
      id: number;
      name: string;
      slug: string;
      syncConfig: any;
      deploymentId?: number;
      deploymentUrl?: string;
      organizationId: number;
    }>
  > {
    // A null organization used to widen this to `sql`true``, i.e. no filter at
    // all, so a mission with no organization matched every tenant's apps and
    // then synced data into them. There is no correct unscoped answer here.
    if (organizationId == null) {
      logger.warn(
        `[MissionAppSync] Mission ${missionId} has no organization; no linked apps can be resolved.`,
      );
      return [];
    }
    const orgFilter = eq(apps.organizationId, organizationId);

    // 1. Find backing pipeline for the mission run or mission
    let yamlMissionId: string | null = null;
    if (missionName && MISSION_NAME_TO_YAML_ID[missionName]) {
      yamlMissionId = MISSION_NAME_TO_YAML_ID[missionName];
      logger.info(`[MissionAppSync] Resolved mission name "${missionName}" to YAML ID: ${yamlMissionId}`);
    }

    if (!yamlMissionId) {
      try {
        const [pipelineExec] = await db
          .select({ pipelineId: pipelineExecutions.pipelineId })
          .from(pipelineExecutions)
          .where(
            or(
              eq(pipelineExecutions.missionId, missionId),
              eq(pipelineExecutions.missionRunId, missionId)
            )
          )
          .limit(1);

        if (pipelineExec) {
          const [pipeline] = await db
            .select({ labels: pipelines.labels })
            .from(pipelines)
            .where(eq(pipelines.id, pipelineExec.pipelineId))
            .limit(1);
          
          const labels = pipeline?.labels as Record<string, any> || {};
          if (labels?.missionId) {
            yamlMissionId = labels.missionId;
            logger.info(`[MissionAppSync] Resolved mission ${missionId} to YAML ID: ${yamlMissionId}`);
          }
        }
      } catch (err: any) {
        logger.warn(`[MissionAppSync] Error resolving pipeline labels: ${err.message}`);
      }
    }

    // 2. Fetch all apps for this organization
    const appsList = await db
      .select({
        id: apps.id,
        name: apps.name,
        slug: apps.slug,
        config: apps.config,
        oddjobMissionId: apps.oddjobMissionId,
        organizationId: apps.organizationId,
        runtimeMetadata: apps.runtimeMetadata,
      })
      .from(apps)
      .where(orgFilter);

    // 3. Filter apps to find the linked ones
    const linkedAppsList = appsList.filter((app) => {
      // Direct link
      if (app.oddjobMissionId === missionId) return true;

      // Sync config link
      const syncMissions = Array.isArray((app.config as any)?.syncMissions) ? (app.config as any).syncMissions : [];
      if (syncMissions.includes(missionId)) return true;

      // Cycle app config / dependentMissionIds link
      const cycleApp = (app.runtimeMetadata as any)?.cycleApp ?? (app.config as any)?.cycleApp ?? null;
      if (cycleApp) {
        const interactionModel = String(cycleApp.interactionModel || "").toLowerCase();
        if (interactionModel === "shared-server") {
          const modules = (app.runtimeMetadata as any)?.workbenchModules || [];
          return modules.some((mod: any) => {
            const dependentIds = Array.isArray(mod.dependentMissions) ? mod.dependentMissions : [];
            return yamlMissionId && dependentIds.includes(yamlMissionId);
          });
        } else {
          const dependentIds = Array.isArray(cycleApp.dependentMissionIds) ? cycleApp.dependentMissionIds : [];
          return yamlMissionId && dependentIds.includes(yamlMissionId);
        }
      }

      return false;
    });

    // Get deployment info for each linked app
    const result = [];
    for (const app of linkedAppsList) {
      const [deployment] = await db
        .select({
          id: appDeployments.id,
          url: appDeployments.url,
        })
        .from(appDeployments)
        .where(
          and(
            eq(appDeployments.appId, app.id),
            eq(appDeployments.isPublished, true)
          )
        )
        .orderBy(desc(appDeployments.installedAt))
        .limit(1);

      result.push({
        id: app.id,
        name: app.name,
        slug: app.slug,
        syncConfig: (app.config)?.sync || {},
        deploymentId: deployment?.id,
        deploymentUrl: deployment?.url || undefined,
        // Was `?? 291`, which labelled an unattributable app as TECHHEAD7's.
        // organizationId is non-null from the guard above, so the only
        // remaining fallback is the real one.
        organizationId: app.organizationId ?? organizationId,
      });
    }

    return result;
  },

  /**
   * Parse sync configuration from app config
   */
  parseSyncConfig(config: any): SyncConfig {
    const defaultConfig: SyncConfig = {
      syncEnabled: true,
      syncDirection: "mission-to-app",
      syncTrigger: "on-complete",
      datasetMappings: [],
      conflictResolution: "mission-wins",
      retryPolicy: {
        maxRetries: 3,
        backoffMs: 1000,
      },
    };

    if (!config) return defaultConfig;

    return {
      ...defaultConfig,
      ...config,
      datasetMappings: config.datasetMappings || defaultConfig.datasetMappings,
      retryPolicy: {
        ...defaultConfig.retryPolicy,
        ...config.retryPolicy,
      },
    };
  },

  /**
   * Check if sync should trigger for this event type
   */
  shouldSyncForTrigger(configTrigger: string, eventTrigger: string): boolean {
    if (configTrigger === "manual" && eventTrigger !== "manual") return false;
    if (configTrigger === "on-complete" && eventTrigger !== "on-complete") return false;
    if (configTrigger === "on-milestone" && !eventTrigger.includes("milestone")) return false;
    return true;
  },

  /**
   * Sync mission data to a specific app
   */
  async syncToApp(
    mission: NonNullable<Awaited<ReturnType<typeof this.getMissionDetails>>>,
    app: Awaited<ReturnType<typeof this.findLinkedApps>>[0],
    config: SyncConfig
  ): Promise<SyncOperation> {
    const operationId = `sync_${mission.id}_${app.id}_${Date.now()}`;
    const operation: SyncOperation = {
      id: operationId,
      missionId: mission.id,
      appId: app.id,
      operationType: config.syncDirection === "bidirectional" ? "bidirectional" : "push",
      status: "in-progress",
      recordsAffected: 0,
      startedAt: new Date(),
    };

    logger.info(`[MissionAppSync] Starting sync operation ${operationId}`);

    try {
      let totalRecords = 0;

      // Process each dataset mapping
      for (const mapping of config.datasetMappings) {
        const records = await this.syncDatasetMapping(mission, app, mapping, config);
        totalRecords += records;
      }

      operation.recordsAffected = totalRecords;
      operation.status = "completed";
      operation.completedAt = new Date();

      // Update app dataset cache timestamp
      await this.updateAppSyncTimestamp(app.id, mission.id);

      logger.info(`[MissionAppSync] Operation ${operationId} completed: ${totalRecords} records`);
    } catch (error: any) {
      operation.status = "failed";
      operation.errorMessage = error.message;
      operation.completedAt = new Date();
      logger.error(`[MissionAppSync] Operation ${operationId} failed:`, error.message);
    }

    return operation;
  },

  /**
   * Sync a single dataset mapping
   */
  async syncDatasetMapping(
    mission: NonNullable<Awaited<ReturnType<typeof this.getMissionDetails>>>,
    app: Awaited<ReturnType<typeof this.findLinkedApps>>[0],
    mapping: DatasetMapping,
    config: SyncConfig
  ): Promise<number> {
    // Extract data from mission blackboard
    const missionData = this.extractDataFromPath(mission.blackboard, mapping.missionDataPath);
    
    if (!missionData) {
      logger.warn(`[MissionAppSync] No data found at path ${mapping.missionDataPath} for mission ${mission.id}`);
      return 0;
    }

    // Transform data according to field mappings
    const transformedData = this.transformData(missionData, mapping.fieldMapping, config.transformationRules);

    // Push to app's dataset
    const recordsSynced = await this.pushToAppDataset(
      app,
      mapping.appDatasetId,
      mapping.appCollectionName,
      transformedData,
      config.conflictResolution
    );

    return recordsSynced;
  },

  /**
   * Extract data from blackboard using dot-notation path
   */
  extractDataFromPath(blackboard: Record<string, any>, path: string): any {
    const parts = path.split(".");
    let current = blackboard;

    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }

    return current;
  },

  /**
   * Transform data according to field mappings and rules
   */
  transformData(
    data: any,
    fieldMapping: Record<string, string>,
    transformationRules?: TransformationRule[]
  ): any[] {
    // Handle array data
    const dataArray = Array.isArray(data) ? data : [data];

    return dataArray.map((item) => {
      const transformed: Record<string, any> = {};

      // Apply field mappings
      for (const [missionField, datasetField] of Object.entries(fieldMapping)) {
        let value = this.getNestedValue(item, missionField);

        // Apply transformation rules
        if (transformationRules) {
          const rule = transformationRules.find((r) => r.field === missionField);
          if (rule) {
            value = this.applyTransformation(value, rule);
          }
        }

        this.setNestedValue(transformed, datasetField, value);
      }

      // Add metadata
      transformed._syncedAt = new Date().toISOString();
      transformed._syncSource = "mission";

      return transformed;
    });
  },

  /**
   * Get nested value from object using dot notation
   */
  getNestedValue(obj: any, path: string): any {
    const parts = path.split(".");
    let current = obj;

    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }

    return current;
  },

  /**
   * Set nested value in object using dot notation
   */
  setNestedValue(obj: any, path: string, value: any): void {
    const parts = path.split(".");
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }

    current[parts[parts.length - 1]] = value;
  },

  /**
   * Apply transformation rule to value
   */
  applyTransformation(value: any, rule: TransformationRule): any {
    switch (rule.operation) {
      case "uppercase":
        return typeof value === "string" ? value.toUpperCase() : value;
      case "lowercase":
        return typeof value === "string" ? value.toLowerCase() : value;
      case "format-date":
        if (value instanceof Date || !isNaN(Date.parse(value))) {
          const date = new Date(value);
          return date.toISOString().split("T")[0];
        }
        return value;
      case "calculate":
        if (rule.params?.formula && typeof value === "number") {
          // Simple calculation support
          const { multiplier = 1, addend = 0 } = rule.params;
          return value * multiplier + addend;
        }
        return value;
      case "concatenate":
        if (rule.params?.fields && typeof value === "object") {
          const values = rule.params.fields.map((f: string) => value[f]).filter(Boolean);
          return values.join(rule.params.separator || " ");
        }
        return value;
      default:
        return value;
    }
  },

  /**
   * Push data to app's dataset collection
   */
  async pushToAppDataset(
    app: Awaited<ReturnType<typeof this.findLinkedApps>>[0],
    datasetId: number,
    collectionName: string,
    data: any[],
    conflictResolution: string
  ): Promise<number> {
    logger.info(
      `[MissionAppSync] Pushing ${data.length} records to app ${app.name} dataset ${datasetId} (collection: ${collectionName})`
    );

    let insertedCount = 0;
    const crypto = await import("node:crypto");

    for (const item of data) {
      try {
        const recordId = String(item.id || item.recordId || item.caseId || crypto.randomUUID());

        await db
          .insert(appRecords)
          .values({
            appId: app.id,
            orgId: app.organizationId,
            collection: collectionName,
            recordId: recordId,
            data: item,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [appRecords.appId, appRecords.orgId, appRecords.collection, appRecords.recordId],
            set: {
              data: item,
              updatedAt: new Date(),
            },
          });
        insertedCount++;
      } catch (err: any) {
        logger.error(`[MissionAppSync] Failed to push item to app dataset: ${err.message}`, err);
      }
    }

    return insertedCount;
  },

  /**
   * Update app's last sync timestamp
   */
  async updateAppSyncTimestamp(appId: number, missionId: number): Promise<void> {
    await db
      .update(apps)
      .set({
        config: sql`config || ${JSON.stringify({
          lastSync: {
            missionId,
            syncedAt: new Date().toISOString(),
          },
        })}::jsonb`,
      })
      .where(eq(apps.id, appId));
  },

  /**
   * Update mission sync status
   */
  async updateMissionSyncStatus(missionId: number, operations: SyncOperation[]): Promise<void> {
    const successfulOps = operations.filter((o) => o.status === "completed");
    
    await db
      .update(missions)
      .set({
        blackboard: sql`blackboard || ${JSON.stringify({
          syncStatus: {
            lastSyncAt: new Date().toISOString(),
            appsSynced: successfulOps.length,
            totalRecords: successfulOps.reduce((sum, o) => sum + o.recordsAffected, 0),
            operations: operations.map((o) => ({
              appId: o.appId,
              status: o.status,
              records: o.recordsAffected,
            })),
          },
        })}::jsonb`,
      })
      .where(eq(missions.id, missionId));
  },

  /**
   * Emit sync event for real-time updates
   */
  async emitSyncEvent(missionId: number, operations: SyncOperation[]): Promise<void> {
    await eventStream.publish(
      "mission.data.synced",
      {
        missionId,
        syncedAt: new Date().toISOString(),
        appsUpdated: operations.filter((o) => o.status === "completed").map((o) => o.appId),
        totalRecords: operations.reduce((sum, o) => sum + o.recordsAffected, 0),
      },
      { subject: `mission:${missionId}` },
      "mission-app-sync"
    );
  },

  /**
   * Get sync status for a mission-app pair
   */
  async getSyncStatus(missionId: number, appId?: number): Promise<SyncStatus> {
    const [mission] = await db
      .select({
        blackboard: missions.blackboard,
      })
      .from(missions)
      .where(eq(missions.id, missionId))
      .limit(1);

    const syncStatus = (mission?.blackboard as any)?.syncStatus;

    return {
      lastSyncAt: syncStatus?.lastSyncAt,
      lastSyncStatus: syncStatus?.appsSynced > 0 ? "success" : "no-sync",
      totalSyncs: syncStatus?.operations?.length || 0,
      failedSyncs: syncStatus?.operations?.filter((o: any) => o.status === "failed").length || 0,
      pendingSyncs: 0, // Would need to query pending queue
      lastError: syncStatus?.operations?.find((o: any) => o.status === "failed")?.error,
    };
  },

  /**
   * Configure sync for an app
   */
  async configureAppSync(
    appId: number,
    config: Partial<SyncConfig>
  ): Promise<boolean> {
    try {
      await db
        .update(apps)
        .set({
          config: sql`config || ${JSON.stringify({ sync: config })}::jsonb`,
        })
        .where(eq(apps.id, appId));

      logger.info(`[MissionAppSync] Configured sync for app ${appId}`);
      return true;
    } catch (error: any) {
      logger.error(`[MissionAppSync] Failed to configure sync for app ${appId}:`, error.message);
      return false;
    }
  },

  /**
   * Batch sync multiple missions
   */
  async batchSync(
    missionIds: number[],
    trigger: string = "manual"
  ): Promise<
    {
      missionId: number;
      success: boolean;
      appsAffected: number;
      recordsSynced: number;
      error?: string;
    }[]
  > {
    const results = [];

    for (const missionId of missionIds) {
      try {
        const result = await this.syncMissionToApps(missionId, trigger);
        results.push({
          missionId,
          success: result.success,
          appsAffected: result.summary.appsAffected,
          recordsSynced: result.summary.recordsSynced,
        });
      } catch (error: any) {
        results.push({
          missionId,
          success: false,
          appsAffected: 0,
          recordsSynced: 0,
          error: error.message,
        });
      }
    }

    return results;
  },

  /**
   * Get sync configuration template
   */
  getSyncConfigTemplate(): SyncConfig {
    return {
      syncEnabled: true,
      syncDirection: "mission-to-app",
      syncTrigger: "on-complete",
      datasetMappings: [
        {
          missionDataPath: "blackboard.results",
          appDatasetId: 0, // To be filled
          appCollectionName: "mission_results",
          fieldMapping: {
            "id": "mission_id",
            "name": "mission_name",
            "outcome": "result",
            "completedAt": "completed_date",
          },
        },
      ],
      transformationRules: [
        {
          field: "completedAt",
          operation: "format-date",
        },
      ],
      conflictResolution: "mission-wins",
      retryPolicy: {
        maxRetries: 3,
        backoffMs: 1000,
      },
    };
  },
};

export default missionAppSyncService;
