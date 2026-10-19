// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — CONTEXT POD
// Full Service Implementation implementing ContextPort
// ============================================================================

import { randomUUID, createHash } from "crypto";
import type {
    PredictionContext,
    ContextResolutionInput,
    ContextResolutionResult,
    ContextCreationInput,
    ContextLifecycleInput,
    ContextMergeInput,
    ContextSplitInput,
    ContextPort,
} from "./types.js";
import { DEFAULT_CONTEXT_PERMISSIONS } from "./types.js";
import type { DomainContext } from "../quant/types.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { predictionContexts, contextRelations } from "@shared/schema/prediction/context.js";
import { eq, inArray } from "drizzle-orm";

const logger = createLogger("ContextService");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isUuid(value: string): boolean {
    return UUID_PATTERN.test(value);
}

export function resolveContextId(id: string): string {
    if (isUuid(id)) return id;
    const hash = createHash("md5").update(id).digest("hex");
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(12, 15)}-8${hash.slice(15, 18)}-${hash.slice(18, 30)}`;
}

function metadataArray(metadata: unknown, key: string): string[] {
    const value = (metadata as Record<string, unknown> | undefined)?.[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function rowToContext(row: typeof predictionContexts.$inferSelect): PredictionContext {
    const metadata = (row.metadata as Record<string, unknown>) ?? {};
    const provenance = (row.provenance as PredictionContext["provenance"]) ?? {
        source: "context-service",
        method: "database",
        resolvedBy: "system",
        evidenceIds: [],
        createdAt: row.startedAt.toISOString(),
    };

    return {
        id: row.id,
        type: row.type as PredictionContext["type"],
        label: row.label ?? undefined,
        tenantId: row.tenantId ?? undefined,
        applicationId: row.applicationId ?? undefined,
        actorId: row.actorId ?? undefined,
        workflowId: row.workflowId ?? undefined,
        sessionId: row.sessionId ?? undefined,
        taskId: row.taskId ?? undefined,
        agentId: row.agentId ?? undefined,
        regionId: row.regionId ?? undefined,
        status: row.status as PredictionContext["status"],
        confidence: row.confidence,
        resolutionMethod: row.resolutionMethod,
        evidenceEventIds: row.evidenceEventIds ?? [],
        evidenceQuantIds: row.evidenceQuantIds ?? [],
        permissions: { ...DEFAULT_CONTEXT_PERMISSIONS, ...(row.permissions as Partial<PredictionContext["permissions"]> ?? {}) },
        baselineRefs: row.baselineRefs ?? [],
        startedAt: row.startedAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        closedAt: row.closedAt?.toISOString(),
        provenance,
        metadata,
        mode: (metadata.mode as PredictionContext["mode"]) ?? "realtime",
        createdAt: (metadata.createdAt as string) ?? row.startedAt.toISOString(),
        parentContextIds: metadataArray(metadata, "parentContextIds"),
        childContextIds: metadataArray(metadata, "childContextIds"),
        relatedContextIds: metadataArray(metadata, "relatedContextIds"),
    };
}

export class ContextService implements ContextPort {
    // Read-through cache backed by prediction_contexts. The cache keeps tests
    // and degraded local environments working when the database is unavailable.
    private contexts = new Map<string, PredictionContext>();

    /**
     * Resolves context based on input signals.
     */
    async resolve(input: ContextResolutionInput, ctx: DomainContext): Promise<ContextResolutionResult> {
        logger.info(`[ContextPod] Resolving context for mode ${input.mode}`);
        
        // Simple resolution heuristic: use hint or fallback to a new one
        const contextId = input.contextHint;
        if (contextId) {
            const resolvedId = resolveContextId(contextId);
            const existing = await this.getContext(resolvedId, ctx) || await this.getContext(contextId, ctx);
            if (existing) {
                return {
                    context: existing,
                    confidence: 1.0,
                    candidates: [],
                    createdNew: false,
                    mergedContextIds: [],
                    warnings: []
                };
            }
        }

        // Create new if not resolved
        const newCtx = await this.createContext({
            id: contextId ? resolveContextId(contextId) : undefined,
            type: "session", // Default
            mode: input.mode,
            tenantId: input.tenantId,
            actorId: input.actorId,
            workflowId: input.workflowId,
            sessionId: input.sessionId,
            confidence: 0.8,
            resolutionMethod: "fallback_to_new"
        }, ctx);

        return {
            context: newCtx,
            confidence: 0.8,
            candidates: [],
            createdNew: true,
            mergedContextIds: [],
            warnings: ["Falling back to new context"]
        };
    }

    async getContext(contextId: string, ctx: DomainContext): Promise<PredictionContext | null> {
        const resolvedId = resolveContextId(contextId);
        const cached = this.contexts.get(resolvedId) || this.contexts.get(contextId);
        if (cached) return cached;
        if (!isUuid(resolvedId)) return null;

        try {
            const [row] = await db.select().from(predictionContexts).where(eq(predictionContexts.id, resolvedId)).limit(1);
            if (!row) return null;
            const context = rowToContext(row);
            this.contexts.set(context.id, context);
            return context;
        } catch (err) {
            logger.warn("context lookup failed; using cache only", { err, contextId: resolvedId });
            return null;
        }
    }

    async createContext(input: ContextCreationInput & { id?: string }, ctx: DomainContext): Promise<PredictionContext> {
        const id = input.id || randomUUID();
        const now = new Date().toISOString();
        
        const context: PredictionContext = {
            id,
            type: input.type,
            label: input.label,
            tenantId: input.tenantId,
            applicationId: input.applicationId,
            actorId: input.actorId,
            workflowId: input.workflowId,
            sessionId: input.sessionId,
            status: "active",
            confidence: input.confidence || 1.0,
            resolutionMethod: input.resolutionMethod || "explicit_creation",
            evidenceEventIds: input.evidenceEventIds || [],
            evidenceQuantIds: [],
            permissions: { ...DEFAULT_CONTEXT_PERMISSIONS },
            baselineRefs: [],
            startedAt: now,
            lastSeenAt: now,
            provenance: {
                source: "context-service",
                method: "createContext",
                resolvedBy: "system",
                evidenceIds: [],
                createdAt: now
            },
            metadata: input.metadata || {},
            mode: input.mode,
            createdAt: now,
            parentContextIds: input.parentContextIds || [],
            childContextIds: [],
            relatedContextIds: []
        };
        
        this.contexts.set(id, context);
        try {
            await db.insert(predictionContexts).values({
                id,
                type: context.type,
                label: context.label,
                tenantId: context.tenantId,
                applicationId: context.applicationId,
                actorId: context.actorId,
                workflowId: context.workflowId,
                sessionId: context.sessionId,
                taskId: context.taskId,
                agentId: context.agentId,
                regionId: context.regionId && isUuid(context.regionId) ? context.regionId : null,
                status: context.status,
                confidence: context.confidence,
                resolutionMethod: context.resolutionMethod,
                evidenceEventIds: context.evidenceEventIds.filter(isUuid),
                evidenceQuantIds: context.evidenceQuantIds.filter(isUuid),
                permissions: context.permissions as any,
                baselineRefs: context.baselineRefs,
                startedAt: new Date(context.startedAt),
                lastSeenAt: new Date(context.lastSeenAt),
                closedAt: context.closedAt ? new Date(context.closedAt) : null,
                provenance: context.provenance as any,
                metadata: {
                    ...context.metadata,
                    mode: context.mode,
                    createdAt: context.createdAt,
                    parentContextIds: context.parentContextIds,
                    childContextIds: context.childContextIds,
                    relatedContextIds: context.relatedContextIds,
                } as any,
            });
        } catch (err) {
            logger.warn("context persistence failed; kept in local cache", { err, contextId: id });
        }
        logger.info(`[ContextPod] Created context ${id} (${input.type})`);
        return context;
    }

    async updateLifecycle(input: ContextLifecycleInput, ctx: DomainContext): Promise<PredictionContext> {
        const current = await this.getContext(input.contextId, ctx);
        if (!current) throw new Error(`Context ${input.contextId} not found`);
        
        const updated = {
            ...current,
            status: input.status,
            closedAt: input.closedAt || (input.status === "closed" ? new Date().toISOString() : undefined),
            lastSeenAt: new Date().toISOString()
        };
        
        this.contexts.set(input.contextId, updated);
        if (isUuid(input.contextId)) {
            try {
                await db.update(predictionContexts)
                    .set({
                        status: updated.status,
                        closedAt: updated.closedAt ? new Date(updated.closedAt) : null,
                        lastSeenAt: new Date(updated.lastSeenAt),
                    })
                    .where(eq(predictionContexts.id, input.contextId));
            } catch (err) {
                logger.warn("context lifecycle persistence failed; cache updated", { err, contextId: input.contextId });
            }
        }
        logger.info(`[ContextPod] Updated lifecycle for ${input.contextId} to ${input.status}`);
        return updated;
    }

    async mergeContexts(input: ContextMergeInput, ctx: DomainContext): Promise<PredictionContext> {
        const primary = await this.getContext(input.primaryContextId, ctx);
        if (!primary) throw new Error(`Primary context ${input.primaryContextId} not found`);

        const secondaryContexts = (await Promise.all(input.secondaryContextIds.map(id => this.getContext(id, ctx))))
            .filter((context): context is PredictionContext => !!context);
        const now = new Date().toISOString();
        const mergedIds = secondaryContexts.map(context => context.id);
        const merged: PredictionContext = {
            ...primary,
            confidence: Math.max(primary.confidence, input.confidence),
            evidenceEventIds: Array.from(new Set([...primary.evidenceEventIds, ...(input.evidenceIds ?? []), ...secondaryContexts.flatMap(context => context.evidenceEventIds)])),
            evidenceQuantIds: Array.from(new Set([...primary.evidenceQuantIds, ...secondaryContexts.flatMap(context => context.evidenceQuantIds)])),
            relatedContextIds: Array.from(new Set([...primary.relatedContextIds, ...mergedIds])),
            lastSeenAt: now,
            metadata: {
                ...primary.metadata,
                mergeReason: input.reason,
                mergedContextIds: Array.from(new Set([...(primary.metadata.mergedContextIds as string[] ?? []), ...mergedIds])),
            },
        };

        this.contexts.set(merged.id, merged);
        for (const secondary of secondaryContexts) {
            this.contexts.set(secondary.id, { ...secondary, status: "merged", relatedContextIds: Array.from(new Set([...secondary.relatedContextIds, merged.id])), lastSeenAt: now });
        }

        try {
            if (isUuid(merged.id)) {
                await db.update(predictionContexts)
                    .set({
                        confidence: merged.confidence,
                        evidenceEventIds: merged.evidenceEventIds.filter(isUuid),
                        evidenceQuantIds: merged.evidenceQuantIds.filter(isUuid),
                        lastSeenAt: new Date(now),
                        metadata: {
                            ...merged.metadata,
                            mode: merged.mode,
                            createdAt: merged.createdAt,
                            parentContextIds: merged.parentContextIds,
                            childContextIds: merged.childContextIds,
                            relatedContextIds: merged.relatedContextIds,
                        } as any,
                    })
                    .where(eq(predictionContexts.id, merged.id));
            }
            const secondaryUuidIds = mergedIds.filter(isUuid);
            if (secondaryUuidIds.length > 0) {
                await db.update(predictionContexts)
                    .set({ status: "merged", lastSeenAt: new Date(now) })
                    .where(inArray(predictionContexts.id, secondaryUuidIds));
                await db.insert(contextRelations).values(secondaryUuidIds.map(id => ({
                    sourceContextId: id,
                    targetContextId: merged.id,
                    relationType: "merged_into",
                    confidence: input.confidence,
                    evidenceIds: (input.evidenceIds ?? []).filter(isUuid),
                    metadata: { reason: input.reason } as any,
                })));
            }
        } catch (err) {
            logger.warn("context merge persistence failed; cache updated", { err, primaryContextId: merged.id });
        }

        return merged;
    }

    async splitContext(input: ContextSplitInput, ctx: DomainContext): Promise<PredictionContext[]> {
        const source = await this.getContext(input.sourceContextId, ctx);
        if (!source) throw new Error(`Context ${input.sourceContextId} not found`);

        const children = await Promise.all(input.splitTypes.map(type => this.createContext({
            type,
            label: source.label ? `${source.label} / ${type}` : type,
            tenantId: source.tenantId,
            applicationId: source.applicationId,
            actorId: source.actorId,
            workflowId: source.workflowId,
            sessionId: source.sessionId,
            taskId: source.taskId,
            agentId: source.agentId,
            regionId: source.regionId,
            parentContextIds: [source.id],
            mode: source.mode,
            confidence: input.confidence,
            resolutionMethod: "split",
            evidenceEventIds: input.evidenceIds ?? source.evidenceEventIds,
            metadata: { splitReason: input.reason, sourceContextId: source.id },
        }, ctx)));

        const updatedSource: PredictionContext = {
            ...source,
            status: "split",
            childContextIds: Array.from(new Set([...source.childContextIds, ...children.map(child => child.id)])),
            lastSeenAt: new Date().toISOString(),
            metadata: { ...source.metadata, splitReason: input.reason },
        };
        this.contexts.set(source.id, updatedSource);

        try {
            if (isUuid(source.id)) {
                await db.update(predictionContexts)
                    .set({
                        status: "split",
                        lastSeenAt: new Date(updatedSource.lastSeenAt),
                        metadata: {
                            ...updatedSource.metadata,
                            mode: updatedSource.mode,
                            createdAt: updatedSource.createdAt,
                            parentContextIds: updatedSource.parentContextIds,
                            childContextIds: updatedSource.childContextIds,
                            relatedContextIds: updatedSource.relatedContextIds,
                        } as any,
                    })
                    .where(eq(predictionContexts.id, source.id));
                await db.insert(contextRelations).values(children.map(child => ({
                    sourceContextId: child.id,
                    targetContextId: source.id,
                    relationType: "split_from",
                    confidence: input.confidence,
                    evidenceIds: (input.evidenceIds ?? []).filter(isUuid),
                    metadata: { reason: input.reason } as any,
                })));
            }
        } catch (err) {
            logger.warn("context split persistence failed; cache updated", { err, sourceContextId: source.id });
        }

        return children;
    }

    async getBaselines(contextId: string, ctx: DomainContext): Promise<string[]> {
        const context = this.contexts.get(contextId);
        return context?.baselineRefs || [];
    }
}

export const contextService = new ContextService();
