// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — STORAGE POD SERVICE
// MVP: thin orchestration over Postgres (already handled per-pod) + Qdrant port.
// The storage pod acts as a unified storage facade, not a replacement for
// per-pod persistence — those remain authoritative.
// ============================================================================

import { randomUUID } from "crypto";
import { createLogger } from "@server/utils/logger.js";
import type { DomainContext } from "../quant/types.js";
import type { VectorPort } from "../plugin-runtime/types.js";
import type {
    StoragePort,
    PersistInput,
    PersistResult,
    RetrieveInput,
    RetrieveResult,
    QueryInput,
    QueryResult,
    SnapshotInput,
    Snapshot,
    ReplayInput,
    ReplayResult,
    StorageDiffInput,
    StorageDiffResult,
    ArchiveInput,
    ArchiveResult,
} from "./types.js";

const logger = createLogger("StoragePod");

class StoragePod implements StoragePort {
    private vectorPort?: VectorPort;

    constructor(vectorPort?: VectorPort) {
        this.vectorPort = vectorPort;
    }

    setVectorPort(port: VectorPort): void {
        this.vectorPort = port;
    }

    async persist(input: PersistInput, ctx: DomainContext): Promise<PersistResult> {
        // Each domain pod owns its own persistence.
        // This method handles cross-cutting concerns: versioning + optional vector upsert.
        const entityId = input.entityId ?? randomUUID();

        if (input.vector && this.vectorPort) {
            try {
                await this.vectorPort.upsert({
                    collection: `${input.entityType}_vectors`,
                    id: entityId,
                    vector: input.vector.embedding,
                    payload: { entityType: input.entityType, tenantId: input.tenantId, ...input.data },
                });
            } catch (err) {
                logger.warn(`vector upsert failed for ${input.entityType}, continuing`, err as any);
            }
        }

        return { entityId, version: 1, persistedAt: ctx.now };
    }

    async retrieve(_input: RetrieveInput, _ctx: DomainContext): Promise<RetrieveResult | null> {
        // Domain pods own their own retrieval. This returns null to signal "use domain pod".
        return null;
    }

    async query(input: QueryInput, ctx: DomainContext): Promise<QueryResult> {
        // Hybrid retrieval: only Qdrant vector path implemented here.
        if (input.vector && this.vectorPort) {
            try {
                const results = await this.vectorPort.search({
                    collection: input.vector.collection,
                    vector: input.vector.embedding,
                    topK: input.vector.topK,
                    filter: input.tenantId ? { tenantId: input.tenantId } : undefined,
                });
                return {
                    entityType: input.entityType,
                    results: results.map(r => ({
                        entityId: r.id,
                        entityType: input.entityType,
                        data: r.payload as Record<string, unknown>,
                        version: 1,
                    })),
                    totalCount: results.length,
                };
            } catch (err) {
                logger.warn("vector query failed", err as any);
            }
        }
        return { entityType: input.entityType, results: [], totalCount: 0 };
    }

    async snapshot(input: SnapshotInput, ctx: DomainContext): Promise<Snapshot> {
        return {
            snapshotId: randomUUID(),
            entityType: input.entityType,
            entityId: input.entityId,
            createdAt: ctx.now,
            compressed: false,
            payload: { tenantId: input.tenantId, snapshotAt: ctx.now },
        };
    }

    async replay(_input: ReplayInput, ctx: DomainContext): Promise<ReplayResult> {
        // Full replay deferred per spec §50
        return { events: [], totalCount: 0 };
    }

    async diff(_input: StorageDiffInput, _ctx: DomainContext): Promise<StorageDiffResult> {
        return { entityId: _input.entityId, changes: [] };
    }

    async archive(_input: ArchiveInput, _ctx: DomainContext): Promise<ArchiveResult> {
        // Archive deferred per spec §50
        return { archivedCount: 0 };
    }
}

export const storagePod = new StoragePod();
export type { StoragePod };
