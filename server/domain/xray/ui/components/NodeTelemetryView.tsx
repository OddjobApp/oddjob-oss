import React from "react";
import { Activity, Clock, CheckCircle2, AlertTriangle, PlayCircle } from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";

interface NodeTelemetryViewProps {
  telemetry: {
    totalRuns?: number;
    lastRunAt?: string;
    successRate?: number;
    errorCount?: number;
  };
}

export function NodeTelemetryView({ telemetry }: NodeTelemetryViewProps) {
  const hasData = telemetry.totalRuns !== undefined || telemetry.lastRunAt !== undefined;

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center gap-2 border-b border-foreground/10 pb-2">
        <Activity className="w-4 h-4 text-purple-400" />
        <h4 className="text-[10px] font-black uppercase tracking-widest text-foreground/80">
          Node Execution Telemetry
        </h4>
      </div>

      {hasData ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 rounded-lg border border-foreground/10 bg-foreground/[0.02]">
            <div className="flex items-center gap-1.5 text-foreground/40 text-[9px] font-black uppercase mb-1">
              <PlayCircle className="w-3.5 h-3.5 text-blue-400" /> Total Executions
            </div>
            <p className="text-xl font-bold text-foreground">{telemetry.totalRuns ?? 0}</p>
          </div>

          <div className="p-3 rounded-lg border border-foreground/10 bg-foreground/[0.02]">
            <div className="flex items-center gap-1.5 text-foreground/40 text-[9px] font-black uppercase mb-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Success Rate
            </div>
            <p className="text-xl font-bold text-emerald-400">
              {telemetry.successRate !== undefined ? `${telemetry.successRate}%` : "100%"}
            </p>
          </div>

          <div className="p-3 rounded-lg border border-foreground/10 bg-foreground/[0.02] col-span-2">
            <div className="flex items-center gap-1.5 text-foreground/40 text-[9px] font-black uppercase mb-1">
              <Clock className="w-3.5 h-3.5 text-amber-400" /> Last Active Timestamp
            </div>
            <p className="text-[11px] font-mono text-foreground/80">
              {telemetry.lastRunAt ? new Date(telemetry.lastRunAt).toLocaleString() : "No recent activity recorded"}
            </p>
          </div>
        </div>
      ) : (
        <div className="p-6 text-center border border-dashed border-foreground/10 rounded-lg bg-foreground/[0.02]">
          <Activity className="w-8 h-8 mx-auto text-foreground/20 mb-2 animate-pulse" />
          <p className="text-[11px] font-medium text-foreground/60">No direct telemetry records logged yet.</p>
          <p className="text-[9px] text-foreground/40 mt-1">
            Telemetry metrics are captured automatically during mission runs and operational cycles.
          </p>
        </div>
      )}
    </div>
  );
}
