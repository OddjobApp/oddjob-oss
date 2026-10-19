import { createHash } from "node:crypto";
import { createLogger } from "../../../utils/logger.js";
import { db } from "../../../database_service.js";
import { agentKnowledgeGraphEntries, missionRuns, missions, jobs, agentRunSteps } from "@shared/schema/index.js";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { getEmbeddings } from "@domain/knowledge/core/rag-langchain.service.js";
import {
  searchQdrant,
  upsertQdrantPoints,
  ensureQdrantCollection,
  deleteQdrantByFilter,
} from "@server/integrations/qdrant-client.js";
import { extractReferences } from "./context-injection/reference-extractor.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";

const logger = createLogger("AgentMemoryAcrossMissionsService");

const COLLECTION_NAME = "agent_knowledge_graph";

export interface OrgMemoryPolicy {
  retentionPeriodDays: number;
  maxEntriesPerRepo: number;
  compactionModel: string;
}

export class AgentMemoryAcrossMissionsService {
  /**
   * Initializes the Qdrant collection for Agent Knowledge Graph memories.
   */
  async initializeGraph(): Promise<void> {
    try {
      const embeddings = getEmbeddings();
      const testVector = await embeddings.embedQuery("initialization");
      await ensureQdrantCollection(COLLECTION_NAME, testVector.length);
      logger.info(`[AgentMemoryKG] Initialized vector collection: ${COLLECTION_NAME} with dimension ${testVector.length}`);
    } catch (error: any) {
      logger.error(`[AgentMemoryKG] Failed to initialize vector collection: ${error.message}`);
    }
  }

  /**
   * Scopes and retrieves organization policies.
   */
  async getOrgPolicy(orgId: number): Promise<OrgMemoryPolicy> {
    return {
      retentionPeriodDays: 365,
      maxEntriesPerRepo: 10000,
      compactionModel: "copilot",
    };
  }

  /**
   * Helper to resolve the Repository ID from a mission.
   */
  resolveRepositoryId(mission: any): string {
    const vcsConfig = mission?.vcsConfig as any;
    if (vcsConfig?.remote) {
      return vcsConfig.remote;
    }
    if (mission?.workspacePath) {
      return mission.workspacePath;
    }
    return "default-repo";
  }

  /**
   * Stores a single Knowledge Graph entry, checking for semantic overlap and merging.
   */
  async storeEntry(
    organizationId: number,
    agentId: string,
    repositoryId: string,
    type: string,
    content: string,
    confidence: number = 100,
    metadata: Record<string, any> = {}
  ): Promise<number> {
    logger.info(`[AgentMemoryKG] Storing entry for Agent ${agentId}, Repo ${repositoryId}, Type ${type}`);

    // Generate embedding
    const embeddings = getEmbeddings();
    const vector = await embeddings.embedQuery(content);

    // Ensure the collection is initialized
    await this.initializeGraph();

    // Check for semantic overlap of similar type in Qdrant
    const similarityThreshold = 0.85;
    const searchResults = await searchQdrant(vector, {
      limit: 1,
      collection: COLLECTION_NAME,
      filter: {
        must: [
          { key: "organizationId", match: { value: organizationId } },
          { key: "agentId", match: { value: agentId } },
          { key: "repositoryId", match: { value: repositoryId } },
          { key: "type", match: { value: type } },
        ],
      },
    });

    if (searchResults.length > 0 && searchResults[0].score >= similarityThreshold) {
      const existingId = Number(searchResults[0].id);
      const [existing] = await db
        .select()
        .from(agentKnowledgeGraphEntries)
        .where(eq(agentKnowledgeGraphEntries.id, existingId))
        .limit(1);

      if (existing) {
        logger.info(`[AgentMemoryKG] Overlapping memory found (ID: ${existing.id}, score: ${searchResults[0].score}). Merging...`);

        // Perform merge logic: combine metadata lists, boost confidence, update timestamps
        const mergedFilePaths = Array.from(
          new Set([...(existing.metadata?.filePaths || []), ...(metadata.filePaths || [])])
        );
        const mergedModuleNames = Array.from(
          new Set([...(existing.metadata?.moduleNames || []), ...(metadata.moduleNames || [])])
        );
        const mergedTechKeywords = Array.from(
          new Set([...(existing.metadata?.techKeywords || []), ...(metadata.techKeywords || [])])
        );

        const updatedMetadata = {
          ...existing.metadata,
          ...metadata,
          filePaths: mergedFilePaths,
          moduleNames: mergedModuleNames,
          techKeywords: mergedTechKeywords,
        };

        const newConfidence = Math.min(100, Math.max(existing.confidence, confidence) + 5);

        await db
          .update(agentKnowledgeGraphEntries)
          .set({
            confidence: newConfidence,
            metadata: updatedMetadata,
            updatedAt: new Date(),
          })
          .where(eq(agentKnowledgeGraphEntries.id, existing.id));

        // Update Qdrant vector payload
        await upsertQdrantPoints(
          [
            {
              id: existing.id,
              vector,
              payload: {
                organizationId,
                agentId,
                repositoryId,
                type,
                content,
                confidence: newConfidence,
                metadata: updatedMetadata,
                updatedAt: new Date().toISOString(),
              },
            },
          ],
          COLLECTION_NAME
        );

        return existing.id;
      }
    }

    // Insert new entry in database
    const [inserted] = await db
      .insert(agentKnowledgeGraphEntries)
      .values({
        organizationId,
        agentId,
        repositoryId,
        type,
        content,
        confidence,
        metadata,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Upsert new entry to Qdrant
    await upsertQdrantPoints(
      [
        {
          id: inserted.id,
          vector,
          payload: {
            organizationId,
            agentId,
            repositoryId,
            type,
            content,
            confidence,
            metadata,
            updatedAt: new Date().toISOString(),
          },
        },
      ],
      COLLECTION_NAME
    );

    logger.info(`[AgentMemoryKG] Created new memory entry ${inserted.id}`);
    return inserted.id;
  }

  /**
   * Runs session memory compaction at the end of a mission run.
   */
  async compactSession(
    missionRunId: number,
    backingJobId: number,
    organizationId: number
  ): Promise<void> {
    logger.info(`[AgentMemoryKG] Compacting session for Run ${missionRunId}, backing job ${backingJobId}`);

    try {
      // Validate agent belongs to organization
      const [job] = await db.select().from(jobs).where(eq(jobs.id, backingJobId)).limit(1);
      if (!job || job.organizationId !== organizationId) {
        logger.warn(`[AgentMemoryKG] Security alert: cross-org attempt detected for agent ${backingJobId} in org ${organizationId}`);
        throw new Error("403 Forbidden: Cross-organization access denied");
      }

      // Fetch mission run details
      const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
      if (!run || !run.missionId) {
        logger.warn(`[AgentMemoryKG] Run ${missionRunId} does not exist or has no missionId`);
        return;
      }

      const [mission] = await db.select().from(missions).where(eq(missions.id, run.missionId)).limit(1);
      if (!mission) {
        logger.warn(`[AgentMemoryKG] Mission ${run.missionId} not found`);
        return;
      }

      const repositoryId = this.resolveRepositoryId(mission);

      // Fetch steps history from agent_run_steps
      const steps = await db
        .select()
        .from(agentRunSteps)
        .where(eq(agentRunSteps.missionRunId, missionRunId))
        .orderBy(agentRunSteps.createdAt);

      let formattedSteps = "";
      if (steps.length > 0) {
        formattedSteps = steps
          .map((s) => {
            const time = s.createdAt ? new Date(s.createdAt).toISOString() : "unknown";
            return `[${time}] ${s.type.toUpperCase()}: ${s.content} ${
              s.toolName ? `(Tool: ${s.toolName}, Args: ${JSON.stringify(s.toolArgs)})` : ""
            }`;
          })
          .join("\n");
      } else {
        // Fallback to dynamicTrace
        const trace = (run.dynamicTrace as any[]) || [];
        formattedSteps = trace
          .map((t) => `[${t.event || "event"}] ${t.note || JSON.stringify(t)}`)
          .join("\n");
      }

      // Resolve LLM model configuration
      const policy = await this.getOrgPolicy(organizationId);
      const aiConfig = await systemAiService.getAiConfig(
        policy.compactionModel as any,
        organizationId
      ) || { provider: "google", model: "gemini-1.5-pro" };

      const isCompleted = run.status === "completed" || run.isSuccess === true;

      const prompt = `You are a Senior Project Memory Synthesizer. Analyze the execution log and steps of a completed coding mission to distill key learnings.

MISSION CONTEXT:
Objective: ${mission.objective || run.name}
Status: ${isCompleted ? "SUCCESS" : "FAILURE"}
Failure Reason: ${run.failureReason || "N/A"}

EXECUTION LOG STEPS:
${formattedSteps.substring(0, 20000)}

TASK:
Identify and extract key architectural decisions, code patterns, project conventions, dependency details, and failures (lessons learned) from this mission.
Return a JSON object containing an "entries" array of extracted knowledge graph entries.

EACH ENTRY MUST MATCH THIS STRUCTURE:
{
  "type": "code_pattern" | "architectural_decision" | "project_convention" | "dependency_note" | "lesson_learned",
  "content": "A concise description of the finding or lesson. For patterns/lessons, be concrete and refer to specific file changes/methods.",
  "confidence": 100, // 0-100 score representing how verified this pattern or lesson is (defaults to 100 for successful runs, or lower 70-80 for partial/failures)
  "metadata": {
    "filePaths": ["relative/path/to/file.ts"], // files modified or referenced
    "moduleNames": ["module_name"],
    "techKeywords": ["keyword1", "keyword2"],
    "codeSnippet": "...", // Only for code_pattern if a specific code pattern/boilerplate was established
    "failureMode": "...", // Only for lesson_learned: what failed (e.g., a regex pattern matched greedily)
    "rootCause": "...", // Only for lesson_learned: why did it fail
    "resolution": "...", // Only for lesson_learned: how was it fixed
    "errorCategory": "test_failure" | "build_error" | "lint_violation" | "merge_conflict" | "timeout" | "tool_misuse" // Only for lesson_learned
  }
}

Return ONLY valid JSON.`;

      logger.info(`[AgentMemoryKG] Requesting LLM compaction for run ${missionRunId}`);
      const response = await systemAiService.generateJson(prompt, policy.compactionModel as any);
      if (!response || !Array.isArray(response.entries)) {
        logger.warn(`[AgentMemoryKG] LLM returned empty or invalid json compaction result`);
        return;
      }

      logger.info(`[AgentMemoryKG] LLM extracted ${response.entries.length} memories`);

      for (const rawEntry of response.entries) {
        if (!rawEntry.type || !rawEntry.content) continue;
        const entryMetadata = rawEntry.metadata || {};
        entryMetadata.sourceMissionId = run.missionId;
        entryMetadata.sourceMissionRunId = missionRunId;
        entryMetadata.jobId = backingJobId;

        const confidence = rawEntry.confidence || 100;

        if (confidence < 85) {
          const { knowledgeBaseQuestionEngineService } = await import("./knowledge-base-question-engine.service.js");
          await knowledgeBaseQuestionEngineService.createQuestion(
            organizationId,
            repositoryId,
            "low_confidence_compaction",
            {
              filePaths: entryMetadata.filePaths || [],
              errorCategory: entryMetadata.errorCategory || undefined,
              missionRunId,
              jobId: backingJobId,
              compactionEntry: {
                type: rawEntry.type,
                content: rawEntry.content,
                confidence,
              }
            }
          );
        } else {
          await this.storeEntry(
            organizationId,
            backingJobId.toString(),
            repositoryId,
            rawEntry.type,
            rawEntry.content,
            confidence,
            entryMetadata
          );
        }
      }

      // Enforce total count limit pruning
      await this.pruneLowRelevanceEntries(organizationId, backingJobId.toString(), repositoryId, policy.maxEntriesPerRepo);

      // Run decay relevance cycle on lesson entries
      await this.decayRelevance(organizationId, repositoryId);

    } catch (error: any) {
      logger.error(`[AgentMemoryKG] Session compaction failed for run ${missionRunId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Recalls relevant general patterns and failure warning lessons.
   */
  async recallPriorKnowledge(
    organizationId: number,
    agentId: string,
    repositoryId: string,
    implementationPlan: string | object,
    maxPatterns: number = 5,
    maxLessons: number = 3,
    tokenBudget: number = 2000
  ): Promise<{ formattedMemoryContext: string; patterns: any[]; lessons: any[] }> {
    logger.info(`[AgentMemoryKG] Recalling prior knowledge for Agent ${agentId}, Repo ${repositoryId}`);

    // Validate agent belongs to organization
    const jobId = parseInt(agentId, 10);
    if (!isNaN(jobId)) {
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
      if (job && job.organizationId !== organizationId) {
        logger.warn(`[AgentMemoryKG] Security alert: cross-org recall attempt for agent ${agentId} inside organization ${organizationId}`);
        throw new Error("403 Forbidden: Cross-organization access denied");
      }
    }

    const planRefs = extractReferences(implementationPlan);
    const planText = typeof implementationPlan === "string" ? implementationPlan : JSON.stringify(implementationPlan);

    // Fetch all database entries for candidate comparisons
    const dbEntries = await db
      .select()
      .from(agentKnowledgeGraphEntries)
      .where(
        and(
          eq(agentKnowledgeGraphEntries.organizationId, organizationId),
          eq(agentKnowledgeGraphEntries.agentId, agentId),
          eq(agentKnowledgeGraphEntries.repositoryId, repositoryId)
        )
      );

    if (dbEntries.length === 0) {
      logger.info("[AgentMemoryKG] No memory entries exist in the database for this agent/repo pair.");
      return { formattedMemoryContext: "", patterns: [], lessons: [] };
    }

    // Generate plan embedding
    const embeddings = getEmbeddings();
    let planVector: number[] = [];
    try {
      planVector = await embeddings.embedQuery(planText);
    } catch (err) {
      logger.error("[AgentMemoryKG] Failed to generate embedding for plan:", err);
    }

    // Retrieve semantic similarities from Qdrant
    const semanticScoresMap = new Map<number, number>();
    if (planVector.length > 0) {
      try {
        const qdrantResults = await searchQdrant(planVector, {
          limit: 100,
          collection: COLLECTION_NAME,
          filter: {
            must: [
              { key: "organizationId", match: { value: organizationId } },
              { key: "agentId", match: { value: agentId } },
              { key: "repositoryId", match: { value: repositoryId } },
            ],
          },
        });
        for (const hit of qdrantResults) {
          semanticScoresMap.set(Number(hit.id), hit.score);
        }
      } catch (err: any) {
        logger.warn(`[AgentMemoryKG] Qdrant search failed (falling back to exact matches only): ${err.message}`);
      }
    }

    const now = new Date();
    const scoredEntries = dbEntries.map((entry) => {
      const similarity = semanticScoresMap.get(entry.id) || 0;

      // Calculate recency
      const ageDays = (now.getTime() - new Date(entry.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
      const recency = Math.exp(-ageDays / 30);

      // Exact matches boost (priority match for plan files and symbols)
      let exactMatchBoost = 0;
      const planFilesSet = new Set(planRefs.filePaths);
      const entryFiles = entry.metadata?.filePaths || [];
      for (const f of entryFiles) {
        const basename = f.split("/").pop() || f;
        if (planFilesSet.has(f) || planText.includes(f) || planText.includes(basename)) {
          exactMatchBoost = 0.5; // strong priority boost
          break;
        }
      }

      if (exactMatchBoost === 0) {
        const planModulesSet = new Set(planRefs.moduleNames);
        const entryModules = entry.metadata?.moduleNames || [];
        for (const m of entryModules) {
          if (planModulesSet.has(m) || planText.includes(m)) {
            exactMatchBoost = 0.3;
            break;
          }
        }
      }

      const rawScore = 0.5 * similarity + 0.3 * (entry.confidence / 100) + 0.2 * recency;
      const score = rawScore + exactMatchBoost;

      return { entry, score, isExactMatch: exactMatchBoost > 0 };
    });

    // Sort by score descending
    scoredEntries.sort((a, b) => b.score - a.score);

    // Separate general patterns and lessons
    const patternsCandidates = scoredEntries.filter((e) => e.entry.type !== "lesson_learned");
    const lessonsCandidates = scoredEntries.filter(
      (e) => e.entry.type === "lesson_learned" && (e.isExactMatch || e.score >= 0.5)
    );

    const recalledPatterns = patternsCandidates.slice(0, maxPatterns).map((c) => c.entry);
    const recalledLessons = lessonsCandidates.slice(0, maxLessons).map((c) => c.entry);

    // Track page hits and update access statistics
    const recalledIds = [...recalledPatterns, ...recalledLessons].map((e) => e.id);
    if (recalledIds.length > 0) {
      await db
        .update(agentKnowledgeGraphEntries)
        .set({
          accessCount: sql`access_count + 1`,
          lastAccessed: new Date(),
        })
        .where(inArray(agentKnowledgeGraphEntries.id, recalledIds));
    }

    // Format & budget logic (approx. 4 chars per token)
    const charBudget = tokenBudget * 4;
    let formattedContext = "\n=== PRIOR KNOWLEDGE FROM PREVIOUS MISSIONS ===\n";
    formattedContext += "The following relevant patterns, decisions, and lessons learned from past runs in this repository have been retrieved to help you:\n\n";

    let addedEntriesCount = 0;

    if (recalledPatterns.length > 0) {
      let patternsSection = "## General Code Patterns & Project Conventions\n";
      for (const entry of recalledPatterns) {
        const ageDays = Math.floor((Date.now() - new Date(entry.updatedAt).getTime()) / (1000 * 60 * 60 * 24));
        let entryText = `### [${entry.type.toUpperCase()}] (Confidence: ${entry.confidence}%, Age: ${ageDays} days ago)\n`;
        entryText += `${entry.content}\n`;
        if (entry.metadata?.filePaths?.length) {
          entryText += `Associated Files: ${entry.metadata.filePaths.join(", ")}\n`;
        }
        if (entry.metadata?.codeSnippet) {
          entryText += `Example Code:\n\`\`\`\n${entry.metadata.codeSnippet}\n\`\`\`\n`;
        }
        entryText += "\n";

        if (formattedContext.length + patternsSection.length + entryText.length > charBudget) {
          break;
        }
        patternsSection += entryText;
        addedEntriesCount++;
      }
      if (addedEntriesCount > 0) {
        formattedContext += patternsSection;
      }
    }

    let addedLessonsCount = 0;
    if (recalledLessons.length > 0) {
      let lessonsSection = "## Lessons Learned & Failures (WARNINGS)\n";
      lessonsSection += "⚠️ Pay close attention to these known errors or pitfalls encountered previously in related files:\n\n";
      for (const entry of recalledLessons) {
        const ageDays = Math.floor((Date.now() - new Date(entry.updatedAt).getTime()) / (1000 * 60 * 60 * 24));
        let entryText = `### WARNING: ${entry.metadata?.failureMode || "Known Issue"} (Category: ${entry.metadata?.errorCategory || "general"}, Confidence: ${entry.confidence}%, Age: ${ageDays} days ago)\n`;
        entryText += `Description: ${entry.content}\n`;
        if (entry.metadata?.rootCause) {
          entryText += `Root Cause: ${entry.metadata.rootCause}\n`;
        }
        if (entry.metadata?.resolution) {
          entryText += `Successful Resolution: ${entry.metadata.resolution}\n`;
        }
        if (entry.metadata?.filePaths?.length) {
          entryText += `Associated Files: ${entry.metadata.filePaths.join(", ")}\n`;
        }
        entryText += "\n";

        if (formattedContext.length + lessonsSection.length + entryText.length > charBudget) {
          break;
        }
        lessonsSection += entryText;
        addedLessonsCount++;
      }
      if (addedLessonsCount > 0) {
        formattedContext += lessonsSection;
      }
    }

    formattedContext += "===============================================\n";

    const finalFormattedString = (addedEntriesCount > 0 || addedLessonsCount > 0) ? formattedContext : "";

    return {
      formattedMemoryContext: finalFormattedString,
      patterns: recalledPatterns,
      lessons: recalledLessons,
    };
  }

  /**
   * Refines relevance/confidence score of lessons based on active missions.
   * If a Lesson_Entry has not been relevant in the last 20 missions, decays its confidence.
   */
  async decayRelevance(organizationId: number, repositoryId: string): Promise<void> {
    logger.info(`[AgentMemoryKG] Running decay relevance cycle for repository ${repositoryId}`);

    try {
      // Find all lessons for this repository
      const lessons = await db
        .select()
        .from(agentKnowledgeGraphEntries)
        .where(
          and(
            eq(agentKnowledgeGraphEntries.organizationId, organizationId),
            eq(agentKnowledgeGraphEntries.repositoryId, repositoryId),
            eq(agentKnowledgeGraphEntries.type, "lesson_learned")
          )
        );

      for (const lesson of lessons) {
        // Count how many mission runs have occurred for this repository since the lesson was last accessed/modified
        const [runCountObj] = await db
          .select({ count: sql<number>`count(*)` })
          .from(missionRuns)
          .leftJoin(missions, eq(missionRuns.missionId, missions.id))
          .where(
            and(
              eq(missions.organizationId, organizationId),
              sql`(${missions.workspacePath} = ${repositoryId} OR ${missions.vcsConfig}->>'remote' = ${repositoryId})`,
              sql`${missionRuns.createdAt} > ${lesson.lastAccessed}`
            )
          );

        const missionsSinceLastUse = runCountObj?.count || 0;

        if (missionsSinceLastUse >= 20) {
          const decayedConfidence = Math.max(0, lesson.confidence - 10);
          logger.info(`[AgentMemoryKG] Decaying lesson ${lesson.id} confidence to ${decayedConfidence} (inactive for ${missionsSinceLastUse} missions)`);

          if (decayedConfidence <= 30) {
            // Archive the entry (change type to archived_lesson_learned)
            await db
              .update(agentKnowledgeGraphEntries)
              .set({
                confidence: decayedConfidence,
                type: "archived_lesson_learned",
                updatedAt: new Date(),
              })
              .where(eq(agentKnowledgeGraphEntries.id, lesson.id));
            logger.info(`[AgentMemoryKG] Archived lesson ${lesson.id} due to low confidence`);
          } else {
            await db
              .update(agentKnowledgeGraphEntries)
              .set({
                confidence: decayedConfidence,
                updatedAt: new Date(),
              })
              .where(eq(agentKnowledgeGraphEntries.id, lesson.id));
          }
        }
      }
    } catch (err: any) {
      logger.error(`[AgentMemoryKG] Decay relevance failed: ${err.message}`);
    }
  }

  /**
   * Enforces the maximum size policy by pruning low-relevance entries.
   */
  private async pruneLowRelevanceEntries(
    organizationId: number,
    agentId: string,
    repositoryId: string,
    maxLimit: number
  ): Promise<void> {
    try {
      const dbEntries = await db
        .select()
        .from(agentKnowledgeGraphEntries)
        .where(
          and(
            eq(agentKnowledgeGraphEntries.organizationId, organizationId),
            eq(agentKnowledgeGraphEntries.agentId, agentId),
            eq(agentKnowledgeGraphEntries.repositoryId, repositoryId)
          )
        );

      if (dbEntries.length <= maxLimit) return;

      logger.info(`[AgentMemoryKG] Graph size ${dbEntries.length} exceeds limit ${maxLimit}. Pruning...`);

      // Calculate score for pruning: confidence * 0.4 + accessCount * 0.4 + normalizedRecency * 0.2
      const now = Date.now();
      const scored = dbEntries.map((e) => {
        const ageDays = (now - new Date(e.lastAccessed).getTime()) / (1000 * 60 * 60 * 24);
        const recency = Math.exp(-ageDays / 30);
        const score = e.confidence * 0.4 + e.accessCount * 0.4 + recency * 20;
        return { id: e.id, score };
      });

      // Sort by score ascending (lowest relevance first)
      scored.sort((a, b) => a.score - b.score);
      const toDeleteCount = dbEntries.length - maxLimit;
      const idsToDelete = scored.slice(0, toDeleteCount).map((s) => s.id);

      if (idsToDelete.length > 0) {
        // Delete from Postgres
        await db
          .delete(agentKnowledgeGraphEntries)
          .where(inArray(agentKnowledgeGraphEntries.id, idsToDelete));

        // Delete from Qdrant vector database
        try {
          const { QdrantClient } = await import("@qdrant/js-client-rest");
          const client = new QdrantClient({
            url: process.env.QDRANT_URL || "http://localhost:6333",
            apiKey: process.env.QDRANT_API_KEY,
            checkCompatibility: false,
          });
          await client.delete(COLLECTION_NAME, { points: idsToDelete });
        } catch (qdrantErr: any) {
          logger.warn(`[AgentMemoryKG] Qdrant points delete failed during pruning: ${qdrantErr.message}`);
        }

        logger.info(`[AgentMemoryKG] Successfully pruned ${idsToDelete.length} low-relevance memories`);
      }
    } catch (err: any) {
      logger.error(`[AgentMemoryKG] Pruning failed: ${err.message}`);
    }
  }

  /**
   * Deletes all memories when an organization is deactivated.
   */
  async purgeOrganizationMemory(organizationId: number): Promise<void> {
    logger.info(`[AgentMemoryKG] Purging all memory for organization ${organizationId}`);

    try {
      // 1. Delete from PostgreSQL
      await db
        .delete(agentKnowledgeGraphEntries)
        .where(eq(agentKnowledgeGraphEntries.organizationId, organizationId));

      // 2. Delete from Qdrant
      await deleteQdrantByFilter(
        {
          must: [
            {
              key: "organizationId",
              match: { value: organizationId },
            },
          ],
        },
        COLLECTION_NAME
      );

      logger.info(`[AgentMemoryKG] Purge complete for organization ${organizationId}`);
    } catch (error: any) {
      logger.error(`[AgentMemoryKG] Purging organization ${organizationId} failed: ${error.message}`);
    }
  }

  /**
   * Records memory utilization after a mission run. Audits agent history to check if recalled entries
   * were referenced or contradicted, adjusting confidence scores accordingly.
   */
  async recordMemoryUtilization(
    organizationId: number,
    recalledEntries: any[],
    history: any[],
    runSuccess: boolean
  ): Promise<void> {
    if (!recalledEntries || recalledEntries.length === 0) return;

    logger.info(`[AgentMemoryKG] Recording memory utilization for ${recalledEntries.length} entries`);

    try {
      const formattedHistory = history
        .map((s) => `[${s.type.toUpperCase()}] ${s.content}`)
        .join("\n");

      const formattedEntries = recalledEntries
        .map((e) => `[ID: ${e.id}] [Type: ${e.type}] ${e.content}`)
        .join("\n");

      const policy = await this.getOrgPolicy(organizationId);
      const aiConfig = await systemAiService.getAiConfig(
        policy.compactionModel as any,
        organizationId
      ) || { provider: "google", model: "gemini-1.5-pro" };

      const prompt = `You are an AI Memory Auditor. Analyze the agent's execution history and determine if they utilized, referenced, contradicted, or successfully adhered to the prior knowledge entries provided to them.

PRIOR KNOWLEDGE PROVIDED:
${formattedEntries}

AGENT EXECUTION HISTORY:
${formattedHistory.substring(0, 15000)}

MISSION SUCCESS: ${runSuccess ? "YES" : "NO"}

TASK:
For each prior knowledge entry, assess the agent's usage and return a JSON object with:
{
  "assessments": [
    {
      "id": 123,
      "usage": "referenced" | "contradicted" | "adhered_avoided" | "ignored"
    }
  ]
}

- "referenced": Agent explicitly used/copied/implemented the pattern/convention.
- "contradicted": Agent did something directly opposite to the pattern/convention or ignored warning.
- "adhered_avoided": Agent successfully followed the warning (e.g. avoided a known pitfall).
- "ignored": Entry was not relevant to the final actions taken.

Return ONLY valid JSON.`;

      const response = await systemAiService.generateJson(prompt, policy.compactionModel as any);
      if (response && Array.isArray(response.assessments)) {
        for (const item of response.assessments) {
          const entryId = Number(item.id);
          const usage = item.usage;

          const [existing] = await db
            .select()
            .from(agentKnowledgeGraphEntries)
            .where(eq(agentKnowledgeGraphEntries.id, entryId))
            .limit(1);

          if (existing) {
            let confidenceModifier = 0;
            if (usage === "referenced") {
              confidenceModifier = 5;
            } else if (usage === "contradicted") {
              confidenceModifier = -10;
              if (runSuccess) {
                const { knowledgeBaseQuestionEngineService } = await import("./knowledge-base-question-engine.service.js");
                await knowledgeBaseQuestionEngineService.createQuestion(
                  organizationId,
                  existing.repositoryId,
                  "memory_contradiction",
                  {
                    filePaths: existing.metadata?.filePaths || [],
                    conflictingPatterns: [existing.content],
                    jobId: isNaN(parseInt(existing.agentId, 10)) ? undefined : parseInt(existing.agentId, 10),
                    originalPattern: existing.content,
                    patternId: existing.id
                  }
                ).catch(e => logger.warn(`Failed to create contradiction question: ${e.message}`));
              }
            } else if (usage === "adhered_avoided" && existing.type === "lesson_learned") {
              confidenceModifier = 10;
            }

            if (confidenceModifier !== 0) {
              const newConfidence = Math.min(100, Math.max(0, existing.confidence + confidenceModifier));
              logger.info(`[AgentMemoryKG] Adjusting confidence of memory ${entryId} by ${confidenceModifier} (new: ${newConfidence}) due to ${usage}`);
              await db
                .update(agentKnowledgeGraphEntries)
                .set({
                  confidence: newConfidence,
                  updatedAt: new Date(),
                })
                .where(eq(agentKnowledgeGraphEntries.id, entryId));
            }
          }
        }
      }
    } catch (err: any) {
      logger.error(`[AgentMemoryKG] Failed to record memory utilization: ${err.message}`);
    }
  }
}

export const agentMemoryAcrossMissionsService = new AgentMemoryAcrossMissionsService();

