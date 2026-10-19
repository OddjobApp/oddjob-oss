import { createLogger } from "@server/utils/logger.js";
import { generalGateway } from "../../../integrations/general-gateway.js";

const logger = createLogger("SidecarSync");

export interface MemorySyncInput {
    content: string;
    memoryType?: string;
    sessionId?: string;
    workflowId?: string;
    importance?: number;
    tags?: string[];
    context?: any;
}

export class SidecarSyncService {
    private host: string;

    constructor() {
        // The Python sidecar (backend/main.py) listens on PORT (default 8002) and is
        // pointed at by PYTHON_SERVICE_URL. The previous default (localhost:8000) was
        // stale and never matched the running service. Derive the bare host root and
        // build each router's path explicitly — memory is under /api/v1, predictive
        // under /api, so a single baseUrl can't serve both.
        const raw = process.env.BACKEND_URL || process.env.PYTHON_SERVICE_URL || "http://localhost:8002";
        this.host = raw.replace(/\/+$/, "").replace(/\/api(\/v\d+)?$/, "");
    }

    /**
     * Sync a memory entry to the Python Sidecar
     */
    async syncMemory(input: MemorySyncInput, userId: string = "system", organizationId?: number, appDeploymentId?: number) {
        try {
            const response = await generalGateway.execute({
                action: "store_memory",
                method: "POST",
                url: `${this.host}/api/v1/memory/memories`,
                body: {
                    content: input.content,
                    memory_type: input.memoryType || "conversation",
                    session_id: input.sessionId,
                    workflow_id: input.workflowId,
                    importance: input.importance || 1.0,
                    tags: input.tags || [],
                    context: {
                        ...(input.context || {}),
                        app_id: appDeploymentId // Added app_id to memory context
                    }
                },
                organizationId
            });

            if (response.status >= 400) {
                logger.warn(`Sidecar memory sync returned status ${response.status}: ${JSON.stringify(response.body)}`);
            }
            return response.body;
        } catch (error) {
            logger.error("Failed to sync memory to sidecar:", error);
            return null;
        }
    }

    /**
     * Fetch consolidated long-term context from the Python Sidecar
     */
    async fetchConsolidatedContext(query: string, jobId?: number, userId: string = "system", appDeploymentId?: number) {
        try {
            const response = await generalGateway.execute({
                action: "get_context",
                method: "POST",
                url: `${this.host}/api/v1/memory/memories/context`,
                body: {
                    query,
                    agent_id: jobId?.toString(),
                    app_id: appDeploymentId?.toString(), // Added app_id for scoped memory
                    context_depth: 3,
                    max_results: 5
                }
            });

            if (response.status >= 400) {
                logger.warn(`Sidecar context fetch returned status ${response.status}`);
                return null;
            }

            return response.body;
        } catch (error) {
            logger.error("Failed to fetch context from sidecar:", error);
            return null;
        }
    }

    /**
     * Log a predictive observation (metric) to the sidecar
     */
    async logObservation(entity: string, value: number, context: any = {}, userId: string = "system") {
        try {
            const response = await generalGateway.execute({
                action: "record_observation",
                method: "POST",
                url: `${this.host}/api/predictive/observations`,
                body: {
                    entity,
                    value,
                    context,
                    metadata: {
                        timestamp: new Date().toISOString()
                    }
                }
            });

            return response.status < 400;
        } catch (error) {
            logger.error("Failed to log observation to sidecar:", error);
            return false;
        }
    }
}

export const sidecarSyncService = new SidecarSyncService();


