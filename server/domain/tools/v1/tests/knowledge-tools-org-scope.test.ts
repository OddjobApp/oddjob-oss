/**
 * The knowledge tools agents use refuse to run without an organization.
 *
 * search_unified_knowledge passed `organizationId || null` to unified search, and
 * get_document_relationships built a null-organization context that kept the
 * caller's super-admin flag, which getOrgConditions reads as "no filter at all".
 * Either way a tool invoked without its context could read every tenant.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const search = vi.hoisted(() => ({ executeUnifiedSearch: vi.fn(async () => []) }));
const services = vi.hoisted(() => ({
    findTopicByName: vi.fn(async () => []),
    findJobsUsingTopic: vi.fn(async () => []),
    listDocuments: vi.fn(async () => []),
    searchNodes: vi.fn(async () => ({ nodes: [] })),
    findPipelinesUsingTopic: vi.fn(async () => []),
}));

vi.mock("@domain/knowledge/core/search/search-service.js", () => ({ searchService: search }));
vi.mock("../../../knowledge/core/search/search-service.js", () => ({ searchService: search }));
vi.mock("@domain/ai/core/semantic-cache.service.js", () => ({ SemanticCacheService: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) } }));
vi.mock("../../../ai/core/semantic-cache.service.js", () => ({ SemanticCacheService: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) } }));
vi.mock("@domain/knowledge/core/rag-langchain.service.js", () => ({ retrieveSimilarDocuments: vi.fn() }));
vi.mock("../../../../domain/knowledge/core/topic-service.js", () => ({ topicService: { findTopicByName: services.findTopicByName } }));
vi.mock("../../../../domain/jobs/job.service.js", () => ({ jobService: { findJobsUsingTopic: services.findJobsUsingTopic } }));
vi.mock("../../../../domain/knowledge/core/extraction/document-service.js", () => ({ documentService: { listDocuments: services.listDocuments } }));
vi.mock("../../../../domain/knowledge/core/graph/graph-service.js", () => ({ graphService: { searchNodes: services.searchNodes } }));
vi.mock("../../../pipeline/core/pipeline.service.js", () => ({ pipelineService: { findPipelinesUsingTopic: services.findPipelinesUsingTopic } }));

import { search_unified_knowledge } from "../capabilities/search-core.js";
import { CORE_TOOLS } from "../capabilities/core.js";

describe("knowledge tools without an organization", () => {
    beforeEach(() => vi.clearAllMocks());

    it.each([undefined, {}, { organizationId: null }, { organizationId: null, isSuperAdmin: true }])(
        "search_unified_knowledge answers with the refusal and never searches (%o)",
        async (context) => {
            const answer = await search_unified_knowledge.execute({ query: "payroll" }, context);
            expect(answer).toMatch(/Organization context required/);
            expect(search.executeUnifiedSearch).not.toHaveBeenCalled();
        },
    );

    it("search_unified_knowledge searches the caller's organization", async () => {
        await search_unified_knowledge.execute({ query: "payroll" }, { organizationId: 42 });
        expect(search.executeUnifiedSearch).toHaveBeenCalledWith("payroll", expect.anything(), 42, expect.anything());
    });

    it("get_document_relationships refuses, even for a super admin, and reads nothing", async () => {
        const answer = await CORE_TOOLS.get_document_relationships.execute(
            { topicName: "payroll", documentId: 1 },
            { organizationId: null, isSuperAdmin: true, userId: "u" } as any,
        );
        expect(answer).toMatch(/Organization context required/);
        for (const fn of Object.values(services)) expect(fn).not.toHaveBeenCalled();
    });

    it("get_document_relationships reads as the caller's organization, never as super admin", async () => {
        await CORE_TOOLS.get_document_relationships.execute(
            { topicName: "payroll", documentId: 1 },
            { organizationId: 42, isSuperAdmin: true, userId: "u" } as any,
        );
        expect(services.findTopicByName).toHaveBeenCalledWith("payroll", expect.objectContaining({ organizationId: 42, isSuperAdmin: false }));
        expect(services.searchNodes).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 42, isSuperAdmin: false }), expect.anything());
    });
});
