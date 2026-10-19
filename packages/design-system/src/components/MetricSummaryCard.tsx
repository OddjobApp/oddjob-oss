import React from "react";
import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { colors } from "../tokens";

export interface MetricSummaryCardProps {
  title: string;
  value: string | number;
  change?: number; // e.g. 12.5 for +12.5%, -3.2 for -3.2%
  trend?: "up" | "down" | "neutral";
  icon?: LucideIcon;
  description?: string;
  variant?: "default" | "success" | "warning" | "danger" | "info";
  className?: string;
}

export function MetricSummaryCard({
  title,
  value,
  change,
  trend,
  icon: Icon,
  description,
  variant = "default",
  className = "",
}: MetricSummaryCardProps) {
  const isPositive = change !== undefined ? change > 0 : trend === "up";
  const isNegative = change !== undefined ? change < 0 : trend === "down";

  // Surface + border track the app's theme tokens so the card (and its
  // text-foreground value) stay legible in both light and dark. Previously the
  // background was a fixed palette color (white for `default`), which made the
  // white value text invisible in dark mode. Only the icon keeps a variant accent.
  const getVariantStyles = () => {
    const base = { bg: "hsl(var(--card))", border: "hsl(var(--border))" };
    switch (variant) {
      case "success":
        return { ...base, iconColor: colors.success[500] };
      case "warning":
        return { ...base, iconColor: colors.warning[500] };
      case "danger":
        return { ...base, iconColor: colors.danger[500] };
      case "info":
        return { ...base, iconColor: colors.info[500] };
      default:
        return { ...base, iconColor: colors.primary[500] };
    }
  };

  const variantStyle = getVariantStyles();

  return (
    <div
      className={`p-4 rounded-xl border transition-all duration-200 hover:shadow-sm ${className}`}
      style={{
        backgroundColor: variantStyle.bg,
        borderColor: variantStyle.border,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
            {title}
          </p>
          <p className="text-2xl font-bold text-foreground font-mono tracking-tight">
            {value}
          </p>
        </div>

        {Icon && (
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${variantStyle.iconColor}15`, color: variantStyle.iconColor }}
          >
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>

      {(change !== undefined || description) && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          {change !== undefined && (
            <span
              className={`inline-flex items-center gap-1 font-semibold px-1.5 py-0.5 rounded ${
                isPositive
                  ? "bg-emerald-500/10 text-emerald-600"
                  : isNegative
                  ? "bg-red-500/10 text-red-600"
                  : "bg-neutral-500/10 text-neutral-600"
              }`}
            >
              {isPositive ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : isNegative ? (
                <TrendingDown className="w-3.5 h-3.5" />
              ) : (
                <Minus className="w-3.5 h-3.5" />
              )}
              {change > 0 ? "+" : ""}
              {change}%
            </span>
          )}

          {description && (
            <span className="text-muted-foreground truncate">{description}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default MetricSummaryCard;
