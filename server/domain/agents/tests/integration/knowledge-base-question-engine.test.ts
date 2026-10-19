import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "../../../../database_service.js";
import {
  knowledgeBaseQuestions,
  agentKnowledgeGraphEntries,
  orgs,
  jobs,
  missions,
  missionRuns,
  agentRunSteps,
  pipelineStepExecutions,
  agentDeployments,
} from "@shared/schema/index.js";
import { eq, and, inArray } from "drizzle-orm";
import { knowledgeBaseQuestionEngineService } from "../../core/knowledge-base-question-engine.service.js";
import { agentMemoryAcrossMissionsService } from "../../core/agent-memory-across-missions.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";

// Mock LangChain Embeddings
vi.mock("@domain/knowledge/core/rag-langchain.service.js", () => ({
  getEmbeddings: () => ({
    embedQuery: vi.fn().mockResolvedValue(new Array(768).fill(0.15)),
    embedDocuments: vi.fn().mockResolvedValue([new Array(768).fill(0.15)]),
  }),
}));

// Mock Qdrant Client
vi.mock("@server/integrations/qdrant-client.js", () => ({
  ensureQdrantCollection: vi.fn().mockResolvedValue(true),
  upsertQdrantPoints: vi.fn().mockResolvedValue(undefined),
  searchQdrant: vi.fn().mockResolvedValue([]),
  deleteQdrantByFilter: vi.fn().mockResolvedValue(undefined),
}));

// Mock systemAiService
vi.mock("@domain/ai/core/system-ai.service.js", () => {
  return {
    systemAiService: {
      getAiConfig: vi.fn().mockResolvedValue({ provider: "google", model: "gemini-1.5-pro", apiKey: "mock-key" }),
      generateJson: vi.fn(),
      generateText: vi.fn(),
    },
  };
});

describe("Knowledge Base Question Engine Integration Tests", () => {
  let org1Id: number;
  let org2Id: number;
  let job1Id: number;
  let mission1Id: number;
  let run1Id: number;

  const cleanup = async () => {
    const orgIds = [];
    if (org1Id) orgIds.push(org1Id);
    if (org2Id) orgIds.push(org2Id);
    if (orgIds.length === 0) return;

    await db.delete(knowledgeBaseQuestions).where(inArray(knowledgeBaseQuestions.organizationId, orgIds));
    await db.delete(agentRunSteps).where(inArray(agentRunSteps.organizationId, orgIds));
    await db.delete(agentKnowledgeGraphEntries).where(inArray(agentKnowledgeGraphEntries.organizationId, orgIds));

    const jobIds = [];
    if (job1Id) jobIds.push(job1Id);
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

    const existingOrgs = await db
      .select({ id: orgs.id })
      .from(orgs)
      .where(inArray(orgs.name, ["Org Three", "Org Four"]));

    if (existingOrgs.length > 0) {
      const existingOrgIds = existingOrgs.map((o) => o.id);
      await db.delete(knowledgeBaseQuestions).where(inArray(knowledgeBaseQuestions.organizationId, existingOrgIds));
      await db.delete(agentRunSteps).where(inArray(agentRunSteps.organizationId, existingOrgIds));
      await db.delete(agentKnowledgeGraphEntries).where(inArray(agentKnowledgeGraphEntries.organizationId, existingOrgIds));
      
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
    const [org1] = await db.insert(orgs).values({ name: "Org Three" }).returning();
    const [org2] = await db.insert(orgs).values({ name: "Org Four" }).returning();
    org1Id = org1.id;
    org2Id = org2.id;

    // Seed Jobs (Agents)
    const [job1] = await db
      .insert(jobs)
      .values({
        name: "Test Agent Job 3",
        type: "ai_agent",
        tool: "None",
        config: {},
        organizationId: org1Id,
        createdBy: "test-user",
      })
      .returning();

    job1Id = job1.id;

    // Seed Mission
    const [mission1] = await db
      .insert(missions)
      .values({
        name: "Mission 3",
        organizationId: org1Id,
        objective: "Test question engine system",
        workspacePath: "my-test-repo-2",
        createdBy: "test-user",
      })
      .returning();

    // Seed Mission Run
    const [run1] = await db
      .insert(missionRuns)
      .values({
        missionId: mission1.id,
        name: "Test Run 3",
        status: "failed",
        isSuccess: false,
        organizationId: org1Id,
        createdBy: "test-user",
      })
      .returning();

    run1Id = run1.id;
  });

  afterAll(async () => {
    await cleanup();
  });

  it("should successfully generate a question and avoid duplicates", async () => {
    const aiResponse = {
      questionText: "Should we order regex alternations from longest to shortest?",
      proposedAnswer: "Yes, to avoid greedy prefix matches.",
    };
    vi.spyOn(systemAiService, "generateJson").mockResolvedValue(aiResponse);

    const questionId1 = await knowledgeBaseQuestionEngineService.createQuestion(
      org1Id,
      "my-test-repo-2",
      "low_confidence_compaction",
      {
        filePaths: ["server/utils/regex.ts"],
        jobId: job1Id,
      }
    );

    expect(questionId1).not.toBeNull();

    // De-duplication check: creating question with overlapping files/source should return same ID
    const questionId2 = await knowledgeBaseQuestionEngineService.createQuestion(
      org1Id,
      "my-test-repo-2",
      "low_confidence_compaction",
      {
        filePaths: ["server/utils/regex.ts"],
        jobId: job1Id,
      }
    );

    expect(questionId2).toBe(questionId1);

    const pending = await knowledgeBaseQuestionEngineService.listQuestions(org1Id, "my-test-repo-2");
    expect(pending.length).toBe(1);
    expect(pending[0].questionText).toContain("regex alternations");
  });

  it("should redirect low-confidence compaction entries to the question engine", async () => {
    // Seed agent steps
    await db.insert(agentRunSteps).values([
      {
        runId: "run-uuid-3",
        jobId: job1Id,
        organizationId: org1Id,
        type: "thought",
        content: "I will modify regex.ts.",
        missionId: mission1Id,
        missionRunId: run1Id,
      },
    ]);

    const mockCompaction = {
      entries: [
        {
          type: "code_pattern",
          content: "Low confidence regex ordering pattern.",
          confidence: 75, // < 85
          metadata: {
            filePaths: ["server/utils/regex.ts"],
          },
        },
        {
          type: "code_pattern",
          content: "High confidence regex pattern.",
          confidence: 90, // >= 85
          metadata: {
            filePaths: ["server/utils/regex.ts"],
          },
        },
      ],
    };

    vi.spyOn(systemAiService, "generateJson")
      .mockResolvedValueOnce(mockCompaction) // first call: compactSession LLM extraction
      .mockResolvedValueOnce({               // second call: createQuestion LLM generation
        questionText: "What is the correct regex ordering pattern for this codebase?",
        proposedAnswer: "Order regex alternations from longest to shortest to avoid greedy prefix matches.",
      });

    await agentMemoryAcrossMissionsService.compactSession(run1Id, job1Id, org1Id);

    // Verify low-confidence entry generated a question
    const pendingQuestions = await db
      .select()
      .from(knowledgeBaseQuestions)
      .where(eq(knowledgeBaseQuestions.organizationId, org1Id));

    expect(pendingQuestions.length).toBe(1);
    expect(pendingQuestions[0].triggerSource).toBe("low_confidence_compaction");

    // Verify high-confidence entry was stored directly in Knowledge Graph
    const storedGraph = await db
      .select()
      .from(agentKnowledgeGraphEntries)
      .where(eq(agentKnowledgeGraphEntries.organizationId, org1Id));

    expect(storedGraph.length).toBe(1);
    expect(storedGraph[0].confidence).toBe(90);
  });

  it("should trigger memory_contradiction question on successful run contradictions", async () => {
    // Pre-populate knowledge entry
    const [entry] = await db.insert(agentKnowledgeGraphEntries).values({
      organizationId: org1Id,
      agentId: job1Id.toString(),
      repositoryId: "my-test-repo-2",
      type: "code_pattern",
      content: "Use import type to import models.",
      confidence: 100,
      metadata: {
        filePaths: ["server/models/user.ts"],
      },
    }).returning();

    const mockAuditResult = {
      assessments: [
        {
          id: entry.id,
          usage: "contradicted",
        },
      ],
    };

    vi.spyOn(systemAiService, "generateJson")
      .mockResolvedValueOnce(mockAuditResult) // first call: recordMemoryUtilization audit
      .mockResolvedValueOnce({                // second call: createQuestion LLM generation
        questionText: "Is 'import type' required when importing the user model?",
        proposedAnswer: "Yes, use 'import type' for all type-only imports to enforce separation.",
      });

    // Run audit representing a successful execution
    await agentMemoryAcrossMissionsService.recordMemoryUtilization(
      org1Id,
      [entry],
      [{ type: "action", content: "Successful import of user model directly without type keyword." }],
      true // successful run
    );

    // Verify contradiction question was triggered
    const questions = await db
      .select()
      .from(knowledgeBaseQuestions)
      .where(
        and(
          eq(knowledgeBaseQuestions.organizationId, org1Id),
          eq(knowledgeBaseQuestions.triggerSource, "memory_contradiction")
        )
      );

    expect(questions.length).toBe(1);
    expect(questions[0].contextData.conflictingPatterns).toContain("Use import type to import models.");
  });

  it("should resolve questions and create 100% confidence Knowledge Graph entries", async () => {
    const [question] = await db
      .insert(knowledgeBaseQuestions)
      .values({
        organizationId: org1Id,
        repositoryId: "my-test-repo-2",
        questionText: "Verify naming conventions.",
        status: "pending",
        triggerSource: "low_confidence_compaction",
        proposedAnswer: "Always name files with kebab-case.",
        contextData: {
          filePaths: ["server/utils/names.ts"],
        },
      })
      .returning();

    await knowledgeBaseQuestionEngineService.resolveQuestion(
      org1Id,
      question.id,
      "Always name files with kebab-case.",
      "dev-admin",
      "approve"
    );

    // Check question status
    const [updatedQ] = await db
      .select()
      .from(knowledgeBaseQuestions)
      .where(eq(knowledgeBaseQuestions.id, question.id))
      .limit(1);

    expect(updatedQ.status).toBe("answered");
    expect(updatedQ.answerText).toBe("Always name files with kebab-case.");

    // Check Knowledge Graph has verified 100% confidence entry
    const entries = await db
      .select()
      .from(agentKnowledgeGraphEntries)
      .where(
        and(
          eq(agentKnowledgeGraphEntries.organizationId, org1Id),
          eq(agentKnowledgeGraphEntries.repositoryId, "my-test-repo-2")
        )
      );

    expect(entries.length).toBe(1);
    expect(entries[0].confidence).toBe(100);
    expect(entries[0].content).toBe("Always name files with kebab-case.");
  });
});
