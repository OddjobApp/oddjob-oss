// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — Bootstrap
// Registers all pod plugins and wires external ports (Qdrant, etc.)
// Call once at server startup, after DB is ready.
// ============================================================================

import { createLogger } from "@server/utils/logger.js";
import { registerAllQuantPlugins } from "./quant/plugins/index.js";
import { registerAllRealmPlugins } from "./realm-mesh/plugins/index.js";
import { registerAllPredictionPlugins } from "./prediction/plugins/index.js";
import { registerAllPruningPlugins } from "./pruning/plugins/index.js";
import { registerAllMemoryPlugins } from "./memory/plugins/index.js";
import { registerAllGraphPlugins } from "./graph/plugins/index.js";
import { registerAllHiddenStatePlugins } from "./hidden-state/plugins/index.js";
import { registerAllCalibrationPlugins } from "./calibration/plugins/index.js";
import { registerAllContextPlugins } from "./context/plugins/index.js";
import { registerAllGovernancePlugins } from "./governance/plugins/index.js";
import { registerAllWindowingPlugins } from "./windowing/plugins/index.js";
import { registerAllDiffPlugins } from "./diff/plugins/index.js";
import { memoryPod } from "./memory/memory-pod.service.js";
import { storagePod } from "./storage/storage-pod.service.js";
import type { VectorPort, VectorSearchInput, VectorSearchResult, VectorUpsertInput, VectorUpsertResult, VectorDeleteInput, VectorDeleteResult } from "./plugin-runtime/types.js";

const logger = createLogger("PredictionIntelligenceBootstrap");

// ---------------------------------------------------------------------------
// Build a VectorPort adapter from the existing Qdrant client
// ---------------------------------------------------------------------------

async function buildQdrantVectorPort(): Promise<VectorPort | null> {
    try {
        const { getClient } = await import("@server/integrations/qdrant-client.js");
        const client = getClient();

        const port: VectorPort = {
            async search(input: VectorSearchInput): Promise<VectorSearchResult[]> {
                const results = await client.search(input.collection, {
                    vector: input.vector,
                    limit: input.topK,
                    filter: input.filter
                        ? { must: Object.entries(input.filter).map(([k, v]) => ({ key: k, match: { value: v } })) }
                        : undefined,
                    with_payload: true,
                });
                return results.map(r => ({
                    id: String(r.id),
                    score: r.score,
                    payload: (r.payload ?? {}) as Record<string, unknown>,
                }));
            },

            async upsert(input: VectorUpsertInput): Promise<VectorUpsertResult> {
                await client.upsert(input.collection, {
                    wait: false,
                    points: [{ id: input.id, vector: input.vector, payload: input.payload }],
                });
                return { id: input.id };
            },

            async delete(input: VectorDeleteInput): Promise<VectorDeleteResult> {
                await client.delete(input.collection, { wait: false, points: [input.id] });
                return { deleted: true };
            },
        };
        return port;
    } catch (err) {
        logger.warn("[PI Bootstrap] Qdrant client not available — vector search disabled", { err: String(err) });
        return null;
    }
}

// ---------------------------------------------------------------------------
// Main bootstrap entry point
// ---------------------------------------------------------------------------

let initialized = false;

export async function initializePredictionIntelligencePods(): Promise<void> {
    if (initialized) return;
    initialized = true;

    logger.info("[PI Bootstrap] Registering Prediction Intelligence plugins...");

    // Register all pod plugins into the shared plugin registry
    registerAllQuantPlugins();
    registerAllRealmPlugins();
    registerAllPredictionPlugins();
    registerAllPruningPlugins();
    registerAllMemoryPlugins();
    registerAllGraphPlugins();
    registerAllHiddenStatePlugins();
    registerAllCalibrationPlugins();
    registerAllContextPlugins();
    registerAllGovernancePlugins();
    registerAllWindowingPlugins();
    registerAllDiffPlugins();

    logger.info("[PI Bootstrap] All plugin pods registered.");

    // Wire Qdrant vector port — gracefully no-ops if Qdrant is unavailable
    const vectorPort = await buildQdrantVectorPort();
    if (vectorPort) {
        memoryPod.setVectorPort(vectorPort);
        storagePod.setVectorPort(vectorPort);
        logger.info("[PI Bootstrap] Qdrant VectorPort wired to memory and storage pods.");
    } else {
        logger.info("[PI Bootstrap] Running without Qdrant — set QDRANT_URL to enable vector memory.");
    }
}
