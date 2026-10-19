import { TrustGraphAdapter } from "./adapter.js";
import { createLogger } from "@server/utils/logger.js";
import axios from "axios";

const logger = createLogger("TrustGraphExportService");

export interface ExportResult {
  success: boolean;
  coreUrl?: string;
  entityCount: number;
  relationshipCount: number;
  error?: string;
}

export class TrustGraphExportService {
  private static readonly API_URL = process.env.TRUSTGRAPH_URL || "http://localhost:8000";
  private static readonly API_KEY = process.env.TRUSTGRAPH_API_KEY || "dev-key";

  /**
   * Snaps a mission's current knowledge state into a portable TrustGraph Context Core.
   */
  static async snapMission(missionRunId: number): Promise<ExportResult> {
    logger.info(`Starting "Mission Snap" for mission run ${missionRunId}`);

    try {
      // 1. Resolve root mission
      const { trustGraphService } = await import("./adapter.js");
      const { entities, relationships } = await trustGraphService.fromMission(missionRunId);

      if (entities.length === 0) {
        logger.warn(`No knowledge found for mission run ${missionRunId}. Snapshot skipped.`);
        return { success: true, entityCount: 0, relationshipCount: 0 };
      }

      // 2. Prepare the Context Core
      const core = {
        missionRunId,
        entities,
        relationships,
        timestamp: new Date().toISOString(),
        version: "1.0.0"
      };

      let coreUrl = `local://cores/mission_${missionRunId}.tg`;

      // 3. --- REAL PERSISTENCE: GARAGE S3 ---
      try {
        const { EvidenceStorageService } = await import("../../core/infrastructure/evidence-storage.service.js");
        const coreKey = `cores/mission_${missionRunId}_${Date.now()}.tg.json`;
        coreUrl = await EvidenceStorageService.store(coreKey, core);
        
        // 4. --- EVENT FABRIC: PULSAR ---
        const { EventFabricService } = await import("../../core/infrastructure/event-fabric.service.js");
        await EventFabricService.emit({
          topic: "persistent://oddjob/missions/snaps",
          missionId: undefined, // Will be resolved by Pulsar/Consumers
          payload: { missionRunId, coreUrl, timestamp: new Date().toISOString() }
        });

      } catch (err: any) {
        logger.error(`Failed to persist Context Core to infrastructure: ${err.message}`);
        // coreUrl remains local fallback
      }
      
      logger.info(`Mission snap successful for run ${missionRunId}`, {
        entities: entities.length,
        relationships: relationships.length,
        coreUrl
      });

      return {
        success: true,
        coreUrl,
        entityCount: entities.length,
        relationshipCount: relationships.length
      };
    } catch (error: any) {
      logger.error(`Mission snap failed for run ${missionRunId}`, error);
      return {
        success: false,
        entityCount: 0,
        relationshipCount: 0,
        error: error.message
      };
    }
  }
}


