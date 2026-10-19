import { z } from "zod";

export const phenotypeStageSchema = z.enum([
  "embryonic", "validation", "differentiation", "sandbox", "shadow", "canary", "mature",
  "suspended", "retired", "failed",
]);
export type PhenotypeStage = z.infer<typeof phenotypeStageSchema>;

const DEVELOPMENT_PATH: PhenotypeStage[] = [
  "embryonic", "validation", "differentiation", "sandbox", "shadow", "canary", "mature",
];

export interface StageEvidence {
  evaluationId?: string;
  selectionRunId?: string;
  approvedBy?: string;
  rollbackTarget?: PhenotypeStage;
  reason: string;
}

export interface StageTransition {
  from: PhenotypeStage;
  to: PhenotypeStage;
  action: "promote" | "rollback" | "kill" | "retire" | "fail";
  evidence: StageEvidence;
}

export class StageTransitionError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = "StageTransitionError"; }
}

export function transitionPhenotype(fromInput: PhenotypeStage, action: StageTransition["action"], evidence: StageEvidence): StageTransition {
  const from = phenotypeStageSchema.parse(fromInput);
  if (!evidence.reason?.trim()) throw new StageTransitionError("A transition reason is required", "MISSING_EVIDENCE");
  if (["retired", "failed"].includes(from)) throw new StageTransitionError(`Terminal phenotype cannot leave ${from}`, "TERMINAL_STAGE");

  let to: PhenotypeStage;
  if (action === "kill") to = "suspended";
  else if (action === "retire") to = "retired";
  else if (action === "fail") to = "failed";
  else if (action === "rollback") {
    if (!evidence.rollbackTarget) throw new StageTransitionError("Rollback target is required", "MISSING_ROLLBACK_TARGET");
    const currentIndex = DEVELOPMENT_PATH.indexOf(from);
    const targetIndex = DEVELOPMENT_PATH.indexOf(evidence.rollbackTarget);
    if (targetIndex < 0 || currentIndex < 0 || targetIndex >= currentIndex) throw new StageTransitionError("Rollback must target an earlier developmental stage", "INVALID_ROLLBACK");
    to = evidence.rollbackTarget;
  } else {
    const currentIndex = DEVELOPMENT_PATH.indexOf(from);
    if (currentIndex < 0 || currentIndex === DEVELOPMENT_PATH.length - 1) throw new StageTransitionError(`Cannot promote from ${from}`, "INVALID_PROMOTION");
    to = DEVELOPMENT_PATH[currentIndex + 1];
    if (to === "shadow" && !evidence.evaluationId) throw new StageTransitionError("Shadow promotion requires an evaluation", "EVALUATION_REQUIRED");
    if (["canary", "mature"].includes(to) && (!evidence.selectionRunId || !evidence.approvedBy)) {
      throw new StageTransitionError(`${to} promotion requires selection evidence and human approval`, "APPROVAL_REQUIRED");
    }
  }
  return { from, to, action, evidence: { ...evidence } };
}

