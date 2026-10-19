/**
 * JiraStatusControls — transition buttons for defect Jira tickets.
 */
import React, { useState } from "react";
import { ArrowRight, Loader2, AlertCircle } from "lucide-react";
import { jira, telemetry } from "../lib/platform-client";

interface Props {
  issueKey: string;
  currentStatus: string;
}

const COMMON_TRANSITIONS = ["In Progress", "Code Review", "In QA", "Done", "Resolved", "Closed"];

export function JiraStatusControls({ issueKey, currentStatus }: Props) {
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [status, setStatus] = useState(currentStatus);
  const [error, setError] = useState<string | null>(null);

  async function handleTransition(transitionName: string) {
    setTransitioning(transitionName);
    setError(null);
    try {
      const result = await jira.transition(issueKey, transitionName);
      if (result.success) {
        setStatus(transitionName);
        telemetry.emit("defect_jira_transitioned", "info", { jiraKey: issueKey, fromStatus: status, toStatus: transitionName });
      } else {
        setError(result.error ?? `Transition "${transitionName}" not available`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTransitioning(null);
    }
  }

  // Show transitions that aren't the current status
  const available = COMMON_TRANSITIONS.filter((t) => t.toLowerCase() !== status.toLowerCase());

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500">Jira Status:</span>
        <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-semibold">{status}</span>
      </div>
      {error && <div className="text-[10px] text-rose-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</div>}
      <div className="flex flex-wrap gap-1">
        {available.slice(0, 4).map((t) => (
          <button key={t} onClick={() => handleTransition(t)} disabled={!!transitioning}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-lg transition-colors disabled:opacity-50">
            {transitioning === t ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
