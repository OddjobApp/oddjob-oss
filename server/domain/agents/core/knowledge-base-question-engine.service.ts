import { db } from "@server/database_service.js";
import { eq, and, ne, sql, desc, asc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import {
  knowledgeBaseQuestions,
  agentKnowledgeGraphEntries,
  orgs,
  missionRuns,
  missions,
  agentRunSteps,
} from "@shared/schema/index.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { agentMemoryAcrossMissionsService } from "./agent-memory-across-missions.service.js";
import { extractReferences } from "./context-injection/reference-extractor.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import type { BriefingItem, TechDebtCard, TechDebtQuery } from "./kb-extensions/types.js";
import { computeJaccardSimilarity } from "./kb-extensions/keyword-similarity.js";

const logger = createLogger("KnowledgeBaseQuestionEngineService");

// Per-org daily question cap. Prevents a broken build loop or a mass-ingestion
// event from flooding the review queue.
const DAILY_QUESTION_CAP = 50;

// Preferred Slack channel for KB review notifications. Falls back to the first
// available channel if this name is not found in the workspace.
const SLACK_REVIEW_CHANNEL = "knowledge-review";

export interface QuestionContext {
  filePaths?: string[];
  errorCategory?: string;
  conflictingPatterns?: string[];
  missionRunId?: number;
  jobId?: number;
  // Extension fields for rescue_pattern_detected
  strategy?: string;
  jobType?: string;
  count?: number;
  missionRunIds?: number[];
  // Extension fields for hil_pattern_detected
  tool?: string;
  parameterKeys?: string[];
  approvalCount?: number;
  sampleParams?: Record<string, any>;
  // Extension fields for cross_repo_propagation
  sourceQuestionId?: number;
  sourceRepositoryId?: string;
  sourceAnswer?: string;
  matchReason?: string;
  [key: string]: any;
}

export class KnowledgeBaseQuestionEngineService {
  private static instance: KnowledgeBaseQuestionEngineService;

  private constructor() {}

  static getInstance(): KnowledgeBaseQuestionEngineService {
    if (!KnowledgeBaseQuestionEngineService.instance) {
      KnowledgeBaseQuestionEngineService.instance = new KnowledgeBaseQuestionEngineService();
    }
    return KnowledgeBaseQuestionEngineService.instance;
  }

  /**
   * Automatically creates a pending question in the queue based on trigger signals.
   */
  async createQuestion(
    organizationId: number,
    repositoryId: string,
    triggerSource: "predictive_failure" | "memory_contradiction" | "low_confidence_compaction" | "rescue_pattern_detected" | "hil_pattern_detected" | "cross_repo_propagation",
    contextData: QuestionContext
  ): Promise<number | null> {
    logger.info(`[KBQuestionEngine] Creating question for Repo ${repositoryId}, Source ${triggerSource}`);

    // Validate organization
    const [org] = await db.select().from(orgs).where(eq(orgs.id, organizationId)).limit(1);
    if (!org) {
      logger.warn(`[KBQuestionEngine] Invalid organization: ${organizationId}`);
      return null;
    }

    // Daily cap — prevents a broken build loop or mass-ingestion event from
    // flooding the review queue. Counter resets automatically after 24 h.
    try {
      const dailyKey = `kb_questions_today:${organizationId}`;
      const count = await redis.incr(dailyKey);
      if (count === 1) {
        // Set TTL only on the first increment so it resets in 24 h.
        await redis.expire(dailyKey, 86400);
      }
      if (count > DAILY_QUESTION_CAP) {
        logger.warn(
          `[KBQuestionEngine] Daily question cap (${DAILY_QUESTION_CAP}) reached for org ${organizationId}. ` +
          `Dropping ${triggerSource} question for ${repositoryId}.`
        );
        return null;
      }
    } catch (redisErr: any) {
      // Redis unavailable — proceed without throttling rather than dropping real signals.
      logger.warn(`[KBQuestionEngine] Daily cap check failed (proceeding): ${redisErr.message}`);
    }

    // Check for duplicates (existing pending question for the same source/files)
    const filePaths = contextData.filePaths || [];
    const existing = await db
      .select()
      .from(knowledgeBaseQuestions)
      .where(
        and(
          eq(knowledgeBaseQuestions.organizationId, organizationId),
          eq(knowledgeBaseQuestions.repositoryId, repositoryId),
          eq(knowledgeBaseQuestions.triggerSource, triggerSource),
          eq(knowledgeBaseQuestions.status, "pending")
        )
      );

    // Duplicate check: if files overlap, skip creating a new question
    for (const q of existing) {
      const qFiles = q.contextData?.filePaths || [];
      if (filePaths.some((f) => qFiles.includes(f))) {
        logger.info(`[KBQuestionEngine] Skipping duplicate pending question for files: ${filePaths.join(", ")}`);
        return q.id;
      }
    }

    // Build LLM prompts
    const prompt = `You are a Senior Project Memory Synthesizer and Developer Auditor.
Analyze the following context regarding a gap or issue identified in the repository:

TRIGGER SOURCE: ${triggerSource}
CONTEXT DATA:
${JSON.stringify(contextData, null, 2)}

TASK:
1. Generate a concise, clear, and highly technical question that can be presented to a human developer to resolve this discrepancy or establish a code pattern.
2. Generate a proposed answer/resolution that represents the best practices for fixing this issue, based on the context.

Your response must be a JSON object with this exact structure:
{
  "questionText": "Your clear, developer-facing question...",
  "proposedAnswer": "Your proposed code convention or lesson resolution..."
}

Return ONLY valid JSON.`;

    try {
      const aiConfig = await systemAiService.getAiConfig("copilot", organizationId) || {
        provider: "google",
        model: "gemini-1.5-pro",
      };

      const aiResponse = await systemAiService.generateJson(prompt, aiConfig.model as any);

      if (!aiResponse || !aiResponse.questionText) {
        logger.warn("[KBQuestionEngine] AI returned invalid JSON structure for question generation");
        return null;
      }

      const [inserted] = await db
        .insert(knowledgeBaseQuestions)
        .values({
          organizationId,
          repositoryId,
          questionText: aiResponse.questionText,
          status: "pending",
          triggerSource,
          contextData,
          proposedAnswer: aiResponse.proposedAnswer || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      logger.info(`[KBQuestionEngine] Generated question ${inserted.id} successfully`);

      // Fan out a Slack notification so the team is proactively alerted
      // rather than waiting for a developer to check the questions UI.
      this.notifySlack(organizationId, inserted.id, aiResponse.questionText, triggerSource, contextData).catch(() => {});

      return inserted.id;
    } catch (error: any) {
      logger.error(`[KBQuestionEngine] Failed to generate question: ${error.message}`);
      return null;
    }
  }

  /**
   * Retrieves pending questions for a repository under an organization.
   */
  async listQuestions(organizationId: number, repositoryId: string): Promise<any[]> {
    return db
      .select()
      .from(knowledgeBaseQuestions)
      .where(
        and(
          eq(knowledgeBaseQuestions.organizationId, organizationId),
          eq(knowledgeBaseQuestions.repositoryId, repositoryId),
          eq(knowledgeBaseQuestions.status, "pending")
        )
      );
  }

  /**
   * Resolves a pending question, updating its status and syncing changes to the Knowledge Graph.
   */
  async resolveQuestion(
    organizationId: number,
    questionId: number,
    answerText: string,
    answeredBy: string,
    action: "approve" | "edit" | "ignore"
  ): Promise<void> {
    logger.info(`[KBQuestionEngine] Resolving question ${questionId} with action ${action}`);

    const [question] = await db
      .select()
      .from(knowledgeBaseQuestions)
      .where(eq(knowledgeBaseQuestions.id, questionId))
      .limit(1);

    if (!question) {
      throw new Error(`Question ${questionId} not found`);
    }

    if (question.organizationId !== organizationId) {
      logger.warn(`[KBQuestionEngine] Security alert: cross-org resolve attempt for question ${questionId} in org ${organizationId}`);
      throw new Error("403 Forbidden: Cross-organization access denied");
    }

    if (action === "ignore") {
      await db
        .update(knowledgeBaseQuestions)
        .set({
          status: "ignored",
          answeredBy,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(knowledgeBaseQuestions.id, questionId));
      return;
    }

    const finalAnswer = action === "approve" ? (question.proposedAnswer || answerText) : answerText;

    // Determine type and metadata of entry to insert into Knowledge Graph
    const type = question.triggerSource === "predictive_failure" ? "lesson_learned" : "project_convention";
    const contextData = question.contextData as QuestionContext;
    const metadata: Record<string, any> = {
      filePaths: contextData.filePaths || [],
      errorCategory: contextData.errorCategory || undefined,
      sourceMissionId: contextData.missionRunId || undefined,
      resolvedFromQuestionId: questionId,
    };

    // Store verified learning in Knowledge Graph (100% confidence)
    const agentId = contextData.jobId ? String(contextData.jobId) : "system-audit";
    await agentMemoryAcrossMissionsService.storeEntry(
      organizationId,
      agentId,
      question.repositoryId,
      type,
      finalAnswer,
      100,
      metadata
    );

    // If memory_contradiction: prune/archive conflicting/outdated patterns
    if (question.triggerSource === "memory_contradiction" && contextData.conflictingPatterns?.length) {
      try {
        const conflictingPatterns = contextData.conflictingPatterns;
        const matchingDbEntries = await db
          .select()
          .from(agentKnowledgeGraphEntries)
          .where(
            and(
              eq(agentKnowledgeGraphEntries.organizationId, organizationId),
              eq(agentKnowledgeGraphEntries.repositoryId, question.repositoryId)
            )
          );

        const idsToPrune = matchingDbEntries
          .filter((e) => conflictingPatterns.some((cp) => e.content.toLowerCase().includes(cp.toLowerCase())))
          .map((e) => e.id);

        if (idsToPrune.length > 0) {
          logger.info(`[KBQuestionEngine] Pruning conflicting patterns: ${idsToPrune.join(", ")}`);
          // Purge from DB
          await db
            .delete(agentKnowledgeGraphEntries)
            .where(
              and(
                eq(agentKnowledgeGraphEntries.organizationId, organizationId),
                sql`${agentKnowledgeGraphEntries.id} IN (${sql.join(idsToPrune)})`
              )
            );
          
          // Purge from Qdrant
          const { deleteQdrantByFilter } = await import("@server/integrations/qdrant-client.js");
          await deleteQdrantByFilter(
            {
              must: [
                { key: "organizationId", match: { value: organizationId } },
                { key: "repositoryId", match: { value: question.repositoryId } }
              ],
              should: idsToPrune.map((id) => ({ key: "id", match: { value: id } }))
            },
            "agent_knowledge_graph"
          );
        }
      } catch (err: any) {
        logger.warn(`[KBQuestionEngine] Failed to clean up conflicting patterns: ${err.message}`);
      }
    }

    // Update question status to answered
    await db
      .update(knowledgeBaseQuestions)
      .set({
        status: "answered",
        answerText: finalAnswer,
        answeredBy,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeBaseQuestions.id, questionId));

    // Sync the verified answer into the human-facing Knowledge Graph
    // so it appears in the Knowledge Garden UI with full verification audit trail.
    try {
      const { knowledgeVerificationService } = await import("@domain/knowledge/core/knowledge-verification.service.js");
      const { knowledgeNodes } = await import("@shared/schema/index.js");

      const nodeName = `KB-Q-${questionId}: ${question.questionText.slice(0, 80)}`;
      const [existingNode] = await db
        .select()
        .from(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.name, nodeName),
            eq(knowledgeNodes.organizationId, organizationId)
          )
        )
        .limit(1);

      if (existingNode) {
        await knowledgeVerificationService.approveNode(
          existingNode.id,
          answeredBy,
          `Re-approved from resolved question ${questionId}`
        );
      } else {
        const [newNode] = await db
          .insert(knowledgeNodes)
          .values({
            name: nodeName,
            label: "Verified Convention",
            data: {
              answer: finalAnswer,
              resolvedFromQuestionId: questionId,
              triggerSource: question.triggerSource,
              filePaths: metadata.filePaths,
            },
            organizationId,
            verificationStatus: "verified",
            verifiedBy: answeredBy,
            verifiedAt: new Date(),
            confidenceScore: "1.00",
            status: "active",
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any)
          .returning();

        if (newNode) {
          await knowledgeVerificationService.approveNode(
            newNode.id,
            answeredBy,
            `Created from resolved question ${questionId}`
          );
        }
      }
    } catch (kgErr: any) {
      logger.warn(`[KBQuestionEngine] KG node sync failed: ${kgErr.message}`);
    }

    // Fire-and-forget: check sibling repos for matching pending questions
    this.propagateToSiblingRepos(organizationId, {
      id: questionId,
      repositoryId: question.repositoryId,
      questionText: question.questionText,
      contextData: question.contextData as QuestionContext,
    }, finalAnswer).catch((err) => {
      logger.warn(`[KBQuestionEngine] Cross-repo propagation fire-and-forget error: ${err.message}`);
    });
  }

  /**
   * Audits a failed run and registers a predictive failure warning if a file has recurrent failures.
   */
  async auditFailedRun(
    organizationId: number,
    repositoryId: string,
    missionRunId: number
  ): Promise<void> {
    try {
      logger.info(`[KBQuestionEngine] Auditing failed run ${missionRunId} for repo ${repositoryId}`);

      const steps = await db
        .select()
        .from(agentRunSteps)
        .where(eq(agentRunSteps.missionRunId, missionRunId));

      if (steps.length === 0) return;

      const planText = steps.map((s) => s.content).join("\n");
      const refs = extractReferences(planText);
      const filePaths = refs.filePaths;

      if (filePaths.length === 0) return;

      for (const file of filePaths) {
        // Query last 10 runs for this repository
        const recentRuns = await db
          .select({
            id: missionRuns.id,
            isSuccess: missionRuns.isSuccess,
            status: missionRuns.status,
          })
          .from(missionRuns)
          .innerJoin(missions, eq(missionRuns.missionId, missions.id))
          .where(
            and(
              eq(missions.organizationId, organizationId),
              sql`(${missions.workspacePath} = ${repositoryId} OR ${missions.vcsConfig}->>'remote' = ${repositoryId})`
            )
          )
          .orderBy(desc(missionRuns.createdAt))
          .limit(10);

        if (recentRuns.length === 0) continue;

        let failureCount = 0;
        for (const run of recentRuns) {
          const isSuccess = run.isSuccess === true || run.status === "completed";
          if (!isSuccess) {
            const runSteps = await db
              .select({ content: agentRunSteps.content })
              .from(agentRunSteps)
              .where(eq(agentRunSteps.missionRunId, run.id));

            const runText = runSteps.map((s) => s.content).join("\n");
            if (runText.includes(file)) {
              failureCount++;
            }
          }
        }

        if (failureCount >= 3) {
          // Check if there is already a verified learning in the KB for this file
          const existingKB = await db
            .select()
            .from(agentKnowledgeGraphEntries)
            .where(
              and(
                eq(agentKnowledgeGraphEntries.organizationId, organizationId),
                eq(agentKnowledgeGraphEntries.repositoryId, repositoryId)
              )
            );

          const hasVerifiedEntry = existingKB.some((e) =>
            (e.metadata?.filePaths || []).includes(file) && e.confidence >= 90
          );

          if (!hasVerifiedEntry) {
            await this.createQuestion(
              organizationId,
              repositoryId,
              "predictive_failure",
              {
                filePaths: [file],
                errorCategory: "test_failure",
                missionRunId,
                failureCount,
              }
            );
          }
        }
      }
    } catch (err: any) {
      logger.warn(`[KBQuestionEngine] Failed to audit failed run: ${err.message}`);
    }
  }

  /**
   * Returns up to 5 pending KB questions whose context file paths overlap with
   * the given mission file references, ordered by creation date ascending (oldest first).
   * Used during governance pre-flight to surface unresolved knowledge gaps.
   */
  async getPreMissionBriefing(
    organizationId: number,
    missionFilePaths: string[]
  ): Promise<BriefingItem[]> {
    if (!missionFilePaths || missionFilePaths.length === 0) {
      return [];
    }

    try {
      // Query all pending questions for this organization
      const pendingQuestions = await db
        .select()
        .from(knowledgeBaseQuestions)
        .where(
          and(
            eq(knowledgeBaseQuestions.organizationId, organizationId),
            eq(knowledgeBaseQuestions.status, "pending")
          )
        )
        .orderBy(asc(knowledgeBaseQuestions.createdAt));

      // Filter to questions whose contextData.filePaths overlap with missionFilePaths
      const matching = pendingQuestions.filter((q) => {
        const qFilePaths: string[] = (q.contextData as any)?.filePaths || [];
        return qFilePaths.some((fp) => missionFilePaths.includes(fp));
      });

      // Take at most 5 results (already sorted oldest-first from the query)
      const limited = matching.slice(0, 5);

      // Map to BriefingItem format
      const now = Date.now();
      return limited.map((q) => {
        const ageMs = now - new Date(q.createdAt).getTime();
        const ageInDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        return {
          questionId: q.id,
          questionText: q.questionText,
          triggerSource: q.triggerSource,
          ageInDays,
          filePaths: (q.contextData as any)?.filePaths || [],
        };
      });
    } catch (err: any) {
      logger.warn(`[KBQuestionEngine] Pre-mission briefing query failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Returns pending KB questions formatted as tech debt cards for sprint planning.
   * Read-only — never modifies question status.
   *
   * Priority score formula:
   *   (failureFrequency × 3) + (ageInDays × 1) + (missionReferenceCount × 2)
   *
   * Where:
   * - failureFrequency = count of failed mission runs for the same repo (last 30 days)
   * - ageInDays = days since question creation
   * - missionReferenceCount = count of all mission runs for the same repo (last 30 days)
   */
  async getTechDebtCards(query: TechDebtQuery): Promise<TechDebtCard[]> {
    const { organizationId, repositoryId, limit } = query;
    const effectiveLimit = Math.min(limit ?? 50, 50);

    logger.info(`[KBQuestionEngine] Fetching tech debt cards for org ${organizationId}${repositoryId ? ` repo ${repositoryId}` : ""}`);

    // 1. Query pending KB questions for this organization (optionally filtered by repo)
    const conditions = [
      eq(knowledgeBaseQuestions.organizationId, organizationId),
      eq(knowledgeBaseQuestions.status, "pending"),
    ];
    if (repositoryId) {
      conditions.push(eq(knowledgeBaseQuestions.repositoryId, repositoryId));
    }

    const pendingQuestions = await db
      .select()
      .from(knowledgeBaseQuestions)
      .where(and(...conditions));

    if (pendingQuestions.length === 0) {
      return [];
    }

    // 2. Compute mission run counts per repository in the last 30 days
    //    Uses a simplified heuristic: count missions for the same repository
    //    rather than checking per-file overlap (too expensive per-question).
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get unique repositoryIds from pending questions
    const repoIds = [...new Set(pendingQuestions.map((q) => q.repositoryId))];

    // Query mission runs per repository (all runs and failed runs)
    const missionRunCounts = new Map<string, { total: number; failed: number }>();

    for (const repoId of repoIds) {
      const runs = await db
        .select({
          id: missionRuns.id,
          isSuccess: missionRuns.isSuccess,
          status: missionRuns.status,
        })
        .from(missionRuns)
        .innerJoin(missions, eq(missionRuns.missionId, missions.id))
        .where(
          and(
            eq(missions.organizationId, organizationId),
            sql`(${missions.workspacePath} = ${repoId} OR ${missions.vcsConfig}->>'remote' = ${repoId})`,
            sql`${missionRuns.createdAt} > ${thirtyDaysAgo}`
          )
        );

      let failed = 0;
      for (const run of runs) {
        const isSuccess = run.isSuccess === true || run.status === "completed";
        if (!isSuccess) {
          failed++;
        }
      }

      missionRunCounts.set(repoId, { total: runs.length, failed });
    }

    // 3. Compute priority score for each question and build TechDebtCards
    const now = Date.now();
    const cards: TechDebtCard[] = pendingQuestions.map((q) => {
      const ageMs = now - new Date(q.createdAt).getTime();
      const ageInDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

      const counts = missionRunCounts.get(q.repositoryId) || { total: 0, failed: 0 };
      const failureFrequency = counts.failed;
      const missionReferenceCount = counts.total;

      const priorityScore = (failureFrequency * 3) + (ageInDays * 1) + (missionReferenceCount * 2);

      return {
        questionId: q.id,
        questionText: q.questionText,
        triggerSource: q.triggerSource,
        createdAt: q.createdAt,
        ageInDays,
        filePaths: (q.contextData as any)?.filePaths || [],
        priorityScore,
        repositoryId: q.repositoryId,
      };
    });

    // 4. Sort by priorityScore descending
    cards.sort((a, b) => b.priorityScore - a.priorityScore);

    // 5. Limit to effective limit (max 50)
    return cards.slice(0, effectiveLimit);
  }

  /**
   * Post-resolution hook: checks sibling repos for matching pending questions
   * and creates cross_repo_propagation suggestions.
   *
   * Matching criteria (minimum 1 must match):
   * - File path extension overlap (e.g., both reference .tsx files)
   * - Error category value match (exact string)
   * - Question text keyword similarity ≥ 60% (Jaccard index)
   *
   * Only checks repos DIFFERENT from the resolved question's repo, same org only.
   * Respects daily question cap. DB errors are logged and swallowed.
   */
  private async propagateToSiblingRepos(
    organizationId: number,
    resolvedQuestion: { id: number; repositoryId: string; questionText: string; contextData: QuestionContext },
    finalAnswer: string
  ): Promise<void> {
    try {
      // Query pending questions in OTHER repos within the same organization
      const pendingQuestions = await db
        .select()
        .from(knowledgeBaseQuestions)
        .where(
          and(
            eq(knowledgeBaseQuestions.organizationId, organizationId),
            eq(knowledgeBaseQuestions.status, "pending"),
            ne(knowledgeBaseQuestions.repositoryId, resolvedQuestion.repositoryId)
          )
        );

      if (pendingQuestions.length === 0) {
        return;
      }

      // Extract file extensions from the resolved question's context
      const resolvedFilePaths: string[] = resolvedQuestion.contextData?.filePaths || [];
      const resolvedExtensions = new Set(
        resolvedFilePaths
          .map((fp) => {
            const lastDot = fp.lastIndexOf(".");
            return lastDot >= 0 ? fp.slice(lastDot).toLowerCase() : "";
          })
          .filter((ext) => ext.length > 0)
      );

      const resolvedErrorCategory = resolvedQuestion.contextData?.errorCategory || "";

      for (const pendingQ of pendingQuestions) {
        const pendingContext = (pendingQ.contextData || {}) as QuestionContext;
        const pendingFilePaths: string[] = pendingContext.filePaths || [];
        const pendingErrorCategory = pendingContext.errorCategory || "";

        let matchReason: "extension_overlap" | "error_category_match" | "keyword_similarity" | null = null;

        // (a) File path extension overlap
        if (resolvedExtensions.size > 0 && pendingFilePaths.length > 0) {
          const pendingExtensions = pendingFilePaths
            .map((fp) => {
              const lastDot = fp.lastIndexOf(".");
              return lastDot >= 0 ? fp.slice(lastDot).toLowerCase() : "";
            })
            .filter((ext) => ext.length > 0);

          for (const ext of pendingExtensions) {
            if (resolvedExtensions.has(ext)) {
              matchReason = "extension_overlap";
              break;
            }
          }
        }

        // (b) Error category exact match
        if (!matchReason && resolvedErrorCategory && pendingErrorCategory) {
          if (resolvedErrorCategory === pendingErrorCategory) {
            matchReason = "error_category_match";
          }
        }

        // (c) Keyword Jaccard similarity ≥ 60%
        if (!matchReason && resolvedQuestion.questionText && pendingQ.questionText) {
          const similarity = computeJaccardSimilarity(resolvedQuestion.questionText, pendingQ.questionText);
          if (similarity >= 0.6) {
            matchReason = "keyword_similarity";
          }
        }

        if (matchReason) {
          // Create a cross_repo_propagation question for the matching pending question's repo
          await this.createQuestion(organizationId, pendingQ.repositoryId, "cross_repo_propagation", {
            sourceQuestionId: resolvedQuestion.id,
            sourceRepositoryId: resolvedQuestion.repositoryId,
            sourceAnswer: finalAnswer,
            matchReason,
            filePaths: pendingFilePaths,
          });
        }
      }
    } catch (err: any) {
      logger.warn(`[KBQuestionEngine] Cross-repo propagation failed: ${err.message}`);
    }
  }

  /**
   * Sends a Slack notification to the org's first available channel
   * when a new knowledge base question is generated.
   * Non-blocking — failures are only warned, never thrown.
   */
  private async notifySlack(
    organizationId: number,
    questionId: number,
    questionText: string,
    triggerSource: string,
    contextData: QuestionContext
  ): Promise<void> {
    try {
      const { saasConnectors } = await import("@shared/schema/index.js");
      const [slackConnector] = await db
        .select()
        .from(saasConnectors)
        .where(
          and(
            eq((saasConnectors as any).orgId, organizationId),
            eq((saasConnectors as any).platform, "slack")
          )
        )
        .limit(1);

      if (!slackConnector) return;

      const creds = (slackConnector as any).credentials as any;
      const token = creds?.bot_token || creds?.api_token || creds?.token;
      if (!token) return;

      const { getSlackClient } = await import("@domain/integrations/slack-service.js");
      const slack = await getSlackClient(token);

      const baseUrl = process.env.APP_URL || "http://localhost:5000";
      const triggerEmoji =
        triggerSource === "predictive_failure" ? "🔴" :
        triggerSource === "memory_contradiction" ? "🟡" : "🔵";

      // Build a context-specific resolve URL.
      // Forge questions get a blueprint-scoped path; all others use the repoId query param.
      const repoId: string = (contextData as any).repositoryId || contextData.filePaths?.[0] || "review";
      const blueprintSlug: string | undefined = (contextData as any).blueprintSlug;
      const resolveUrl = blueprintSlug
        ? `${baseUrl}/knowledge-graph/questions/forge/${encodeURIComponent(blueprintSlug)}`
        : `${baseUrl}/knowledge-graph/questions?repoId=${encodeURIComponent(repoId)}`;

      // Prefer the dedicated #knowledge-review channel. Fetch enough channels to
      // find it by name before falling back to the first available channel.
      const allChannels = await slack.getChannels(100);
      const channelId =
        allChannels.find((c: any) => c.name === SLACK_REVIEW_CHANNEL)?.id
        ?? allChannels[0]?.id;
      if (!channelId) return;

      await slack.postMessage(
        channelId,
        `${triggerEmoji} *Knowledge Base Question* (ID: ${questionId})\n` +
        `*Trigger:* \`${triggerSource}\`\n` +
        `*Question:* ${questionText}\n` +
        `<${resolveUrl}|Review & Answer>`
      );

      logger.info(`[KBQuestionEngine] Slack notification sent for question ${questionId}`);
    } catch (err: any) {
      logger.warn(`[KBQuestionEngine] Slack notification failed for question ${questionId}: ${err.message}`);
    }
  }

  /**
   * Generates 3–5 scoping sub-questions that sharpen a broad research request into
   * concrete, answerable lines of inquiry. Used to scope a copilot research mission
   * before it runs so the autonomous research is well-targeted rather than vague.
   * LLM-backed and Redis-cached; returns [] on any failure so callers can proceed.
   */
  async generateScopingQuestions(
    request: string,
    organizationId: number,
    topic?: string
  ): Promise<string[]> {
    logger.info(`[KBQuestionEngine] Generating scoping questions for a research request (org ${organizationId})`);

    const cacheKey = `scoping_questions:${organizationId}:${(topic || "general").replace(/[^a-zA-Z0-9]/g, "_").substring(0, 40)}:${request.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 60)}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.info(`[KBQuestionEngine] Using cached scoping questions`);
        return JSON.parse(cached);
      }
    } catch (e: any) {
      logger.warn(`[KBQuestionEngine] Redis cache error: ${e.message}`);
    }

    const prompt = `A user asked a question that could not be answered from the existing knowledge base${topic ? ` (topic: ${topic})` : ""}:
"${request}"

A research mission will investigate it. Generate 3 to 5 specific, non-overlapping sub-questions that scope this research so the findings are concrete, well-sourced, and directly answer the user's question. Prefer sub-questions that clarify definitions, key facts, comparisons, constraints, and current state.

Return ONLY a JSON object with this exact structure:
{
  "questions": ["Sub-question 1", "Sub-question 2"]
}`;

    try {
      const aiConfig = await systemAiService.getAiConfig("copilot", organizationId) || {
        provider: "google",
        model: "gemini-1.5-flash",
      };

      const aiResponse = await systemAiService.generateJson(prompt, aiConfig.model as any);

      if (!aiResponse || !Array.isArray(aiResponse.questions) || aiResponse.questions.length === 0) {
        logger.warn("[KBQuestionEngine] AI returned invalid structure for scoping questions");
        return [];
      }

      const questions = (aiResponse.questions as string[]).slice(0, 5);
      try {
        await redis.setex(cacheKey, 86400 * 3, JSON.stringify(questions)); // Cache for 3 days
      } catch (e: any) {
        logger.warn(`[KBQuestionEngine] Failed to cache scoping questions: ${e.message}`);
      }

      return questions;
    } catch (error: any) {
      logger.error(`[KBQuestionEngine] Failed to generate scoping questions: ${error.message}`);
      return [];
    }
  }

  /**
   * Generates highly specific diagnostic questions for an asset based on its type and the reported problem.
   * Leverages the system AI to act as an expert technician for dynamic triage flows.
   */
  async generateAssetDiagnosticQuestions(
    assetType: string,
    problemDescription: string,
    organizationId: number
  ): Promise<string[]> {
    logger.info(`[KBQuestionEngine] Generating diagnostic questions for asset type: ${assetType}`);
    
    const cacheKey = `diagnostic_questions:${organizationId}:${assetType.replace(/[^a-zA-Z0-9]/g, "_")}:${problemDescription.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50)}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.info(`[KBQuestionEngine] Using cached diagnostic questions for ${assetType}`);
        return JSON.parse(cached);
      }
    } catch (e: any) {
      logger.warn(`[KBQuestionEngine] Redis cache error: ${e.message}`);
    }

    const prompt = `You are an expert diagnostic technician for physical assets of type: ${assetType}.
The user has reported the following problem: "${problemDescription}".
Generate 3 to 5 highly specific, actionable questions that will help isolate the root cause of the problem.
These questions will be asked conversationally to the user by a triage AI agent. Keep them clear, concise, and easy for a non-expert user to answer.

Return ONLY a JSON object with this exact structure:
{
  "questions": [
    "Question 1",
    "Question 2"
  ]
}`;

    try {
      const aiConfig = await systemAiService.getAiConfig("copilot", organizationId) || {
        provider: "google",
        model: "gemini-1.5-flash",
      };

      const aiResponse = await systemAiService.generateJson(prompt, aiConfig.model as any);

      if (!aiResponse || !Array.isArray(aiResponse.questions)) {
        logger.warn("[KBQuestionEngine] AI returned invalid structure for diagnostic questions");
        return [
          "Can you provide more details about when this problem started?",
          "Are there any visible error codes or warning lights?",
          "Does the asset still power on normally?"
        ];
      }

      const questions = aiResponse.questions as string[];
      try {
        await redis.setex(cacheKey, 86400 * 7, JSON.stringify(questions)); // Cache for 7 days
      } catch (e: any) {
        logger.warn(`[KBQuestionEngine] Failed to cache diagnostic questions: ${e.message}`);
      }

      return questions;
    } catch (error: any) {
      logger.error(`[KBQuestionEngine] Failed to generate diagnostic questions: ${error.message}`);
      return [
        "Can you provide more details about when this problem started?",
        "Are there any visible error codes or warning lights?",
        "Does the asset still power on normally?"
      ];
    }
  }
}

export const knowledgeBaseQuestionEngineService = KnowledgeBaseQuestionEngineService.getInstance();
