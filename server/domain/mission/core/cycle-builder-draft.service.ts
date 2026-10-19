/**
 * Cycle Builder drafts and the cycles they create or revise.
 *
 * Drafts are private to their owner within an org (a super admin sees every
 * draft in the org). Cycles and blueprints written from a draft are stamped
 * with, and filtered by, the caller's org. The route computes the cycle values
 * and blueprint rows from the definition; this service only persists them.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
  cycleBlueprints,
  cycleBuilderDrafts,
  operationalCycles,
  pipelineOutputParams,
  pipelines,
} from "@shared/schema/index.js";

export type CycleBuilderDraft = typeof cycleBuilderDrafts.$inferSelect;
type NewCycleBuilderDraft = typeof cycleBuilderDrafts.$inferInsert;
type NewOperationalCycle = typeof operationalCycles.$inferInsert;
type NewCycleBlueprint = typeof cycleBlueprints.$inferInsert;

export interface DraftScope {
  organizationId: number;
  userId: string;
  isSuperAdmin: boolean;
}

const draftScope = (scope: DraftScope, ...extra: ReturnType<typeof eq>[]) => and(
  eq(cycleBuilderDrafts.organizationId, scope.organizationId),
  ...(scope.isSuperAdmin ? [] : [eq(cycleBuilderDrafts.ownerUserId, scope.userId)]),
  ...extra,
);

class CycleBuilderDraftService {
  async findDraft(scope: DraftScope, id: number): Promise<CycleBuilderDraft | null> {
    const [draft] = await db.select().from(cycleBuilderDrafts).where(draftScope(scope, eq(cycleBuilderDrafts.id, id))).limit(1);
    return draft ?? null;
  }

  listDrafts(scope: DraftScope) {
    return db.select().from(cycleBuilderDrafts).where(draftScope(scope)).orderBy(desc(cycleBuilderDrafts.updatedAt)).limit(100);
  }

  async insertDraft(values: NewCycleBuilderDraft): Promise<CycleBuilderDraft> {
    const [draft] = await db.insert(cycleBuilderDrafts).values(values).returning();
    return draft;
  }

  /**
   * Write a new definition if the draft is still at `expectedVersion`; null on a
   * concurrent change. Scoped to the org as well as the id.
   */
  async updateDraft(
    organizationId: number,
    id: number,
    expectedVersion: number,
    changes: Pick<NewCycleBuilderDraft, "definition" | "validationState"> & Partial<Pick<NewCycleBuilderDraft, "schemaVersion">>,
  ): Promise<CycleBuilderDraft | null> {
    const [updated] = await db.update(cycleBuilderDrafts)
      .set({ ...changes, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(
        eq(cycleBuilderDrafts.id, id),
        eq(cycleBuilderDrafts.organizationId, organizationId),
        eq(cycleBuilderDrafts.version, expectedVersion),
      ))
      .returning();
    return updated ?? null;
  }

  async deleteDraft(organizationId: number, id: number): Promise<void> {
    await db.delete(cycleBuilderDrafts).where(and(eq(cycleBuilderDrafts.id, id), eq(cycleBuilderDrafts.organizationId, organizationId)));
  }

  listPipelineOutputs(organizationId: number) {
    return db.select({
      pipelineId: pipelines.id,
      pipelineName: pipelines.name,
      outputId: pipelineOutputParams.id,
      name: pipelineOutputParams.name,
      label: pipelineOutputParams.label,
      description: pipelineOutputParams.description,
      dataType: pipelineOutputParams.dataType,
      required: pipelineOutputParams.isRequired,
    }).from(pipelineOutputParams)
      .innerJoin(pipelines, eq(pipelineOutputParams.pipelineId, pipelines.id))
      .where(eq(pipelines.organizationId, organizationId))
      .orderBy(pipelines.name, pipelineOutputParams.displayOrder)
      .limit(500);
  }

  async findCycle(organizationId: number, cycleId: number) {
    const [cycle] = await db.select().from(operationalCycles)
      .where(and(eq(operationalCycles.id, cycleId), eq(operationalCycles.organizationId, organizationId)))
      .limit(1);
    return cycle ?? null;
  }

  /** Blueprints of a cycle already found within the caller's org. */
  listBlueprints(cycleId: number) {
    return db.select().from(cycleBlueprints).where(eq(cycleBlueprints.cycleId, cycleId));
  }

  /** The caller's latest edit draft for this cycle, if any. */
  async findEditDraft(organizationId: number, userId: string, cycleId: number): Promise<CycleBuilderDraft | null> {
    const [draft] = await db.select().from(cycleBuilderDrafts).where(and(
      eq(cycleBuilderDrafts.organizationId, organizationId),
      eq(cycleBuilderDrafts.ownerUserId, userId),
      eq(cycleBuilderDrafts.sourceType, "edit"),
      eq(cycleBuilderDrafts.sourceId, String(cycleId)),
    )).orderBy(desc(cycleBuilderDrafts.updatedAt)).limit(1);
    return draft ?? null;
  }

  /** The draft that created or last revised this cycle, within the org. */
  async findDraftThatBuiltCycle(organizationId: number, cycleId: number): Promise<CycleBuilderDraft | null> {
    const [draft] = await db.select().from(cycleBuilderDrafts)
      .where(and(eq(cycleBuilderDrafts.createdCycleId, cycleId), eq(cycleBuilderDrafts.organizationId, organizationId)))
      .orderBy(desc(cycleBuilderDrafts.updatedAt)).limit(1);
    return draft ?? null;
  }

  /** Create a cycle and its blueprints from a draft, and record it on the draft. */
  async createCycle(
    organizationId: number,
    draftId: number,
    cycleValues: Omit<NewOperationalCycle, "organizationId">,
    blueprintRows: (cycleId: number) => NewCycleBlueprint[],
  ) {
    return db.transaction(async (tx) => {
      const [created] = await tx.insert(operationalCycles).values({ ...cycleValues, organizationId }).returning();
      await tx.insert(cycleBlueprints).values(blueprintRows(created.id));
      await tx.update(cycleBuilderDrafts)
        .set({ createdCycleId: created.id, updatedAt: new Date() })
        .where(and(eq(cycleBuilderDrafts.id, draftId), eq(cycleBuilderDrafts.organizationId, organizationId)));
      return created;
    });
  }

  /** Rewrite a cycle (found within the org) and replace its blueprints, in place. */
  async reviseCycleInPlace(
    organizationId: number,
    draftId: number,
    cycleId: number,
    cycleValues: Partial<NewOperationalCycle>,
    blueprintRows: NewCycleBlueprint[],
  ) {
    return db.transaction(async (tx) => {
      const [updated] = await tx.update(operationalCycles)
        .set({ ...cycleValues, updatedAt: new Date() })
        .where(and(eq(operationalCycles.id, cycleId), eq(operationalCycles.organizationId, organizationId)))
        .returning();
      if (!updated) throw new Error("Source Cycle not found");
      await tx.delete(cycleBlueprints).where(eq(cycleBlueprints.cycleId, cycleId));
      await tx.insert(cycleBlueprints).values(blueprintRows);
      await tx.update(cycleBuilderDrafts)
        .set({ createdCycleId: cycleId, updatedAt: new Date() })
        .where(and(eq(cycleBuilderDrafts.id, draftId), eq(cycleBuilderDrafts.organizationId, organizationId)));
      return updated;
    });
  }
}

export const cycleBuilderDraftService = new CycleBuilderDraftService();
