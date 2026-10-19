import {
  evaluateResults,
  evaluateStudio,
  pagesOfStage,
  respondentDefinition,
  type CohortValues,
  type ResolvedResult,
  type StudioAudience,
  type StudioDecision,
  type StudioDefinition,
  type StudioField,
  type StudioStage,
} from "./form-studio";

/**
 * One response filled in over several stages, by different people, in order.
 *
 * A form with stages is answered stage by stage: a candidate's self-assessment,
 * then HR's data, then the committee's review, each by whoever the cycle assigns.
 * Each submission locks its stage. Scores and decision rules are evaluated again
 * over every locked answer as each stage lands, and the ledger keeps what they
 * were after each one, with the cohort metrics they were evaluated against.
 *
 * An assignee is shown only their own stage and the earlier stages it may see.
 * Questions, answers and computed values from any other stage are left out of
 * their view entirely, so a candidate never receives HR's flight-risk rating, nor
 * a readiness score that depends on it.
 *
 * Pure: the database side is form-studio-stages.service.ts.
 */

export type StageSubmitter =
  | { type: "user"; userId: string; email?: string | null }
  | { type: "external"; email: string }
  | { type: "agent"; agent: string };

/** Where an answer came from when an agent supplied it, such as the document and section it was read from. */
export interface AnswerSource {
  source: string;
}

export interface LockedStage {
  stageId: string;
  answers: Record<string, unknown>;
  submittedAt: string;
  submittedBy: StageSubmitter;
  provenance?: Record<string, AnswerSource>;
  /** Every computed value right after this stage locked: how the scores moved stage by stage. */
  computed: Record<string, unknown>;
  /** The decision rules' status after this stage, or null while they wait on later answers. */
  status: string | null;
  /** The cohort metrics this stage was evaluated against, when the form has any. */
  cohort?: CohortValues;
}

export interface StageLedger {
  stages: LockedStage[];
}

export class StageError extends Error {
  constructor(readonly reason: "no_stages" | "unknown_stage" | "already_submitted" | "out_of_order", message: string) {
    super(message);
    this.name = "StageError";
  }
}

export const emptyLedger = (): StageLedger => ({ stages: [] });

function stageOf(def: StudioDefinition, stageId: string): StudioStage {
  if (!def.studio.stages.length) throw new StageError("no_stages", "This form has no stages. Add stages in Form Studio before a cycle assigns them.");
  const stage = def.studio.stages.find((s) => s.id === stageId);
  if (!stage) throw new StageError("unknown_stage", `Stage ${stageId} does not exist on this form.`);
  return stage;
}

const pageOf = (def: StudioDefinition, field: StudioField) => field.pageId || def.studio.pages[0]?.id;

export const isLocked = (ledger: StageLedger, stageId: string) => ledger.stages.some((s) => s.stageId === stageId);

/** The stage waiting to be filled in, or null once every stage is in. */
export function nextStageId(def: StudioDefinition, ledger: StageLedger): string | null {
  return def.studio.stages.find((s) => !isLocked(ledger, s.id))?.id ?? null;
}

/** The questions a stage's assignee answers. Computed values are never taken from a submission. */
export function stageQuestionKeys(def: StudioDefinition, stageId: string): string[] {
  const pages = pagesOfStage(def, stageOf(def, stageId).id);
  return def.fields.filter((f) => f.type !== "computed" && pages.has(pageOf(def, f))).map((f) => f.key);
}

export function lockedAnswers(ledger: StageLedger): Record<string, unknown> {
  return Object.assign({}, ...ledger.stages.map((s) => s.answers));
}

/** Whose result blocks a stage's assignee sees: a respondent's, or all of them for anyone assigned by role, name or agent. */
export const stageAudience = (stage: StudioStage): StudioAudience => (stage.assignee.type === "respondent" ? "respondent" : "reviewer");

export type LockOutcome =
  | { ok: false; errors: Record<string, string> }
  | { ok: true; ledger: StageLedger; values: Record<string, unknown>; decision: StudioDecision; complete: boolean };

/**
 * Lock a stage with its assignee's answers. Only the next stage can be locked,
 * once. Only that stage's questions are taken from `inputs`, so a later stage
 * cannot rewrite an earlier stage's answers, and only that stage's questions
 * must be answered. `values` includes the cohort metrics; store answers without them.
 */
export function lockStage(
  def: StudioDefinition,
  ledger: StageLedger,
  stageId: string,
  inputs: Record<string, unknown>,
  by: StageSubmitter,
  at: Date,
  provenance?: Record<string, AnswerSource>,
  cohort?: CohortValues,
): LockOutcome {
  const stage = stageOf(def, stageId);
  if (isLocked(ledger, stageId)) throw new StageError("already_submitted", `${stage.title} has already been submitted.`);
  const next = nextStageId(def, ledger);
  if (next !== stageId) {
    const waiting = def.studio.stages.find((s) => s.id === next);
    throw new StageError("out_of_order", `${stage.title} comes after ${waiting?.title ?? next}, which has not been submitted yet.`);
  }

  const answers: Record<string, unknown> = {};
  for (const key of stageQuestionKeys(def, stageId)) {
    if (Object.prototype.hasOwnProperty.call(inputs, key)) answers[key] = inputs[key];
  }
  const evaluation = evaluateStudio(def, { ...lockedAnswers(ledger), ...answers }, true, { stageId, cohort });
  const pages = pagesOfStage(def, stageId);
  const onStage = new Set(def.fields.filter((f) => pages.has(pageOf(def, f))).map((f) => f.key));
  const errors = Object.fromEntries(Object.entries(evaluation.errors).filter(([key]) => key === "formula" || onStage.has(key)));
  if (Object.keys(errors).length) return { ok: false, errors };

  const values = { ...evaluation.values };
  const computed = Object.fromEntries(def.fields.filter((f) => f.type === "computed").map((f) => [f.key, values[f.key]]));
  const sources = provenance ? Object.fromEntries(Object.entries(provenance).filter(([key]) => Object.prototype.hasOwnProperty.call(answers, key))) : {};
  const locked: LockedStage = {
    stageId,
    answers,
    submittedAt: at.toISOString(),
    submittedBy: by,
    computed,
    status: evaluation.decision.state === "decided" ? evaluation.decision.status : null,
    ...(Object.keys(sources).length ? { provenance: sources } : {}),
    ...(def.studio.cohorts.length && cohort ? { cohort } : {}),
  };
  const nextLedger = { stages: [...ledger.stages, locked] };
  return { ok: true, ledger: nextLedger, values, decision: evaluation.decision, complete: nextStageId(def, nextLedger) === null };
}

function reviewerDefinition(def: StudioDefinition): StudioDefinition {
  const copy = structuredClone(def);
  copy.studio.sources = [];
  copy.studio.tests = [];
  copy.studio.issues = [];
  copy.studio.actions = [];
  copy.studio.dataset = null;
  for (const field of copy.fields) delete (field as Record<string, unknown>).source;
  return copy;
}

/**
 * The definition a stage's assignee receives: the pages of their own stage and of
 * the earlier stages they may see, and only the questions and computed values on
 * those pages. Sources, tests, open issues and actions never leave the server; a
 * respondent also gets no reviewer results, decision rules or cohort metrics.
 */
export function stageDefinition(def: StudioDefinition, stageId: string): StudioDefinition {
  const stage = stageOf(def, stageId);
  const shown = new Set([stage.id, ...stage.sees]);
  const pages = new Set(def.studio.stages.filter((s) => shown.has(s.id)).flatMap((s) => s.pageIds));
  const base = stageAudience(stage) === "respondent" ? respondentDefinition(def) : reviewerDefinition(def);
  // Fields keep their page explicitly: a field without one belongs to the first
  // page, and the first page left in this view may be a different one.
  base.fields = base.fields.filter((f) => pages.has(pageOf(def, f))).map((f) => ({ ...f, pageId: pageOf(def, f) }));
  base.studio.pages = base.studio.pages.filter((p) => pages.has(p.id));
  base.studio.stages = base.studio.stages.filter((s) => shown.has(s.id)).map((s) => ({ ...s, sees: s.sees.filter((id) => shown.has(id)) }));
  return base;
}

export interface StageView {
  stage: { id: string; title: string; audience: StudioAudience; assignee: StudioStage["assignee"] };
  locked: boolean;
  /** Every stage in order, by title, with whether it is in and which is next. */
  progress: Array<{ id: string; title: string; locked: boolean; next: boolean }>;
  definition: StudioDefinition;
  /** The answers this assignee may see: those of the earlier stages they see, and their own once submitted. */
  inputs: Record<string, unknown>;
  /** Cohort metrics for computing this view in the browser; none for a respondent. */
  cohort: CohortValues;
  earlier: Array<{ stageId: string; title: string; submittedAt: string; answers: Array<{ key: string; label: string; value: unknown; source?: string }> }>;
  /** Result blocks for this assignee, computed from only the answers they may see. */
  results: ResolvedResult[];
}

export function stageView(def: StudioDefinition, ledger: StageLedger, stageId: string, cohort: CohortValues = {}): StageView {
  const stage = stageOf(def, stageId);
  const locked = isLocked(ledger, stageId);
  const next = nextStageId(def, ledger);
  const readable = new Set([...stage.sees, ...(locked ? [stageId] : [])]);
  const inputs: Record<string, unknown> = Object.assign({}, ...ledger.stages.filter((s) => readable.has(s.stageId)).map((s) => s.answers));
  const definition = stageDefinition(def, stageId);
  const shownCohort = Object.fromEntries(definition.studio.cohorts.filter((c) => cohort[c.id]).map((c) => [c.id, cohort[c.id]]));
  const evaluation = evaluateStudio(definition, inputs, false, { cohort: shownCohort });
  const labels = new Map(def.fields.map((f) => [f.key, f.label]));
  const titles = new Map(def.studio.stages.map((s) => [s.id, s.title]));
  return {
    stage: { id: stage.id, title: stage.title, audience: stageAudience(stage), assignee: stage.assignee },
    locked,
    progress: def.studio.stages.map((s) => ({ id: s.id, title: s.title, locked: isLocked(ledger, s.id), next: s.id === next })),
    definition,
    inputs,
    cohort: shownCohort,
    earlier: ledger.stages.filter((s) => stage.sees.includes(s.stageId)).map((s) => ({
      stageId: s.stageId,
      title: titles.get(s.stageId) ?? s.stageId,
      submittedAt: s.submittedAt,
      answers: Object.entries(s.answers)
        .filter(([, value]) => value !== "" && value !== null && value !== undefined)
        .map(([key, value]) => ({ key, label: labels.get(key) ?? key, value, ...(s.provenance?.[key] ? { source: s.provenance[key].source } : {}) })),
    })),
    results: evaluateResults(definition, evaluation.values, evaluation.decision, stageAudience(stage)),
  };
}
