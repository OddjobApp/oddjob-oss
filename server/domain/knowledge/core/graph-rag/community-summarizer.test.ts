import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommunitySummarizerService } from "./community-summarizer.service.js";
import { GraphRAGService } from "./graph-rag.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";

vi.mock("@server/database_service.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([
          { id: 1, name: "Node A", label: "concept", data: {} },
          { id: 2, name: "Node B", label: "concept", data: {} },
          { id: 3, name: "Node C", label: "tool", data: {} }
        ])
      }))
    }))
  }
}));

vi.mock("@domain/ai/core/system-ai.service.js", () => ({
  systemAiService: {
    generateText: vi.fn().mockResolvedValue("Mocked summary outcome"),
    generateJson: vi.fn()
  }
}));

describe("CommunitySummarizerService & GraphRAG Global Mode", () => {
  beforeEach(() => {
    CommunitySummarizerService.clearCache();
    vi.clearAllMocks();
  });

  it("should cluster nodes using label propagation", () => {
    const nodes = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const edges = [
      { sourceId: 1, targetId: 2 },
      { sourceId: 3, targetId: 4 }
    ];

    const communities = CommunitySummarizerService.detectCommunities(nodes, edges);
    expect(communities.size).toBeGreaterThan(0);
  });

  it("should generate and query community summaries", async () => {
    const summaries = await CommunitySummarizerService.generateCommunitySummaries(1);
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries[0].summary).toBe("Mocked summary outcome");

    const globalAnswer = await CommunitySummarizerService.queryCommunitySummaries("What is Node A?", summaries);
    expect(globalAnswer).toBe("Mocked summary outcome");
  });

  it("should execute global search via GraphRAGService when mode is global", async () => {
    const qdrantClientMock = {} as any;
    const embeddingServiceMock = {} as any;

    const graphRAG = new GraphRAGService(qdrantClientMock, embeddingServiceMock, { enableCache: false });
    const result = await graphRAG.query({
      query: "Summary of workspace",
      organizationId: 1,
      maxHops: 2,
      topK: 5,
      traversalStrategy: "bfs",
      minRelationshipWeight: 0.5,
      includePaths: false,
      mode: "global"
    });

    expect(result.answer).toBe("Mocked summary outcome");
    expect(result.contextNodes.length).toBe(0);
  });
});
