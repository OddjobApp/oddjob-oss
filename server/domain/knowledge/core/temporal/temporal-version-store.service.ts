import { db } from "@server/database_service.js";
import {
    knowledgeNodeVersions,
    knowledgeEdgeVersions,
    insertNodeVersionSchema,
    insertEdgeVersionSchema,
} from "@shared/schema/index.js";
import type { KnowledgeNode, KnowledgeNodeVersion, KnowledgeEdge, KnowledgeEdgeVersion, EdgeChangeType, EdgeSnapshot, EdgeDiffResult } from "@shared/schema/index.js";
import { eq, and, lte, gte, desc, asc, gt, sql, count } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("TemporalVersionStore");

/**
 * Result type for point-in-time node queries.
 * Either the version was found (with state and full version record),
 * or no history is available for the queried timestamp.
 */
export type NodeVersionResult =
    | { found: true; state: Record<string, any>; version: KnowledgeNodeVersion }
    | { found: false; reason: "no_history_available" };

/**
 * Maximum allowed length for the causal annotation field.
 */
const MAX_ANNOTATION_LENGTH = 500;

/**
 * Default causal annotation when none is provided.
 */
const DEFAULT_ANNOTATION = "unspecified";

/**
 * Compares previous and new node states to determine which fields changed.
 * Returns a comma-separated string of field names that differ between the two states.
 */
function detectChangedFields(previousState: KnowledgeNode, newState: KnowledgeNode): string {
    const fieldsToCompare: (keyof KnowledgeNode)[] = [
        "label",
        "name",
        "externalId",
        "data",
        "verificationStatus",
        "confidenceScore",
        "initialConfidenceScore",
        "verifiedBy",
        "verifiedAt",
        "lastReaffirmedAt",
        "usageCount",
        "utilityScore",
        "knowledgeDocumentId",
        "knowledgeTopicId",
        "pipelineExecutionId",
        "extractionSources",
        "fingerprint",
        "missionId",
        "organizationId",
        "prospectPropertyId",
        "appId",
        "deploymentId",
        "sourceType",
        "fidelityClass",
        "scope",
        "ownerId",
        "embedding",
        "embeddingProvider",
        "embeddingModel",
        "embeddingDimensions",
        "embeddingVersion",
        "createdBy",
        "sourceCreatedAt",
        "sourceUpdatedAt",
        "updatedAt",
    ];

    const changed: string[] = [];

    for (const field of fieldsToCompare) {
        const prev = previousState[field];
        const next = newState[field];

        // Deep comparison for objects/arrays (jsonb fields)
        if (typeof prev === "object" || typeof next === "object") {
            if (JSON.stringify(prev) !== JSON.stringify(next)) {
                changed.push(field);
            }
        } else if (prev !== next) {
            changed.push(field);
        }
    }

    return changed.length > 0 ? changed.join(",") : "unknown";
}

/**
 * TemporalVersionStore
 *
 * Records historical snapshots of knowledge node (and edge) states with timestamps,
 * actor identifiers, and causal annotations. Supports point-in-time queries,
 * range queries, and FIFO pruning (max 100 versions per node).
 *
 * On storage failure, errors are logged at ERROR level and the original node
 * mutation is allowed to proceed without blocking (non-throwing).
 */
export const temporalVersionStoreService = {
    /**
     * Records a new version entry for a knowledge node.
     *
     * Captures the complete previous and new states, determines which fields changed,
     * and persists the version record. On failure, logs an error and returns silently
     * so that the original mutation is not blocked.
     *
     * @param nodeId - The ID of the knowledge node being versioned
     * @param previousState - Complete node state before the change
     * @param newState - Complete node state after the change
     * @param actorId - User ID or system process name (e.g. "system:ingestion")
     * @param causalAnnotation - Optional reason for the change (max 500 chars, defaults to "unspecified")
     */
    async recordNodeVersion(
        nodeId: number,
        previousState: KnowledgeNode,
        newState: KnowledgeNode,
        actorId: string,
        causalAnnotation?: string,
    ): Promise<void> {
        try {
            // Determine the organization from the node state
            const organizationId = newState.organizationId ?? previousState.organizationId;
            if (organizationId == null) {
                logger.error("Cannot record node version: missing organizationId", { nodeId });
                return;
            }

            // Determine change type by comparing states
            const changeType = detectChangedFields(previousState, newState);

            // Sanitize causal annotation: enforce 500 char limit, default to "unspecified"
            let annotation = causalAnnotation?.trim() || DEFAULT_ANNOTATION;
            if (annotation.length > MAX_ANNOTATION_LENGTH) {
                annotation = annotation.slice(0, MAX_ANNOTATION_LENGTH);
            }

            // Validate the input using the zod schema
            const versionRecord = insertNodeVersionSchema.parse({
                nodeId,
                organizationId,
                previousState: previousState as unknown as Record<string, any>,
                newState: newState as unknown as Record<string, any>,
                changeType,
                actorId,
                causalAnnotation: annotation,
            });

            // Insert the version record
            await db.insert(knowledgeNodeVersions).values(versionRecord);

            logger.info("Recorded node version", {
                nodeId,
                changeType,
                actorId,
            });
        } catch (error: any) {
            // AC 7: On storage failure, log at ERROR level and allow the original
            // node mutation to proceed without blocking.
            logger.error("Failed to record node version", {
                nodeId,
                actorId,
                error: error.message || error,
            });
        }
    },

    /**
     * Retrieves the state of a knowledge node at a specific point in time.
     *
     * Finds the most recent version record with a timestamp at or before the
     * queried timestamp and returns its newState. If no version record exists
     * at or before the queried timestamp (i.e., the timestamp is earlier than
     * the earliest recorded version), returns a "no history available" indicator.
     *
     * @param nodeId - The ID of the knowledge node to query
     * @param timestamp - The point in time to query the node state at
     * @returns The node state at that time, or a "no history available" result
     */
    async getNodeAtTimestamp(
        nodeId: number,
        timestamp: Date,
    ): Promise<NodeVersionResult> {
        const [versionRecord] = await db
            .select()
            .from(knowledgeNodeVersions)
            .where(
                and(
                    eq(knowledgeNodeVersions.nodeId, nodeId),
                    lte(knowledgeNodeVersions.timestamp, timestamp),
                ),
            )
            .orderBy(desc(knowledgeNodeVersions.timestamp))
            .limit(1);

        if (!versionRecord) {
            return { found: false, reason: "no_history_available" };
        }

        return {
            found: true,
            state: versionRecord.newState as Record<string, any>,
            version: versionRecord,
        };
    },
    /**
     * Retrieves all version records for a knowledge node between two timestamps (inclusive).
     *
     * Returns versions ordered by timestamp ascending, capped at 1,000 entries.
     * Both `from` and `to` bounds are inclusive.
     *
     * @param nodeId - The ID of the knowledge node to query
     * @param from - Start of the time range (inclusive)
     * @param to - End of the time range (inclusive)
     * @returns Array of version records ordered by timestamp ascending, max 1,000
     */
    async getNodeVersionRange(
        nodeId: number,
        from: Date,
        to: Date,
    ): Promise<KnowledgeNodeVersion[]> {
        const versions = await db
            .select()
            .from(knowledgeNodeVersions)
            .where(
                and(
                    eq(knowledgeNodeVersions.nodeId, nodeId),
                    gte(knowledgeNodeVersions.timestamp, from),
                    lte(knowledgeNodeVersions.timestamp, to),
                ),
            )
            .orderBy(asc(knowledgeNodeVersions.timestamp))
            .limit(1000);

        return versions;
    },

    /**
     * Prunes excess version records for a knowledge node using FIFO eviction.
     *
     * Counts total version records for the node. If the count exceeds the maximum,
     * deletes the oldest records (by timestamp) in a single DELETE with a subquery.
     *
     * @param nodeId - The ID of the knowledge node to prune versions for
     * @param maxVersions - Maximum number of versions to retain (default: 100)
     * @returns The number of deleted version records (0 if no pruning needed)
     */
    async pruneExcessVersions(
        nodeId: number,
        maxVersions: number = 100,
    ): Promise<number> {
        // Count total version records for this node
        const [result] = await db
            .select({ total: count() })
            .from(knowledgeNodeVersions)
            .where(eq(knowledgeNodeVersions.nodeId, nodeId));

        const total = result?.total ?? 0;

        if (total <= maxVersions) {
            return 0;
        }

        const excess = total - maxVersions;

        // Delete the oldest N records using a subquery:
        // DELETE FROM knowledge_node_versions
        // WHERE id IN (
        //   SELECT id FROM knowledge_node_versions
        //   WHERE node_id = :nodeId
        //   ORDER BY timestamp ASC
        //   LIMIT :excess
        // )
        const deleteResult = await db.execute(sql`
            DELETE FROM knowledge_node_versions
            WHERE id IN (
                SELECT id FROM knowledge_node_versions
                WHERE node_id = ${nodeId}
                ORDER BY timestamp ASC
                LIMIT ${excess}
            )
        `);

        const deletedCount = Number(deleteResult.rowCount ?? excess);

        logger.info("Pruned excess node versions", {
            nodeId,
            deletedCount,
            previousTotal: total,
            maxVersions,
        });

        return deletedCount;
    },

    /**
     * Records a new version entry for a knowledge edge.
     *
     * Captures the edge's source, target, relation, weight, and the change type
     * (created, modified, or deleted). On failure, logs an error and returns
     * silently so that the original mutation is not blocked.
     *
     * @param edgeId - The ID of the knowledge edge being versioned
     * @param edge - The full KnowledgeEdge object with current state
     * @param changeType - One of "created", "modified", or "deleted"
     */
    async recordEdgeVersion(
        edgeId: number,
        edge: KnowledgeEdge,
        changeType: EdgeChangeType,
    ): Promise<void> {
        try {
            const organizationId = edge.organizationId;
            if (organizationId == null) {
                logger.error("Cannot record edge version: missing organizationId", { edgeId });
                return;
            }

            const versionRecord = insertEdgeVersionSchema.parse({
                edgeId,
                organizationId,
                sourceId: edge.sourceId,
                targetId: edge.targetId,
                relation: edge.relation,
                weight: edge.weight,
                changeType,
            });

            await db.insert(knowledgeEdgeVersions).values(versionRecord);

            logger.info("Recorded edge version", {
                edgeId,
                changeType,
                sourceId: edge.sourceId,
                targetId: edge.targetId,
            });
        } catch (error: any) {
            // On storage failure, log at ERROR level and allow the original
            // edge mutation to proceed without blocking.
            logger.error("Failed to record edge version", {
                edgeId,
                changeType,
                error: error.message || error,
            });
        }
    },

    /**
     * Reconstructs the set of edges as they existed at a specific point in time.
     *
     * For each unique edgeId with version records at or before the queried timestamp,
     * finds the most recent version record. Excludes edges whose most recent version
     * has changeType "deleted". Returns the remaining edge snapshots.
     *
     * If the timestamp is earlier than the earliest recorded version entry for the
     * organization, returns an empty result set.
     *
     * @param orgId - The organization ID to scope the query to
     * @param timestamp - The point in time to reconstruct the edge set at
     * @returns Array of EdgeSnapshot objects representing edges that existed at that time
     */
    async getEdgesAtTimestamp(
        orgId: number,
        timestamp: Date,
    ): Promise<EdgeSnapshot[]> {
        // Use DISTINCT ON (edge_id) ordered by timestamp DESC to get the most recent
        // version of each edge at or before the queried timestamp.
        // Then filter out "deleted" edges in application code.
        const rows = await db.execute(sql`
            SELECT DISTINCT ON (edge_id)
                edge_id,
                source_id,
                target_id,
                relation,
                weight,
                change_type,
                timestamp
            FROM knowledge_edge_versions
            WHERE organization_id = ${orgId}
              AND timestamp <= ${timestamp}
            ORDER BY edge_id, timestamp DESC
        `);

        const snapshots: EdgeSnapshot[] = [];

        for (const row of rows.rows) {
            // Exclude edges whose most recent version is "deleted"
            if (row.change_type === "deleted") {
                continue;
            }

            snapshots.push({
                edgeId: row.edge_id as number,
                sourceId: row.source_id as number,
                targetId: row.target_id as number,
                relation: row.relation as string,
                weight: row.weight as number | null,
                changeType: row.change_type as string,
                timestamp: new Date(row.timestamp as string),
            });
        }

        return snapshots;
    },

    /**
     * Returns all edge version entries between two timestamps for a given organization,
     * ordered by timestamp ascending, with cursor-based pagination (max 10,000 per page).
     *
     * If a cursor is provided, it is interpreted as the string representation of the last
     * seen edge version `id`, and only records with id > cursorId are returned.
     *
     * Fetches 10,001 rows to determine truncation. If 10,001 rows are returned,
     * the result is truncated to 10,000 entries and a nextCursor is provided
     * (the id of the last entry in the page).
     *
     * @param orgId - The organization ID to scope the query to
     * @param from - Start of the time range (inclusive)
     * @param to - End of the time range (inclusive)
     * @param cursor - Optional cursor (last seen id as string) for pagination
     * @returns EdgeDiffResult with entries, truncated flag, and nextCursor
     */
    async getEdgeDiff(
        orgId: number,
        from: Date,
        to: Date,
        cursor?: string,
    ): Promise<EdgeDiffResult> {
        const PAGE_LIMIT = 10_000;

        const conditions = [
            eq(knowledgeEdgeVersions.organizationId, orgId),
            gte(knowledgeEdgeVersions.timestamp, from),
            lte(knowledgeEdgeVersions.timestamp, to),
        ];

        if (cursor) {
            const cursorId = parseInt(cursor, 10);
            if (!Number.isNaN(cursorId)) {
                conditions.push(gt(knowledgeEdgeVersions.id, cursorId));
            }
        }

        const rows = await db
            .select()
            .from(knowledgeEdgeVersions)
            .where(and(...conditions))
            .orderBy(asc(knowledgeEdgeVersions.timestamp), asc(knowledgeEdgeVersions.id))
            .limit(PAGE_LIMIT + 1);

        if (rows.length > PAGE_LIMIT) {
            const entries = rows.slice(0, PAGE_LIMIT);
            const lastEntry = entries[entries.length - 1];
            return {
                entries,
                truncated: true,
                nextCursor: String(lastEntry.id),
            };
        }

        return {
            entries: rows,
            truncated: false,
            nextCursor: null,
        };
    },
};

export default temporalVersionStoreService;
