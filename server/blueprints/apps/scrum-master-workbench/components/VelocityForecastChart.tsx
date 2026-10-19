/**
 * VelocityForecastChart — multi-sprint forecast with confidence bands and quarterly goal.
 */
import React, { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Area, Legend,
} from "recharts";
import { TrendingUp, AlertTriangle } from "lucide-react";
import type { CapacityPlanRecord } from "../lib/collections";

interface Props {
  capacityPlans: CapacityPlanRecord[];
  currentSprintNumber: number;
  quarterlyGoalSp: number | null;
}

export function VelocityForecastChart({ capacityPlans, currentSprintNumber, quarterlyGoalSp }: Props) {
  const chartData = useMemo(() => {
    // Get last 5 sprints with completed data
    const historical = capacityPlans
      .filter((p) => p.sprintNumber < currentSprintNumber && p.planData)
      .sort((a, b) => a.sprintNumber - b.sprintNumber)
      .slice(-5);

    // Compute actual velocities (from planData or targetVelocity as proxy)
    const actuals = historical.map((p) => ({
      sprint: `S${p.sprintNumber}`,
      sprintNumber: p.sprintNumber,
      actual: (p.planData as any)?.completedPoints ?? p.targetVelocity ?? 0,
      target: p.targetVelocity,
    }));

    // Compute trend for forecast (simple linear regression)
    const velocities = actuals.map((a) => a.actual);
    const avg = velocities.length > 0 ? velocities.reduce((s, v) => s + v, 0) / velocities.length : 0;
    const trend = velocities.length >= 2
      ? (velocities[velocities.length - 1] - velocities[0]) / (velocities.length - 1)
      : 0;

    // Standard deviation for confidence bands
    const stdDev = velocities.length > 1
      ? Math.sqrt(velocities.reduce((s, v) => s + (v - avg) ** 2, 0) / (velocities.length - 1))
      : avg * 0.15;

    // Generate forecast for next 3 sprints
    const forecast = [];
    for (let i = 1; i <= 3; i++) {
      const predicted = Math.round(avg + trend * i);
      forecast.push({
        sprint: `S${currentSprintNumber + i}`,
        sprintNumber: currentSprintNumber + i,
        predicted: Math.max(0, predicted),
        upper: Math.max(0, Math.round(predicted + stdDev)),
        lower: Math.max(0, Math.round(predicted - stdDev)),
      });
    }

    // Combine into chart data
    const combined = [
      ...actuals.map((a) => ({
        sprint: a.sprint,
        actual: a.actual,
        predicted: null as number | null,
        upper: null as number | null,
        lower: null as number | null,
      })),
      // Current sprint (bridge point)
      {
        sprint: `S${currentSprintNumber}`,
        actual: null,
        predicted: Math.round(avg + trend),
        upper: null,
        lower: null,
      },
      ...forecast.map((f) => ({
        sprint: f.sprint,
        actual: null,
        predicted: f.predicted,
        upper: f.upper,
        lower: f.lower,
      })),
    ];

    return { combined, avg, forecast, stdDev };
  }, [capacityPlans, currentSprintNumber]);

  // Quarterly goal check
  const forecastTotal = chartData.forecast.reduce((s, f) => s + f.predicted, 0);
  const historicalTotal = chartData.combined.filter((d) => d.actual !== null).reduce((s, d) => s + (d.actual ?? 0), 0);
  const projectedTotal = historicalTotal + forecastTotal;
  const goalMissPercent = quarterlyGoalSp && quarterlyGoalSp > 0
    ? Math.round(((quarterlyGoalSp - projectedTotal) / quarterlyGoalSp) * 100)
    : null;
  const willMissGoal = goalMissPercent !== null && goalMissPercent > 10;

  return (
    <div className="bg-[#15121e]/40 border border-white/5 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-slate-200">Velocity Forecast</h3>
        </div>
        {willMissGoal && (
          <div className="flex items-center gap-1.5 text-xs text-amber-400 font-semibold">
            <AlertTriangle className="w-3.5 h-3.5" />
            ~{goalMissPercent}% below quarterly goal
          </div>
        )}
      </div>

      {/* Warning banner */}
      {willMissGoal && quarterlyGoalSp && (
        <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
          At current velocity, the team will complete approximately {100 - (goalMissPercent ?? 0)}% of the quarterly target ({quarterlyGoalSp} SP).
        </div>
      )}

      {/* Chart */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData.combined} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2238" />
            <XAxis dataKey="sprint" stroke="#64748b" tick={{ fontSize: 10 }} />
            <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ backgroundColor: "#15121e", borderColor: "rgba(255,255,255,0.1)", fontSize: 11 }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />

            {/* Quarterly goal reference */}
            {quarterlyGoalSp && (
              <ReferenceLine
                y={Math.round(quarterlyGoalSp / 8)}
                stroke="#10b981"
                strokeDasharray="4 4"
                label={{ value: "Goal/Sprint", fill: "#10b981", fontSize: 9 }}
              />
            )}

            {/* Confidence band */}
            <Area
              type="monotone"
              dataKey="upper"
              stroke="none"
              fill="#f59e0b"
              fillOpacity={0.05}
              name="Upper bound"
            />
            <Area
              type="monotone"
              dataKey="lower"
              stroke="none"
              fill="#f59e0b"
              fillOpacity={0.05}
              name="Lower bound"
            />

            {/* Actual velocity */}
            <Line
              type="monotone"
              dataKey="actual"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={{ r: 4, fill: "#f59e0b" }}
              name="Actual"
              connectNulls={false}
            />

            {/* Predicted velocity */}
            <Line
              type="monotone"
              dataKey="predicted"
              stroke="#f59e0b"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ r: 3, fill: "#f59e0b", strokeDasharray: "0" }}
              name="Forecast"
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-4 text-xs text-slate-400">
        <span>Avg velocity: <strong className="text-white">{Math.round(chartData.avg)} SP</strong></span>
        <span>±{Math.round(chartData.stdDev)} SP confidence</span>
        {quarterlyGoalSp && <span>Goal: <strong className="text-emerald-400">{quarterlyGoalSp} SP</strong></span>}
      </div>
    </div>
  );
}
