import type { PhaseStatus, SessionListItem, SessionStatus } from "../types/index.js";

/**
 * Derive display `PhaseStatus[]` from the API's `phase_sequence` + `current_phase`
 * + session status. Per-phase cost/artifact counts aren't carried on the row, so
 * they default to 0 (the backend could enrich these later).
 */
export function derivePhases(
  sequence: string[],
  currentPhase: string | null,
  status: SessionStatus,
): PhaseStatus[] {
  const curIdx = currentPhase ? sequence.indexOf(currentPhase) : -1;
  return sequence.map((phase, i) => {
    let phaseStatus: PhaseStatus["status"];
    if (status === "completed") phaseStatus = "completed";
    else if (curIdx === -1) phaseStatus = "pending";
    else if (i < curIdx) phaseStatus = "completed";
    else if (i === curIdx) phaseStatus = status === "failed" ? "failed" : "active";
    else phaseStatus = "pending";
    return { phase, status: phaseStatus, startedAt: null, completedAt: null, artifactCount: 0, costUsd: 0 };
  });
}

/**
 * The generation-sessions API serializes the raw DB row — `phaseSequence`
 * (string[]) and `currentCostUsd` — which differs from the view-model the UI
 * components expect (`phases: PhaseStatus[]`, `totalCostUsd`). Normalize at the
 * data-layer boundary so components receive a consistent shape.
 */
export function normalizeSession(raw: Record<string, any>): SessionListItem {
  const phaseSequence: string[] = Array.isArray(raw.phaseSequence) ? raw.phaseSequence : [];
  return {
    ...raw,
    totalCostUsd: Number(raw.totalCostUsd ?? raw.currentCostUsd ?? 0),
    phases: derivePhases(phaseSequence, raw.currentPhase ?? null, raw.status),
  } as unknown as SessionListItem;
}
