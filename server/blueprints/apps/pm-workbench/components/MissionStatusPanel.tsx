/**
 * MissionStatusPanel — Mission-2 run status and log viewer.
 */
import React from "react";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, RefreshCw, Activity } from "lucide-react";
import type { MissionStatus } from "../lib/hooks";

interface Props {
  missionStatus: MissionStatus;
  onRetry: () => void;
  onScrollToSignoff: () => void;
}

export function MissionStatusPanel({ missionStatus, onRetry, onScrollToSignoff }: Props) {
  const { status, runId, logs, loading, error } = missionStatus;

  // No mission run
  if (!runId && !loading) {
    return (
      <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-5">
        <div className="flex items-center gap-2 text-slate-400 mb-2">
          <Activity className="w-4 h-4" />
          <h3 className="text-sm font-semibold">Mission-2: Requirements & Design</h3>
        </div>
        <p className="text-xs text-slate-500">Mission-2 has not yet been started for this ticket.</p>
      </div>
    );
  }

  const statusColor =
    status === "completed" ? "text-emerald-400" :
    status === "failed" ? "text-rose-400" :
    status === "waiting" ? "text-amber-400" :
    status === "active" ? "text-blue-400" :
    "text-slate-400";

  const StatusIcon =
    status === "completed" ? CheckCircle2 :
    status === "failed" ? XCircle :
    status === "active" ? Loader2 :
    status === "waiting" ? AlertTriangle :
    Activity;

  return (
    <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <StatusIcon className={`w-4 h-4 ${statusColor} ${status === "active" ? "animate-spin" : ""}`} />
          <h3 className="text-sm font-semibold text-slate-200">Mission-2: Requirements & Design</h3>
          {runId && <span className="text-[10px] font-mono text-slate-500">Run #{runId}</span>}
        </div>
        <span className={`text-xs font-semibold ${statusColor}`}>
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      </div>

      {/* Waiting banner */}
      {status === "waiting" && (
        <button
          onClick={onScrollToSignoff}
          className="w-full mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium text-left hover:bg-amber-500/15 transition-colors"
        >
          Human input required — review the sign-off form below ↓
        </button>
      )}

      {/* Error */}
      {error && (
        <div className="mb-3 flex items-center justify-between px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
          <span>{error}</span>
          <button onClick={onRetry} className="flex items-center gap-1 ml-2 underline">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && logs.length === 0 && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-4 bg-white/5 rounded animate-pulse" />)}
        </div>
      )}

      {/* Log entries */}
      {logs.length > 0 && (
        <div className="max-h-48 overflow-y-auto space-y-1">
          {logs.map((log) => (
            <div
              key={log.id}
              className={`flex gap-3 text-[11px] font-mono px-2 py-1 rounded ${
                log.level === "error" ? "bg-rose-500/10 text-rose-300" :
                log.level === "debug" ? "text-slate-500" :
                "text-slate-300"
              }`}
            >
              <span className="text-slate-600 shrink-0">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span className={`uppercase font-bold w-10 shrink-0 ${
                log.level === "error" ? "text-rose-400" :
                log.level === "debug" ? "text-slate-500" :
                "text-blue-400"
              }`}>
                {log.level}
              </span>
              <span className="flex-1 break-all">{log.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Empty logs */}
      {!loading && logs.length === 0 && !error && runId && (
        <p className="text-xs text-slate-500">No log entries yet.</p>
      )}
    </div>
  );
}
