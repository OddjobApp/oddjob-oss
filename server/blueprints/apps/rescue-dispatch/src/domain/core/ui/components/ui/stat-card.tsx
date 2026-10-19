import { memo } from "react";
import { Card } from "@domain-ui/core/ui/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { Link } from "wouter";

interface StatCardProps {
  title: string;
  value?: string | number;
  icon?: LucideIcon;
  valueColor?: string;
  className?: string;
  linkTo?: string;
  onMouseEnter?: () => void;
  trend?: {
    value: number;
    label: string;
    positive?: boolean;
  };
}

/**
 * Memoized stat card component for dashboard metrics.
 * Standardized to fit both light and dark themes without Sentinel-specific overrides.
 */
export const StatCard = memo(function StatCard({ title, value, icon: Icon, valueColor = "text-foreground", className, linkTo, onMouseEnter, trend }: StatCardProps) {
  const ValueComponent = value === undefined ? (
    <div className="mt-2 h-8 w-24 bg-muted animate-pulse rounded" />
  ) : linkTo ? (
    <Link
      href={linkTo}
      className={cn("mt-1 text-3xl font-bold block hover:text-primary transition-colors cursor-pointer tracking-tight", valueColor)}
    >
      {value}
    </Link>
  ) : (
    <p className={cn("mt-1 text-3xl font-bold tracking-tight", valueColor)}>{value}</p>
  );

  return (
    <Card 
      className={cn("border-border/40 p-5 group relative overflow-hidden bg-card shadow-sm hover:shadow-md transition-shadow", className)}
      onMouseEnter={onMouseEnter}
    >
      <div className="relative z-10 flex items-center justify-between w-full gap-4">
        <div className="flex-1 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground group-hover:text-primary transition-colors">{title}</p>
          {ValueComponent}
          {trend && (
            <div className={cn("flex items-center mt-2 text-[10px] font-bold uppercase tracking-widest", trend.positive === false ? "text-destructive" : "text-emerald-600")}>
              <span className="bg-current/10 px-1.5 py-0.5 rounded-sm">{trend.value}</span>
              <span className="ml-2 opacity-70">{trend.label}</span>
            </div>
          )}
        </div>
        <div className="bg-muted p-2 rounded-lg group-hover:bg-primary/10 transition-colors">
          {Icon && <Icon className="h-6 w-6 text-muted-foreground group-hover:text-primary group-hover:scale-110 transition-transform duration-300" />}
        </div>
      </div>
    </Card>
  );
});
