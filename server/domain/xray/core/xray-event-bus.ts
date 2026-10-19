import { createLogger } from "@server/utils/logger.js";
import { EventEmitter } from "node:events";

const logger = createLogger("XrayEventBus");

export enum XrayEventType {
    RELATIONSHIP_UPDATED = "relationship_updated",
    MISSION_UPDATED = "mission_updated",
    PIPELINE_UPDATED = "pipeline_updated",
    AGENT_UPDATED = "agent_updated",
    REINDEX_COMPLETE = "reindex_complete",
    WORKSPACE_INVALIDATED = "workspace_invalidated"
}

export interface XrayEvent {
    type: XrayEventType;
    orgId: number | null;
    entityType?: string;
    entityId?: number;
    metadata?: any;
}

class XrayEventBus extends EventEmitter {
    emitEvent(event: XrayEvent) {
        logger.info(`[XrayEventBus] Emitting event: ${event.type} for org ${event.orgId}`);
        this.emit(event.type, event);
    }
}

export const xrayEventBus = new XrayEventBus();
