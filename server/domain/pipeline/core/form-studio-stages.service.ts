import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { formStudioRevisions, hilForms } from "@shared/schema/index.js";
import { asStudioDefinition, evaluateStudio, withoutCohortValues, type StudioDecision } from "@shared/form-studio.js";
import {
  emptyLedger, lockStage, nextStageId, StageError, stageView,
  type AnswerSource, type LockedStage, type StageSubmitter,
} from "@shared/form-studio-stages.js";
import { BadRequestError, ConflictError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { cohortValuesFor } from "./form-studio-cohorts.service.js";

const logger = createLogger("FormStudioStages");

/**
 * Responses answered stage by stage across a cycle (see shared/form-studio-stages.ts).
 *
 * A staged response is a `hil_forms` response row, like a public submission, and
 * keeps a copy of the release it started on: republishing the form mid-cycle does
 * not change the questions an in-flight response asks. Every read and write is
 * limited to the response's organization by equality, never a null-organization
 * fallback. Once the last stage is in, the response gets what a public submission
 * gets: its dataset record, approval requests for fired actions, and the
 * form_submitted event.
 */

/** Where a staged response started, so a later stage of the same cycle or mission run finds it. */
export interface StageOrigin {
  cycleId?: number | null;
  missionRunId?: number | null;
  pipelineExecutionId?: number | null;
}

interface StagedState {
  formId: number;
  formName: string;
  revision: number;
  releaseNumber: number;
  themeConfig: unknown;
  decision: StudioDecision;
  origin: StageOrigin;
  stages: LockedStage[];
}

const responseScope = (responseId: number, organizationId: number) =>
  and(eq(hilForms.id, responseId), eq(hilForms.kind, "response"), eq(hilForms.organizationId, organizationId));

function httpError(error: unknown): unknown {
  if (!(error instanceof StageError)) return error;
  if (error.reason === "unknown_stage") return new NotFoundError(error.message);
  if (error.reason === "no_stages") return new BadRequestError(error.message);
  return new ConflictError(error.message, { reason: error.reason });
}

async function load(executor: any, responseId: number, organizationId: number, forUpdate = false) {
  const query = executor.select().from(hilForms).where(responseScope(responseId, organizationId));
  const [row] = forUpdate ? await query.for("update") : await query.limit(1);
  const state = ((row?.config ?? {}) as any).formStudioResponse as StagedState | undefined;
  if (!row || !state || !Array.isArray(state.stages)) throw new NotFoundError("Staged response not found.");
  return { row: row as typeof hilForms.$inferSelect, state, definition: asStudioDefinition(row.schema) };
}

export const formStudioStages = {
  /**
   * A new response to the form's latest release, waiting on its first stage —
   * or, when `opts.releaseNumber` is set (a workflow release pinned it at
   * publish time), to THAT release even if the form has been republished since.
   */
  async start(formId: number, organizationId: number, origin: StageOrigin = {}, opts?: { releaseNumber?: number }) {
    const [form] = await db.select().from(hilForms)
      .where(and(eq(hilForms.id, formId), eq(hilForms.kind, "template"), eq(hilForms.organizationId, organizationId), eq(hilForms.isArchived, false)))
      .limit(1);
    if (!form) throw new NotFoundError("Form not found.");
    const published = ((form.config ?? {}) as any).formStudio?.published;
    const releaseNumber = opts?.releaseNumber ?? published?.releaseNumber;
    if (releaseNumber == null) {
      throw new BadRequestError(`Publish "${form.name}" before a cycle uses it. A cycle's response keeps the release it started on.`);
    }
    const [release] = await db.select().from(formStudioRevisions)
      .where(and(eq(formStudioRevisions.formId, form.id), eq(formStudioRevisions.kind, "release"), eq(formStudioRevisions.releaseNumber, releaseNumber)))
      .limit(1);
    if (!release) {
      if (opts?.releaseNumber != null) {
        throw new NotFoundError(`Release v${opts.releaseNumber} of "${form.name}" no longer exists`);
      }
      throw new NotFoundError("Published form not found.");
    }
    const definition = asStudioDefinition(release.schema);
    if (!definition.studio.stages.length) {
      throw new BadRequestError(`"${release.name}" has no stages. Add stages in Form Studio and publish again before a cycle assigns them.`);
    }

    const state: StagedState = {
      formId: form.id,
      formName: release.name,
      revision: release.formRevision,
      releaseNumber,
      themeConfig: release.themeConfig,
      decision: evaluateStudio(definition, {}).decision,
      origin: {
        ...(origin.cycleId != null ? { cycleId: origin.cycleId } : {}),
        ...(origin.missionRunId != null ? { missionRunId: origin.missionRunId } : {}),
        ...(origin.pipelineExecutionId != null ? { pipelineExecutionId: origin.pipelineExecutionId } : {}),
      },
      stages: [],
    };
    const [row] = await db.insert(hilForms).values({
      name: `${release.name} — response`, organizationId, kind: "response", status: "pending", isArchived: true,
      schema: definition, data: {}, config: { formStudioResponse: state },
    }).returning({ id: hilForms.id });
    return { responseId: row.id, formId: form.id, releaseNumber: state.releaseNumber, nextStageId: nextStageId(definition, emptyLedger()) };
  },

  /** The response a cycle (or, outside a cycle, a mission run) is still filling in for this form. */
  async findOpen(formId: number, organizationId: number, origin: StageOrigin): Promise<number | null> {
    const key = origin.cycleId != null ? { name: "cycleId", value: origin.cycleId }
      : origin.missionRunId != null ? { name: "missionRunId", value: origin.missionRunId }
      : null;
    if (!key) return null;
    const [row] = await db.select({ id: hilForms.id }).from(hilForms).where(and(
      eq(hilForms.kind, "response"), eq(hilForms.organizationId, organizationId), eq(hilForms.status, "pending"),
      sql`${hilForms.config}->'formStudioResponse'->>'formId' = ${String(formId)}`,
      sql`${hilForms.config}->'formStudioResponse'->'origin'->>${key.name} = ${String(key.value)}`,
    )).orderBy(desc(hilForms.id)).limit(1);
    return row?.id ?? null;
  },

  /** Why these answers to a stage would be refused, without locking anything; empty when they would be accepted. */
  async check(responseId: number, stageId: string, inputs: Record<string, unknown>, organizationId: number): Promise<Record<string, string>> {
    const { state, definition } = await load(db, responseId, organizationId);
    const cohort = await cohortValuesFor(state.formId, organizationId, definition);
    try {
      const outcome = lockStage(definition, { stages: state.stages }, stageId, inputs, { type: "agent", agent: "check" }, new Date(), undefined, cohort);
      return outcome.ok ? {} : outcome.errors;
    } catch (error) {
      throw httpError(error);
    }
  },

  /**
   * For the cycle, never for an assignee: which form a response answers, which
   * stages are in, and every value and the status so far.
   */
  async progress(responseId: number, organizationId: number) {
    const { row, state, definition } = await load(db, responseId, organizationId);
    const ledger = { stages: state.stages };
    const complete = row.status === "completed";
    return {
      responseId: row.id, formId: state.formId, formName: state.formName, releaseNumber: state.releaseNumber, complete,
      nextStageId: nextStageId(definition, ledger),
      stages: definition.studio.stages.map((s) => ({ id: s.id, title: s.title, assignee: s.assignee, locked: state.stages.some((locked) => locked.stageId === s.id) })),
      pipelineOutput: {
        formStudioResponseId: row.id, formId: state.formId, complete,
        status: state.decision?.state === "decided" ? state.decision.status : null,
        values: { ...((row.data ?? {}) as Record<string, unknown>) },
      },
    };
  },

  /** What one stage's assignee is shown. Safe to send to that assignee; nothing from stages they may not see is in it. */
  async view(responseId: number, stageId: string, organizationId: number) {
    const { row, state, definition } = await load(db, responseId, organizationId);
    const cohort = await cohortValuesFor(state.formId, organizationId, definition);
    try {
      return {
        responseId: row.id, formId: state.formId, formName: state.formName, releaseNumber: state.releaseNumber,
        complete: row.status === "completed",
        ...stageView(definition, { stages: state.stages }, stageId, cohort),
      };
    } catch (error) {
      throw httpError(error);
    }
  },

  /**
   * Lock a stage. `view` is what the submitter may be shown; `pipelineOutput`
   * carries every value and the status for the cycle's next steps, and must not be
   * sent to an assignee, who may not be allowed to see all of it.
   */
  async submit(
    responseId: number, stageId: string, inputs: Record<string, unknown>, organizationId: number,
    by: StageSubmitter, provenance?: Record<string, AnswerSource>,
  ) {
    // Metrics over the other completed responses, read before the row lock.
    const peek = await load(db, responseId, organizationId);
    const cohort = await cohortValuesFor(peek.state.formId, organizationId, peek.definition);
    const outcome = await db.transaction(async (tx) => {
      const { row, state, definition } = await load(tx, responseId, organizationId, true);
      let locked: ReturnType<typeof lockStage>;
      try {
        locked = lockStage(definition, { stages: state.stages }, stageId, inputs ?? {}, by, new Date(), provenance, cohort);
      } catch (error) {
        throw httpError(error);
      }
      if (!locked.ok) throw new BadRequestError(JSON.stringify(locked.errors));

      const next: StagedState = { ...state, stages: locked.ledger.stages, decision: locked.decision };
      const at = new Date();
      await tx.update(hilForms).set({
        // The answers and scores, without the cohort metrics; the ledger keeps those per stage.
        data: withoutCohortValues(locked.values),
        config: { ...((row.config ?? {}) as Record<string, unknown>), formStudioResponse: next },
        status: locked.complete ? "completed" : "pending",
        ...(locked.complete ? { submittedAt: at } : {}),
        updatedAt: at,
      }).where(responseScope(row.id, organizationId));
      return { state: next, definition, locked };
    });

    const { state, definition, locked } = outcome;
    if (locked.complete) {
      try {
        const [form] = await db.select({ createdBy: hilForms.createdBy }).from(hilForms)
          .where(and(eq(hilForms.id, state.formId), eq(hilForms.organizationId, organizationId))).limit(1);
        const { formStudioRuntime } = await import("./form-studio-runtime.service.js");
        await formStudioRuntime.afterSubmit({
          form: { id: state.formId, name: state.formName, organizationId, createdBy: form?.createdBy ?? null },
          releaseNumber: state.releaseNumber,
          definition,
          responseId,
          values: withoutCohortValues(locked.values),
          decision: locked.decision,
        });
      } catch (error) {
        logger.error(`Staged response ${responseId} to form ${state.formId}: recording its dataset item, approvals or event failed: ${(error as Error)?.message ?? error}`);
      }
    }

    return {
      responseId,
      stageId,
      complete: locked.complete,
      nextStageId: nextStageId(definition, locked.ledger),
      view: stageView(definition, locked.ledger, stageId, cohort),
      pipelineOutput: {
        formStudioResponseId: responseId,
        formId: state.formId,
        stageId,
        complete: locked.complete,
        status: locked.decision.state === "decided" ? locked.decision.status : null,
        values: { ...locked.values },
      },
    };
  },
};
