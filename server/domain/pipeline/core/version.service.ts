/**
 * Version Service
 * 
 * Manages version history for jobs, pipelines, and other entities.
 * Provides create, list, get, rollback, and diff operations.
 */

import { db } from "@server/database_service.js";
import { entityVersions, EntityVersion, EntityVersionType } from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("VersionService");

// ============================================================================
// VERSION CRUD
// ============================================================================

/**
 * Create a new version snapshot
 * Automatically increments version number
 */
export async function createVersion(
    entityType: EntityVersionType,
    entityId: number,
    snapshot: Record<string, any>,
    options: {
        userId?: string;
        organizationId?: number;
        changeSummary?: string;
        changedFields?: string[];
    } = {}
): Promise<EntityVersion> {
    // Get next version number
    const [latest] = await db
        .select({ version: entityVersions.version })
        .from(entityVersions)
        .where(and(
            eq(entityVersions.entityType, entityType),
            eq(entityVersions.entityId, entityId)
        ))
        .orderBy(desc(entityVersions.version))
        .limit(1);

    const nextVersion = (latest?.version || 0) + 1;

    const [version] = await db.insert(entityVersions).values({
        entityType,
        entityId,
        version: nextVersion,
        snapshot,
        changeSummary: options.changeSummary,
        changedFields: options.changedFields,
        userId: options.userId,
        organizationId: options.organizationId,
    }).returning();

    logger.info(`Version ${nextVersion} created for ${entityType}:${entityId}`);
    return version;
}

/**
 * Get all versions for an entity
 */
export async function getVersions(
    entityType: EntityVersionType,
    entityId: number,
    limit: number = 50
): Promise<EntityVersion[]> {
    return await db
        .select()
        .from(entityVersions)
        .where(and(
            eq(entityVersions.entityType, entityType),
            eq(entityVersions.entityId, entityId)
        ))
        .orderBy(desc(entityVersions.version))
        .limit(limit);
}

/**
 * Get a specific version
 */
export async function getVersion(
    entityType: EntityVersionType,
    entityId: number,
    version: number
): Promise<EntityVersion | null> {
    const [result] = await db
        .select()
        .from(entityVersions)
        .where(and(
            eq(entityVersions.entityType, entityType),
            eq(entityVersions.entityId, entityId),
            eq(entityVersions.version, version)
        ))
        .limit(1);

    return result || null;
}

/**
 * Get the latest version
 */
export async function getLatestVersion(
    entityType: EntityVersionType,
    entityId: number
): Promise<EntityVersion | null> {
    const [result] = await db
        .select()
        .from(entityVersions)
        .where(and(
            eq(entityVersions.entityType, entityType),
            eq(entityVersions.entityId, entityId)
        ))
        .orderBy(desc(entityVersions.version))
        .limit(1);

    return result || null;
}

// ============================================================================
// DIFF
// ============================================================================

export interface VersionDiff {
    field: string;
    oldValue: any;
    newValue: any;
}

/**
 * Compare two versions and return differences
 */
export async function diffVersions(
    entityType: EntityVersionType,
    entityId: number,
    versionA: number,
    versionB: number
): Promise<VersionDiff[]> {
    const [a, b] = await Promise.all([
        getVersion(entityType, entityId, versionA),
        getVersion(entityType, entityId, versionB),
    ]);

    if (!a || !b) {
        throw new Error(`Version not found`);
    }

    const snapshotA = a.snapshot as Record<string, any>;
    const snapshotB = b.snapshot as Record<string, any>;

    const diffs: VersionDiff[] = [];
    const allKeys = new Set([...Object.keys(snapshotA), ...Object.keys(snapshotB)]);

    for (const key of allKeys) {
        const oldValue = snapshotA[key];
        const newValue = snapshotB[key];

        // Deep comparison
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            diffs.push({ field: key, oldValue, newValue });
        }
    }

    return diffs;
}

// ============================================================================
// ROLLBACK
// ============================================================================

import { jobs, pipelines, pipelineSteps } from "@shared/schema/index.js";

/**
 * Rollback an entity to a specific version
 * Returns the restored snapshot
 */
export async function rollbackToVersion(
    entityType: EntityVersionType,
    entityId: number,
    version: number,
    options: { userId?: string; organizationId?: number } = {}
): Promise<Record<string, any>> {
    const targetVersion = await getVersion(entityType, entityId, version);

    if (!targetVersion) {
        throw new Error(`Version ${version} not found for ${entityType}:${entityId}`);
    }

    const snapshot = targetVersion.snapshot as Record<string, any>;

    // Apply rollback based on entity type
    switch (entityType) {
        case "job":
            // Only restore core fields that are guaranteed to exist
            await db.update(jobs)
                .set({
                    name: snapshot.name,
                    type: snapshot.type,
                    description: snapshot.description,
                    config: snapshot.config,
                    updatedAt: new Date(),
                })
                .where(eq(jobs.id, entityId));
            break;

        case "pipeline":
            await db.update(pipelines)
                .set({
                    name: snapshot.name,
                    description: snapshot.description,
                    triggerType: snapshot.triggerType,
                    labels: snapshot.labels,
                    enableKnowledgeGraph: snapshot.enableKnowledgeGraph,
                    knowledgeGraphConfig: snapshot.knowledgeGraphConfig,
                })
                .where(eq(pipelines.id, entityId));

            // Restore steps
            // 1. Delete existing steps
            await db.delete(pipelineSteps).where(eq(pipelineSteps.pipelineId, entityId));

            // 2. Insert steps from snapshot
            if (snapshot.steps && Array.isArray(snapshot.steps)) {
                for (const step of snapshot.steps) {
                    await db.insert(pipelineSteps).values({
                        pipelineId: entityId,
                        jobId: step.jobId,
                        order: step.order,
                        outputName: step.outputName || null,
                        runOnCondition: step.runOnCondition || "on_success",
                        waitDurationSeconds: step.waitDurationSeconds || null,
                        onFailureAction: step.onFailureAction || "Stop Pipeline",
                        parallelGroup: step.parallelGroup || null,
                        conditionExpression: step.conditionExpression || null,
                        moduleType: step.moduleType || null,
                        destinationStepId: step.destinationStepId || null,
                        decisionNodeConfig: step.decisionNodeConfig || null,
                        retryConfig: step.retryConfig || null,
                        knowledgeGraphConfig: step.knowledgeGraphConfig || null,
                    });
                }
            }
            break;

        default:
            throw new Error(`Rollback not supported for entity type: ${entityType}`);
    }

    // Create a new version recording the rollback
    await createVersion(entityType, entityId, snapshot, {
        ...options,
        changeSummary: `Rolled back to version ${version}`,
        changedFields: ["*"],
    });

    logger.info(`Rolled back ${entityType}:${entityId} to version ${version}`);
    return snapshot;
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Delete old versions, keeping only the most recent N
 */
export async function pruneVersions(
    entityType: EntityVersionType,
    entityId: number,
    keepCount: number = 50
): Promise<number> {
    const versions = await getVersions(entityType, entityId, 1000);

    if (versions.length <= keepCount) {
        return 0;
    }

    const toDelete = versions.slice(keepCount);
    const ids = toDelete.map(v => v.id);

    await db.delete(entityVersions)
        .where(sql`${entityVersions.id} = ANY(${ids})`);

    logger.info(`Pruned ${toDelete.length} old versions for ${entityType}:${entityId}`);
    return toDelete.length;
}


