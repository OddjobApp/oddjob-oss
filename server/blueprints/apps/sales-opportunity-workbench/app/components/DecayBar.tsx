import { OpportunityWindow, parseLadder, ceilingAccent } from "@/lib/platform-client";

interface DecayBarProps {
  window: OpportunityWindow;
  size?: "sm" | "md" | "lg";
}

export function DecayBar({ window, size = "md" }: DecayBarProps) {
  const ladder = parseLadder(window);
  const accent = ceilingAccent(window.current_ceiling);
  
  const sizeClasses = {
    sm: "h-1.5",
    md: "h-2",
    lg: "h-3"
  };

  // Calculate progress through the gate ladder
  const progress = window.current_gate_index / (ladder.length - 1);
  const progressPercent = Math.min(progress * 100, 100);

  return (
    <div className="w-full">
      <div className={`w-full bg-slate-800 rounded-full overflow-hidden ${sizeClasses[size]}`}>
        <div 
          className={`h-full ${accent.bar} transition-all duration-300`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-slate-500">
        <span>{window.current_ceiling}% ceiling</span>
        <span>Gate {window.current_gate_index + 1}/{ladder.length}</span>
      </div>
    </div>
  );
}
