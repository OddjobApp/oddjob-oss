import { describe, it, expect, vi } from "vitest";

import { type CapabilityManifest } from "@shared/schema/capabilities/index.js";
import {
    CapabilityRegistryService,
    CapabilityRegistryUnavailableError,
    capabilityPointId,
    resolveCapabilityCollection,
    toContractDims,
    PLATFORM_ORG_ID,
    type CapabilityRegistryDeps,
} from "./capability-registry.service.js";

function makeManifest(id = "extract_invoice_rows"): CapabilityManifest {
    return {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: id,
        metadata: {
            display_name: "Extract Invoice Rows",
            category: "Data Operations",
            description: "Extract line items from an invoice image.",
            owner: "data-team",
        },
        technical_spec: { inputs: { image_url: "str" }, outputs: { rows: "list" } },
        documentation_meta: { summary: "", business_use_cases: [], guardrails: [] },
        runtime_context: { risk_profile: "Low", execution_environment: "Host", dependencies: [] },
    };
}

/** Build a service with fully stubbed embed + Qdrant seams. */
function makeService(overrides: Partial<CapabilityRegistryDeps> = {}) {
    const upsert = vi.fn(async (_points: any[], _collection?: string): Promise<void> => {});
    const search = vi.fn(async (_vector: number[], _opts?: any): Promise<any[]> => []);
    const remove = vi.fn(async () => {});
    // Keyed lookup, distinct from `search`: existence is not similarity.
    const retrieve = vi.fn(async (_ids: Array<string | number>, _collection?: string): Promise<any[]> => []);
    const embed = vi.fn(async (_text: string) => [0.1, 0.2, 0.3]);
    const deps: CapabilityRegistryDeps = {
        embed,
        upsert: upsert as unknown as CapabilityRegistryDeps["upsert"],
        search: search as unknown as CapabilityRegistryDeps["search"],
        remove: remove as unknown as CapabilityRegistryDeps["remove"],
        retrieve: retrieve as unknown as CapabilityRegistryDeps["retrieve"],
        collection: "test_capabilities",
        ...overrides,
    };
    return { service: new CapabilityRegistryService(deps), embed, upsert, search, remove, retrieve };
}

describe("capabilityPointId", () => {
    it("is a deterministic, valid UUID-shaped id", () => {
        const a = capabilityPointId(7, "extract_invoice_rows");
        const b = capabilityPointId(7, "extract_invoice_rows");
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("differs by org and by capability", () => {
        expect(capabilityPointId(7, "a")).not.toBe(capabilityPointId(8, "a"));
        expect(capabilityPointId(7, "a")).not.toBe(capabilityPointId(7, "b"));
    });
});

describe("toContractDims", () => {
    it("cuts every embedding path to one length", () => {
        // The direct Gemini call returned 3072, the org-scoped one 768.
        expect(toContractDims(new Array(3072).fill(0.1), 768)).toHaveLength(768);
        expect(toContractDims(new Array(768).fill(0.1), 768)).toHaveLength(768);
    });

    it("refuses a vector shorter than the index, and passes 'no embedding' through", () => {
        expect(() => toContractDims(new Array(384).fill(0.1), 768)).toThrow(/384 dimensions/);
        expect(toContractDims(null, 768)).toBeNull();
        expect(toContractDims([], 768)).toBeNull();
    });
});

describe("resolveCapabilityCollection", () => {
    it("versions the collection name by the pinned provider, model and vector length", () => {
        const prev = process.env.ACDD_QDRANT_COLLECTION;
        delete process.env.ACDD_QDRANT_COLLECTION;
        try {
            expect(resolveCapabilityCollection("google", "gemini-embedding-001", 768)).toBe(
                "acdd_capabilities__google__gemini_embedding_001__d768",
            );
            // The same model at another length is another collection.
            expect(resolveCapabilityCollection("google", "gemini-embedding-001", 3072)).not.toBe(
                resolveCapabilityCollection("google", "gemini-embedding-001", 768),
            );
            // A provider/model change routes to a different collection (no dim clash).
            expect(resolveCapabilityCollection("ollama", "nomic-embed-text")).not.toBe(
                resolveCapabilityCollection("google", "gemini-embedding-001"),
            );
        } finally {
            if (prev === undefined) delete process.env.ACDD_QDRANT_COLLECTION;
            else process.env.ACDD_QDRANT_COLLECTION = prev;
        }
    });

    it("honours an explicit ACDD_QDRANT_COLLECTION override", () => {
        const prev = process.env.ACDD_QDRANT_COLLECTION;
        process.env.ACDD_QDRANT_COLLECTION = "custom_collection";
        try {
            expect(resolveCapabilityCollection("google", "gemini-embedding-001")).toBe("custom_collection");
        } finally {
            if (prev === undefined) delete process.env.ACDD_QDRANT_COLLECTION;
            else process.env.ACDD_QDRANT_COLLECTION = prev;
        }
    });
});

describe("register", () => {
    it("embeds and upserts a point carrying org, id and full manifest payload", async () => {
        const { service, embed, upsert } = makeService();
        const manifest = makeManifest();

        await service.register(42, manifest);

        expect(embed).toHaveBeenCalledOnce();
        expect(upsert).toHaveBeenCalledOnce();
        const [points, collection] = upsert.mock.calls[0]!;
        expect(collection).toBe("test_capabilities");
        expect(points).toHaveLength(1);
        expect(points[0].id).toBe(capabilityPointId(42, "extract_invoice_rows"));
        expect(points[0].vector).toEqual([0.1, 0.2, 0.3]);
        expect(points[0].payload).toMatchObject({
            organizationId: 42,
            capabilityId: "extract_invoice_rows",
            category: "Data Operations",
            manifest,
        });
    });

    it("throws (does not silently drop) when the embedding provider is unavailable", async () => {
        const { service, upsert } = makeService({ embed: vi.fn(async () => null) });
        await expect(service.register(42, makeManifest())).rejects.toThrow(/Embedding unavailable/);
        expect(upsert).not.toHaveBeenCalled();
    });
});

describe("discover", () => {
    it("returns [] for an empty problem without calling the backend", async () => {
        const { service, embed, search } = makeService();
        expect(await service.discover(1, "   ")).toEqual([]);
        expect(embed).not.toHaveBeenCalled();
        expect(search).not.toHaveBeenCalled();
    });

    it("scopes the search to the organization and maps score + manifest", async () => {
        const manifest = makeManifest();
        const search = vi.fn(async (_vector: number[], _opts?: any) => [
            { id: "pt-1", score: 0.91, payload: { manifest } },
        ]);
        const { service } = makeService({ search: search as any });

        const results = await service.discover(99, "pull rows out of an invoice image", 5);

        // Org filter applied — caller's org AND the platform org (fallback).
        const [, opts] = search.mock.calls[0]!;
        expect(opts.limit).toBe(5);
        expect(opts.filter.must[0]).toEqual({ key: "organizationId", match: { any: [99, PLATFORM_ORG_ID] } });

        expect(results).toEqual([
            { capabilityId: "extract_invoice_rows", score: 0.91, manifest },
        ]);
    });

    it("scopes to only the platform org when the caller IS the platform org", async () => {
        const search = vi.fn(async (_vector: number[], _opts?: any) => []);
        const { service } = makeService({ search: search as any });
        await service.discover(PLATFORM_ORG_ID, "anything");
        const [, opts] = search.mock.calls[0]!;
        expect(opts.filter.must[0]).toEqual({ key: "organizationId", match: { any: [PLATFORM_ORG_ID] } });
    });

    it("returns [] (not an error) when the embedding provider is unavailable", async () => {
        const { service, search } = makeService({ embed: vi.fn(async () => null) });
        expect(await service.discover(1, "anything")).toEqual([]);
        expect(search).not.toHaveBeenCalled();
    });

    it("skips malformed manifest payloads instead of throwing", async () => {
        const good = makeManifest("good_one");
        const search = vi.fn(async () => [
            { id: "bad", score: 0.8, payload: { manifest: { not: "a manifest" } } },
            { id: "good", score: 0.7, payload: { manifest: good } },
        ]);
        const { service } = makeService({ search: search as any });

        const results = await service.discover(1, "anything");
        expect(results).toHaveLength(1);
        expect(results[0].capabilityId).toBe("good_one");
    });
});

describe("discoverWithStatus", () => {
    // The whole point of this method: an empty result set is ambiguous, and the
    // ambiguity has to survive to the caller. `discover()` cannot express it.
    it("reports 'unavailable' when the embedding provider yields no vector", async () => {
        const { service, search } = makeService({ embed: vi.fn(async () => null) });
        const outcome = await service.discoverWithStatus(1, "anything");
        expect(outcome).toEqual({ status: "unavailable", results: [] });
        expect(search).not.toHaveBeenCalled();
    });

    it("reports 'unavailable' for an empty embedding vector", async () => {
        const { service } = makeService({ embed: vi.fn(async () => []) });
        const outcome = await service.discoverWithStatus(1, "anything");
        expect(outcome.status).toBe("unavailable");
    });

    it("reports 'available' with an empty result set when the search genuinely finds nothing", async () => {
        const { service } = makeService({ search: vi.fn(async () => []) as any });
        const outcome = await service.discoverWithStatus(1, "anything");
        expect(outcome).toEqual({ status: "available", results: [] });
    });

    it("reports 'available' and maps hits when the search returns matches", async () => {
        const manifest = makeManifest();
        const search = vi.fn(async () => [{ id: "pt-1", score: 0.91, payload: { manifest } }]);
        const { service } = makeService({ search: search as any });
        const outcome = await service.discoverWithStatus(1, "anything");
        expect(outcome.status).toBe("available");
        expect(outcome.results).toEqual([
            { capabilityId: "extract_invoice_rows", score: 0.91, manifest },
        ]);
    });

    it("treats an empty problem as 'available' — a caller decision, not a degraded dependency", async () => {
        const { service, embed } = makeService();
        expect(await service.discoverWithStatus(1, "   ")).toEqual({ status: "available", results: [] });
        expect(embed).not.toHaveBeenCalled();
    });

    it("propagates search-layer errors rather than masking them as 'unavailable'", async () => {
        const search = vi.fn(async () => {
            throw new Error("qdrant unreachable");
        });
        const { service } = makeService({ search: search as any });
        await expect(service.discoverWithStatus(1, "anything")).rejects.toThrow(/qdrant unreachable/);
    });
});

describe("remove", () => {
    it("deletes the deterministic point id from the collection", async () => {
        const { service, remove } = makeService();
        await service.remove(42, "extract_invoice_rows");
        expect(remove).toHaveBeenCalledWith([capabilityPointId(42, "extract_invoice_rows")], "test_capabilities");
    });
});

describe("findUnregistered", () => {
    it("returns nothing when every capability resolves", async () => {
        const { service, retrieve } = makeService();
        retrieve.mockResolvedValueOnce([
            { id: capabilityPointId(7, "triage"), payload: {} },
            { id: capabilityPointId(7, "escalate"), payload: {} },
        ]);

        expect(await service.findUnregistered(7, ["triage", "escalate"])).toEqual([]);
    });

    it("names only the capabilities that are absent", async () => {
        const { service, retrieve } = makeService();
        retrieve.mockResolvedValueOnce([{ id: capabilityPointId(7, "triage"), payload: {} }]);

        expect(await service.findUnregistered(7, ["triage", "ghost"])).toEqual(["ghost"]);
    });

    it("counts a platform-org capability as registered for any organization", async () => {
        // Mirrors discover()'s scoping: platform-global capabilities are
        // legitimately referenceable by every tenant, so a genome naming one is
        // not an error.
        const { service, retrieve } = makeService();
        retrieve.mockResolvedValueOnce([{ id: capabilityPointId(PLATFORM_ORG_ID, "shared_tool"), payload: {} }]);

        expect(await service.findUnregistered(7, ["shared_tool"])).toEqual([]);
    });

    it("asks by key rather than by similarity", async () => {
        // The whole point of this method: `search` would return nearest
        // neighbours and call the closest one a match.
        const { service, retrieve, search } = makeService();
        retrieve.mockResolvedValueOnce([]);

        await service.findUnregistered(7, ["triage"]);
        expect(retrieve).toHaveBeenCalledTimes(1);
        expect(search).not.toHaveBeenCalled();
    });

    it("distinguishes an unreachable registry from an absent capability", async () => {
        // A caller must be able to tell "this does not exist" from "I could not
        // find out" — they warrant opposite responses.
        const { service, retrieve } = makeService();
        // mockImplementationOnce, not mockRejectedValueOnce: the latter builds
        // the rejected promise at setup time, so node sees an unhandled
        // rejection before the assertion attaches to it.
        retrieve.mockImplementationOnce(async () => {
            throw new Error("ECONNREFUSED");
        });

        await expect(service.findUnregistered(7, ["triage"])).rejects.toThrow(
            CapabilityRegistryUnavailableError,
        );
    });

    it("does not call the store for an empty request", async () => {
        const { service, retrieve } = makeService();
        expect(await service.findUnregistered(7, [])).toEqual([]);
        expect(retrieve).not.toHaveBeenCalled();
    });
});
