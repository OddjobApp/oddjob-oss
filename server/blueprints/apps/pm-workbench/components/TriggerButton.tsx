/**
 * TriggerButton — Mission-3 trigger with idempotency guard.
 */
import React, { useState } from "react";
import { Rocket, CheckCircle2, Loader2, AlertCircle } from "lucide-react";

interface Props {
  approved: boolean;
  alreadyTriggered: boolean;
  existingRunId: number | null;
  onTrigger: () => Promise<{ runId: number }>;
}

export function TriggerButton({ approved, alreadyTriggered, existingRunId, onTrigger }: Props) {
  const [triggering, setTriggering] = useState(false);
  const [runId, setRunId] = useState<number | null>(existingRunId);
  const [error, setError] = useState<string | null>(null);

  const isTriggered = alreadyTriggered || runId !== null;

  async function handleClick() {
    setTriggering(true);
    setError(null);
    try {
      const result = await onTrigger();
      setRunId(result.runId);
    } catch (e: any) {
      setError(e.message ?? "Trigger failed");
    } finally {
      setTriggering(false);
    }
  }

  if (isTriggered) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
        <CheckCircle2 className="w-5 h-5 shrink-0" />
        <div>
          <div className="text-sm font-semibold">Development Triggered</div>
          <div className="text-xs text-emerald-400/70">Run #{runId ?? existingRunId}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={handleClick}
        disabled={!approved || triggering}
        aria-label="Trigger Core Application Development mission"
        className="flex items-center justify-center gap-2 w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl text-sm font-bold transition-colors"
      >
        {triggering ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Triggering…</>
        ) : (
          <><Rocket className="w-4 h-4" /> Trigger Core Development</>
        )}
      </button>

      {!approved && (
        <p className="text-xs text-slate-500 text-center">Approve PRD and UX mockups to enable this action.</p>
      )}
    </div>
  );
}
