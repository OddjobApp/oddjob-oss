"use client";
import { useState, useEffect, useCallback } from "react";
import {
  fleet,
  records,
  handoffs,
  confluence,
  integrations,
  events,
  hil,
  telemetry,
} from "../../lib/platform-client";
import type { FleetWorkload, HilRequest } from "../../lib/platform-client";
import { HilForm } from "../components/HilForm";
import { useMarkHandoffsRead } from "../../lib/useMarkHandoffsRead";

const COL = {
  UAT_SIGNOFFS: "stakeholder_workbench_uat_signoffs",
  CAB_APPROVALS: "stakeholder_workbench_cab_approvals",
  ROI_CASES: "stakeholder_workbench_roi_cases",
};

type SaveState = "idle" | "saving" | "done" | "error";

export default function StakeholderContent() {
  useMarkHandoffsRead("stakeholder-workbench");

  const [workload, setWorkload] = useState<FleetWorkload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "readiness" | "approvals" | "publish"
  >("readiness");

  // UAT form
  const [uatStatus, setUatStatus] = useState("blocked");
  const [uatNotes, setUatNotes] = useState("");
  const [uatState, setUatState] = useState<SaveState>("idle");
  const [uatError, setUatError] = useState<string | null>(null);

  // CAB form
  const [cabDecision, setCabDecision] = useState("defer");
  const [cabNotes, setCabNotes] = useState("");
  const [cabState, setCabState] = useState<SaveState>("idle");
  const [cabError, setCabError] = useState<string | null>(null);

  const [commitSha, setCommitSha] = useState("");

  // Publish
  const [publishing, setPublishing] = useState(false);
  const [publishUrl, setPublishUrl] = useState<string | null>(null);

  // HIL queue
  const [pendingHil, setPendingHil] = useState<HilRequest[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setWorkload(await fleet.workload());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHil = useCallback(async () => {
    try {
      setPendingHil(await hil.pending("release-gate"));
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

  // Derived readiness metrics
  const agents = workload?.agents ?? [];
  const attention = workload?.attention ?? [];
  const completed = agents.filter((a) => a.status === "completed").length;
  const blocked = agents.filter((a) => a.status === "blocked").length;
  const total = agents.length;
  const readinessScore =
    total > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(55 + (completed / total) * 45 - blocked * 15),
          ),
        )
      : 0;

  async function handleSaveUat(e: React.FormEvent) {
    e.preventDefault();
    setUatState("saving");
    setUatError(null);
    try {
      if (!/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error("A full release commit SHA is required");
      await records.create(COL.UAT_SIGNOFFS, {
        commitSha,
        status: uatStatus,
        notes: uatNotes,
        actor: "operator",
        timestamp: new Date().toISOString(),
      });
      telemetry.emit("uat_signoff_saved", "info", { status: uatStatus });

      setUatState("done");
    } catch (err: any) {
      setUatError(err.message);
      setUatState("error");
    }
  }

  async function handleSaveCab(e: React.FormEvent) {
    e.preventDefault();
    setCabState("saving");
    setCabError(null);
    try {
      if (!/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error("A full release commit SHA is required");
      const [uatRows, gateRows] = await Promise.all([records.list(COL.UAT_SIGNOFFS), records.list("qa_workbench_quality_gates")]);
      const savedUat = uatRows.find(row => row.commitSha === commitSha);
      const savedGate = gateRows.find(row => row.commitSha === commitSha);
      if (cabDecision === "approve" && (loading || error || readinessScore < 80 || blocked > 0 || savedUat?.status !== "approved" || savedGate?.result !== "pass" || savedGate?.evidenceKind !== "runner" || Number(savedGate?.suiteCount ?? 0) < 1))
        throw new Error("Deployment requires current readiness, saved UAT approval and runner-backed QA for the selected commit");
      const [cabWrite] = await Promise.allSettled([
        records.create(COL.CAB_APPROVALS, {
          decision: cabDecision,
          commitSha,
          uatSignoffId: savedUat?.id,
          qualityGateId: savedGate?.id,
          notes: cabNotes,
          actor: "operator",
          timestamp: new Date().toISOString(),
        }),
      ]);
      if (cabWrite.status === "rejected") throw cabWrite.reason;

      telemetry.emit("cab_decision_saved", "info", { decision: cabDecision });

      if (cabDecision === "approve") {
        await handoffs.offer({ version: 1, transition: 'uat_to_deployment', sourceRecordId: cabWrite.value.id,
          sourceUpdatedAt: cabWrite.value._updatedAt ?? cabWrite.value._createdAt, commitSha, ticketKeys: [] })
          .catch(error => setCabError(error.message));
      } else {
        // Notify team of deferral or rejection
        await integrations.slack.post({
          message: `🚫 CAB ${cabDecision === "defer" ? "deferred" : "rejected"} the release. Readiness: ${readinessScore}%. Notes: ${cabNotes || "none"}`,
        });
      }

      setCabState("done");
    } catch (err: any) {
      setCabError(err.message);
      setCabState("error");
    }
  }

  async function handlePublishDigest() {
    setPublishing(true);
    let savedUat: any, savedCab: any;
    try {
      const [uats, cabs] = await Promise.all([records.list(COL.UAT_SIGNOFFS), records.list(COL.CAB_APPROVALS)]);
      savedUat = uats.find(row => row.commitSha === commitSha);
      savedCab = cabs.find(row => row.commitSha === commitSha);
    } catch (err: any) { setCabError(err.message); setPublishing(false); return; }
    const today = new Date().toISOString().split("T")[0];
    const content = `
<h1>Release Readiness Digest — ${today}</h1>
<h2>Executive Summary</h2>
<p><strong>Readiness Score:</strong> ${readinessScore}%</p>
<p><strong>Agent Fleet:</strong> ${completed} of ${total} missions completed · ${blocked} blocked</p>
<p><strong>Cycle Spend:</strong> $${(workload?.summary.tokenSpendUsd ?? 0).toFixed(2)}</p>

<h2>UAT Sign-Off</h2>
<p>Status: <strong>${savedUat?.status ?? "Not saved"}</strong></p>


<h2>CAB Decision</h2>
<p>Decision: <strong>${savedCab?.decision ?? "Not saved"}</strong></p>


<h2>Mission Readiness Map</h2>
<table><tr><th>Agent</th><th>Mission</th><th>Status</th><th>Risk</th></tr>
${agents.map((a) => `<tr><td>${a.agent}</td><td>${a.mission}</td><td>${a.status}</td><td>${a.risk}</td></tr>`).join("")}
</table>
${attention.length > 0 ? `<h2>Attention Items</h2><ul>${attention.map((i) => `<li><strong>${i.severity}:</strong> ${i.agent} — ${i.reason}</li>`).join("")}</ul>` : ""}
    `.trim();

    try {
      const result = await confluence.publish({
        title: `Release Digest — ${today}`,
        content,
      });
      if (result.success) {
        setPublishUrl(result.url ?? null);
        telemetry.emit("release_digest_published", "info", {
          confluencePageId: result.pageId,
          url: result.url,
        });
      }
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#070b12] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            SDLC
          </span>
          <h1 className="text-2xl font-bold">
            Stakeholder Workbench: Release Gateway
          </h1>
          {cabState === "done" && cabDecision === "approve" && (
            <span className="ml-auto text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
              ✓ CAB decision saved — no deployment launched
            </span>
          )}
        </div>

        <label className="block text-sm mb-4">Release commit SHA
          <input aria-label="Release commit SHA" disabled={uatState === "saving" || cabState === "saving"} value={commitSha} onChange={e => { setCommitSha(e.target.value.trim()); setUatState("idle"); setCabState("idle"); setUatStatus("blocked"); setCabDecision("defer"); }} className="block w-full bg-slate-900 border border-white/20 rounded p-2 mt-1" placeholder="Full 40-character commit SHA" />
        </label>
        {/* Inline HIL */}
        <HilForm
          requests={pendingHil}
          onResolved={(id) => {
            setPendingHil((q) => q.filter((r) => r.id !== id));
            fetchData();
          }}
        />

        {/* Readiness score row */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
            <div
              className={`text-3xl font-bold ${readinessScore >= 80 ? "text-emerald-400" : readinessScore >= 50 ? "text-amber-400" : "text-rose-400"}`}
            >
              {readinessScore}%
            </div>
            <div className="text-xs text-slate-500">Readiness</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
            <div className="text-xl font-bold text-rose-400">{blocked}</div>
            <div className="text-xs text-slate-500">Blocked Gates</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
            <div className="text-xl font-bold text-emerald-400">
              {completed}/{total}
            </div>
            <div className="text-xs text-slate-500">Missions Done</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
            <div className="text-xl font-bold text-teal-400">
              ${(workload?.summary.tokenSpendUsd ?? 0).toFixed(2)}
            </div>
            <div className="text-xs text-slate-500">Cycle Spend</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-white/5 pb-2 mb-6">
          {(["readiness", "approvals", "publish"] as const).map((tab) => (
            <button
              title={
                tab === "publish"
                  ? "Jira & Confluence"
                  : tab.charAt(0).toUpperCase() + tab.slice(1)
              }
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-lg ${activeTab === tab ? "bg-indigo-500/10 text-indigo-400" : "text-slate-400 hover:text-white"}`}
            >
              {tab === "publish"
                ? "Jira & Confluence"
                : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {loading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 bg-white/5 rounded-lg animate-pulse"
              />
            ))}
          </div>
        )}

        {/* Readiness map */}
        {!loading && activeTab === "readiness" && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">
              Mission Readiness Map
            </h2>
            {agents.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">
                No active agents. Start a cycle to see readiness.
              </p>
            ) : (
              agents.map((agent) => (
                <div
                  key={agent.agent}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/3 border border-white/5 mb-2"
                >
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${agent.risk === "high" ? "bg-rose-400" : agent.risk === "medium" ? "bg-amber-400" : "bg-emerald-400"}`}
                  />
                  <span className="text-sm text-white flex-1">
                    {agent.mission}
                  </span>
                  <span className="text-xs text-slate-500">{agent.agent}</span>
                  <span
                    className={`text-xs ${agent.status === "completed" ? "text-emerald-400" : agent.status === "blocked" ? "text-rose-400" : "text-slate-400"}`}
                  >
                    {agent.status}
                  </span>
                </div>
              ))
            )}
            {attention.length > 0 && (
              <div className="mt-4 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                <h3 className="text-xs font-bold text-amber-400 mb-2">
                  Attention Items
                </h3>
                {attention.map((item, i) => (
                  <p key={i} className="text-xs text-slate-300">
                    <span className="text-amber-400">{item.mission}</span>:{" "}
                    {item.reason}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Approvals */}
        {!loading && activeTab === "approvals" && (
          <div className="grid grid-cols-2 gap-4">
            {/* UAT */}
            <form
              onSubmit={handleSaveUat}
              className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-300">
                  UAT Sign-Off
                </h2>
                {uatState === "done" && (
                  <span className="text-xs text-emerald-400 ml-auto">
                    ✓ Saved
                  </span>
                )}
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase">
                  Decision
                </label>
                <select
                  title="UAT Decision"
                  value={uatStatus}
                  onChange={(e) => setUatStatus(e.target.value)}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm"
                >
                  <option value="approved">Approved</option>
                  <option value="blocked">Blocked — Issues Remain</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase">
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={uatNotes}
                  onChange={(e) => setUatNotes(e.target.value)}
                  placeholder="Any UAT findings or conditions…"
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm resize-none"
                />
              </div>
              {uatError && <p className="text-xs text-rose-400">{uatError}</p>}
              <button
                data-testid="stakeholder-save-uat"
                title="Save UAT Decision"
                type="submit"
                disabled={uatState === "saving" || uatState === "done"}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
              >
                {uatState === "saving"
                  ? "Saving…"
                  : uatState === "done"
                    ? "✓ UAT Decision Saved"
                    : "Save UAT Decision"}
              </button>
            </form>

            {/* CAB */}
            <form
              onSubmit={handleSaveCab}
              className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-300">
                  CAB Decision
                </h2>
                {cabState === "done" && (
                  <span className="text-xs text-emerald-400 ml-auto">
                    ✓ Saved
                  </span>
                )}
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase">
                  Decision
                </label>
                <select
                  title="CAB Decision"
                  value={cabDecision}
                  onChange={(e) => setCabDecision(e.target.value)}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm"
                >
                  <option value="approve">Approve for Deployment</option>
                  <option value="defer">Defer to Next Release</option>
                  <option value="reject">Reject</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase">
                  Rationale
                </label>
                <textarea
                  rows={2}
                  value={cabNotes}
                  onChange={(e) => setCabNotes(e.target.value)}
                  placeholder="Change advisory board rationale…"
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm resize-none"
                />
              </div>
              {readinessScore < 80 && cabDecision === "approve" && (
                <p className="text-xs text-amber-400">
                  ⚠ Readiness is {readinessScore}% — approving below 80%
                  threshold.
                </p>
              )}
              {cabError && <p className="text-xs text-rose-400">{cabError}</p>}
              <button
                data-testid="stakeholder-approve-cab"
                title="Save CAB Decision"
                type="submit"
                disabled={cabState === "saving" || cabState === "done" || !/^[a-f0-9]{40}$/i.test(commitSha) || (cabDecision === "approve" && (loading || !!error || readinessScore < 80 || blocked > 0))}
                className={`w-full py-2 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors ${
                  cabDecision === "approve"
                    ? "bg-emerald-700 hover:bg-emerald-600"
                    : "bg-rose-800 hover:bg-rose-700"
                }`}
              >
                {cabState === "saving"
                  ? cabDecision === "approve"
                    ? "Saving approval…"
                    : "Saving…"
                  : cabState === "done"
                    ? cabDecision === "approve"
                      ? "✓ Approval Saved — Check Handoff"
                      : "✓ Decision Saved"
                    : cabDecision === "approve"
                      ? "Approve & Prepare Deployment Handoff"
                      : "Save CAB Decision"}
              </button>
            </form>
          </div>
        )}

        {/* Publish */}
        {!loading && activeTab === "publish" && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
            <h2 className="text-sm font-semibold text-slate-300">
              Publish Release Digest to Confluence
            </h2>
            <p className="text-sm text-slate-500">
              Generates a structured release packet including readiness score,
              mission map, UAT and CAB decisions, and attention items.
            </p>
            {publishUrl && (
              <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
                <p className="text-xs text-emerald-400">
                  ✓ Published successfully
                </p>
                <a
                  href={publishUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-400 underline break-all"
                >
                  {publishUrl}
                </a>
              </div>
            )}
            <button
              title="Publish to Confluence"
              onClick={handlePublishDigest}
              disabled={publishing}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
            >
              {publishing ? "Publishing…" : "Publish to Confluence"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
