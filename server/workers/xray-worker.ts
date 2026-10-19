
import { Job } from "bullmq";
import { BaseWorker } from "./base-worker.js";
import { QUEUE_NAMES } from "@domain/core/infrastructure/queue/queue-service.js";
import { xrayIndexingService } from "@domain/xray/core/xray-indexing.service.js";

export interface XrayJobData {
    type: "FULL_REINDEX" | "INCREMENTAL_MISSION" | "INCREMENTAL_PIPELINE";
    organizationId: number;
    entityId?: number;
}

export class XrayWorker extends BaseWorker<XrayJobData> {
    constructor() {
        super(QUEUE_NAMES.XRAY, {
            concurrency: 1, // X-Ray indexing is heavy, run one at a time
        });
    }

    protected async execute(job: Job<XrayJobData>): Promise<any> {
        const { type, organizationId, entityId } = job.data;
        
        this.logger.info(`Starting X-Ray indexing job: ${type} for org ${organizationId}`);

        switch (type) {
            case "FULL_REINDEX": {
                const result = await xrayIndexingService.fullReindex(organizationId);
                // Emit event so downstream listeners (e.g., prefetch) can react
                const { xrayEventBus, XrayEventType } = await import("@domain/xray/core/xray-event-bus.js");
                xrayEventBus.emitEvent({ type: XrayEventType.REINDEX_COMPLETE, orgId: organizationId });
                return result;
            }
            
            case "INCREMENTAL_MISSION":
                if (!entityId) throw new Error("entityId required for INCREMENTAL_MISSION");
                // Index mission-pipeline relationships from execution history
                // (Using plural because it's already there and safe)
                return await xrayIndexingService.indexMissionPipelineEdges(organizationId);

            case "INCREMENTAL_PIPELINE":
                if (!entityId) throw new Error("entityId required for INCREMENTAL_PIPELINE");
                return await xrayIndexingService.indexPipelineDatasetEdges(entityId, organizationId);

            default:
                throw new Error(`Unknown job type: ${type}`);
        }
    }
}

let instance: XrayWorker | null = null;

export function startXrayWorker() {
    if (!instance) {
        instance = new XrayWorker();
    }
    return instance;
}
