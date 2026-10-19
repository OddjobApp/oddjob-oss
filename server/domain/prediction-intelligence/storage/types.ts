// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - STORAGE POD
// Core type definitions (spec §9, §40)
// ============================================================================

import type { DomainContext } from "../quant/types.js";

export type PredictionMode = "realtime" | "interactive" | "analysis" | "batch";

export interface StorageObject {
    id: string;
    tenantId?: string;
    createdAt: string;
    updatedAt: string;
    version: number;
    metadata: Record<string, unknown>;
}

export interface TemporalRecord {
    validFrom: string;
    validTo?: string;
    observedAt?: string;
    supersededBy?: string;
}

export interface VectorRecord {
    vectorId: string;
    vectorType: "semantic" | "quant" | "pattern" | "graph" | "epistemic" | "memory" | "prediction";
    embedding: number[];
    dimensions: number;
    modelVersion: string;
    confidence?: number;
}

export interface Snapshot {
    snapshotId: string;
    entityType: string;
    entityId: string;
    createdAt: string;
    compressed: boolean;
    objectStorageRef?: string;
    payload: Record<string, unknown>;
}

// Port input/output types
export interface PersistInput {
    entityType: string;
    entityId?: string;
    tenantId?: string;
    data: Record<string, unknown>;
    temporal?: TemporalRecord;
    vector?: VectorRecord;
    mode?: PredictionMode;
}

export interface PersistResult {
    entityId: string;
    version: number;
    persistedAt: string;
}

export interface RetrieveInput {
    entityType: string;
    entityId: string;
    tenantId?: string;
    asOf?: string;
}

export interface RetrieveResult {
    entityId: string;
    entityType: string;
    data: Record<string, unknown>;
    version: number;
    temporal?: TemporalRecord;
}

export interface QueryInput {
    entityType: string;
    tenantId?: string;
    filters?: Record<string, unknown>;
    timeRange?: { from?: string; to?: string };
    vector?: { embedding: number[]; topK: number; collection: string };
    limit?: number;
    mode?: PredictionMode;
}

export interface QueryResult {
    entityType: string;
    results: RetrieveResult[];
    totalCount: number;
}

export interface SnapshotInput {
    entityType: string;
    entityId: string;
    tenantId?: string;
}

export interface ReplayInput {
    entityType: string;
    entityId?: string;
    tenantId?: string;
    from: string;
    to: string;
}

export interface ReplayResult {
    events: { timestamp: string; data: Record<string, unknown> }[];
    totalCount: number;
}

export interface StorageDiffInput {
    entityType: string;
    entityId: string;
    fromVersion?: number;
    toVersion?: number;
}

export interface StorageDiffResult {
    entityId: string;
    changes: { field: string; before: unknown; after: unknown }[];
}

export interface ArchiveInput {
    entityType: string;
    entityId?: string;
    tenantId?: string;
    before: string;
}

export interface ArchiveResult {
    archivedCount: number;
    objectStorageRef?: string;
}

// Storage Port (spec §40)
export interface StoragePort {
    persist(input: PersistInput, ctx: DomainContext): Promise<PersistResult>;
    retrieve(input: RetrieveInput, ctx: DomainContext): Promise<RetrieveResult | null>;
    query(input: QueryInput, ctx: DomainContext): Promise<QueryResult>;
    snapshot(input: SnapshotInput, ctx: DomainContext): Promise<Snapshot>;
    replay(input: ReplayInput, ctx: DomainContext): Promise<ReplayResult>;
    diff(input: StorageDiffInput, ctx: DomainContext): Promise<StorageDiffResult>;
    archive(input: ArchiveInput, ctx: DomainContext): Promise<ArchiveResult>;
}

// Qdrant collection names
export const STORAGE_QDRANT_COLLECTIONS = {
    memory: "memory_vectors",
    prediction: "prediction_vectors",
    quant: "quant_vectors",
    pattern: "pattern_vectors",
    graphGeometry: "graph_geometry_vectors",
    epistemic: "epistemic_vectors",
    realm: "realm_vectors",
} as const;
