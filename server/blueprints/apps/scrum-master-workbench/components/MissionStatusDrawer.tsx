/**
 * MissionStatusDrawer — collapsible bottom drawer showing Mission-1 run status and logs.
 */
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronUp, ChevronDown, CheckCircle2, XCircle, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import type { MissionStatus } from "../lib/hooks";

interface Props {
  missionStatus: MissionStatus;
  onRetry: () => void;
}

export function MissionStatusDrawer({ missionStatus, onRetry }: Props) {
  const [open, setOpen] = useState(false);
  const { status, logs, loading, error, runId } = missionStatus;

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
    null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-[#0e0c14]/95 backdrop-blur-md">
      {/* Handle bar */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-3 hover:bg-white/5 transition-colors"
        aria-expanded={open}
        aria-label="Toggle mission status drawer"
      >
        <div className="flex items-center gap-3">
          {StatusIcon && (
            <StatusIcon
              className={`w-4 h-4 ${statusColor} ${status === "active" ? "animate-spin" : ""}`}
            />
          )}
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Mission-1: Sprint Kickoff & Planning
          </span>
          {runId && (
            <span className="text-[10px] font-mono text-slate-500">Run #{runId}</span>
          )}
          <span className={`text-xs font-semibold ${statusColor}`}>
            {status === "idle" ? "Not started" : status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 280, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="h-[280px] overflow-y-auto px-6 pb-4">
              {/* Waiting banner */}
              {status === "waiting" && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium">
                  Human input required — complete the capacity form above
                </div>
              )}

              {/* Error banner */}
              {error && (
                <div className="mb-3 flex items-center justify-between px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                  <span>{error}</span>
                  <button
                    onClick={onRetry}
                    className="flex items-center gap-1 ml-3 px-2 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" /> Retry
                  </button>
                </div>
              )}

              {/* Loading skeleton */}
              {loading && logs.length === 0 && (
                <div className="space-y-2 mt-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-4 bg-white/5 rounded animate-pulse" />
                  ))}
                </div>
              )}

              {/* Log entries */}
              {logs.length > 0 && (
                <div className="space-y-1 mt-1">
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

              {/* Empty state */}
              {!loading && logs.length === 0 && !error && (
                <p className="text-xs text-slate-500 mt-2">
                  {runId ? "No log entries yet." : "Mission-1 has not been triggered for this sprint."}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
