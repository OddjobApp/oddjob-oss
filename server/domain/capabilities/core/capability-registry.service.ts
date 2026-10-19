/**
 * Capability Registry Service
 * ===========================
 *
 * The live, vector-indexed capability router that both pipeline directions
 * converge on:
 *
 *   - Path A (code → docs) registers a freshly-reflected manifest here so the
 *     router always reflects current code.
 *   - Path B (docs → code) registers manifests extracted from Markdown.
 *   - Agents call {@link CapabilityRegistryService.discover} with a
 *     natural-language problem and get back the top-K structural manifests to
 *     inject into their context — this is the semantic upgrade path for the
 *     existing `discover_capabilities` tool.
 *
 * Reuses the platform's hardened infrastructure rather than standing up a
 * parallel stack: embeddings come from `embeddingService` using a PINNED
 * provider+model (no silent failover, so vector dims are deterministic) and
 * vectors live in the shared Qdrant via `server/integrations/qdrant-client.ts`.
 * The collection name is versioned by that embedding contract so a provider
 * change never collides differently-dimensioned vectors.
 *
 * Dependencies are injectable so `discover`/`register` can be unit-tested
 * without a live embedding provider or Qdrant.
 */

import { createHash } from "node:crypto";

import { createLogger } from "@server/utils/logger.js";
import { embeddingService } from "@domain/knowledge/core/rag/embedding-service.js";
import {
    upsertQdrantPoints,
    searchQdrant,
    deleteQdrantPoints,
    retrieveQdrantPoints,
    type VectorPoint,
} from "@server/integrations/qdrant-client.js";
import {
    buildEmbeddingText,
    safeParseCapabilityManifest,
    type CapabilityManifest,
} from "@shared/schema/capabilities/index.js";

const logger = createLogger("CapabilityRegistry");

// Pinned embedding contract — deterministic vector dims so Qdrant upserts never
// break on a provider/model change, and register()/discover() always agree.
const ACDD_EMBEDDING_PROVIDER = (process.env.ACDD_EMBEDDING_PROVIDER || "google").toLowerCase();

function defaultEmbeddingModel(provider: string): string {
    switch (provider) {
        case "ollama":
            return "nomic-embed-text";
        case "openai":
            return "text-embedding-3-small";
        case "python":
            return "all-MiniLM-L6-v2";
        default:
            return "gemini-embedding-001"; // google / gemini
    }
}
const ACDD_EMBEDDING_MODEL = process.env.ACDD_EMBEDDING_MODEL || defaultEmbeddingModel(ACDD_EMBEDDING_PROVIDER);

/**
 * The vector length is part of the contract too. The same Gemini model came back
 * at two sizes: the direct call returns its native 3072, while an org-scoped call
 * (every worker job, and every request in production) goes through
 * organizationEmbeddings, which truncates to QDRANT_VECTOR_SIZE. A collection
 * created by one path then rejected the other with a bare 400: every capability
 * sync job failed after writing its doc, and discovery from an org context
 * searched a collection of the wrong size. Both paths are cut to this length.
 * gemini-embedding-001 is Matryoshka-trained, so a prefix is a valid embedding.
 */
export const ACDD_EMBEDDING_DIMS = parseInt(
    process.env.ACDD_EMBEDDING_DIMS || process.env.QDRANT_VECTOR_SIZE || "3072",
    10,
);

/** Cut a vector to the contract length; a shorter one cannot be indexed. */
export function toContractDims(vector: number[] | null, dims: number = ACDD_EMBEDDING_DIMS): number[] | null {
    if (!vector || vector.length === 0) return null;
    if (vector.length < dims) {
        throw new Error(`Embedding has ${vector.length} dimensions; the capability index needs ${dims}.`);
    }
    return vector.length === dims ? vector : vector.slice(0, dims);
}

function slugifyContract(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * The vector collection is versioned by the pinned embedding contract
 * (provider+model → fixed dimension). A provider/model change routes to a NEW
 * collection instead of colliding with a differently-dimensioned one. An
 * explicit ACDD_QDRANT_COLLECTION always wins.
 */
export function resolveCapabilityCollection(
    provider: string = ACDD_EMBEDDING_PROVIDER,
    model: string = ACDD_EMBEDDING_MODEL,
    dims: number = ACDD_EMBEDDING_DIMS,
): string {
    return (
        process.env.ACDD_QDRANT_COLLECTION ||
        `acdd_capabilities__${slugifyContract(provider)}__${slugifyContract(model)}__d${dims}`
    );
}

const CAPABILITY_COLLECTION = resolveCapabilityCollection();
const DEFAULT_TOP_K = parseInt(process.env.ACDD_DISCOVER_TOP_K || "3", 10);

/**
 * Org id under which PLATFORM-GLOBAL capabilities (the platform's own tools) are
 * indexed. `discover()` always searches this in ADDITION to the caller's org, so
 * platform capabilities are available to every organization while org-specific
 * capabilities stay scoped to their org. Configure with ACDD_PLATFORM_ORG_ID.
 */
export const PLATFORM_ORG_ID = parseInt(process.env.ACDD_PLATFORM_ORG_ID || "0", 10);
const SCORE_THRESHOLD = process.env.ACDD_DISCOVER_SCORE_THRESHOLD
    ? parseFloat(process.env.ACDD_DISCOVER_SCORE_THRESHOLD)
    : undefined;

export interface CapabilityDiscoveryResult {
    capabilityId: string;
    score: number;
    manifest: CapabilityManifest;
}

/**
 * Whether a similarity search actually ran.
 *
 * `available` — the search executed; its (possibly empty) results are authoritative.
 * `unavailable` — the embedding provider produced no vector, so nothing is known.
 *
 * These must never be collapsed: an `unavailable` outcome scored as "no
 * duplicates found" hands a duplicate proposal a clean bill of health precisely
 * when deduplication is broken.
 */
export type CapabilitySimilarityStatus = "available" | "unavailable";

export interface CapabilityDiscoveryOutcome {
    status: CapabilitySimilarityStatus;
    results: CapabilityDiscoveryResult[];
}

/** Injectable seams (default to the real embedding + Qdrant implementations). */
export interface CapabilityRegistryDeps {
    embed: (text: string) => Promise<number[] | null>;
    upsert: typeof upsertQdrantPoints;
    search: typeof searchQdrant;
    remove: typeof deleteQdrantPoints;
    retrieve: typeof retrieveQdrantPoints;
    collection: string;
}

/**
 * Thrown when the registry itself could not be consulted.
 *
 * Distinct from "capability not found" on purpose. A caller validating that a
 * genome references real capabilities must treat the two differently: an
 * unknown capability is a genuine authoring error and should block, while an
 * unreachable vector store is an infrastructure problem that should not
 * silently rewrite itself into "none of your capabilities exist".
 */
export class CapabilityRegistryUnavailableError extends Error {
    constructor(cause: string) {
        super(`Capability registry unavailable: ${cause}`);
        this.name = "CapabilityRegistryUnavailableError";
    }
}

const DEFAULT_DEPS: CapabilityRegistryDeps = {
    embed: async (text: string) =>
        toContractDims(await embeddingService.generateEmbeddingWith(text, ACDD_EMBEDDING_PROVIDER, ACDD_EMBEDDING_MODEL)),
    upsert: upsertQdrantPoints,
    search: searchQdrant,
    remove: deleteQdrantPoints,
    retrieve: retrieveQdrantPoints,
    collection: CAPABILITY_COLLECTION,
};

/**
 * Deterministically map (org, capability) to a valid Qdrant point UUID. Qdrant
 * only accepts unsigned-int or UUID point ids; capability slugs are neither, so
 * we hash them into the canonical UUID shape ourselves (stable across
 * upsert/delete).
 */
export function capabilityPointId(organizationId: number, capabilityId: string): string {
    const hash = createHash("md5").update(`acdd:${organizationId}:${capabilityId}`).digest("hex");
    return (
        `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-` +
        `${hash.slice(16, 20)}-${hash.slice(20, 32)}`
    );
}

export class CapabilityRegistryService {
    private readonly deps: CapabilityRegistryDeps;

    constructor(deps: Partial<CapabilityRegistryDeps> = {}) {
        this.deps = { ...DEFAULT_DEPS, ...deps };
    }

    /**
     * Embed and index a capability manifest into the vector router.
     *
     * @throws if the embedding provider is unreachable (so the caller — a worker
     *   with retry/backoff — can requeue rather than silently drop it).
     */
    async register(organizationId: number, manifest: CapabilityManifest): Promise<void> {
        const vector = await this.deps.embed(buildEmbeddingText(manifest));
        if (!vector || vector.length === 0) {
            throw new Error(
                `Embedding unavailable for capability ${manifest.capability_id}; registration deferred.`,
            );
        }

        const point: VectorPoint = {
            id: capabilityPointId(organizationId, manifest.capability_id),
            vector,
            payload: {
                organizationId,
                capabilityId: manifest.capability_id,
                category: manifest.metadata.category,
                riskProfile: manifest.runtime_context.risk_profile,
                // Full manifest so discovery can return the structural payload directly.
                manifest,
            },
        };

        await this.deps.upsert([point], this.deps.collection);
        logger.info(
            `Indexed capability ${manifest.capability_id} for org ${organizationId} ` +
                `(${manifest.metadata.category}, risk=${manifest.runtime_context.risk_profile})`,
        );
    }

    /**
     * Return the top-K capability manifests most semantically relevant to a
     * natural-language problem, scoped to the organization.
     *
     * NOTE: an empty array from this method is ambiguous — it means either "no
     * capability was similar enough" or "similarity could not be computed"
     * (the embedding provider returns `null` on every failure path rather than
     * throwing). Callers that use the result to make a scoring or eligibility
     * decision MUST use {@link discoverWithStatus} instead, so a degraded
     * provider cannot be recorded as a confident negative.
     */
    async discover(
        organizationId: number,
        problem: string,
        topK: number = DEFAULT_TOP_K,
    ): Promise<CapabilityDiscoveryResult[]> {
        return (await this.discoverWithStatus(organizationId, problem, topK)).results;
    }

    /**
     * {@link discover}, but reporting whether similarity could actually be
     * computed.
     *
     * `available` means the search ran; `results` is then authoritative and an
     * empty array genuinely means "nothing similar". `unavailable` means the
     * embedding provider produced no vector, so nothing is known either way —
     * an `unavailable` outcome must never be scored as "no duplicates".
     *
     * Search-layer errors are NOT caught here: they propagate, preserving the
     * behaviour `discover()` callers already rely on. Callers that need those
     * treated as `unavailable` should catch and map them.
     */
    async discoverWithStatus(
        organizationId: number,
        problem: string,
        topK: number = DEFAULT_TOP_K,
    ): Promise<CapabilityDiscoveryOutcome> {
        // An empty query is a caller decision, not a degraded dependency.
        if (!problem || !problem.trim()) return { status: "available", results: [] };

        const vector = await this.deps.embed(problem);
        if (!vector || vector.length === 0) {
            logger.warn("Discovery skipped: embedding unavailable for query.");
            return { status: "unavailable", results: [] };
        }

        // Search the caller's org AND the platform org, so platform-global
        // capabilities are discoverable by every organization.
        const orgScope =
            organizationId === PLATFORM_ORG_ID ? [PLATFORM_ORG_ID] : [organizationId, PLATFORM_ORG_ID];
        const hits = await this.deps.search(vector, {
            limit: topK,
            scoreThreshold: SCORE_THRESHOLD,
            collection: this.deps.collection,
            filter: {
                must: [{ key: "organizationId", match: { any: orgScope } }],
            } as any,
        });

        const results: CapabilityDiscoveryResult[] = [];
        for (const hit of hits ?? []) {
            const payload = (hit as { payload?: Record<string, unknown> }).payload ?? {};
            const parsed = safeParseCapabilityManifest(payload.manifest);
            if (!parsed.success) {
                logger.warn(
                    `Skipping malformed manifest in discovery payload (point ${(hit as any).id}).`,
                );
                continue;
            }
            results.push({
                capabilityId: parsed.data.capability_id,
                score: (hit as { score?: number }).score ?? 0,
                manifest: parsed.data,
            });
        }
        return { status: "available", results };
    }

    /** Remove a capability from the vector router. */
    /**
     * Which of these capability ids are NOT registered for this organization.
     *
     * An exact keyed lookup, not a similarity search: `discover()` always
     * returns its nearest neighbours, so using it to answer "does X exist"
     * returns whatever is closest and calls it a match.
     *
     * Platform-org capabilities count as registered for every organization,
     * matching `discover()`'s scoping — a genome may legitimately reference a
     * platform-global capability.
     *
     * @throws CapabilityRegistryUnavailableError if the store cannot be reached,
     *   so callers can distinguish "this capability does not exist" from "I was
     *   unable to find out".
     */
    async findUnregistered(organizationId: number, capabilityIds: string[]): Promise<string[]> {
        const unique = [...new Set(capabilityIds)].filter(Boolean);
        if (unique.length === 0) return [];

        const scopes =
            organizationId === PLATFORM_ORG_ID ? [PLATFORM_ORG_ID] : [organizationId, PLATFORM_ORG_ID];

        // One point per (scope, capability); a capability is registered if any
        // of its scoped ids resolves.
        const wanted = unique.flatMap((capabilityId) =>
            scopes.map((scope) => ({ capabilityId, pointId: capabilityPointId(scope, capabilityId) })),
        );

        let found: Array<{ id: string | number }>;
        try {
            found = await this.deps.retrieve(wanted.map((w) => w.pointId), this.deps.collection);
        } catch (error: any) {
            throw new CapabilityRegistryUnavailableError(error?.message ?? String(error));
        }

        const foundIds = new Set(found.map((point) => String(point.id)));
        return unique.filter((capabilityId) =>
            !wanted.some((w) => w.capabilityId === capabilityId && foundIds.has(w.pointId)),
        );
    }

    async remove(organizationId: number, capabilityId: string): Promise<void> {
        await this.deps.remove([capabilityPointId(organizationId, capabilityId)], this.deps.collection);
        logger.info(`Removed capability ${capabilityId} for org ${organizationId} from router.`);
    }
}

export const capabilityRegistry = new CapabilityRegistryService();
