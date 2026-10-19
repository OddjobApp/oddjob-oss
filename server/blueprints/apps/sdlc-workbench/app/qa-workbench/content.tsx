"use client";
import { useState, useEffect, useCallback } from "react";
import {
  records,
  missions,
  handoffs,
  integrations,
  events,
  hil,
  telemetry,
  knowledge,
} from "../../lib/platform-client";
import type { HilRequest } from "../../lib/platform-client";
import { AgentChat } from "../components/AgentChat";
import { qualitySteeringModes } from "../../lib/steering-modes";
import { HilForm } from "../components/HilForm";
import { ActivityFeed } from "../components/ActivityFeed";
import { evaluateQualityEvidence } from "../../lib/workflow-safety";
import { useMarkHandoffsRead } from "../../lib/useMarkHandoffsRead";

const COL = {
  TEST_SUITES: "qa_workbench_test_suites",
  DEFECTS: "qa_workbench_defects",
  QUALITY_GATES: "qa_workbench_quality_gates",
};

type GateState = "idle" | "evaluating" | "pass" | "fail" | "error";

export default function QAWorkbenchContent() {
  useMarkHandoffsRead("qa-workbench");

  const [suites, setSuites] = useState<any[]>([]);
  const [defects, setDefects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [commitSha, setCommitSha] = useState("");
  const [activeTab, setActiveTab] = useState<"suites" | "defects" | "gate">(
    "suites",
  );

  // Quality gate
  const [gateState, setGateState] = useState<GateState>("idle");
  const [gateError, setGateError] = useState<string | null>(null);
  const [gateResult, setGateResult] = useState<{
    passed: boolean;
    reasons: string[];
  } | null>(null);

  // Defect log form
  const [defectTitle, setDefectTitle] = useState("");
  const [defectSeverity, setDefectSeverity] = useState("Medium");
  const [defectDesc, setDefectDesc] = useState("");
  const [defectLogging, setDefectLogging] = useState(false);

  // HIL queue
  const [pendingHil, setPendingHil] = useState<HilRequest[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d] = await Promise.all([records.list(COL.TEST_SUITES), records.list(COL.DEFECTS)]);
      setSuites(s); setDefects(d); setDataError(null);
    } catch (err: any) {
      setDataError(err.message ?? "Test evidence could not be loaded");
    } finally { setLoading(false); }
  }, []);

  const fetchHil = useCallback(async () => {
    try {
      setPendingHil(await hil.pending("qa-sign-off"));
    } catch {}
  }, []);

  useEffect(() => {
    fetchData();
    fetchHil();
    const unsub = events.subscribe((event) => {
      const refresh = [
        "mission.completed",
        "mission.blocked",
        "mission.status_changed",
        "hil.raised",
      ];
      if (refresh.includes(event.type)) {
        fetchData();
        fetchHil();
      }
    });
    return unsub;
  }, [fetchData, fetchHil]);

  async function handleEvaluateGate() {
    setGateState("evaluating");
    setGateError(null);
    setGateResult(null);
    try {
      if (loading || dataError) throw new Error("Load complete test evidence before evaluating the gate");
      const [currentSuites, currentDefects] = await Promise.all([records.list(COL.TEST_SUITES), records.list(COL.DEFECTS)]);
      const result = evaluateQualityEvidence(currentSuites, currentDefects, commitSha);
      if (!result.evidenceReady) throw new Error(result.reasons.join("; "));
      setSuites(currentSuites); setDefects(currentDefects);
      setGateResult(result);

      const [gateWriteResult, knowledgeResult] = await Promise.allSettled([
        records.create(COL.QUALITY_GATES, {
          result: result.passed ? "pass" : "fail",
          reasons: result.reasons,
          suiteCount: currentSuites.length,
          commitSha,
          evidenceKind: "runner",
          defectCount: defects.filter((d: any) => d.status === "open").length,
          timestamp: new Date().toISOString(),
        }),
        knowledge.query(
          "test coverage quality gates defect patterns historical failures",
          3,
        ),
      ]);
      if (gateWriteResult.status === "rejected") throw gateWriteResult.reason;
      const knowledgeRows =
        knowledgeResult.status === "fulfilled"
          ? Array.isArray(knowledgeResult.value)
            ? knowledgeResult.value
            : ((knowledgeResult.value as any)?.results ?? [])
          : [];
      const knowledgeContext = knowledgeRows
        .slice(0, 3)
        .map((r: any) => ({ content: r.content, source: r.source }));

      const priorGates = await records.list(COL.QUALITY_GATES);
      const currentGateId =
        gateWriteResult.status === "fulfilled"
          ? gateWriteResult.value.id
          : null;
      const failedGateCount =
        priorGates.filter(
          (g: any) => g.result === "fail" && g.commitSha === commitSha && g.id !== currentGateId,
        ).length + (result.passed ? 0 : 1);

      if (!result.passed && failedGateCount >= 2) {
        await hil.create(
          `QA quality gate has failed ${failedGateCount} times and requires human triage before another development retry.`,
          {
            stage: "qa-sign-off",
            failureCount: failedGateCount,
            reasons: result.reasons,
            defectCount: defects.filter((d: any) => d.status === "open").length,
            criticalDefectCount: defects.filter(
              (d: any) => d.status === "open" && d.severity === "Critical",
            ).length,
            latestGateId: currentGateId,
          },
        );
        fetchHil();
        setGateState("fail");
        return; // Human triage must complete before another automatic retry.
      }

      telemetry.emit("quality_gate_evaluated", "info", {
        passed: result.passed,
        reasons: result.reasons,
      });

      if (result.passed) {
        setGateState("pass");

        // The UAT run is a destination; only the saved QA gate proves the source.
        await handoffs.offer({ version: 1, transition: 'qa_to_uat', sourceRecordId: gateWriteResult.value.id,
          sourceUpdatedAt: gateWriteResult.value._updatedAt ?? gateWriteResult.value._createdAt, commitSha, ticketKeys: [] })
          .catch(error => setGateError(error.message));

      } else {
        setGateState("fail");
        // Route critical defects back to Core Application Development
        const criticalDefects = defects.filter(
          (d: any) => d.status === "open" && d.severity === "Critical",
        );
        if (criticalDefects.length > 0) {
          await integrations.bugs
            .create({
              title: `QA Gate Failed: ${criticalDefects.length} critical defect(s) require resolution`,
              description: result.reasons.join("; "),
              severity: "Critical",
            })
            .catch(() => null);
        }
        await missions.trigger("Core Application Development", {
          qualityGatePassed: false,
          reasons: result.reasons,
          defectCount: defects.filter((d: any) => d.status === "open").length,
          priority: criticalDefects.length > 0 ? "critical" : "normal",
          triggeredBy: "qa-workbench",
          knowledgeContext,
        });
      }
    } catch (err: any) {
      setGateError(err.message);
      setGateState("error");
    }
  }

  async function handleLogDefect(e: React.FormEvent) {
    e.preventDefault();
    if (!defectTitle.trim()) return;
    setDefectLogging(true);
    try {
      await records.create(COL.DEFECTS, {
        title: defectTitle,
        severity: defectSeverity,
        description: defectDesc,
        status: "open",
        timestamp: new Date().toISOString(),
      });
      telemetry.emit("defect_logged", "info", {
        title: defectTitle,
        severity: defectSeverity,
      });
      setDefectTitle("");
      setDefectDesc("");
      setDefectSeverity("Medium");
      fetchData();
    } finally {
      setDefectLogging(false);
    }
  }

  async function handleResolveDefect(defect: any) {
    await records.update(COL.DEFECTS, defect.id, {
      status: "resolved",
      resolvedAt: new Date().toISOString(),
      resolution: "Operator marked resolved; runner verification still required",
    });
    telemetry.emit("defect_resolved", "info", {
      id: defect.id,
      title: defect.title,
    });
    fetchData();
  }


  const openDefects = defects.filter((d: any) => d.status === "open");
  const criticalOpen = openDefects.filter(
    (d: any) => d.severity === "Critical",
  );

  return (
    <div className="flex flex-1 overflow-hidden h-screen">
      <div className="min-h-screen bg-[#090d16] text-white p-6 flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
              SDLC
            </span>
            <h1 className="text-2xl font-bold">
              QA Workbench: Defect Triage Center
            </h1>
            {openDefects.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-400">
                {openDefects.length} open
                {criticalOpen.length > 0
                  ? ` · ${criticalOpen.length} critical`
                  : ""}
              </span>
            )}
            {gateState === "pass" && (
              <span className="ml-auto text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
                ✓ Gate passed — check handoff status
              </span>
            )}
            {gateState === "fail" && (
              <span className="ml-auto text-xs font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3 py-1 rounded-full">
                ✗ Gate failed — review remediation status
              </span>
            )}
          </div>

          <label className="block text-sm mb-4">Commit SHA being evaluated
            <input aria-label="Commit SHA being evaluated" disabled={gateState === "evaluating"} value={commitSha} onChange={e => { setCommitSha(e.target.value.trim()); setGateResult(null); setGateState("idle"); }} className="block w-full bg-slate-900 border border-white/20 rounded p-2 mt-1" placeholder="Full 40-character commit SHA" />
          </label>
          {dataError && <p role="alert" className="text-rose-400 mb-4">Evidence unavailable: {dataError}. Evaluation is blocked.</p>}
          {/* Inline HIL */}
          <HilForm
            requests={pendingHil}
            onResolved={(id) => {
              setPendingHil((q) => q.filter((r) => r.id !== id));
              fetchData();
            }}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex gap-2 border-b border-white/5 pb-2">
                {(["suites", "defects", "gate"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 text-sm font-medium rounded-lg ${activeTab === tab ? "bg-rose-500/10 text-rose-400" : "text-slate-400 hover:text-white"}`}
                  >
                    {tab === "gate"
                      ? "Quality Gate"
                      : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {loading && (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-12 bg-white/5 rounded animate-pulse"
                    />
                  ))}
                </div>
              )}

              {/* Test suites */}
              {!loading && activeTab === "suites" && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h2 className="text-sm font-semibold text-slate-300">
                      Test Suites ({suites.length})
                    </h2>
                    <p className="text-xs text-slate-400">Runner results must include commit SHA, run ID and result URL. Manual passing results are not accepted.</p>
                  </div>
                  {suites.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-4">
                      No test suites logged yet. The QA agent will populate
                      these.
                    </p>
                  ) : (
                    suites.map((s: any) => (
                      <div
                        key={s.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/3 border border-white/5 mb-2"
                      >
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${s.status === "passed" ? "bg-emerald-400" : "bg-rose-400"}`}
                        />
                        <span className="text-sm text-white flex-1">
                          {s.suiteName}
                        </span>
                        <span className="text-xs text-slate-400">
                          {s.passCount}✓ {s.failCount}✗
                        </span>
                        <span
                          className={`text-xs font-mono ${(s.coveragePercent ?? 0) >= 70 ? "text-blue-400" : "text-amber-400"}`}
                        >
                          {s.coveragePercent}%
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Defects + log form */}
              {!loading && activeTab === "defects" && (
                <div className="space-y-4">
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <h2 className="text-sm font-semibold text-slate-300 mb-3">
                      Defects ({defects.length})
                    </h2>
                    {defects.length === 0 ? (
                      <p className="text-sm text-slate-500 text-center py-4">
                        No defects logged. The QA agent will log defects when
                        tests fail.
                      </p>
                    ) : (
                      defects.map((d: any) => (
                        <div
                          key={d.id}
                          className={`px-3 py-2 rounded-lg border mb-2 ${d.severity === "Critical" ? "bg-rose-500/5 border-rose-500/20" : "bg-white/3 border-white/5"}`}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${d.severity === "Critical" ? "bg-rose-500/20 text-rose-400" : d.severity === "High" ? "bg-amber-500/20 text-amber-400" : "bg-slate-700 text-slate-400"}`}
                            >
                              {d.severity}
                            </span>
                            <span className="text-sm text-white flex-1">
                              {d.title}
                            </span>
                            <span
                              className={`text-[10px] ${d.status === "open" ? "text-rose-400" : "text-emerald-400"}`}
                            >
                              {d.status}
                            </span>
                            {d.status === "open" && (
                              <button
                                data-testid="qa-resolve-defect"
                                onClick={() => handleResolveDefect(d)}
                                className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-[10px] font-semibold transition-colors"
                              >
                                Resolve
                              </button>
                            )}
                          </div>
                          {d.description && (
                            <p className="text-xs text-slate-500 mt-1 ml-7">
                              {d.description}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  <form
                    onSubmit={handleLogDefect}
                    className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3"
                  >
                    <h2 className="text-sm font-semibold text-slate-300">
                      Log a Defect
                    </h2>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <label className="text-[10px] text-slate-500 uppercase">
                          Title
                        </label>
                        <input
                          type="text"
                          required
                          value={defectTitle}
                          onChange={(e) => setDefectTitle(e.target.value)}
                          placeholder="Brief description of the defect"
                          className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 uppercase">
                          Severity
                        </label>
                        <select
                          value={defectSeverity}
                          onChange={(e) => setDefectSeverity(e.target.value)}
                          className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm"
                        >
                          <option>Critical</option>
                          <option>High</option>
                          <option>Medium</option>
                          <option>Low</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">
                        Description (optional)
                      </label>
                      <textarea
                        rows={2}
                        value={defectDesc}
                        onChange={(e) => setDefectDesc(e.target.value)}
                        placeholder="Steps to reproduce or additional context"
                        className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm resize-none"
                      />
                    </div>
                    <button
                      data-testid="qa-log-defect"
                      type="submit"
                      disabled={defectLogging}
                      className="w-full py-2 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
                    >
                      {defectLogging ? "Logging…" : "Log Defect"}
                    </button>
                  </form>
                </div>
              )}

              {/* Quality gate */}
              {!loading && activeTab === "gate" && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
                  <h2 className="text-sm font-semibold text-slate-300">
                    Quality Gate Evaluation
                  </h2>

                  {/* Current status summary */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white/3 rounded-lg p-3 text-center">
                      <div
                        className={`text-xl font-bold ${suites.filter((s: any) => s.status === "passed").length === suites.length && suites.length > 0 ? "text-emerald-400" : "text-rose-400"}`}
                      >
                        {
                          suites.filter((s: any) => s.status === "passed")
                            .length
                        }
                        /{suites.length}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Suites Passing
                      </div>
                    </div>
                    <div className="bg-white/3 rounded-lg p-3 text-center">
                      <div
                        className={`text-xl font-bold ${openDefects.length === 0 ? "text-emerald-400" : "text-rose-400"}`}
                      >
                        {openDefects.length}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Open Defects
                      </div>
                    </div>
                    <div className="bg-white/3 rounded-lg p-3 text-center">
                      <div
                        className={`text-xl font-bold ${criticalOpen.length === 0 ? "text-emerald-400" : "text-rose-500"}`}
                      >
                        {criticalOpen.length}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Critical Open
                      </div>
                    </div>
                  </div>

                  {/* Gate result */}
                  {gateResult && (
                    <div
                      className={`p-3 rounded-lg border ${gateResult.passed ? "bg-emerald-500/5 border-emerald-500/20" : "bg-rose-500/5 border-rose-500/20"}`}
                    >
                      <p
                        className={`text-sm font-semibold ${gateResult.passed ? "text-emerald-400" : "text-rose-400"}`}
                      >
                        {gateResult.passed
                          ? "✓ All quality rules passed"
                          : "✗ Gate failed — issues must be resolved"}
                      </p>
                      {gateResult.reasons.map((r, i) => (
                        <p key={i} className="text-xs text-slate-400 mt-1">
                          · {r}
                        </p>
                      ))}
                    </div>
                  )}

                  {gateError && (
                    <p className="text-xs text-rose-400">{gateError}</p>
                  )}

                  <button
                    data-testid="qa-evaluate-gate"
                    onClick={handleEvaluateGate}
                    disabled={
                      gateState === "evaluating" || gateState === "pass" || loading || !!dataError || !/^[a-f0-9]{40}$/i.test(commitSha)
                    }
                    className={`w-full py-2.5 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${
                      gateState === "pass"
                        ? "bg-emerald-700"
                        : "bg-rose-700 hover:bg-rose-600"
                    }`}
                  >
                    {gateState === "evaluating"
                      ? "Evaluating…"
                      : gateState === "pass"
                        ? "✓ Gate Passed — Check Handoff"
                        : "Evaluate Quality Gate"}
                  </button>
                </div>
              )}
            </div>

            <div>
              <AgentChat
                agentName="QA Automation Engineer"
                agentRole="Quality Assurance"
                steeringModes={qualitySteeringModes}
                defaultGreeting="Hello! I'm your QA agent. I can run Playwright tests, analyse test coverage, log defects, and evaluate quality gates. What would you like to test?"
              />
            </div>
          </div>
        </div>
      </div>
      <ActivityFeed position="sidebar" />
    </div>
  );
}
