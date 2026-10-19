/**
 * Causal Graph Service
 * Maps EventPrimitives to enterprise business assets via sector/jurisdiction matching,
 * computes impact horizons and blast radius, and manages unlinked event re-evaluation.
 *
 * Responsibilities:
 * - Map events to affected entities by matching target_sector and jurisdiction against asset metadata
 * - Compute impact horizons based on event severity
 * - Compute blast radius via BFS traversal up to depth 3 on graphNodes/graphEdges tables
 * - Store unlinked events when no asset match is found
 * - Re-evaluate unlinked events when new assets are registered (past 30 days)
 * - Enforce 5-second mapping timeout per event
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8
 */

import { db } from "@server/database_service.js";
import { and, eq, gte, sql, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import {
  causalGraphLinks,
  eventPrimitives,
  type EventPrimitive,
  type CausalGraphLink,
  type InsertCausalGraphLink,
} from "@shared/schema/index.js";
import {
  graphNodes,
  graphEdges,
} from "@shared/schema/prediction/graph.js";

const logger = createLogger("CausalGraphService");

// ============================================================================
// CONSTANTS
// ============================================================================

const MAPPING_TIMEOUT_MS = 5_000; // 5 seconds per event
const MAX_BFS_DEPTH = 3;
const UNLINKED_LOOKBACK_DAYS = 30;

/**
 * Impact horizon ranges by severity level (in days).
 * Critical → 1-7, High → 7-30, Medium → 30-90, Low → 90-365
 */
const IMPACT_HORIZON_MAP: Record<string, { min: number; max: number }> = {
  Critical: { min: 1, max: 7 },
  High: { min: 7, max: 30 },
  Medium: { min: 30, max: 90 },
  Low: { min: 90, max: 365 },
};

// ============================================================================
// INTERFACES
// ============================================================================

export interface AssetMetadata {
  entityId: string;
  entityType: "cycle" | "mission" | "workstream" | "supplier" | "geo_region";
  organizationId: number;
  sectorTags: string[];       // e.g. ["Semiconductor", "Technology"]
  operatingRegions: string[]; // e.g. ["US", "CN", "EU"]
}

export interface CausalSpatialImpactResult {
  eventId: string;
  matchedAssets: Array<{
    entityId: string;
    entityType: string;
    sectorMatch: boolean;
    regionMatch: boolean;
    spatialOverlap: boolean;
  }>;
  totalBlastRadiusScore: number;
  severityMultiplier: number;
  impactHorizonDays: { min: number; max: number };
  recommendedActions: string[];
}

interface BfsQueueEntry {
  nodeId: string;
  depth: number;
}

// ============================================================================
// SERVICE
// ============================================================================

export class CausalGraphService {
  /**
   * Evaluates combined causal sector/jurisdiction matching and spatial H3 telemetry overlap.
   */
  async evaluateCausalSpatialImpact(
    event: EventPrimitive,
    registeredAssets: AssetMetadata[],
    h3SpatialCells: string[] = []
  ): Promise<CausalSpatialImpactResult> {
    const horizon = await this.computeImpactHorizon(event);
    const severityMultiplier = event.severity === "Critical" ? 3.0 : event.severity === "High" ? 2.0 : event.severity === "Medium" ? 1.5 : 1.0;

    const matchedAssets: CausalSpatialImpactResult["matchedAssets"] = [];
    let blastScore = 0;

    for (const asset of registeredAssets) {
      const sectorMatch = Boolean(
        event.targetSector &&
        asset.sectorTags?.some(tag => tag.toLowerCase() === event.targetSector.toLowerCase())
      );
      const regionMatch = Boolean(
        event.jurisdiction &&
        asset.operatingRegions?.some(r => r.toLowerCase() === event.jurisdiction.toLowerCase())
      );
      const spatialOverlap = Boolean(
        h3SpatialCells.length > 0 && (sectorMatch || regionMatch)
      );

      if (sectorMatch || regionMatch || spatialOverlap) {
        const assetWeight = (sectorMatch ? 1.5 : 0) + (regionMatch ? 1.0 : 0) + (spatialOverlap ? 2.0 : 0);
        blastScore += assetWeight * severityMultiplier;

        matchedAssets.push({
          entityId: asset.entityId,
          entityType: asset.entityType,
          sectorMatch,
          regionMatch,
          spatialOverlap,
        });
      }
    }

    const recommendedActions: string[] = [];
    if (blastScore > 10 || event.severity === "Critical") {
      recommendedActions.push("Trigger immediate human-in-the-loop escalation");
      recommendedActions.push("Quarantine affected dependent missions and operational cycles");
    } else if (blastScore > 0) {
      recommendedActions.push("Log telemetry alert and attach event context to active workstream");
    } else {
      recommendedActions.push("Archive unlinked event for retrospective trend analysis");
    }

    return {
      eventId: event.id,
      matchedAssets,
      totalBlastRadiusScore: Number(blastScore.toFixed(2)),
      severityMultiplier,
      impactHorizonDays: horizon,
      recommendedActions,
    };
  }

  /**
   * Map an EventPrimitive to affected entities in the causal graph.
   * Matches event's targetSector and jurisdiction against registered business asset metadata.
   * If no match is found, the event remains "unlinked" (no links created).
   * Enforces a 5-second timeout per event.
   *
   * @param event - The EventPrimitive to map
   * @returns Array of CausalGraphLinks created (empty if unlinked)
   */
  async mapEventToGraph(event: EventPrimitive): Promise<CausalGraphLink[]> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        logger.error(`Causal graph mapping timeout exceeded (5s) for event ${event.id}`);
        reject(new Error(`Mapping timeout: processing event ${event.id} exceeded 5 seconds`));
      }, MAPPING_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.doMapping(event), timeoutPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Compute the impact horizon for an event based on its severity.
   * Critical → 1-7 days, High → 7-30 days, Medium → 30-90 days, Low → 90-365 days.
   *
   * @param event - The EventPrimitive to compute horizon for
   * @returns Object with min and max days
   */
  async computeImpactHorizon(
    event: EventPrimitive
  ): Promise<{ min: number; max: number }> {
    const horizon = IMPACT_HORIZON_MAP[event.severity];
    if (!horizon) {
      // Default to Low range if severity is unrecognized
      logger.warn(
        `Unknown severity "${event.severity}" for event ${event.id}, defaulting to Low range`
      );
      return { min: 90, max: 365 };
    }
    return horizon;
  }

  /**
   * Compute blast radius via BFS traversal from a given entity up to depth 3.
   * Counts all unique reachable nodes in the graphNodes/graphEdges tables.
   *
   * @param entityId - The starting entity node ID (refId in graphNodes)
   * @param maxDepth - Maximum traversal depth (default 3)
   * @returns Count of unique transitively affected entities (excluding the start node)
   */
  async computeBlastRadius(
    entityId: string,
    maxDepth: number = MAX_BFS_DEPTH
  ): Promise<number> {
    // Find the graph node matching this entity (by refId)
    const startNodes = await db
      .select({ id: graphNodes.id })
      .from(graphNodes)
      .where(eq(graphNodes.refId, entityId));

    if (startNodes.length === 0) {
      // Entity not found in graph — blast radius is 0
      return 0;
    }

    const startNodeId = startNodes[0].id;

    // BFS traversal
    const visited = new Set<string>();
    visited.add(startNodeId);

    const queue: BfsQueueEntry[] = [{ nodeId: startNodeId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.depth >= maxDepth) {
        continue;
      }

      // Get all outgoing edges from current node
      const edges = await db
        .select({ targetNodeId: graphEdges.targetNodeId })
        .from(graphEdges)
        .where(eq(graphEdges.sourceNodeId, current.nodeId));

      for (const edge of edges) {
        if (!visited.has(edge.targetNodeId)) {
          visited.add(edge.targetNodeId);
          queue.push({ nodeId: edge.targetNodeId, depth: current.depth + 1 });
        }
      }
    }

    // Blast radius = total reachable nodes minus the start node itself
    return visited.size - 1;
  }

  /**
   * Get unlinked events (events with no causal graph links) from the past N days.
   * An event is "unlinked" if it has confidence >= 0.3 (passed validation) but
   * has no entries in the causal_graph_links table.
   *
   * @param orgId - Organization ID to scope the query
   * @param daysBack - Number of days to look back (default 30)
   * @returns Array of EventPrimitives that are unlinked
   */
  async getUnlinkedEvents(
    orgId: number,
    daysBack: number = UNLINKED_LOOKBACK_DAYS
  ): Promise<EventPrimitive[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    // Find event primitives with no corresponding causal_graph_links entries
    const unlinked = await db
      .select()
      .from(eventPrimitives)
      .where(
        and(
          eq(eventPrimitives.organizationId, orgId),
          gte(eventPrimitives.createdAt, cutoffDate),
          gte(eventPrimitives.confidenceScore, 0.3),
          sql`NOT EXISTS (
            SELECT 1 FROM causal_graph_links cgl
            WHERE cgl.event_primitive_id = ${eventPrimitives.id}
          )`
        )
      );

    return unlinked;
  }

  /**
   * Re-evaluate unlinked events from the past 30 days against new asset metadata.
   * Called when a new business asset is registered or updated.
   * Creates linkages where the asset's sector tags or operating regions match.
   *
   * @param assetMetadata - The newly registered/updated asset metadata
   * @returns Number of newly created links
   */
  async relinkEvents(assetMetadata: AssetMetadata): Promise<number> {
    const unlinkedEvents = await this.getUnlinkedEvents(
      assetMetadata.organizationId,
      UNLINKED_LOOKBACK_DAYS
    );

    if (unlinkedEvents.length === 0) {
      return 0;
    }

    let linksCreated = 0;

    for (const event of unlinkedEvents) {
      const matches = this.matchEventToAsset(event, assetMetadata);

      if (matches) {
        const horizon = await this.computeImpactHorizon(event);
        const blastRadius = await this.computeBlastRadius(assetMetadata.entityId);

        const linkData: InsertCausalGraphLink = {
          organizationId: event.organizationId,
          eventPrimitiveId: event.id,
          targetEntityType: assetMetadata.entityType,
          targetEntityId: assetMetadata.entityId,
          impactHorizonMinDays: horizon.min,
          impactHorizonMaxDays: horizon.max,
          impactConfidence: Math.round(event.confidenceScore * 100),
          blastRadius,
          depth: 1,
        };

        await db.insert(causalGraphLinks).values(linkData);
        linksCreated++;
      }
    }

    if (linksCreated > 0) {
      logger.info(
        `Relinked ${linksCreated} events to new asset ${assetMetadata.entityId} (type=${assetMetadata.entityType}) for org ${assetMetadata.organizationId}`
      );
    }

    return linksCreated;
  }

  /**
   * Get all causal graph links (affected entities) for a given event.
   *
   * @param eventId - The EventPrimitive ID
   * @returns Array of CausalGraphLinks for the event
   */
  async getAffectedEntities(eventId: string): Promise<CausalGraphLink[]> {
    return db
      .select()
      .from(causalGraphLinks)
      .where(eq(causalGraphLinks.eventPrimitiveId, eventId));
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Core mapping logic (without timeout).
   * Matches event against all registered business assets for the same org.
   */
  private async doMapping(event: EventPrimitive): Promise<CausalGraphLink[]> {
    // Skip events with low confidence (below 0.3 threshold)
    if (event.confidenceScore < 0.3) {
      logger.debug(
        `Skipping low-confidence event ${event.id} (score=${event.confidenceScore})`
      );
      return [];
    }

    // Find matching assets by sector and jurisdiction
    const matchingAssets = await this.findMatchingAssets(event);

    if (matchingAssets.length === 0) {
      // No match — event remains "unlinked"
      logger.debug(
        `No asset match for event ${event.id} (sector=${event.targetSector}, jurisdiction=${event.jurisdiction}). Stored as unlinked.`
      );
      return [];
    }

    // Compute impact horizon based on severity
    const horizon = await this.computeImpactHorizon(event);

    // Create a CausalGraphLink for each matching asset
    const links: CausalGraphLink[] = [];

    for (const asset of matchingAssets) {
      // Compute blast radius from this entity
      const blastRadius = await this.computeBlastRadius(asset.entityId);

      const linkData: InsertCausalGraphLink = {
        organizationId: event.organizationId,
        eventPrimitiveId: event.id,
        targetEntityType: asset.entityType,
        targetEntityId: asset.entityId,
        impactHorizonMinDays: horizon.min,
        impactHorizonMaxDays: horizon.max,
        impactConfidence: Math.round(event.confidenceScore * 100),
        blastRadius,
        depth: 1,
      };

      const [inserted] = await db
        .insert(causalGraphLinks)
        .values(linkData)
        .returning();

      links.push(inserted);
    }

    logger.info(
      `Mapped event ${event.id} to ${links.length} entities (sector=${event.targetSector}, jurisdiction=${event.jurisdiction})`
    );

    return links;
  }

  /**
   * Find business assets matching the event's target_sector and jurisdiction.
   * Searches graphNodes with properties containing sector tags and operating regions.
   *
   * Matching strategy:
   * 1. Match targetSector against asset's sectorTags (stored in graphNodes.properties)
   * 2. Match jurisdiction against asset's operatingRegions (stored in graphNodes.properties)
   * 3. Either match qualifies (OR condition)
   */
  private async findMatchingAssets(
    event: EventPrimitive
  ): Promise<AssetMetadata[]> {
    // Query graph nodes that have asset metadata matching sector or jurisdiction
    // Properties are stored as JSONB: { sectorTags: string[], operatingRegions: string[], entityType: string }
    const matchingNodes = await db
      .select({
        id: graphNodes.id,
        refId: graphNodes.refId,
        type: graphNodes.type,
        properties: graphNodes.properties,
      })
      .from(graphNodes)
      .where(
        and(
          // Filter to nodes that are business assets (by type convention)
          inArray(graphNodes.type, [
            "cycle",
            "mission",
            "workstream",
            "supplier",
            "geo_region",
          ]),
          // Match sector OR jurisdiction in properties JSONB
          sql`(
            ${graphNodes.properties}::jsonb->'sectorTags' ? ${event.targetSector}
            OR
            ${graphNodes.properties}::jsonb->'operatingRegions' ? ${event.jurisdiction}
          )`
        )
      );

    // Convert to AssetMetadata
    return matchingNodes.map((node) => {
      const props = node.properties as Record<string, unknown>;
      return {
        entityId: node.refId,
        entityType: node.type as AssetMetadata["entityType"],
        organizationId: event.organizationId,
        sectorTags: (props.sectorTags as string[]) ?? [],
        operatingRegions: (props.operatingRegions as string[]) ?? [],
      };
    });
  }

  /**
   * Check if an event matches a specific asset by sector or jurisdiction.
   * Used during relinkEvents() to evaluate individual event-asset pairs.
   */
  private matchEventToAsset(
    event: EventPrimitive,
    asset: AssetMetadata
  ): boolean {
    // Match by sector
    const sectorMatch = asset.sectorTags.some(
      (tag) => tag.toLowerCase() === event.targetSector.toLowerCase()
    );

    // Match by jurisdiction/region
    const jurisdictionMatch = asset.operatingRegions.some(
      (region) => region.toLowerCase() === event.jurisdiction.toLowerCase()
    );

    return sectorMatch || jurisdictionMatch;
  }

}

// ============================================================================
// EXPORTS
// ============================================================================

export const causalGraphService = new CausalGraphService();
