import { db } from "@server/database_service.js";
import { knowledgeNodes, knowledgeEdges, missionRuns, type KnowledgeNode, type KnowledgeEdge } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { type TGEntity, type TGRelationship } from "./types.js";
import { createLogger } from "@server/utils/logger.js";
import { randomUUID } from "crypto";
import { eventStream } from "../../core/infrastructure/event-stream.service.js";
import { POD_EVENTS } from "../../core/infrastructure/pod-events.contract.js";

const logger = createLogger("TrustGraphAdapter");

export class TrustGraphAdapter {
  constructor() {
    this.initializeListeners();
  }

  private initializeListeners() {
    logger.info("[TrustGraph] Initializing real-time evidence listeners...");

    // Listen for mission completion to synthesize evidence
    eventStream.on(POD_EVENTS.MISSION.RUN_COMPLETED, async (event) => {
      const { runId } = event.payload;
      logger.info(`[TrustGraph] Mission run ${runId} completed. Synching intelligence graph...`);
      await this.fromMission(runId);
    });

    // Listen for knowledge ingestion
    eventStream.on(POD_EVENTS.KNOWLEDGE.DOCUMENT_INGESTED, async (event) => {
      logger.info(`[TrustGraph] New knowledge ingested. Updating trust relationships...`);
      // Future: Implement incremental document mapping
    });
  }

  /**
   * Converts Oddjob Knowledge Nodes and Edges for a specific mission run into TrustGraph format.
   * Resolves the root mission context automatically.
   */
  async fromMission(missionRunId: number): Promise<{ entities: TGEntity[]; relationships: TGRelationship[] }> {
    logger.info(`Converting knowledge for mission run ${missionRunId} to TrustGraph format`);

    // 0. Resolve the root missionId
    const [run] = await db
      .select({ missionId: missionRuns.missionId })
      .from(missionRuns)
      .where(eq(missionRuns.id, missionRunId))
      .limit(1);

    if (!run || !run.missionId) {
      logger.warn(`Could not resolve missionId for run ${missionRunId}. Returning empty snapshot.`);
      return { entities: [], relationships: [] };
    }

    const missionId = run.missionId;

    // 1. Fetch all nodes for the mission
    const nodes = await db
      .select()
      .from(knowledgeNodes)
      .where(eq(knowledgeNodes.missionId, missionId));

    // 2. Fetch all edges for the mission
    const edges = await db
      .select()
      .from(knowledgeEdges)
      .where(eq(knowledgeEdges.missionId, missionId));

    // Map to track Oddjob ID -> TrustGraph UUID for relationship mapping
    const idMap = new Map<number, string>();

    // 3. Transform Nodes to TGEntities
    const entities: TGEntity[] = nodes.map((node) => {
      const tgId = randomUUID();
      idMap.set(node.id, tgId);

      return {
        id: tgId,
        label: node.label,
        properties: {
          ...((node.data as Record<string, any>) || {}),
          name: node.name,
          originalId: node.id,
          missionId: node.missionId,
          organizationId: node.organizationId,
          confidenceScore: node.confidenceScore,
          externalId: node.externalId,
        },
        provenance: {
          sourceId: `mission:${missionId}`,
          timestamp: node.createdAt || new Date(),
          evidence: JSON.stringify(node.extractionSources || []),
        },
      };
    });

    // 4. Transform Edges to TGRelationships
    const relationships: TGRelationship[] = edges
      .map((edge) => {
        const sourceUuid = idMap.get(edge.sourceId);
        const targetUuid = idMap.get(edge.targetId);

        if (!sourceUuid || !targetUuid) {
          logger.warn(`Skipping edge ${edge.id} due to missing node mapping`, {
            edgeId: edge.id,
            sourceId: edge.sourceId,
            targetId: edge.targetId,
          });
          return null;
        }

        return {
          sourceId: sourceUuid,
          targetId: targetUuid,
          type: edge.relation.toUpperCase().replace(/\s+/g, "_"),
          confidence: (edge.weight || 5) / 10, // Map 1-10 to 0.1-1.0
        };
      })
      .filter((r): r is TGRelationship => r !== null);

    logger.info(`Converted ${entities.length} entities and ${relationships.length} relationships`);

    return { entities, relationships };
  }
}

export const trustGraphService = new TrustGraphAdapter();


