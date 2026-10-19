/**
 * DependencyRadar — reads QA Workbench collections to flag committed tickets
 * with open defects or failed quality gates.
 */
import React, { useState, useEffect, useCallback } from "react";
import { ShieldAlert, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { records } from "../lib/platform-client";
import { COLLECTIONS } from "../lib/collections";
import type { QaDefectRecord, QaQualityGateRecord, BacklogRecord } from "../lib/collections";

interface Props {
  committedRecords: BacklogRecord[];
}

interface DependencyIssue {
  jiraKey: string;
  type: "defect" | "gate_failure";
  title: string;
  severity?: string;
}

export function DependencyRadar({ committedRecords }: Props) {
  const [issues, setIssues] = useState<DependencyIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const committedKeys = new Set(committedRecords.map((r) => r.jiraKey));

  const loadDependencies = useCallback(async () => {
    if (committedKeys.size === 0) { setIssues([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [defectsRaw, gatesRaw] = await Promise.all([
        records.list(COLLECTIONS.QA_DEFECTS).catch(() => []),
        records.list(COLLECTIONS.QA_QUALITY_GATES).catch(() => []),
      ]);

      const defects = defectsRaw as unknown as QaDefectRecord[];
      const gates = gatesRaw as unknown as QaQualityGateRecord[];

      const found: DependencyIssue[] = [];

      // Check for open Critical/High defects on committed tickets
      for (const defect of defects) {
        if (
          (defect.severity === "Critical" || defect.severity === "High") &&
          defect.status === "open" &&
          defect.jiraKey &&
          committedKeys.has(defect.jiraKey)
        ) {
          found.push({
            jiraKey: defect.jiraKey,
            type: "defect",
            title: defect.title,
            severity: defect.severity,
          });
        }
      }

      // Check for failed quality gates
      const failedGates = gates.filter((g) => g.overallStatus === "failed");
      if (failedGates.length > 0) {
        // If there are any recent failed gates, flag all committed tickets as potentially affected
        const latestFailed = failedGates.sort((a, b) =>
          new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime()
        )[0];
        if (latestFailed) {
          found.push({
            jiraKey: "ALL",
            type: "gate_failure",
            title: `Quality gate failed (${latestFailed.evaluatedAt.split("T")[0]})`,
          });
        }
      }

      setIssues(found);
    } catch (e: any) {
      setError("Unable to check dependencies");
    } finally {
      setLoading(false);
    }
  }, [committedKeys.size]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadDependencies(); }, [loadDependencies]);

  if (loading) {
    return (
      <div className="px-4 py-3 rounded-lg bg-white/5 border border-white/5 text-xs text-slate-500 animate-pulse">
        Checking dependencies...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-white/5 border border-white/5 text-xs text-slate-500">
        <span>{error}</span>
        <button onClick={loadDependencies} className="underline"><RefreshCw className="w-3 h-3 inline" /> Retry</button>
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-400 font-semibold">
        <CheckCircle2 className="w-4 h-4" /> All Clear — no open dependencies on committed tickets
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
        <ShieldAlert className="w-4 h-4" />
        Dependency Radar — {issues.length} issue{issues.length !== 1 ? "s" : ""} found
      </div>
      {issues.map((issue, i) => (
        <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="font-mono text-amber-400 shrink-0">{issue.jiraKey}</span>
          <span className="text-slate-300 flex-1 truncate">{issue.title}</span>
          {issue.severity && (
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
              issue.severity === "Critical" ? "bg-rose-500/20 text-rose-400" : "bg-orange-500/20 text-orange-400"
            }`}>{issue.severity}</span>
          )}
          <span className="text-[9px] text-slate-500">{issue.type === "defect" ? "Open Defect" : "Gate Failed"}</span>
        </div>
      ))}
    </div>
  );
}
