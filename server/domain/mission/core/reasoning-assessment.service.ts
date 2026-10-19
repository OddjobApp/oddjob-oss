import { db } from "@server/database_service.js";
import { missionRuns } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";

export type ReasoningDimension = {
  score: number;
  evidence: string[];
  gaps: string[];
};

export type ReasoningAssessment = {
  version: "1.0";
  missionRunId: number;
  assessedAt: string;
  overallScore: number;
  confidence: number;
  disposition: "promote_candidate" | "needs_review" | "revise";
  dimensions: {
    framing: ReasoningDimension;
    evidence: ReasoningDimension;
    adaptability: ReasoningDimension;
    verification: ReasoningDimension;
    efficiency: ReasoningDimension;
  };
  pivotalEvents: Array<{ index: number; event: string; outcome: string }>;
  critic: { strengths: string[]; risks: string[]; recommendations: string[] };
  correctedPlan: string[];
  learningCandidates: Array<{ type: "procedural" | "episodic" | "anti_pattern" | "routing"; content: string; confidence: number }>;
  promotionGate: { eligible: boolean; requiredScore: number; blockers: string[]; requiresHumanReview: boolean };
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const text = (value: unknown) => JSON.stringify(value ?? "").toLowerCase();
const hasAny = (value: unknown, terms: string[]) => terms.some((term) => text(value).includes(term));

export function assessReasoningRun(run: any): ReasoningAssessment {
  const trace = Array.isArray(run?.dynamicTrace) ? run.dynamicTrace : [];
  const context = run?.missionContext && typeof run.missionContext === "object" ? run.missionContext : {};
  const successful = trace.filter((entry: any) => hasAny(entry, ["success", "completed", "verified", "passed"]));
  const failures = trace.filter((entry: any) => hasAny(entry, ["fail", "error", "rejected", "blocked"]));
  const replans = trace.filter((entry: any) => hasAny(entry, ["replan", "adapt", "pivot", "retry", "recovery"]));
  const verificationEvents = trace.filter((entry: any) => hasAny(entry, ["verify", "test", "audit", "validate", "assert"]));
  const evidenceEvents = trace.filter((entry: any) => entry?.evidence || entry?.output || entry?.result || entry?.tool || entry?.source);
  const planningSignals = [context.intent, context.objective, context.plan, context.executionPlan, context.successCriteria, context.rulesOfEngagement].filter(Boolean);

  const framingScore = clamp(25 + planningSignals.length * 11 + (context.successCriteria ? 15 : 0) + (context.allowedTools?.length ? 8 : 0));
  const evidenceScore = clamp(20 + Math.min(60, evidenceEvents.length * 7) + (successful.length ? 10 : 0) - Math.max(0, failures.length - evidenceEvents.length) * 5);
  const adaptabilityScore = clamp(45 + Math.min(35, replans.length * 12) + (failures.length && replans.length ? 15 : 0) - (failures.length > 2 && !replans.length ? 30 : 0));
  const verificationScore = clamp(30 + Math.min(60, verificationEvents.length * 20) + (run?.isSuccess === true ? 10 : 0));
  const usefulEvents = successful.length + evidenceEvents.length + verificationEvents.length;
  const efficiencyScore = clamp(65 + Math.min(20, usefulEvents * 3) - failures.length * 7 - Math.max(0, trace.length - 40));

  const dimension = (score: number, evidence: string[], gap: string): ReasoningDimension => ({
    score,
    evidence,
    gaps: score < 70 ? [gap] : [],
  });
  const dimensions = {
    framing: dimension(framingScore, planningSignals.length ? [`${planningSignals.length} planning signals captured`] : [], "Define explicit success criteria, unknowns, and a task graph before acting."),
    evidence: dimension(evidenceScore, evidenceEvents.length ? [`${evidenceEvents.length} evidence-bearing trace events`] : [], "Attach observable sources or tool outputs to consequential claims."),
    adaptability: dimension(adaptabilityScore, replans.length ? [`${replans.length} recovery or replanning events`] : [], "Record a replan when evidence contradicts the current approach."),
    verification: dimension(verificationScore, verificationEvents.length ? [`${verificationEvents.length} verification events`] : [], "Run objective verification before concluding the mission."),
    efficiency: dimension(efficiencyScore, [`${trace.length} total events`, `${failures.length} failure signals`], "Reduce repeated or low-information actions."),
  };
  const overallScore = clamp(
    dimensions.framing.score * 0.2 + dimensions.evidence.score * 0.25 + dimensions.adaptability.score * 0.2 + dimensions.verification.score * 0.25 + dimensions.efficiency.score * 0.1,
  );
  const gaps = Object.values(dimensions).flatMap((item) => item.gaps);
  const criticalBlockers = [
    dimensions.evidence.score < 50 ? "Evidence fidelity below 50" : undefined,
    dimensions.verification.score < 50 ? "Verification coverage below 50" : undefined,
    failures.length > 0 && replans.length === 0 ? "Failures occurred without a recorded recovery" : undefined,
  ].filter(Boolean) as string[];
  const eligible = overallScore >= 80 && criticalBlockers.length === 0 && trace.length >= 5;
  const pivotalEvents = trace
    .map((entry: any, index: number) => ({ index, event: String(entry?.event || entry?.action || entry?.type || "trace_event"), outcome: hasAny(entry, ["fail", "error"]) ? "failure" : hasAny(entry, ["success", "complete"]) ? "success" : "observation", raw: entry }))
    .filter((item: any) => item.outcome !== "observation" || hasAny(item.raw, ["decision", "replan", "pivot"]))
    .slice(-8)
    .map(({ index, event, outcome }: any) => ({ index, event, outcome }));

  const strengths = Object.entries(dimensions).filter(([, value]) => value.score >= 75).map(([key]) => `${key[0].toUpperCase()}${key.slice(1)} is supported by the captured trajectory.`);
  const recommendations = gaps.slice(0, 5);
  const learningCandidates: ReasoningAssessment["learningCandidates"] = [];
  if (successful.length) learningCandidates.push({ type: "procedural", content: `Reuse the verified sequence from ${successful.length} successful trajectory event(s).`, confidence: Math.min(0.95, 0.6 + successful.length * 0.04) });
  if (failures.length) learningCandidates.push({ type: "anti_pattern", content: `Avoid or guard the approach represented by ${failures.length} failed trajectory event(s).`, confidence: Math.min(0.95, 0.65 + failures.length * 0.04) });
  if (replans.length) learningCandidates.push({ type: "episodic", content: `Preserve the recovery path used in ${replans.length} replanning event(s).`, confidence: 0.75 });

  return {
    version: "1.0",
    missionRunId: Number(run.id),
    assessedAt: new Date().toISOString(),
    overallScore,
    confidence: clamp(35 + Math.min(55, trace.length * 4)) / 100,
    disposition: eligible ? "promote_candidate" : overallScore >= 65 ? "needs_review" : "revise",
    dimensions,
    pivotalEvents,
    critic: { strengths, risks: criticalBlockers, recommendations },
    correctedPlan: recommendations.length ? recommendations : ["Preserve the current reasoning pattern and validate it on held-out missions."],
    learningCandidates,
    promotionGate: { eligible, requiredScore: 80, blockers: criticalBlockers, requiresHumanReview: true },
  };
}

export const reasoningAssessmentService = {
  async assessAndPersist(missionRunId: number): Promise<ReasoningAssessment> {
    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
    if (!run) throw new Error(`Mission run ${missionRunId} not found`);
    const assessment = assessReasoningRun(run);
    await db.update(missionRuns).set({
      missionContext: sql`jsonb_set(COALESCE(${missionRuns.missionContext}, '{}'::jsonb), '{reasoningGym}', ${JSON.stringify(assessment)}::jsonb, true)`,
    }).where(eq(missionRuns.id, missionRunId));
    return assessment;
  },
};
