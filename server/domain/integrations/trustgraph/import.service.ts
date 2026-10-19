import { db } from "@server/database_service.js";
import { knowledgeNodes, knowledgeEdges, type KnowledgeNode, type KnowledgeEdge } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import { type TGEntity, type TGRelationship } from "./types.js";
import { randomUUID } from "crypto";

const logger = createLogger("TrustGraphImportService");

export interface ImportConfig {
  organizationId: number;
  missionId: number;
  pipelineExecutionId?: number;
  sanitize?: boolean;
}

export class TrustGraphImportService {
  /**
   * Imports a set of TrustGraph entities and relationships into the local Knowledge Graph.
   */
  static async importCore(
    entities: TGEntity[],
    relationships: TGRelationship[],
    config: ImportConfig
  ): Promise<{ nodesImported: number; edgesImported: number }> {
    const { organizationId, missionId, pipelineExecutionId, sanitize = true } = config;
    
    logger.info(`Importing TrustGraph core into Mission ${missionId} (Org: ${organizationId})`);

    const idMap = new Map<string, number>(); // TG UUID -> Local Serial ID

    // 1. Import Entities as KnowledgeNodes
    let nodesImported = 0;
    for (const entity of entities) {
      try {
        const [node] = (await db
          .insert(knowledgeNodes)
          .values({
            organizationId,
            missionId,
            pipelineExecutionId,
            name: entity.properties.name || entity.label,
            label: entity.label || "imported_concept",
            data: {
              ...entity.properties,
              tg_id: entity.id,
              tg_label: entity.label,
              imported_at: new Date().toISOString(),
              original_provenance: entity.provenance,
              content: entity.provenance?.evidence || "",
              summary: entity.properties.summary || ""
            }
          })
          .returning()) as any[];

        if (node) {
          // @ts-ignore - Drizzle serial ID inference can be tricky in some tsc versions
          idMap.set(entity.id, Number(node.id));
          nodesImported++;
        }
      } catch (err: any) {
        logger.error(`Failed to import TG entity ${entity.id}: ${err.message}`);
      }
    }

    // 2. Import Relationships as KnowledgeEdges
    let edgesImported = 0;
    for (const rel of relationships) {
      const sourceId = idMap.get(rel.sourceId);
      const targetId = idMap.get(rel.targetId);

      if (!sourceId || !targetId) {
        logger.warn(`Skipping relationship ${rel.sourceId} -> ${rel.targetId}: One or both nodes not found in local ID map.`);
        continue;
      }

      try {
        await db.insert(knowledgeEdges).values({
          organizationId,
          missionId,
          sourceId,
          targetId,
          relation: rel.type,
          weight: Math.min(10, Math.max(1, Math.round(parseFloat(rel.confidence.toString()) * 10))),
          data: {
            tg_source: rel.sourceId,
            tg_target: rel.targetId,
            imported_at: new Date().toISOString()
          }
        });
        edgesImported++;
      } catch (err: any) {
        logger.error(`Failed to import TG relationship ${rel.sourceId} -> ${rel.targetId}: ${err.message}`);
      }
    }

    logger.info(`Successfully imported ${nodesImported} nodes and ${edgesImported} edges into mission ${missionId}`);
    return { nodesImported, edgesImported };
  }

  /**
   * Fetches and imports a Context Core from a URL.
   */
  static async importFromUrl(url: string, config: ImportConfig): Promise<any> {
     logger.info(`Attempting to import Context Core from: ${url}`);
     
     // Simulation: Fetch core from storage (Garage/S3)
     // In a real implementation, we would download the .tg file, decrypt/verify, and parse.
     
     const entities: TGEntity[] = []; 
     const relationships: TGRelationship[] = [];
     
     return await this.importCore(entities, relationships, config);
  }
}
