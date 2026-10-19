"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  jira,
  fleet,
  records,
  missions,
  handoffs,
  events,
  hil,
  telemetry,
  knowledge,
} from "../../lib/platform-client";
import type {
  JiraIssue,
  FleetWorkload,
  HilRequest,
} from "../../lib/platform-client";
import { AgentChat } from "../components/AgentChat";
import { planningSteeringModes } from "../../lib/steering-modes";
import { HilForm } from "../components/HilForm";
import { ActivityFeed } from "../components/ActivityFeed";
import { useMarkHandoffsRead } from "../../lib/useMarkHandoffsRead";

const COL = {
  CAPACITY: "scrum_workbench_capacity_plans",
  BLOCKERS: "scrum_workbench_blockers",
};

type SubmitState = "idle" | "saving" | "done" | "error";

export default function ScrumMasterContent() {
  useMarkHandoffsRead("scrum-master-workbench");

  const [sprintTickets, setSprintTickets] = useState<JiraIssue[]>([]);
  const [workload, setWorkload] = useState<FleetWorkload | null>(null);
  const [blockers, setBlockers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "capacity" | "backlog" | "blockers"
  >("capacity");

  // Capacity form
  const [sprintNum, setSprintNum] = useState("");
  const [engineerDays, setEngineerDays] = useState("");
  const [targetVelocity, setTargetVelocity] = useState("");
  const [capacityState, setCapacityState] = useState<SubmitState>("idle");
  const [capacityError, setCapacityError] = useState<string | null>(null);

  // Blocker form
  const [blockerTitle, setBlockerTitle] = useState("");
  const [blockerAgent, setBlockerAgent] = useState("");
  const [blockerState, setBlockerState] = useState<SubmitState>("idle");

  // Cross-workbench reads
  const [qaDefects, setQaDefects] = useState<any[]>([]);
  const [qualityGates, setQualityGates] = useState<any[]>([]);

  // HIL queue
  const [pendingHil, setPendingHil] = useState<HilRequest[]>([]);

  const fetchData = useCallback(async () => {
    const [
      jiraResult,
      fleetData,
      blockerRecords,
      qaDefectRecords,
      qualityGateRecords,
    ] = await Promise.all([
      jira
        .search("sprint in openSprints() ORDER BY priority DESC", 30)
        .catch(() => ({ success: false, issues: [] as JiraIssue[] })),
      fleet.workload().catch(() => null),
      records.list(COL.BLOCKERS).catch(() => []),
      records.list("qa_workbench_defects").catch(() => []),
      records.list("qa_workbench_quality_gates").catch(() => []),
    ]);
    if (jiraResult.success) setSprintTickets(jiraResult.issues);
    else setError("Could not load sprint backlog");
    setWorkload(fleetData);
    setBlockers(blockerRecords);
    setQaDefects(qaDefectRecords);
    setQualityGates(qualityGateRecords);
    setLoading(false);
  }, []);

  const fetchHil = useCallback(async () => {
    try {
      setPendingHil(await hil.pending("sprint-capacity"));
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

  async function handleCapacitySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (![sprintNum, engineerDays, targetVelocity].every(value => value.trim() && Number.isFinite(Number(value)) && Number(value) > 0)) {
      setCapacityError('Enter a positive sprint number, engineer-days and target velocity.');
      return;
    }
    setCapacityState("saving");
    setCapacityError(null);
    try {
      const [capacityWrite, knowledgeResult] = await Promise.allSettled([
        records.create(COL.CAPACITY, {
          ticketKeys: sprintTickets.map(ticket => ticket.key),
          sprintNum: Number(sprintNum),
          engineerDays: Number(engineerDays),
          targetVelocity: Number(targetVelocity),
          actor: "operator",
          timestamp: new Date().toISOString(),
        }),
        knowledge.query(
          `sprint planning velocity capacity engineering practices sprint ${sprintNum}`,
          3,
        ),
      ]);
      if (capacityWrite.status === "rejected") throw capacityWrite.reason;
      const knowledgeContext =
        knowledgeResult.status === "fulfilled"
          ? knowledgeResult.value.results
              .slice(0, 3)
              .map((r) => ({ content: r.content, source: r.source }))
          : [];

      telemetry.emit("sprint_capacity_committed", "info", {
        sprintNum,
        engineerDays,
        targetVelocity,
      });

      const launch = await missions.trigger("Sprint Kickoff & Planning", {
        sprintNum: Number(sprintNum),
        engineerDays: Number(engineerDays),
        targetVelocity: Number(targetVelocity),
        triggeredBy: "scrum-master-workbench",
        knowledgeContext,
      });

      await handoffs.offer({ version: 1, transition: 'planning_to_development', sourceRecordId: capacityWrite.value.id,
        sourceUpdatedAt: capacityWrite.value._updatedAt ?? capacityWrite.value._createdAt, sourceRunId: launch.runId!, ticketKeys: sprintTickets.map(ticket => ticket.key) })
        .catch(error => setCapacityError(error.message));

      setCapacityState("done");
    } catch (err: any) {
      setCapacityError(err.message);
      setCapacityState("error");
    }
  }

  async function handleLogBlocker(e: React.FormEvent) {
    e.preventDefault();
    if (!blockerTitle.trim()) return;
    setBlockerState("saving");
    try {
      await records.create(COL.BLOCKERS, {
        title: blockerTitle,
        agent: blockerAgent,
        status: "open",
        timestamp: new Date().toISOString(),
      });
      telemetry.emit("blocker_logged", "info", {
        title: blockerTitle,
        agent: blockerAgent,
      });
      setBlockerTitle("");
      setBlockerAgent("");
      setBlockerState("done");
      fetchData();
    } catch (err: any) {
      setBlockerState("error");
    }
  }

  const busyAgents =
    workload?.agents.filter((a) => a.status === "active") ?? [];
  const openBlockers = blockers.filter((b: any) => b.status === "open");

  return (
    <div className="flex flex-1 overflow-hidden h-screen">
      <div className="min-h-screen bg-[#08070b] text-white p-6 flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              SDLC
            </span>
            <h1 className="text-2xl font-bold">
              Scrum Master Workbench: Sprint Planning
            </h1>
            {capacityState === "done" && (
              <span className="ml-auto text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
                ✓ Sprint committed — Kickoff mission triggered
              </span>
            )}
          </div>

          {/* Inline HIL */}
          <HilForm
            requests={pendingHil}
            onResolved={(id) => {
              setPendingHil((q) => q.filter((r) => r.id !== id));
              fetchData();
            }}
          />

          {/* Fleet summary */}
          {workload && (
            <div className="grid grid-cols-4 gap-3 mb-6">
              {[
                {
                  label: "Active",
                  value: workload.summary.active,
                  color: "text-blue-400",
                },
                {
                  label: "Blocked",
                  value: workload.summary.blocked,
                  color: "text-amber-400",
                },
                {
                  label: "Idle",
                  value: workload.summary.idle,
                  color: "text-slate-400",
                },
                {
                  label: "Completed",
                  value: workload.summary.completed,
                  color: "text-emerald-400",
                },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className="bg-white/5 border border-white/10 rounded-xl p-3 text-center"
                >
                  <div className={`text-xl font-bold ${color}`}>{value}</div>
                  <div className="text-[10px] text-slate-500">{label}</div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex gap-2 border-b border-white/5 pb-2">
                {(["capacity", "backlog", "blockers"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`relative px-4 py-2 text-sm font-medium rounded-lg ${activeTab === tab ? "bg-amber-500/10 text-amber-400" : "text-slate-400 hover:text-white"}`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {tab === "blockers" && openBlockers.length > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-[9px] font-bold text-white flex items-center justify-center">
                        {openBlockers.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Capacity planning */}
              {activeTab === "capacity" && (
                <form
                  onSubmit={handleCapacitySubmit}
                  className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4"
                >
                  <h2 className="text-sm font-semibold text-amber-400">
                    Sprint Capacity Planning
                  </h2>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">
                        Sprint #
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={sprintNum}
                        onChange={(e) => setSprintNum(e.target.value)}
                        className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">
                        Engineer-Days
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={engineerDays}
                        onChange={(e) => setEngineerDays(e.target.value)}
                        className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">
                        Target Velocity
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={targetVelocity}
                        onChange={(e) => setTargetVelocity(e.target.value)}
                        className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm"
                      />
                    </div>
                  </div>
                  {capacityError && (
                    <p className="text-xs text-rose-400">{capacityError}</p>
                  )}
                  <button
                    data-testid="scrum-save-capacity"
                    type="submit"
                    disabled={capacityState === "saving" || !sprintNum || !engineerDays || !targetVelocity || Number(sprintNum) <= 0 || Number(engineerDays) <= 0 || Number(targetVelocity) <= 0}
                    className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
                  >
                    {capacityState === "saving"
                      ? "Saving & Triggering Kickoff…"
                      : "Save & Trigger Sprint Kickoff"}
                  </button>
                </form>
              )}

              {/* QA Pulse — cross-workbench read */}
              {activeTab === "capacity" &&
                (qaDefects.length > 0 || qualityGates.length > 0) &&
                (() => {
                  const openDefects = qaDefects.filter(
                    (d: any) => d.status === "open",
                  );
                  const critical = openDefects.filter(
                    (d: any) => d.severity === "Critical",
                  );
                  const high = openDefects.filter(
                    (d: any) => d.severity === "High",
                  );
                  const other = openDefects.filter(
                    (d: any) =>
                      d.severity !== "Critical" && d.severity !== "High",
                  );
                  const latestGate =
                    qualityGates.length > 0
                      ? qualityGates
                          .slice()
                          .sort(
                            (a: any, b: any) =>
                              new Date(b.timestamp ?? 0).getTime() -
                              new Date(a.timestamp ?? 0).getTime(),
                          )[0]
                      : null;
                  return (
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-violet-400">
                          QA Pulse
                        </h2>
                        <span className="text-[10px] text-slate-500 italic">
                          Data from QA Workbench — read-only
                        </span>
                      </div>

                      {/* Defect summary */}
                      <div className="flex items-center gap-4">
                        <span className="text-xs text-slate-400">
                          Open defects:
                        </span>
                        <span className="text-sm font-bold text-white">
                          {openDefects.length}
                        </span>
                        {critical.length > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                            {critical.length} Critical
                          </span>
                        )}
                        {high.length > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                            {high.length} High
                          </span>
                        )}
                        {other.length > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-500/20 text-slate-400 border border-slate-500/20">
                            {other.length} Other
                          </span>
                        )}
                      </div>

                      {/* Latest quality gate */}
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400">
                          Latest quality gate:
                        </span>
                        {latestGate ? (
                          <>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                latestGate.result === "pass"
                                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                  : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                              }`}
                            >
                              {latestGate.result === "pass" ? "PASS" : "FAIL"}
                            </span>
                            {latestGate.timestamp && (
                              <span className="text-[10px] text-slate-500">
                                {new Date(
                                  latestGate.timestamp,
                                ).toLocaleString()}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-slate-500">
                            No gate evaluated yet
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

              {/* Sprint backlog */}
              {activeTab === "backlog" && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <h2 className="text-sm font-semibold text-slate-300 mb-3">
                    Active Sprint Backlog ({sprintTickets.length} tickets)
                  </h2>
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
                  {error && (
                    <div className="text-sm text-rose-400">{error}</div>
                  )}
                  {sprintTickets.map((t) => (
                    <div
                      key={t.key}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/3 border border-white/5 mb-2"
                    >
                      <span className="font-mono text-xs text-amber-400 w-20">
                        {t.key}
                      </span>
                      <span className="text-sm text-white flex-1 truncate">
                        {t.summary}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {t.status}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {t.priority}
                      </span>
                    </div>
                  ))}
                  {!loading && sprintTickets.length === 0 && (
                    <p className="text-sm text-slate-500 text-center py-4">
                      No tickets in active sprint.
                    </p>
                  )}
                </div>
              )}

              {/* Blockers */}
              {activeTab === "blockers" && (
                <div className="space-y-4">
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <h2 className="text-sm font-semibold text-rose-400 mb-3">
                      Open Blockers ({openBlockers.length})
                    </h2>
                    {openBlockers.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        No blockers logged for this sprint.
                      </p>
                    ) : (
                      openBlockers.map((b: any) => (
                        <div
                          key={b.id}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-rose-500/5 border border-rose-500/20 mb-2"
                        >
                          <span className="w-2 h-2 rounded-full bg-rose-400 flex-shrink-0" />
                          <span className="text-sm text-white flex-1">
                            {b.title}
                          </span>
                          {b.agent && (
                            <span className="text-xs text-slate-500">
                              {b.agent}
                            </span>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  {/* QA Defects Escalated as Blockers — cross-workbench read */}
                  {(() => {
                    const escalated = qaDefects.filter(
                      (d: any) =>
                        d.severity === "Critical" && d.status === "open",
                    );
                    if (escalated.length === 0) return null;
                    return (
                      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                        <h2 className="text-sm font-semibold text-rose-300 mb-3">
                          QA Defects Escalated as Blockers
                        </h2>
                        {escalated.map((d: any) => (
                          <div
                            key={d.id}
                            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-rose-500/5 border border-rose-500/20 mb-2"
                          >
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30 flex-shrink-0">
                              {d.severity}
                            </span>
                            <span className="text-sm text-white flex-1">
                              {d.title}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  <form
                    onSubmit={handleLogBlocker}
                    className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3"
                  >
                    <h2 className="text-sm font-semibold text-slate-300">
                      Log a Blocker
                    </h2>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">
                        Description
                      </label>
                      <input
                        type="text"
                        required
                        value={blockerTitle}
                        onChange={(e) => setBlockerTitle(e.target.value)}
                        placeholder="What is blocked and why?"
                        className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">
                        Blocked Agent (optional)
                      </label>
                      <input
                        type="text"
                        value={blockerAgent}
                        onChange={(e) => setBlockerAgent(e.target.value)}
                        placeholder="e.g. Backend Developer"
                        className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={blockerState === "saving"}
                      className="w-full py-2 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
                    >
                      {blockerState === "saving" ? "Logging…" : "Log Blocker"}
                    </button>
                  </form>
                </div>
              )}
            </div>

            <div>
              <AgentChat
                agentName="Scrum Master"
                agentRole="Agile Coach"
                steeringModes={planningSteeringModes.filter(
                  (mode) =>
                    mode.id === "dependency-discovery" ||
                    mode.id === "change-impact",
                )}
                defaultGreeting="Hello! I'm your Scrum Master agent. I can help plan sprint capacity, analyse velocity trends, identify blockers, and coordinate the development team. What would you like to work on?"
                agentsList={[
                  {
                    name: "Scrum Master",
                    label: "Scrum Master",
                    role: "Agile Coach",
                  },
                  {
                    name: "Backend Developer",
                    label: "Backend Dev",
                    role: "Systems Engineer",
                  },
                ]}
              />
            </div>
          </div>
        </div>
      </div>
      <ActivityFeed position="sidebar" />
    </div>
  );
}
