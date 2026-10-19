import { EventEmitter } from "events";
import { createLogger } from "@server/utils/logger.js";
import { xrayIndexingService } from "./xray-indexing.service.js";

const logger = createLogger("XrayEventBus");

/**
 * XrayEventBus
 * 
 * Centralized event hub for real-time relationship indexing triggers.
 * Components across the system (mission runs, pipeline executions, agent spawns)
 * emit events here to ensure the X-Ray graph remains synchronized.
 */
class XrayEventBus extends EventEmitter {
  private static instance: XrayEventBus;

  private constructor() {
    super();
    this.setupListeners();
  }

  public static getInstance(): XrayEventBus {
    if (!XrayEventBus.instance) {
      XrayEventBus.instance = new XrayEventBus();
    }
    return XrayEventBus.instance;
  }

  private setupListeners() {
    this.on("entity:created", async (data: { type: string, id: number, organizationId: number }) => {
      logger.debug(`[XrayEventBus] Entity created: ${data.type}::${data.id}`);
      // Route to the appropriate indexer based on entity type
      if (data.type === "mission") {
        await xrayIndexingService.indexMissionPipelineEdges(data.organizationId).catch(() => {});
      } else if (data.type === "pipeline") {
        await xrayIndexingService.indexPipelineDatasetEdges(data.id, data.organizationId).catch(() => {});
      } else if (data.type === "cycle") {
        await xrayIndexingService.indexCycleMissionEdges(data.organizationId).catch(() => {});
      } else if (data.type === "app") {
        await xrayIndexingService.indexAppMissionEdge(data.id).catch(() => {});
      }
    });

    this.on("pipeline:executed", async (data: { pipelineId: number, missionId?: number, organizationId: number }) => {
      logger.debug(`[XrayEventBus] Pipeline executed: ${data.pipelineId}, Mission: ${data.missionId}`);
      await xrayIndexingService.indexMissionPipelineEdges(data.organizationId).catch(() => {});
    });

    this.on("mission:run", async (data: { missionId: number, organizationId: number }) => {
      logger.debug(`[XrayEventBus] Mission run triggered: ${data.missionId}`);
      await xrayIndexingService.indexMissionPipelineEdges(data.organizationId).catch(() => {});
    });
  }

  /**
   * Emit an event indicating a mission has updated its state.
   */
  public emitMissionUpdate(missionId: number, organizationId: number) {
    this.emit("mission:run", { missionId, organizationId });
  }

  /**
   * Emit an event indicating a pipeline execution has occurred.
   */
  public emitPipelineExecution(pipelineId: number, organizationId: number, missionId?: number) {
    this.emit("pipeline:executed", { pipelineId, organizationId, missionId });
  }
}

export const xrayEventBus = XrayEventBus.getInstance();
