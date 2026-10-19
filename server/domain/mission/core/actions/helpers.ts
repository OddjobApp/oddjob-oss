import { db } from "@server/database_service.js";
import { sourcePerformanceLogs } from "@shared/schema/index.js";
import { predictionBranches } from "@shared/schema/prediction/predictions.js";
import { createLogger } from "@server/utils/logger.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { inArray } from "drizzle-orm";
import { join } from "path";
import { readFile, writeFile } from "fs/promises";

const logger = createLogger("ActionHelpers");

// ── Source performance logging helper ────────────────────────────────────────
export async function logSourcePerformance(
    missionContext: Record<string, unknown> | null | undefined,
    missionType: string,
    orgId: number | null,
    success: boolean,
    log: ReturnType<typeof createLogger> = logger,
): Promise<void> {
    try {
        const trackedAssets = (missionContext as any)?.tracked_assets ?? [];
        const uniqueTools = [...new Set<string>(
            trackedAssets.filter((a: any) => a.type === "tool").map((a: any) => String(a.name))
        )];
        if (uniqueTools.length === 0) return;
        await db.insert(sourcePerformanceLogs).values(
            uniqueTools.map(tool => ({ source: tool, missionType, success, yieldedInfo: success, organizationId: orgId }))
        );
        log.info(`[ActionHelpers] Logged ${success ? "success" : "failure"} for ${uniqueTools.length} sources`);
    } catch (err: any) {
        log.warn(`[ActionHelpers] Failed to log source performance: ${err.message}`);
    }
}

// ── Branch weight training (async, non-blocking, uses fs/promises + Redis lock) ─
const WEIGHTS_REDIS_KEY = "prediction:branch_ranker_weights";
const WEIGHTS_LOCK_KEY = "prediction:branch_ranker_weights:lock";

export async function trainBranchWeights(
    missionId: number,
    missionContext: Record<string, unknown> | null | undefined,
    log: ReturnType<typeof createLogger> = logger,
): Promise<void> {
    try {
        // Distributed lock — skip if another node is training
        const locked = await redis.set(WEIGHTS_LOCK_KEY, "1", "EX", 30, "NX");
        if (!locked) return;

        try {
            const mappingPath = join(process.cwd(), "server/domain/prediction-intelligence/prediction/prediction_mission_mapping.json");
            let mapping: Record<string, number> = {};
            try {
                mapping = JSON.parse(await readFile(mappingPath, "utf-8"));
            } catch (err: any) { 
                log.warn(`[ActionHelpers] Failed to load prediction_mission_mapping.json: ${err.message}`);
                return; 
            }

            const contextIds = Object.keys(mapping).filter(k => mapping[k] === missionId);
            if (contextIds.length === 0) return;

            const branches = await db.select().from(predictionBranches)
                .where(inArray(predictionBranches.contextId, contextIds));

            const usedTools = [...new Set<string>(
                ((missionContext as any)?.tracked_assets ?? [])
                    .filter((a: any) => a.type === "tool")
                    .map((a: any) => String(a.name))
            )];

            // Load weights from Redis first, fallback to file
            let weights: Record<string, number>;
            const cached = await redis.get(WEIGHTS_REDIS_KEY);
            if (cached) {
                weights = JSON.parse(cached);
            } else {
                const weightsPath = join(process.cwd(), "server/domain/prediction-intelligence/prediction/branch_ranker_weights.json");
                weights = JSON.parse(await readFile(weightsPath, "utf-8"));
            }

            const learningRate = 0.05;
            let updated = false;

            for (const branch of branches) {
                const features = (branch.payload as any)?.features;
                if (!features) continue;
                const label = usedTools.some(t => branch.predicate.includes(t)) ? 1 : 0;
                const z = Object.keys(weights).reduce((acc, k) =>
                    k !== "bias" ? acc + weights[k] * (features[k] ?? 0) : acc, weights.bias ?? 0);
                const error = 1 / (1 + Math.exp(-z)) - label;
                for (const k of Object.keys(features)) {
                    if (k in weights) weights[k] -= learningRate * error * features[k];
                }
                if ("bias" in weights) weights.bias -= learningRate * error;
                updated = true;
            }

            if (updated) {
                // Persist to Redis (cluster-safe) and file (fallback for single-node)
                await redis.set(WEIGHTS_REDIS_KEY, JSON.stringify(weights), "EX", 86400);
                const weightsPath = join(process.cwd(), "server/domain/prediction-intelligence/prediction/branch_ranker_weights.json");
                await writeFile(weightsPath, JSON.stringify(weights, null, 4));
                log.info(`[ActionHelpers] Updated branch ranker weights for mission ${missionId}`);
            }
        } finally {
            await redis.del(WEIGHTS_LOCK_KEY);
        }
    } catch (err: any) {
        log.warn(`[ActionHelpers] Weight training error: ${err.message}`);
    }
}
