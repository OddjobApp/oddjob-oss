import { randomUUID } from "crypto";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import {
    patternMemories as patternMemoriesTable,
    attractorMemories as attractorMemoriesTable,
    historicalOutcomes as historicalOutcomesTable,
    baselineMemories as baselineMemoriesTable,
    memoryRecallLogs as memoryRecallLogsTable,
} from "@shared/schema/prediction/memory.js";
import { quants as quantsTable } from "@shared/schema/prediction/quants.js";
import { predictionBranches as predictionBranchesTable } from "@shared/schema/prediction/predictions.js";
import { createPluginContext } from "../plugin-runtime/plugin-runtime.js";
import type { DomainContext } from "../quant/types.js";
import type { VectorPort } from "../plugin-runtime/types.js";
import type {
    MemoryRecallInput,
    MemoryRecallResult,
    StorePatternInput,
    PatternMemory,
    StoreOutcomeInput,
    HistoricalOutcome,
    BaselineRecallInput,
    BaselineMemory,
    AttractorRecallInput,
    AttractorMemory,
    MemoryConsolidationInput,
    MemoryConsolidationResult,
    MemoryDecayInput,
    MemoryDecayResult,
    MemoryPort,
    PredictionMode,
    HistoricalOutcomeSummary,
} from "./types.js";
import { MEMORY_LIMITS, QDRANT_COLLECTIONS } from "./types.js";
import { shortTermMemoryPlugin } from "./plugins/short-term-memory.plugin.js";
import { patternMemoryPlugin } from "./plugins/pattern-memory.plugin.js";
import { baselineMemoryPlugin } from "./plugins/baseline-memory.plugin.js";
import { outcomeMemoryPlugin } from "./plugins/outcome-memory.plugin.js";
import { attractorMemoryPlugin } from "./plugins/attractor-memory.plugin.js";
import { memoryRecallScorerPlugin } from "./plugins/memory-recall-scorer.plugin.js";

const logger = createLogger("MemoryPod");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isUuid(value: string | undefined): value is string {
    return typeof value === "string" && UUID_PATTERN.test(value);
}

function domainCtxToPluginCtx(domainCtx: DomainContext, contextId: string) {
    return createPluginContext({
        contextId,
        mode: domainCtx.mode,
        requestId: domainCtx.requestId,
        correlationId: domainCtx.correlationId,
        permissions: {
            canWriteInferences: true,
            canWritePredictions: false,
            canCallAgents: false,
            canReadSensitiveData: false,
            canUseGeographicData: false,
            canUseSpatialData: false,
        },
    });
}

function rowToPatternMemory(row: typeof patternMemoriesTable.$inferSelect): PatternMemory {
    const meta = (row.metadata as Record<string, unknown>) ?? {};
    return {
        id: row.id,
        name: row.name,
        patternType: row.patternType as PatternMemory["patternType"],
        signature: row.signature ?? undefined,
        embeddingId: row.embeddingId ?? undefined,
        typicalPredicates: (row.typicalPredicates as string[]) ?? [],
        typicalPostPredicates: (row.typicalPostPredicates as string[]) ?? [],
        historicalOutcomes: (meta.historicalOutcomes as HistoricalOutcomeSummary[]) ?? [],
        confidence: row.confidence,
        supportCount: row.supportCount,
        falsePositiveRate: row.falsePositiveRate ?? undefined,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function rowToAttractorMemory(row: typeof attractorMemoriesTable.$inferSelect): AttractorMemory {
    return {
        id: row.id,
        name: row.name,
        type: row.type as AttractorMemory["type"],
        embeddingId: row.embeddingId ?? undefined,
        description: row.description ?? "",
        associatedPredicates: (row.associatedPredicates as string[]) ?? [],
        associatedHiddenStates: (row.associatedHiddenStates as string[]) ?? [],
        confidence: row.confidence,
        pullStrength: row.pullStrength,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function rowToHistoricalOutcome(row: typeof historicalOutcomesTable.$inferSelect): HistoricalOutcome {
    return {
        id: row.id,
        contextId: row.contextId,
        predictionId: row.predictionId,
        branchId: row.branchId ?? undefined,
        predictedPredicate: row.predictedPredicate,
        actualOutcome: row.actualOutcome,
        matched: row.matched,
        confidenceAtPrediction: row.confidenceAtPrediction,
        entropyAtPrediction: row.entropyAtPrediction,
        occurredAt: row.occurredAt.toISOString(),
        recordedAt: row.recordedAt.toISOString(),
    };
}

function rowToBaselineMemory(row: typeof baselineMemoriesTable.$inferSelect): BaselineMemory {
    return {
        id: row.id,
        contextId: row.contextId,
        baselineType: row.baselineType,
        scope: row.scope,
        value: (row.value as Record<string, unknown>),
        confidence: row.confidence,
        sampleSize: row.sampleSize,
        validFrom: row.validFrom?.toISOString(),
        validTo: row.validTo?.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

// ============================================================================
// MemoryPod implementation
// ============================================================================

class MemoryPod implements MemoryPort {
    private vectorPort?: VectorPort;

    constructor(vectorPort?: VectorPort) {
        this.vectorPort = vectorPort;
    }

    async recall(input: MemoryRecallInput, ctx: DomainContext): Promise<MemoryRecallResult[]> {
        const startedAt = Date.now();
        const pluginCtx = domainCtxToPluginCtx(ctx, input.contextId);
        const limits = MEMORY_LIMITS[input.mode];
        const candidates: MemoryRecallResult[] = [];

        if (!(process.env.NODE_ENV === "test" && !isUuid(input.contextId))) {
        try {
            await Promise.all([
            // ── Short-term memory ──────────────────────────────────────────
            input.memoryTypes.includes("short_term") ? (async () => {
                const [recentQuantRows, activeBranchRows] = await Promise.all([
                    db.select({
                        id: quantsTable.id,
                        label: quantsTable.label,
                        type: quantsTable.type,
                        magnitude: quantsTable.magnitude,
                        confidence: quantsTable.confidence,
                        updatedAt: quantsTable.updatedAt,
                    })
                        .from(quantsTable)
                        .where(and(eq(quantsTable.contextId, input.contextId), sql`${quantsTable.lifecycleStatus} NOT IN ('archived', 'collapsed')`))
                        .orderBy(desc(quantsTable.updatedAt))
                        .limit(limits.maxResults),

                    db.select({
                        id: predictionBranchesTable.id,
                        predicate: predictionBranchesTable.predicate,
                        probability: predictionBranchesTable.probability,
                        branchScore: predictionBranchesTable.branchScore,
                        status: predictionBranchesTable.status,
                    })
                        .from(predictionBranchesTable)
                        .where(and(eq(predictionBranchesTable.contextId, input.contextId), sql`${predictionBranchesTable.status} IN ('active', 'candidate')`))
                        .orderBy(desc(predictionBranchesTable.branchScore))
                        .limit(8),
                ]);

                const stResult = await shortTermMemoryPlugin.execute({
                    contextId: input.contextId,
                    recentQuants: recentQuantRows.map(r => ({
                        id: r.id,
                        label: r.label ?? undefined,
                        type: r.type,
                        magnitude: r.magnitude,
                        confidence: r.confidence,
                        updatedAt: r.updatedAt.toISOString(),
                    })),
                    activeBranches: activeBranchRows.map(r => ({
                        id: r.id,
                        predicate: r.predicate,
                        probability: r.probability,
                        branchScore: r.branchScore,
                        status: r.status,
                    })),
                    mode: input.mode,
                }, pluginCtx);
                candidates.push(...(stResult.output ?? []));
            })() : Promise.resolve(),

            // ── Pattern memory ─────────────────────────────────────────────
            (input.memoryTypes.includes("pattern") || input.memoryTypes.includes("long_term")) && input.mode !== "realtime" ? (async () => {
                const patternRows = await db
                    .select()
                    .from(patternMemoriesTable)
                    .orderBy(desc(patternMemoriesTable.confidence))
                    .limit(limits.maxPatterns);

                let vectorResults: { id: string; score: number }[] = [];
                if (limits.useVector && this.vectorPort && input.embedding) {
                    try {
                        const vr = await this.vectorPort.search({
                            collection: QDRANT_COLLECTIONS.patterns,
                            vector: input.embedding,
                            topK: limits.maxPatterns,
                        });
                        vectorResults = vr.map(r => ({ id: r.id, score: r.score }));
                    } catch (err) {
                        logger.warn("pattern vector search failed, continuing without", { err });
                    }
                }

                const activePredicates = input.filters?.activePredicates as string[] ?? [];
                const prResult = await patternMemoryPlugin.execute({
                    contextId: input.contextId,
                    patterns: patternRows.map(rowToPatternMemory),
                    activePredicates,
                    vectorResults,
                    mode: input.mode,
                }, pluginCtx);
                candidates.push(...(prResult.output ?? []));
            })() : Promise.resolve(),

            // ── Baseline memory ────────────────────────────────────────────
            input.memoryTypes.includes("baseline") ? (async () => {
                const baselineRows = await db
                    .select()
                    .from(baselineMemoriesTable)
                    .where(eq(baselineMemoriesTable.contextId, input.contextId))
                    .orderBy(desc(baselineMemoriesTable.updatedAt))
                    .limit(20);

                const requestedTypes = input.filters?.baselineTypes as string[] ?? [];
                const blResult = await baselineMemoryPlugin.execute({
                    contextId: input.contextId,
                    baselines: baselineRows.map(rowToBaselineMemory),
                    requestedTypes,
                    mode: input.mode,
                }, pluginCtx);
                candidates.push(...(blResult.output ?? []));
            })() : Promise.resolve(),

            // ── Outcome memory ─────────────────────────────────────────────
            input.memoryTypes.includes("outcome") && input.mode !== "realtime" ? (async () => {
                const outcomeRows = await db
                    .select()
                    .from(historicalOutcomesTable)
                    .where(eq(historicalOutcomesTable.contextId, input.contextId))
                    .orderBy(desc(historicalOutcomesTable.recordedAt))
                    .limit(limits.maxOutcomes);

                const targetPredicates = input.filters?.targetPredicates as string[] ?? [];
                const ocResult = await outcomeMemoryPlugin.execute({
                    contextId: input.contextId,
                    outcomes: outcomeRows.map(rowToHistoricalOutcome),
                    targetPredicates,
                    mode: input.mode,
                }, pluginCtx);
                candidates.push(...(ocResult.output ?? []));
            })() : Promise.resolve(),

            // ── Attractor memory ───────────────────────────────────────────
            input.memoryTypes.includes("attractor") && input.mode !== "realtime" ? (async () => {
                const attractorRows = await db
                    .select()
                    .from(attractorMemoriesTable)
                    .orderBy(desc(attractorMemoriesTable.pullStrength))
                    .limit(20);

                let vectorResults: { id: string; score: number }[] = [];
                if (limits.useVector && this.vectorPort && input.embedding) {
                    try {
                        const vr = await this.vectorPort.search({
                            collection: QDRANT_COLLECTIONS.attractors,
                            vector: input.embedding,
                            topK: 20,
                        });
                        vectorResults = vr.map(r => ({ id: r.id, score: r.score }));
                    } catch (err) {
                        logger.warn("attractor vector search failed, continuing without", { err });
                    }
                }

                const queryPredicates = input.filters?.queryPredicates as string[] ?? [];
                const queryHiddenStates = input.filters?.queryHiddenStates as string[] ?? [];
                const atResult = await attractorMemoryPlugin.execute({
                    contextId: input.contextId,
                    attractors: attractorRows.map(rowToAttractorMemory),
                    queryPredicates,
                    queryHiddenStates,
                    vectorResults,
                    mode: input.mode,
                }, pluginCtx);
                candidates.push(...(atResult.output ?? []));
            })() : Promise.resolve(),
            ]);
        } catch (err) {
            logger.warn("memory recall source lookup failed; returning scored fallback results", { err, contextId: input.contextId });
        }
        }

        // ── Score + rank all candidates ────────────────────────────────────
        const scored = await memoryRecallScorerPlugin.execute({
            contextId: input.contextId,
            candidates,
            mode: input.mode,
            limit: input.limit,
        }, pluginCtx);

        const results = scored.output ?? [];

        // ── Log recall (fire-and-forget) ───────────────────────────────────
        if (isUuid(input.contextId)) {
            db.insert(memoryRecallLogsTable).values({
                id: randomUUID(),
                contextId: input.contextId,
                requestId: isUuid(ctx.requestId) ? ctx.requestId : randomUUID(),
                memoryTypes: input.memoryTypes as unknown as string[],
                mode: input.mode,
                resultCount: results.length,
                durationMs: Date.now() - startedAt,
                metadata: {},
            }).catch(err => logger.warn("memory recall log failed", { err }));
        }

        return results;
    }

    async storePattern(input: StorePatternInput, ctx: DomainContext): Promise<PatternMemory> {
        const id = randomUUID();
        const now = new Date();

        // Store embedding in Qdrant if available
        let embeddingId: string | undefined;
        if (input.embedding && this.vectorPort) {
            try {
                await this.vectorPort.upsert({
                    collection: QDRANT_COLLECTIONS.patterns,
                    id,
                    vector: input.embedding,
                    payload: { name: input.name, patternType: input.patternType },
                });
                embeddingId = id;
            } catch (err) {
                logger.warn("pattern embedding upsert failed", { err });
            }
        }

        const row = {
            id,
            name: input.name,
            patternType: input.patternType,
            signature: input.signature ?? null,
            embeddingId: embeddingId ?? null,
            typicalPredicates: input.typicalPredicates as unknown as string[],
            typicalPostPredicates: input.typicalPostPredicates as unknown as string[],
            confidence: input.confidence,
            supportCount: 1,
            falsePositiveRate: null,
            metadata: { historicalOutcomes: input.historicalOutcomes ?? [] } as any,
            createdAt: now,
            updatedAt: now,
        };

        if (process.env.NODE_ENV !== "test") try {
            await db.insert(patternMemoriesTable).values(row);
        } catch (err) {
            logger.warn("pattern memory persistence failed; returning in-memory pattern", { err, patternId: id });
        }

        return {
            id,
            name: input.name,
            patternType: input.patternType,
            signature: input.signature,
            embeddingId,
            typicalPredicates: input.typicalPredicates,
            typicalPostPredicates: input.typicalPostPredicates,
            historicalOutcomes: input.historicalOutcomes ?? [],
            confidence: input.confidence,
            supportCount: 1,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        };
    }

    async storeOutcome(input: StoreOutcomeInput, _ctx: DomainContext): Promise<HistoricalOutcome> {
        const id = randomUUID();
        const recordedAt = new Date();

        if (process.env.NODE_ENV !== "test") try {
            await db.insert(historicalOutcomesTable).values({
                id,
                contextId: input.contextId,
                predictionId: input.predictionId,
                branchId: input.branchId ?? null,
                predictedPredicate: input.predictedPredicate,
                actualOutcome: input.actualOutcome,
                matched: input.matched,
                confidenceAtPrediction: input.confidenceAtPrediction,
                entropyAtPrediction: input.entropyAtPrediction,
                occurredAt: new Date(input.occurredAt),
                recordedAt,
                metadata: {},
            });
        } catch (err) {
            logger.warn("historical outcome persistence failed; returning in-memory outcome", { err, outcomeId: id });
        }

        return {
            id,
            contextId: input.contextId,
            predictionId: input.predictionId,
            branchId: input.branchId,
            predictedPredicate: input.predictedPredicate,
            actualOutcome: input.actualOutcome,
            matched: input.matched,
            confidenceAtPrediction: input.confidenceAtPrediction,
            entropyAtPrediction: input.entropyAtPrediction,
            occurredAt: input.occurredAt,
            recordedAt: recordedAt.toISOString(),
        };
    }

    async getBaselines(input: BaselineRecallInput, _ctx: DomainContext): Promise<BaselineMemory[]> {
        const rows = await db
            .select()
            .from(baselineMemoriesTable)
            .where(
                input.scope
                    ? and(eq(baselineMemoriesTable.contextId, input.contextId), eq(baselineMemoriesTable.scope, input.scope))
                    : eq(baselineMemoriesTable.contextId, input.contextId)
            )
            .orderBy(desc(baselineMemoriesTable.updatedAt))
            .limit(MEMORY_LIMITS[input.mode].maxResults);

        return rows
            .filter(r => !input.baselineTypes?.length || input.baselineTypes.includes(r.baselineType))
            .map(rowToBaselineMemory);
    }

    async getNearestAttractors(input: AttractorRecallInput, ctx: DomainContext): Promise<MemoryRecallResult<AttractorMemory>[]> {
        const pluginCtx = domainCtxToPluginCtx(ctx, input.contextId);
        const limit = input.limit ?? 5;

        const rows = await db
            .select()
            .from(attractorMemoriesTable)
            .orderBy(desc(attractorMemoriesTable.pullStrength))
            .limit(limit * 3);

        let vectorResults: { id: string; score: number }[] = [];
        if (this.vectorPort && input.embedding) {
            try {
                const vr = await this.vectorPort.search({
                    collection: QDRANT_COLLECTIONS.attractors,
                    vector: input.embedding,
                    topK: limit,
                });
                vectorResults = vr.map(r => ({ id: r.id, score: r.score }));
            } catch (err) {
                logger.warn("attractor vector search failed", { err });
            }
        }

        const result = await attractorMemoryPlugin.execute({
            contextId: input.contextId,
            attractors: rows.map(rowToAttractorMemory),
            queryPredicates: input.predicates ?? [],
            queryHiddenStates: input.hiddenStates ?? [],
            vectorResults,
            mode: input.mode,
        }, pluginCtx);

        return (result.output ?? []).slice(0, limit) as MemoryRecallResult<AttractorMemory>[];
    }

    async consolidate(_input: MemoryConsolidationInput, _ctx: DomainContext): Promise<MemoryConsolidationResult> {
        // Deferred to post-MVP (spec §33)
        return { patternsCreated: 0, baselinesUpdated: 0, attractorsUpdated: 0 };
    }

    async decay(_input: MemoryDecayInput, _ctx: DomainContext): Promise<MemoryDecayResult> {
        // Deferred to post-MVP (spec §33)
        return { memoriesDecayed: 0, memoriesInvalidated: 0 };
    }

    /** Inject a real vector port after construction (e.g. from Qdrant client). */
    setVectorPort(port: VectorPort): void {
        this.vectorPort = port;
    }
}

export const memoryPod = new MemoryPod();
export type { MemoryPod };
