import React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { TrendingDown, Zap } from "lucide-react";

interface Props {
  totalPoints: number;
}

export function SprintBurndownPredictor({ totalPoints }: Props) {
  // Generate a mock burndown chart
  const days = 14;
  const idealBurnRate = totalPoints / days;
  
  const data = Array.from({ length: days + 1 }).map((_, i) => {
    const ideal = totalPoints - (i * idealBurnRate);
    // Add some random noise for actual progress up to day 5, and predicted afterwards
    const isPast = i <= 5;
    
    // Create a scenario where they are slightly behind, but agent workload will catch up
    let actual = null;
    let predicted = null;
    
    if (isPast) {
        // Fall behind slightly
        actual = totalPoints - (i * (idealBurnRate * 0.8));
    } else {
        // Start predicting from day 5
        const startingPoint = totalPoints - (5 * (idealBurnRate * 0.8));
        // Predict catching up using agent workload
        predicted = startingPoint - ((i - 5) * (idealBurnRate * 1.2));
        if (predicted < 0) predicted = 0;
    }

    return {
      day: `Day ${i}`,
      ideal: Math.round(ideal),
      actual: actual !== null ? Math.round(actual) : null,
      predicted: predicted !== null ? Math.round(predicted) : null,
    };
  });
  
  // Make sure day 5 has both to connect the lines
  data[5].predicted = data[5].actual;

  return (
    <div className="bg-[#15121e]/40 border border-white/5 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-slate-200">AI-Predicted Sprint Burndown</h3>
        </div>
        <div className="flex items-center gap-1 text-xs text-indigo-400 font-semibold px-2 py-1 bg-indigo-500/10 rounded-lg">
          <Zap className="w-3.5 h-3.5" /> High Agent Utilization
        </div>
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2238" vertical={false} />
            <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(val) => val.replace('Day ', 'D')} />
            <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ backgroundColor: "#15121e", borderColor: "rgba(255,255,255,0.1)", fontSize: 11 }} />
            
            <ReferenceLine x="Day 5" stroke="#f59e0b" strokeDasharray="3 3" label={{ position: 'top', value: 'Today', fill: '#f59e0b', fontSize: 10 }} />

            <Line type="monotone" dataKey="ideal" stroke="#64748b" strokeWidth={1} strokeDasharray="4 4" dot={false} name="Ideal Guideline" />
            <Line type="monotone" dataKey="actual" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} name="Actual Progress" />
            <Line type="monotone" dataKey="predicted" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Agent-Adjusted Prediction" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="text-xs text-slate-400">
        Prediction accounts for active Agent workload. Projected completion: <strong className="text-white">On Track</strong>.
      </div>
    </div>
  );
}
