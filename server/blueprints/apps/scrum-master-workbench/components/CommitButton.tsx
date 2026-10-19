/**
 * CommitButton — Sprint commit control with velocity anomaly confirmation dialog.
 */
import React, { useState } from "react";
import { Rocket, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { missions, telemetry } from "../lib/platform-client";
import type { BacklogRecord, HandoffRecord } from "../lib/collections";

interface Props {
  sprintNumber: number;
  committedRecords: BacklogRecord[];
  targetVelocity: number | null;
  anomalyThreshold: number;
  capacityPlanComplete: boolean;
  alreadyCommitted: boolean;
  commitTimestamp: string | null;
  onHandoffCreated: (handoff: HandoffRecord) => Promise<void>;
  onBacklogUpdated: (jiraKey: string, runId: number) => Promise<void>;
}

export function CommitButton({
  sprintNumber,
  committedRecords,
  targetVelocity,
  anomalyThreshold,
  capacityPlanComplete,
  alreadyCommitted,
  commitTimestamp,
  onHandoffCreated,
  onBacklogUpdated,
}: Props) {
  const [confirming, setConfirming]   = useState(false);
  const [committing, setCommitting]   = useState(false);
  const [progress, setProgress]       = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary]         = useState<{ success: number; failed: number } | null>(null);
  const [errors, setErrors]           = useState<string[]>([]);

  const committedPoints = committedRecords.reduce((s, r) => s + (r.storyPoints ?? 0), 0);
  const deviation = targetVelocity && targetVelocity > 0
    ? (committedPoints - targetVelocity) / targetVelocity
    : null;
  const isAnomaly = deviation !== null && Math.abs(deviation) > anomalyThreshold;

  const canCommit =
    capacityPlanComplete &&
    committedRecords.length > 0 &&
    !alreadyCommitted;

  async function doCommit() {
    setCommitting(true);
    setConfirming(false);
    setErrors([]);
    setProgress({ done: 0, total: committedRecords.length });

    let success = 0;
    let failed  = 0;
    const errs: string[] = [];

    for (let i = 0; i < committedRecords.length; i++) {
      const record = committedRecords[i];
      try {
        const result = await missions.trigger("Core Application Development", {
          jiraKey: record.jiraKey,
          sprintNumber,
        });
        await onHandoffCreated({
          jiraKey: record.jiraKey,
          mission3RunId: result.runId,
          sprintNumber,
          triggeredAt: new Date().toISOString(),
          triggeredBy: "scrum-master-workbench",
        });
        await onBacklogUpdated(record.jiraKey, result.runId);
        success++;
      } catch (e: any) {
        failed++;
        errs.push(`${record.jiraKey}: ${e.message ?? "trigger failed"}`);
      }
      setProgress({ done: i + 1, total: committedRecords.length });
    }

    telemetry.emit("sprint_committed", "info", {
      sprintNumber,
      committedTicketCount: committedRecords.length,
      totalStoryPoints: committedPoints,
    });

    // Emit stage_handoff event (Planning → Development)
    if (success > 0) {
      telemetry.emit("stage_handoff", "info", {
        sourceStage: "Planning",
        targetStage: "Development",
        sourceMission: "Sprint Kickoff & Planning",
        targetMission: "Core Application Development",
        ticketKeys: committedRecords.filter((_, i) => i < success).map((r) => r.jiraKey),
        triggeredBy: "scrum-master-workbench",
        runId: sprintNumber,
      });
    }

    setSummary({ success, failed });
    setErrors(errs);
    setCommitting(false);
  }

  function handleClick() {
    if (isAnomaly) {
      setConfirming(true);
    } else {
      doCommit();
    }
  }

  // Already committed state
  if (alreadyCommitted) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
        <CheckCircle2 className="w-5 h-5 shrink-0" />
        <div>
          <div className="text-sm font-semibold">Sprint {sprintNumber} Committed</div>
          {commitTimestamp && (
            <div className="text-xs text-emerald-400/70">
              {new Date(commitTimestamp).toLocaleString()}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Post-commit summary
  if (summary) {
    return (
      <div className="space-y-3">
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
          summary.failed === 0
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
            : "bg-amber-500/10 border-amber-500/20 text-amber-400"
        }`}>
          {summary.failed === 0 ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
          <span className="text-sm font-semibold">
            Sprint committed: {summary.success} ticket{summary.success !== 1 ? "s" : ""} triggered
            {summary.failed > 0 ? `, ${summary.failed} failed` : ""}
          </span>
        </div>
        {errors.length > 0 && (
          <div className="space-y-1">
            {errors.map((e, i) => (
              <div key={i} className="px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">{e}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // In-progress
  if (committing && progress) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
          <Loader2 className="w-5 h-5 animate-spin shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold">Triggering Core Development…</div>
            <div className="text-xs text-blue-400/70 mt-0.5">
              {progress.done} / {progress.total} tickets
            </div>
          </div>
        </div>
        <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Anomaly confirmation dialog */}
      {confirming && deviation !== null && (
        <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Committed story points deviate from target velocity by{" "}
              <strong>{Math.round(Math.abs(deviation) * 100)}%</strong>.
              Proceed with sprint commit?
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={doCommit}
              className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              Yes, commit sprint
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <button
        onClick={handleClick}
        disabled={!canCommit || committing}
        aria-label={`Commit sprint ${sprintNumber} and trigger Core Application Development`}
        className="flex items-center justify-center gap-2 w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl text-sm font-bold transition-colors"
      >
        <Rocket className="w-4 h-4" />
        Commit Sprint & Trigger Development
      </button>

      {!capacityPlanComplete && (
        <p className="text-xs text-slate-500 text-center">Complete the capacity plan before committing.</p>
      )}
      {committedRecords.length === 0 && capacityPlanComplete && (
        <p className="text-xs text-slate-500 text-center">Select at least one ticket to commit.</p>
      )}
    </div>
  );
}
