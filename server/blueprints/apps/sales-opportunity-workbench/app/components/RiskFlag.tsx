import { RecommendationKind } from "@/lib/platform-client";

interface RiskFlagProps {
  kind: RecommendationKind;
  severity?: "low" | "medium" | "high";
  count?: number;
}

export function RiskFlag({ kind, severity = "medium", count }: RiskFlagProps) {
  const riskConfig: Record<RecommendationKind, { icon: string; label: string; color: string }> = {
    slip_risk: { icon: "!", label: "Slip Risk", color: "text-amber-400" },
    stalled: { icon: "STOP", label: "Stalled", color: "text-orange-400" },
    aging: { icon: "TIME", label: "Aging", color: "text-yellow-400" },
    next_best_action: { icon: "TIP", label: "Next Action", color: "text-blue-400" },
    win: { icon: "WIN", label: "Win", color: "text-emerald-400" },
    loss: { icon: "LOSS", label: "Loss", color: "text-rose-400" }
  };

  const config = riskConfig[kind];
  const severityColors = {
    low: "bg-slate-500/10 border-slate-500/30",
    medium: "bg-amber-500/10 border-amber-500/30",
    high: "bg-rose-500/10 border-rose-500/30"
  };

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border ${severityColors[severity]}`}>
      <span className="text-xs">{config.icon}</span>
      <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-xs text-slate-400">({count})</span>
      )}
    </div>
  );
}
