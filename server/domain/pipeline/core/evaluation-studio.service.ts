/**
 * Evaluation Studio persistence: test sets, cases, the run lifecycle and
 * baseline promotions, as managed from /api/evaluation-studio.
 *
 * Every method takes `organizationId: number`. Cases, runs and results carry
 * no org column; they are reached only through a test set found within the org.
 *
 * A test set may name a job and a mission. Running the set chats with that job
 * as a system context, and agentService.chat loads a job by id and then adopts
 * the JOB's organization — so a set pointing at another tenant's job would run
 * that tenant's agent, with its tools and knowledge, and file the answers in
 * this org's results. assertReferencesInOrg is the gate on the way in;
 * evaluationService.runTestSet repeats the check for sets saved before it.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
  evaluationPromotions,
  evaluationRunResults,
  evaluationRuns,
  evaluationTestCases,
  evaluationTestSets,
  jobs,
  missionRuns,
  missions,
} from "@shared/schema/index.js";
import { summarizeEvaluationRun } from "./evaluation-promotion.service.js";
import { buildMissionEvaluationCase } from "@domain/mission/core/mission-evaluation-case.js";

export type ReferenceFailure = "job-not-found" | "mission-not-found";

/**
 * True when the job may be used by `organizationId`: it exists and either
 * belongs to that org or to none (a shared/platform job). Only a job owned by
 * a different org, or a missing one, is refused.
 */
export async function jobUsableByOrg(jobId: number, organizationId: number): Promise<boolean> {
  const [job] = await db.select({ organizationId: jobs.organizationId }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return !!job && (job.organizationId == null || job.organizationId === organizationId);
}

async function missionUsableByOrg(missionId: number, organizationId: number): Promise<boolean> {
  const [mission] = await db.select({ organizationId: missions.organizationId }).from(missions).where(eq(missions.id, missionId)).limit(1);
  return !!mission && (mission.organizationId == null || mission.organizationId === organizationId);
}

const SYSTEM_TEST_CASES = [
  {
    inputPrompt: "What are the supported field types for Form Agents according to documentation?",
    expectedCriteria: "text, textarea, select, date, number, boolean",
    method: "keyword",
  },
  {
    inputPrompt: "How does the system extract 'Severity' from bug report templates?",
    expectedCriteria: "\\*\\*Severity:\\*\\*\\s*(.*?)(?:\\n|$)",
    method: "llm_judge",
  },
  {
    inputPrompt: "What is the relation name used for linking Tickets to Features in the KG ingestion rules?",
    expectedCriteria: "relates_to",
    method: "keyword",
  },
  {
    inputPrompt: "Briefly explain the 'Interactive Form Runtime' feature.",
    expectedCriteria: "Forms appearing during pipeline execution with real-time validation and timeout management.",
    method: "llm_judge",
  },
];

class EvaluationStudioService {
  listTestSets(organizationId: number) {
    return db
      .select()
      .from(evaluationTestSets)
      .where(eq(evaluationTestSets.organizationId, organizationId))
      .orderBy(desc(evaluationTestSets.updatedAt));
  }

  private async findTestSet(organizationId: number, testSetId: number) {
    const [set] = await db
      .select()
      .from(evaluationTestSets)
      .where(and(eq(evaluationTestSets.id, testSetId), eq(evaluationTestSets.organizationId, organizationId)))
      .limit(1);
    return set ?? null;
  }

  async createTestSet(organizationId: number, input: {
    name?: string;
    description?: string | null;
    jobId?: number | null;
    missionId?: number | null;
  }) {
    if (input.jobId != null && !(await jobUsableByOrg(input.jobId, organizationId))) {
      return { ok: false as const, failure: "job-not-found" as ReferenceFailure };
    }
    if (input.missionId != null && !(await missionUsableByOrg(input.missionId, organizationId))) {
      return { ok: false as const, failure: "mission-not-found" as ReferenceFailure };
    }
    const [set] = await db.insert(evaluationTestSets).values({
      organizationId,
      name: input.name || "Untitled Test Set",
      description: input.description || null,
      jobId: input.jobId ?? null,
      missionId: input.missionId ?? null,
    }).returning();
    return { ok: true as const, set };
  }

  /** A one-case regression set built from a mission run, or null when the run is not in this org. */
  async generateFromMissionRun(organizationId: number, missionRunId: number, name?: string) {
    const [source] = await db.select({ run: missionRuns, mission: missions })
      .from(missionRuns)
      .leftJoin(missions, eq(missionRuns.missionId, missions.id))
      .where(and(eq(missionRuns.id, missionRunId), eq(missionRuns.organizationId, organizationId)))
      .limit(1);
    if (!source) return null;

    return db.transaction(async (tx) => {
      const [testSet] = await tx.insert(evaluationTestSets).values({
        organizationId,
        missionId: source.run.missionId,
        name: name || `Mission regression: ${source.run.name}`,
        description: `Generated from mission run ${source.run.id} (${source.run.status}).`,
      }).returning();
      const generated = buildMissionEvaluationCase({ ...source.run, objective: source.mission?.objective });
      const [testCase] = await tx.insert(evaluationTestCases).values({ testSetId: testSet.id, ...generated }).returning();
      return { testSet, testCase };
    });
  }

  /** The set's cases, or null when the set is not in this org. */
  async listCases(organizationId: number, testSetId: number) {
    if (!(await this.findTestSet(organizationId, testSetId))) return null;
    return db.select().from(evaluationTestCases).where(eq(evaluationTestCases.testSetId, testSetId));
  }

  /** The new case, or null when the set is not in this org. */
  async addCase(organizationId: number, testSetId: number, input: { inputPrompt?: string; expectedCriteria?: string; method?: string }) {
    if (!(await this.findTestSet(organizationId, testSetId))) return null;
    const [testCase] = await db.insert(evaluationTestCases).values({
      testSetId,
      inputPrompt: input.inputPrompt || "",
      expectedCriteria: input.expectedCriteria || "",
      method: input.method || "llm_judge",
    }).returning();
    return testCase;
  }

  /** The set, its summarized runs and active promotion, or null when the set is not in this org. */
  async loadLifecycle(organizationId: number, testSetId: number) {
    const set = await this.findTestSet(organizationId, testSetId);
    if (!set) return null;

    const runs = await db.select().from(evaluationRuns)
      .where(eq(evaluationRuns.testSetId, testSetId))
      .orderBy(desc(evaluationRuns.startedAt));
    const runIds = runs.map((run) => run.id);
    const results = runIds.length > 0
      ? await db.select().from(evaluationRunResults).where(inArray(evaluationRunResults.runId, runIds))
      : [];
    const resultsByRun = new Map<number, typeof results>();
    for (const result of results) {
      const existing = resultsByRun.get(result.runId) ?? [];
      existing.push(result);
      resultsByRun.set(result.runId, existing);
    }

    const [activePromotion] = await db.select().from(evaluationPromotions)
      .where(and(eq(evaluationPromotions.testSetId, testSetId), eq(evaluationPromotions.organizationId, organizationId)))
      .orderBy(desc(evaluationPromotions.promotedAt))
      .limit(1);

    return {
      set,
      activePromotion: activePromotion ?? null,
      runs: runs.map((run) => ({
        ...summarizeEvaluationRun(run, resultsByRun.get(run.id) ?? []),
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        isActiveBaseline: activePromotion?.candidateRunId === run.id,
      })),
    };
  }

  async recordPromotion(organizationId: number, input: Omit<typeof evaluationPromotions.$inferInsert, "organizationId" | "id" | "promotedAt">) {
    const [promotion] = await db.insert(evaluationPromotions).values({ organizationId, ...input }).returning();
    return promotion;
  }

  async importSystemTests(organizationId: number): Promise<number> {
    return db.transaction(async (tx) => {
      const [set] = await tx.insert(evaluationTestSets).values({
        organizationId,
        name: "System documentation Baseline",
        description: "Test cases generated from FORM_AGENT_FEATURE_DOCUMENTATION and KG_TEST_PLAN.",
      }).returning();
      await tx.insert(evaluationTestCases).values(SYSTEM_TEST_CASES.map((c) => ({ testSetId: set.id, ...c })));
      return set.id;
    });
  }
}

export const evaluationStudioService = new EvaluationStudioService();
