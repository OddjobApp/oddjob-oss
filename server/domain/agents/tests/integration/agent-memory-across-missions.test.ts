import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "../../../../database_service.js";
import {
  agentKnowledgeGraphEntries,
  orgs,
  jobs,
  missions,
  missionRuns,
  agentRunSteps,
  agentChatMessages,
  agentDeployments,
  pipelineStepExecutions,
} from "@shared/schema/index.js";
import { eq, and, inArray } from "drizzle-orm";
import { agentMemoryAcrossMissionsService } from "../../core/agent-memory-across-missions.service.js";


// Mock LangChain Embeddings
vi.mock("@domain/knowledge/core/rag-langchain.service.js", () => ({
  getEmbeddings: () => ({
    embedQuery: vi.fn().mockResolvedValue(new Array(768).fill(0.15)),
    embedDocuments: vi.fn().mockResolvedValue([new Array(768).fill(0.15)]),
  }),
}));

// Mock Qdrant Client (in-memory mock vector DB)
const mockPointsMap = new Map<string, any>();
vi.mock("@server/integrations/qdrant-client.js", () => ({
  ensureQdrantCollection: vi.fn().mockResolvedValue(true),
  upsertQdrantPoints: vi.fn().mockImplementation(async (points, collection) => {
    for (const p of points) {
      mockPointsMap.set(String(p.id), p);
    }
    return Promise.resolve();
  }),
  searchQdrant: vi.fn().mockImplementation(async (vector, options) => {
    const results = [];
    for (const [id, point] of mockPointsMap.entries()) {
      const payload = point.payload || {};
      let matches = true;
      if (options?.filter?.must) {
        for (const f of options.filter.must) {
          if (payload[f.key] !== f.match?.value) {
            matches = false;
            break;
          }
        }
      }
      if (matches) {
        results.push({
          id: point.id,
          score: 0.92, // High score to trigger overlap merge in storeEntry
          payload: point.payload,
          vector: point.vector,
        });
      }
    }
    return results;
  }),
  deleteQdrantByFilter: vi.fn().mockImplementation(async (filter, collection) => {
    mockPointsMap.clear();
    return Promise.resolve();
  }),
  clearQdrantCollection: vi.fn().mockResolvedValue(true),
}));

// Mock System AI Service
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
vi.mock("@domain/ai/core/system-ai.service.js", () => {
  return {
    systemAiService: {
      getAiConfig: vi.fn().mockResolvedValue({ provider: "google", model: "gemini-1.5-pro", apiKey: "mock-key" }),
      generateJson: vi.fn(),
      generateText: vi.fn(),
    },
  };
});

describe("Agent Memory Across Missions Integration Tests", () => {
  let org1Id: number;
  let org2Id: number;
  let job1Id: number;
  let job2Id: number;
  let mission1Id: number;
  let run1Id: number;

  const cleanup = async () => {
    const orgIds = [];
    if (org1Id) orgIds.push(org1Id);
    if (org2Id) orgIds.push(org2Id);
    if (orgIds.length === 0) return;

    await db.delete(agentRunSteps).where(inArray(agentRunSteps.organizationId, orgIds));
    await db.delete(agentKnowledgeGraphEntries).where(inArray(agentKnowledgeGraphEntries.organizationId, orgIds));
    await db.delete(agentChatMessages).where(inArray(agentChatMessages.organizationId, orgIds));
    
    const jobIds = [];
    if (job1Id) jobIds.push(job1Id);
    if (job2Id) jobIds.push(job2Id);
    if (jobIds.length > 0) {
      await db.delete(pipelineStepExecutions).where(inArray(pipelineStepExecutions.jobId, jobIds));
      await db.delete(agentDeployments).where(inArray(agentDeployments.jobId, jobIds));
    }
    
    await db.delete(missionRuns).where(inArray(missionRuns.organizationId, orgIds));
    await db.delete(missions).where(inArray(missions.organizationId, orgIds));
    
    if (jobIds.length > 0) {
      await db.delete(jobs).where(inArray(jobs.id, jobIds));
    }
    
    await db.delete(orgs).where(inArray(orgs.id, orgIds));
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockPointsMap.clear();

    // Clean up any remaining records from previous runs dynamically
    const existingOrgs = await db
      .select({ id: orgs.id })
      .from(orgs)
      .where(inArray(orgs.name, ["Org One", "Org Two"]));

    if (existingOrgs.length > 0) {
      const existingOrgIds = existingOrgs.map((o) => o.id);
      await db.delete(agentRunSteps).where(inArray(agentRunSteps.organizationId, existingOrgIds));
      await db.delete(agentKnowledgeGraphEntries).where(inArray(agentKnowledgeGraphEntries.organizationId, existingOrgIds));
      await db.delete(agentChatMessages).where(inArray(agentChatMessages.organizationId, existingOrgIds));
      
      const existingJobs = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(inArray(jobs.organizationId, existingOrgIds));

      if (existingJobs.length > 0) {
        const existingJobIds = existingJobs.map((j) => j.id);
        await db.delete(pipelineStepExecutions).where(inArray(pipelineStepExecutions.jobId, existingJobIds));
        await db.delete(agentDeployments).where(inArray(agentDeployments.jobId, existingJobIds));
      }
      
      await db.delete(missionRuns).where(inArray(missionRuns.organizationId, existingOrgIds));
      await db.delete(missions).where(inArray(missions.organizationId, existingOrgIds));
      
      if (existingJobs.length > 0) {
        const existingJobIds = existingJobs.map((j) => j.id);
        await db.delete(jobs).where(inArray(jobs.id, existingJobIds));
      }
      await db.delete(orgs).where(inArray(orgs.id, existingOrgIds));
    }

    // Seed Orgs
    const [org1] = await db.insert(orgs).values({ name: "Org One" }).returning();
    const [org2] = await db.insert(orgs).values({ name: "Org Two" }).returning();
    org1Id = org1.id;
    org2Id = org2.id;

    // Seed Jobs (Agents)
    const [job1] = await db
      .insert(jobs)
      .values({
        name: "Test Agent Job 1",
        type: "ai_agent",
        tool: "None",
        config: {},
        organizationId: org1Id,
        createdBy: "test-user",
      })
      .returning();

    const [job2] = await db
      .insert(jobs)
      .values({
        name: "Test Agent Job 2",
        type: "ai_agent",
        tool: "None",
        config: {},
        organizationId: org2Id,
        createdBy: "test-user",
      })
      .returning();

    job1Id = job1.id;
    job2Id = job2.id;

    // Seed Mission
    const [mission1] = await db
      .insert(missions)
      .values({
        name: "Mission 1",
        organizationId: org1Id,
        objective: "Test memory synthesis goal",
        createdBy: "test-user",
      })
      .returning();
    mission1Id = mission1.id;

    // Seed Mission Run
    const [run1] = await db
      .insert(missionRuns)
      .values({
        name: "Run 1",
        missionId: mission1Id,
        organizationId: org1Id,
        status: "completed",
        createdBy: "test-user",
      })
      .returning();
    run1Id = run1.id;
  });

  afterAll(async () => {
    await cleanup();
  });

  it("should successfully store a knowledge entry and resolve Qdrant upsert", async () => {
    const entryId = await agentMemoryAcrossMissionsService.storeEntry(
      org1Id,
      job1Id.toString(),
      "my-test-repo",
      "code_pattern",
      "Always use typescript index.ts file for exports",
      100,
      { filePaths: ["shared/schema/index.ts"] }
    );

    expect(entryId).toBeGreaterThan(0);

    const [dbRow] = await db
      .select()
      .from(agentKnowledgeGraphEntries)
      .where(eq(agentKnowledgeGraphEntries.id, entryId))
      .limit(1);

    expect(dbRow).toBeDefined();
    expect(dbRow.content).toBe("Always use typescript index.ts file for exports");
    expect(dbRow.type).toBe("code_pattern");
    expect(mockPointsMap.has(String(entryId))).toBe(true);
  });

  it("should merge overlapping entries when they match semantically", async () => {
    // Store first entry
    const entryId1 = await agentMemoryAcrossMissionsService.storeEntry(
      org1Id,
      job1Id.toString(),
      "my-test-repo",
      "code_pattern",
      "Always use typescript index.ts file for exports",
      80,
      { filePaths: ["shared/schema/index.ts"], techKeywords: ["exports"] }
    );

    // Store overlapping entry (mock Qdrant returns score 0.92, triggering merge)
    const entryId2 = await agentMemoryAcrossMissionsService.storeEntry(
      org1Id,
      job1Id.toString(),
      "my-test-repo",
      "code_pattern",
      "Always use typescript index.ts file for exports (duplicate)",
      90,
      { filePaths: ["shared/schema/auth.ts"], techKeywords: ["auth"] }
    );

    // They should merge to the first entry ID
    expect(entryId2).toBe(entryId1);

    const [mergedRow] = await db
      .select()
      .from(agentKnowledgeGraphEntries)
      .where(eq(agentKnowledgeGraphEntries.id, entryId1))
      .limit(1);

    expect(mergedRow.confidence).toBe(95); // max(80, 90) + 5
    expect(mergedRow.metadata.filePaths).toContain("shared/schema/index.ts");
    expect(mergedRow.metadata.filePaths).toContain("shared/schema/auth.ts");
    expect(mergedRow.metadata.techKeywords).toContain("exports");
    expect(mergedRow.metadata.techKeywords).toContain("auth");
  });

  it("should fail storeEntry or recallPriorKnowledge if cross-org boundaries are breached", async () => {
    // Job 2 belongs to Org 2, so Org 1 should not be allowed to recall with Job 2's ID
    await expect(
      agentMemoryAcrossMissionsService.recallPriorKnowledge(
        org1Id,
        job2Id.toString(),
        "my-test-repo",
        "some plan"
      )
    ).rejects.toThrow("403 Forbidden: Cross-organization access denied");

    // Compacting session with cross-org job ID should throw 403
    await expect(
      agentMemoryAcrossMissionsService.compactSession(run1Id, job2Id, org1Id)
    ).rejects.toThrow("403 Forbidden: Cross-organization access denied");
  });

  it("should successfully compact session into structured knowledge graph entries", async () => {
    // Seed agent steps in run history
    await db.insert(agentRunSteps).values([
      {
        runId: "run-uuid-1",
        jobId: job1Id,
        organizationId: org1Id,
        type: "thought",
        content: "I will write a custom validator for regex patterns.",
        missionId: mission1Id,
        missionRunId: run1Id,
      },
      {
        runId: "run-uuid-1",
        jobId: job1Id,
        organizationId: org1Id,
        type: "action",
        toolName: "write_file",
        content: "Writing regex validator...",
        missionId: mission1Id,
        missionRunId: run1Id,
      },
    ]);

    // Mock LLM response for compaction
    const mockedCompactionResult = {
      entries: [
        {
          type: "code_pattern",
          content: "Always order regex alternations from longest to shortest.",
          confidence: 95,
          metadata: {
            filePaths: ["server/utils/regex.ts"],
            techKeywords: ["regex"],
          },
        },
        {
          type: "lesson_learned",
          content: "Greedy matches occur when shorter patterns are placed first.",
          confidence: 85,
          metadata: {
            filePaths: ["server/utils/regex.ts"],
            errorCategory: "test_failure",
            failureMode: "greedy matching",
          },
        },
      ],
    };

    vi.spyOn(systemAiService, "generateJson").mockResolvedValue(mockedCompactionResult);

    await agentMemoryAcrossMissionsService.compactSession(run1Id, job1Id, org1Id);

    // Verify database table has the compacted entries
    const dbRows = await db
      .select()
      .from(agentKnowledgeGraphEntries)
      .where(
        and(
          eq(agentKnowledgeGraphEntries.organizationId, org1Id),
          eq(agentKnowledgeGraphEntries.agentId, job1Id.toString())
        )
      );

    expect(dbRows.length).toBe(2);
    const pattern = dbRows.find((r) => r.type === "code_pattern");
    const lesson = dbRows.find((r) => r.type === "lesson_learned");

    expect(pattern).toBeDefined();
    expect(pattern?.content).toBe("Always order regex alternations from longest to shortest.");
    expect(lesson).toBeDefined();
    expect(lesson?.content).toBe("Greedy matches occur when shorter patterns are placed first.");
    expect(lesson?.metadata.errorCategory).toBe("test_failure");
  });

  it("should recall relevant entries based on implementation plan", async () => {
    // Pre-populate entries
    await db.insert(agentKnowledgeGraphEntries).values([
      {
        organizationId: org1Id,
        agentId: job1Id.toString(),
        repositoryId: "my-test-repo",
        type: "code_pattern",
        content: "Use the reference-extractor module to parse file changes.",
        confidence: 90,
        metadata: {
          filePaths: ["server/domain/agents/core/context-injection/reference-extractor.ts"],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        organizationId: org1Id,
        agentId: job1Id.toString(),
        repositoryId: "my-test-repo",
        type: "lesson_learned",
        content: "Ensure tsx is checked before ts to avoid prefix overlap.",
        confidence: 85,
        metadata: {
          filePaths: ["server/domain/agents/core/context-injection/reference-extractor.ts"],
          errorCategory: "test_failure",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // Plan references the exact file
    const plan = "We need to fix reference-extractor.ts regex matching pattern.";

    const result = await agentMemoryAcrossMissionsService.recallPriorKnowledge(
      org1Id,
      job1Id.toString(),
      "my-test-repo",
      plan
    );

    expect(result.patterns.length).toBe(1);
    expect(result.lessons.length).toBe(1);
    expect(result.formattedMemoryContext).toContain("PRIOR KNOWLEDGE FROM PREVIOUS MISSIONS");
    expect(result.formattedMemoryContext).toContain("reference-extractor.ts");
  });

  it("should purge organization data upon organization deactivation", async () => {
    // Populate an entry
    await agentMemoryAcrossMissionsService.storeEntry(
      org1Id,
      job1Id.toString(),
      "my-test-repo",
      "code_pattern",
      "test content",
      100
    );

    // Verify it exists
    const beforePurge = await db
      .select()
      .from(agentKnowledgeGraphEntries)
      .where(eq(agentKnowledgeGraphEntries.organizationId, org1Id));
    expect(beforePurge.length).toBe(1);

    // Purge
    await agentMemoryAcrossMissionsService.purgeOrganizationMemory(org1Id);

    // Verify it is gone
    const afterPurge = await db
      .select()
      .from(agentKnowledgeGraphEntries)
      .where(eq(agentKnowledgeGraphEntries.organizationId, org1Id));
    expect(afterPurge.length).toBe(0);
    expect(mockPointsMap.size).toBe(0);
  });
});
