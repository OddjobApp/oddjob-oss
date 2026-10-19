import StatCard from "@domain-ui/core/ui/components/shared/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { DollarSign, Coins, Clock, Wrench, CheckCircle2, XCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { SessionMetrics, AutonomousMetrics } from "../types/index.js";

export interface CostMetricsPanelProps {
  metrics?: SessionMetrics;
  autonomous?: AutonomousMetrics;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function CostMetricsPanel({ metrics, autonomous }: CostMetricsPanelProps) {
  const chartData = (metrics?.phases ?? []).map((p) => ({
    phase: p.phase.replace(/_/g, " "),
    cost: Math.round(p.costUsd * 10000) / 10000,
  }));

  return (
    <div className="space-y-4" data-testid="cost-metrics-panel">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard title="Total Cost" value={`$${(metrics?.totalCostUsd ?? 0).toFixed(2)}`} icon={DollarSign} />
        <StatCard title="Tokens" value={(metrics?.totalTokens ?? 0).toLocaleString()} icon={Coins} />
        <StatCard title="Duration" value={formatDuration(metrics?.totalDurationMs ?? 0)} icon={Clock} />
        {autonomous && (
          <>
            <StatCard title="Fix Attempts" value={autonomous.fixAttempts} icon={Wrench} />
            <StatCard title="Successful Fixes" value={autonomous.successfulFixes} icon={CheckCircle2} />
            <StatCard title="Failed Fixes" value={autonomous.failedFixes} icon={XCircle} />
          </>
        )}
      </div>

      {chartData.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Cost by Phase</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="phase" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(v: number) => `$${v}`} />
                <Bar dataKey="cost" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
