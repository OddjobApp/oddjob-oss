import { useState } from "react";
import StatCard from "@domain-ui/core/ui/components/shared/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { RefreshCw, TrendingUp, Timer, ShieldCheck } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { useAggregateAnalytics } from "../hooks/useAggregateAnalytics.js";

const FIX_COLORS = ["#16a34a", "#dc2626", "#f59e0b"];

export default function QualityMetricsPage() {
  const [since, setSince] = useState<string>("");
  const { data, isLoading, isError, refetch } = useAggregateAnalytics(since || undefined);

  const fixData = data
    ? [
        { name: "Resolved", value: data.fixAttempts.resolved },
        { name: "Failed", value: data.fixAttempts.failed },
        { name: "Reverted", value: data.fixAttempts.reverted },
      ]
    : [];
  const costByPhase = data ? Object.entries(data.costByPhase).map(([phase, cost]) => ({ phase, cost })) : [];
  const testLoop = data ? data.testLoopDistribution.map((count, i) => ({ iterations: i === 5 ? "5+" : String(i), count })) : [];

  return (
    <div className="space-y-6 p-6" data-testid="quality-metrics-page">
      <div className="flex items-end justify-between">
        <h1 className="text-xl font-semibold">Pipeline Quality Metrics</h1>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="since" className="text-xs">Since</Label>
            <Input id="since" type="date" value={since} onChange={(e) => setSince(e.target.value)} className="w-40" />
          </div>
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading} data-testid="refresh-metrics">
            <RefreshCw className={`mr-1 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {isError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">Failed to load analytics.</div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard title="Total Sessions" value={data?.totalSessions ?? 0} icon={TrendingUp} />
        <StatCard title="Fix Success" value={data ? `${data.fixAttempts.total ? Math.round((data.fixAttempts.resolved / data.fixAttempts.total) * 100) : 0}%` : "—"} icon={ShieldCheck} />
        <StatCard title="Avg Time-to-Fix" value={data ? `${Math.round(data.averageTimeToFixMs / 1000)}s` : "—"} icon={Timer} />
        <StatCard title="Gate Pass Rate" value={data ? `${Math.round(data.qualityGatePassRate * 100)}%` : "—"} icon={ShieldCheck} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Verification Pass Rate Over Time</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data?.verificationPassRateOverTime ?? []}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} fontSize={11} />
                <Tooltip formatter={(v: number) => `${Math.round(v * 100)}%`} />
                <Line type="monotone" dataKey="rate" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Fix Attempt Outcomes</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={fixData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80}>
                  {fixData.map((_, i) => <Cell key={i} fill={FIX_COLORS[i % FIX_COLORS.length]} />)}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Cost Breakdown by Phase</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={costByPhase}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="phase" fontSize={11} />
                <YAxis tickFormatter={(v) => `$${v}`} fontSize={11} />
                <Tooltip formatter={(v: number) => `$${v}`} />
                <Bar dataKey="cost" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Test Loop Iterations</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={testLoop}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="iterations" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Bar dataKey="count" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-sm">Cost Over Time</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data?.costOverTime ?? []}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis tickFormatter={(v) => `$${v}`} fontSize={11} />
                <Tooltip formatter={(v: number) => `$${v}`} />
                <Area type="monotone" dataKey="cost" stroke="#16a34a" fill="#16a34a33" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
