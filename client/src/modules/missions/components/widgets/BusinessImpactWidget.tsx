import React from "react";
import { Card, CardContent } from "@domain-ui/core/ui/components/ui/card";
import { TrendingUp, Clock, DollarSign, Sparkles } from "lucide-react";

interface BusinessImpactWidgetProps {
  mission: any;
  run: any;
}

export default function BusinessImpactWidget({ mission, run }: BusinessImpactWidgetProps) {
  // Safe defaults
  const membersCount = mission?.members?.length || 1;
  const budgetLimit = parseFloat(mission?.budgetLimitUsd || "10.00");
  const costUsd = parseFloat(run?.costUsd || "0.00");
  const startedAt = run?.startedAt ? new Date(run.startedAt).getTime() : Date.now();
  const completedAt = run?.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  
  // Calculations
  const durationMs = completedAt - startedAt;
  const durationHours = durationMs / (1000 * 60 * 60);
  
  // Assumptions for ROI math
  const manualHoursEst = membersCount * 2; // Assume 2 hours per agent role
  const manualRate = 50; // $50/hr
  const manualCostEst = manualHoursEst * manualRate;
  
  const hoursSaved = Math.max(0, manualHoursEst - durationHours).toFixed(1);
  const aiCost = costUsd;
  const roiPercentage = manualCostEst > 0 ? (((manualCostEst - aiCost) / manualCostEst) * 100).toFixed(0) : 0;

  return (
    <div className="w-full bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-blue-500/10 border border-white/10 rounded-xl p-4 mb-6 shadow-lg backdrop-blur-md relative overflow-hidden">
      <div className="absolute top-0 right-0 p-4 opacity-10">
        <Sparkles className="w-24 h-24 text-amber-500" />
      </div>
      
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-amber-500/20 rounded-lg">
          <TrendingUp className="w-5 h-5 text-amber-500" />
        </div>
        <div>
          <h3 className="text-lg font-black text-foreground tracking-tight">Executive Impact Dashboard</h3>
          <p className="text-xs text-muted-foreground font-medium">Real-time value delivery metrics</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative z-10">
        {/* Metric 1: Time Saved */}
        <Card className="bg-foreground/5 border-white/10">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <Clock className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Estimated Time Saved</p>
              <div className="flex items-end gap-2">
                <span className="text-2xl font-black text-foreground">+{hoursSaved}h</span>
                <span className="text-xs text-emerald-400 mb-1 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-full">vs manual</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Metric 2: Cost Efficiency */}
        <Card className="bg-foreground/5 border-white/10">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Cost Efficiency</p>
              <div className="flex items-end gap-2">
                <span className="text-2xl font-black text-foreground">${aiCost.toFixed(2)}</span>
                <span className="text-xs text-muted-foreground mb-1 font-medium line-through decoration-red-500/50">${manualCostEst.toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Metric 3: ROI */}
        <Card className="bg-foreground/5 border-white/10 overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-transparent pointer-events-none" />
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Mission ROI</p>
              <div className="flex items-end gap-2">
                <span className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-emerald-400">+{roiPercentage}%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
