import { Stage, ceilingAccent } from "@/lib/platform-client";

interface StageBadgeProps {
  stage: Stage;
  probability?: number;
  size?: "sm" | "md" | "lg";
}

export function StageBadge({ stage, probability, size = "md" }: StageBadgeProps) {
  const accent = probability !== undefined ? ceilingAccent(probability) : null;
  
  const sizeClasses = {
    sm: "text-xs px-2 py-0.5",
    md: "text-sm px-2.5 py-1", 
    lg: "text-base px-3 py-1.5"
  };

  const stageColors: Record<Stage, string> = {
    PROSPECT: "bg-slate-500/10 text-slate-400 border-slate-500/30",
    QUALIFIED: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    PROPOSAL: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
    NEGOTIATION: "bg-purple-500/10 text-purple-400 border-purple-500/30",
    CLOSED_WON: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    CLOSED_LOST: "bg-rose-500/10 text-rose-400 border-rose-500/30"
  };

  return (
    <div className={`inline-flex items-center gap-2 rounded-full border ${sizeClasses[size]} ${stageColors[stage]}`}>
      <span>{stage.replace("_", " ")}</span>
      {probability !== null && probability !== undefined && (
        <span className={`font-semibold ${accent?.text}`}>
          {probability}%
        </span>
      )}
    </div>
  );
}
