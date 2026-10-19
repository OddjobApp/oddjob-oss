/**
 * VelocityGauge — Recharts bar showing committed SP vs target velocity.
 * Emits telemetry on anomaly detection.
 */
import React, { useEffect, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell, Legend,
} from "recharts";
import { AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";
import { telemetry } from "../lib/platform-client";

interface Props {
  committedPoints: number;
  targetVelocity: number | null;
  anomalyThreshold: number; // e.g. 0.20 for 20%
  sprintNumber: number;
}

export function VelocityGauge({ committedPoints, targetVelocity, anomalyThreshold, sprintNumber }: Props) {
  const lastEmittedRef = useRef<"over" | "under" | null>(null);

  const deviation =
    targetVelocity && targetVelocity > 0
      ? (committedPoints - targetVelocity) / targetVelocity
      : null;

  const isOver  = deviation !== null && deviation >  anomalyThreshold;
  const isUnder = deviation !== null && deviation < -anomalyThreshold;
  const isAnomaly = isOver || isUnder;

  // Emit telemetry once per anomaly direction change
  useEffect(() => {
    if (!targetVelocity || deviation === null) return;
    const pct = Math.round(Math.abs(deviation) * 100);
    if (isOver && lastEmittedRef.current !== "over") {
      lastEmittedRef.current = "over";
      telemetry.emit("velocity_anomaly_over", "warn", {
        sprintNumber, committedPoints, targetVelocity, deviationPercent: pct,
      });
    } else if (isUnder && lastEmittedRef.current !== "under") {
      lastEmittedRef.current = "under";
      telemetry.emit("velocity_anomaly_under", "warn", {
        sprintNumber, committedPoints, targetVelocity, deviationPercent: pct,
      });
    } else if (!isAnomaly) {
      lastEmittedRef.current = null;
    }
  }, [isOver, isUnder, isAnomaly, committedPoints, targetVelocity, deviation, sprintNumber]);

  const chartData = [
    { name: "Sprint", committed: committedPoints, target: targetVelocity ?? 0 },
  ];

  const barColor = isOver ? "#f59e0b" : isUnder ? "#f59e0b" : "#10b981";

  return (
    <div className="bg-[#15121e]/40 border border-white/5 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">Velocity Gauge</h3>
        {targetVelocity === null ? (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <MinusCircle className="w-3.5 h-3.5" />
            No velocity target set
          </div>
        ) : isAnomaly ? (
          <div className="flex items-center gap-1.5 text-xs text-amber-400 font-semibold">
            <AlertTriangle className="w-3.5 h-3.5" />
            Anomaly detected
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            On target
          </div>
        )}
      </div>

      {/* Anomaly banner */}
      {isAnomaly && targetVelocity !== null && deviation !== null && (
        <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium">
          Velocity anomaly detected: committed points ({committedPoints} SP) are{" "}
          {Math.round(Math.abs(deviation) * 100)}%{" "}
          {isOver ? "above" : "below"} target ({targetVelocity} SP)
        </div>
      )}

      {/* On-target label */}
      {!isAnomaly && targetVelocity !== null && (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-400">Committed: <span className="text-white font-bold">{committedPoints} SP</span></span>
          <span className="text-slate-400">Target: <span className="text-emerald-400 font-bold">{targetVelocity} SP</span></span>
        </div>
      )}

      {/* Chart */}
      {targetVelocity !== null && (
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2238" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, Math.max(committedPoints, targetVelocity) * 1.2]}
                stroke="#64748b"
                tick={{ fontSize: 10 }}
              />
              <YAxis type="category" dataKey="name" hide />
              <Tooltip
                contentStyle={{ backgroundColor: "#15121e", borderColor: "rgba(255,255,255,0.1)", fontSize: 11 }}
                formatter={(value: number, name: string) => [
                  `${value} SP`,
                  name === "committed" ? "Committed" : "Target",
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, color: "#94a3b8" }}
                formatter={(value) => value === "committed" ? "Committed SP" : "Target Velocity"}
              />
              <ReferenceLine x={targetVelocity} stroke="#10b981" strokeDasharray="4 4" label={{ value: "Target", fill: "#10b981", fontSize: 10 }} />
              <Bar dataKey="committed" name="committed" radius={[0, 4, 4, 0]} maxBarSize={32}>
                <Cell fill={barColor} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
