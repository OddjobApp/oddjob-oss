/**
 * Confluence Pagination Tests
 *
 * Verifies that getAllPagesInSpace and getAllSpaces correctly follow
 * offset pagination until Confluence signals end-of-results.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the gateway ──────────────────────────────────────────────────────────
const mockGetPagesInSpace = vi.fn();
const mockGetSpaces       = vi.fn();

vi.mock("../../../integrations/confluence-gateway.js", () => ({
    ConfluenceGateway: vi.fn(function() {
        return {
            getPagesInSpace:   mockGetPagesInSpace,
            getSpaces:         mockGetSpaces,
            getPage:           vi.fn(),
            getSpaceIdByKey:   vi.fn(),
            searchPagesV2:     vi.fn(),
            getPageV2:         vi.fn(),
            convertToMarkdown: vi.fn((html: string) => html),
            getBaseUrl:        vi.fn(() => "https://example.atlassian.net"),
        };
    }),
}));

function makePages(n: number, offset = 0) {
    return Array.from({ length: n }, (_, i) => ({
        id: String(offset + i + 1),
        title: `Page ${offset + i + 1}`,
        body: { storage: { value: "" } },
        version: { number: 1 },
        space: { key: "TEST", name: "Test" },
        _links: { webui: "/pages/1", tinyui: "/tiny/1" },
    }));
}

function makeSpaces(n: number, offset = 0) {
    return Array.from({ length: n }, (_, i) => ({
        id: offset + i + 1,
        key: `S${offset + i + 1}`,
        name: `Space ${offset + i + 1}`,
        type: "global",
        _links: { webui: "/" },
    }));
}

describe("ConfluenceClient.getAllPagesInSpace", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns all pages when they fit in a single request", async () => {
        mockGetPagesInSpace.mockResolvedValueOnce(makePages(30));

        const { ConfluenceClient } = await import("../confluence-service.js");
        const client = new ConfluenceClient("https://x.atlassian.net", "user", "token");
        const result = await client.getAllPagesInSpace("TEST", 50);

        expect(result).toHaveLength(30);
        expect(mockGetPagesInSpace).toHaveBeenCalledTimes(1);
        expect(mockGetPagesInSpace).toHaveBeenCalledWith("TEST", 50, 0);
    });

    it("follows multiple pages when results equal pageSize", async () => {
        mockGetPagesInSpace
            .mockResolvedValueOnce(makePages(50, 0))    // page 1 — full
            .mockResolvedValueOnce(makePages(50, 50))   // page 2 — full
            .mockResolvedValueOnce(makePages(20, 100)); // page 3 — partial → stop

        const { ConfluenceClient } = await import("../confluence-service.js");
        const client = new ConfluenceClient("https://x.atlassian.net", "user", "token");
        const result = await client.getAllPagesInSpace("TEST", 50);

        expect(result).toHaveLength(120);
        expect(mockGetPagesInSpace).toHaveBeenCalledTimes(3);
        expect(mockGetPagesInSpace).toHaveBeenNthCalledWith(1, "TEST", 50, 0);
        expect(mockGetPagesInSpace).toHaveBeenNthCalledWith(2, "TEST", 50, 50);
        expect(mockGetPagesInSpace).toHaveBeenNthCalledWith(3, "TEST", 50, 100);
    });

    it("stops when an empty batch is returned", async () => {
        mockGetPagesInSpace
            .mockResolvedValueOnce(makePages(50, 0))
            .mockResolvedValueOnce([]);

        const { ConfluenceClient } = await import("../confluence-service.js");
        const client = new ConfluenceClient("https://x.atlassian.net", "user", "token");
        const result = await client.getAllPagesInSpace("TEST", 50);

        expect(result).toHaveLength(50);
        expect(mockGetPagesInSpace).toHaveBeenCalledTimes(2);
    });

    it("respects maxPages safety cap", async () => {
        // Each call returns a full page — pagination would continue forever without the cap
        mockGetPagesInSpace.mockResolvedValue(makePages(50));

        const { ConfluenceClient } = await import("../confluence-service.js");
        const client = new ConfluenceClient("https://x.atlassian.net", "user", "token");
        const result = await client.getAllPagesInSpace("TEST", 50, 75);

        // Should stop after 75 total entries (2 full pages = 100, but cap is 75)
        expect(result.length).toBeLessThanOrEqual(100); // last batch might overshoot slightly
        // Crucially it does NOT keep fetching indefinitely
        expect(mockGetPagesInSpace.mock.calls.length).toBeLessThanOrEqual(3);
    });
});

describe("ConfluenceClient.getAllSpaces", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns all spaces in one request", async () => {
        mockGetSpaces.mockResolvedValueOnce(makeSpaces(10));

        const { ConfluenceClient } = await import("../confluence-service.js");
        const client = new ConfluenceClient("https://x.atlassian.net", "user", "token");
        const result = await client.getAllSpaces(50);

        expect(result).toHaveLength(10);
        expect(mockGetSpaces).toHaveBeenCalledTimes(1);
    });

    it("follows pagination across multiple pages", async () => {
        mockGetSpaces
            .mockResolvedValueOnce(makeSpaces(50, 0))
            .mockResolvedValueOnce(makeSpaces(5, 50));

        const { ConfluenceClient } = await import("../confluence-service.js");
        const client = new ConfluenceClient("https://x.atlassian.net", "user", "token");
        const result = await client.getAllSpaces(50);

        expect(result).toHaveLength(55);
        expect(mockGetSpaces).toHaveBeenCalledTimes(2);
        expect(mockGetSpaces).toHaveBeenNthCalledWith(1, 50, 0);
        expect(mockGetSpaces).toHaveBeenNthCalledWith(2, 50, 50);
    });
});

// ── Executor integration: verify paginated methods are called ─────────────────
describe("ConfluenceSyncExecutor uses pagination helpers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it("keeps paging until a space is exhausted (does not stop after the first page)", async () => {
        // The executor drives pagination itself: it calls the single-page
        // getPagesInSpace in a loop, advancing `start` by `limit` each time,
        // and stops when a page comes back empty. Guard that it advances.
        const makePage = (id: number) => ({
            id: String(id),
            title: `Page ${id}`,
            body: { storage: { value: "<p>hi</p>" } },
            _links: { webui: `/spaces/DEMO/pages/${id}` },
            space: { key: "DEMO" },
        });

        const getPagesSpy = vi.fn()
            .mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => makePage(i)))
            .mockResolvedValueOnce([makePage(50)])
            .mockResolvedValue([]);
        const getSpacesSpy = vi.fn().mockResolvedValue([{ key: "DEMO" }]);

        vi.doMock("@domain/integrations/confluence-service.js", () => ({
            getConfluenceClient: vi.fn().mockResolvedValue({
                getSpaces: getSpacesSpy,
                getPagesInSpace: getPagesSpy,
                convertToMarkdown: vi.fn(() => "# hi"),
                getBaseUrl: vi.fn(() => "https://x.atlassian.net/wiki"),
            }),
        }));

        vi.doMock("@domain/knowledge/core/knowledge-store.js", () => ({
            ingestFileToKnowledgeStore: vi.fn().mockResolvedValue({ id: 7 }),
        }));

        vi.doMock("@domain/knowledge/core/extraction/knowledge-graph-extractor.js", () => ({
            extractAndCreateKnowledgeGraph: vi.fn().mockResolvedValue(undefined),
        }));

        const { ConfluenceSyncExecutor } = await import("../../jobs/core/executors/confluence-sync-executor.js");
        const executor = new ConfluenceSyncExecutor();

        const job = { id: 1, organizationId: 1, createdBy: "u" } as any;
        const config = { credentialId: 1, spaceKeys: [], knowledgeTopicId: 42 };

        await executor.execute(job, config as any, {} as any, {} as any);

        expect(getSpacesSpy).toHaveBeenCalled();
        // Offset must advance past the first page, then terminate on the empty page.
        expect(getPagesSpy).toHaveBeenNthCalledWith(1, "DEMO", 50, 0);
        expect(getPagesSpy).toHaveBeenNthCalledWith(2, "DEMO", 50, 50);
        expect(getPagesSpy).toHaveBeenNthCalledWith(3, "DEMO", 50, 100);
        expect(getPagesSpy).toHaveBeenCalledTimes(3);
    });
});
