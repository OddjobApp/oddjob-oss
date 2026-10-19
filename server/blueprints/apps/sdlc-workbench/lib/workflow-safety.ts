/** Pure workflow checks shared by the workbench and its platform gateway. */
export function evaluateQualityEvidence(suites: any[], defects: any[], commitSha: string) {
  const reasons: string[] = [];
  let evidenceReady = suites.length > 0 && /^[a-f0-9]{40}$/i.test(commitSha);
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) reasons.push("Select the full commit SHA being evaluated");
  if (!suites.length) reasons.push("No runner test evidence is available");
  for (const suite of suites) {
    if (suite.status !== "passed") reasons.push("A required test suite has not passed");
    if (suite.evidenceKind !== "runner" || suite.commitSha !== commitSha ||
        typeof suite.runId !== "string" || !suite.runId.trim() ||
        typeof suite.resultUrl !== "string" || !/^https:\/\//.test(suite.resultUrl)) {
      reasons.push("Test evidence must reference a runner, result URL and the selected commit");
      evidenceReady = false;
    }
    if (!Number.isFinite(suite.passCount) || suite.passCount < 1 || suite.failCount !== 0)
      reasons.push("Test evidence must include executed tests with zero failures");
    if (!Number.isFinite(suite.coveragePercent) || suite.coveragePercent < 70 || suite.coveragePercent > 100)
      reasons.push("Required coverage must be between 70% and 100%");
    if (!Number.isFinite(suite.passCount) || !Number.isFinite(suite.failCount) || suite.passCount < 0 || suite.failCount < 0 || suite.passCount + suite.failCount < 1 || !Number.isFinite(suite.coveragePercent)) evidenceReady = false;
  }
  if (defects.some(d => d.status === "open" && ["critical", "high"].includes(String(d.severity).toLowerCase())))
    reasons.push("Critical or high severity defects remain open");
  return { passed: reasons.length === 0, evidenceReady, reasons: [...new Set(reasons)] };
}

export interface MissionTriggerReceipt {
  runId: number | null;
  status: string;
  queued?: boolean;
  outboxRecordId?: string | number;
  message?: string;
}
export function requireLaunchedMission(receipt: MissionTriggerReceipt): number {
  if (receipt.status !== "launched" || receipt.queued || !Number.isInteger(receipt.runId) || Number(receipt.runId) < 1) {
    throw new Error(receipt.status === "queued"
      ? `Request queued; no mission has launched. Operation: ${receipt.outboxRecordId ?? "unavailable"}. ${receipt.message ?? ""}`
      : receipt.message ?? "Mission did not return a confirmed launch receipt");
  }
  return receipt.runId as number;
}

export function validateReleaseEvidence(context: Record<string, any>, cab: any, uat: any, gate: any) {
  const sha = context.commitSha;
  if (!/^[a-f0-9]{40}$/i.test(String(sha ?? ""))) return "A full release commit SHA is required";
  if (!cab || cab.decision !== "approve" || cab.commitSha !== sha || cab.uatSignoffId !== context.uatSignoffId || cab.qualityGateId !== context.qualityGateId)
    return "A saved CAB approval covering this commit, UAT signoff and quality gate is required";
  if (!uat || uat.status !== "approved" || uat.commitSha !== sha)
    return "A saved UAT approval for this commit is required";
  if (!gate || gate.result !== "pass" || gate.commitSha !== sha || gate.evidenceKind !== "runner" || !Number.isInteger(gate.suiteCount) || gate.suiteCount < 1)
    return "A saved runner-backed passing quality gate for this commit is required";
  return null;
}
