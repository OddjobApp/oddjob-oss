import StatCard from "@domain-ui/core/ui/components/shared/StatCard";
import { Activity, AlertTriangle, CheckCircle2, DollarSign } from "lucide-react";

export interface MetricCardRowProps {
  activeCount: number;
  blockedCount: number;
  completedCount: number;
  totalCost: number;
}

/** Row of summary stat cards for the session dashboard. */
export function MetricCardRow({ activeCount, blockedCount, completedCount, totalCost }: MetricCardRowProps) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatCard title="Active" value={activeCount} icon={Activity} />
      <StatCard title="Blocked" value={blockedCount} icon={AlertTriangle} description={blockedCount > 0 ? "Needs attention" : undefined} />
      <StatCard title="Completed" value={completedCount} icon={CheckCircle2} />
      <StatCard title="Total Cost" value={`$${totalCost.toFixed(2)}`} icon={DollarSign} />
    </div>
  );
}
