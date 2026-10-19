export interface MissionEvaluationSource {
  id: number;
  name: string;
  status: string;
  isSuccess?: boolean | null;
  failureReason?: string | null;
  metricType?: string | null;
  actualMetricValue?: string | number | null;
  objective?: string | null;
}

export function buildMissionEvaluationCase(run: MissionEvaluationSource) {
  const objective = run.objective?.trim() || run.name;
  const observedMetric = run.metricType && run.actualMetricValue != null
    ? ` Preserve or improve the observed ${run.metricType} result of ${run.actualMetricValue}.`
    : "";
  const failureGuard = run.isSuccess === false || run.status === "failed"
    ? ` The response must avoid the prior failure: ${run.failureReason || "mission execution failed"}.`
    : "";

  return {
    inputPrompt: objective,
    expectedCriteria: `Achieve the mission objective with a complete, evidence-backed result.${observedMetric}${failureGuard}`,
    method: "llm_judge" as const,
    sourceMissionRunId: run.id,
  };
}
