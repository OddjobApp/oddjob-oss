import React from "react";
import { LucideIcon } from "lucide-react";
import { colors } from "../tokens";

export interface ActionCardBadge {
  label: string;
  variant?: "default" | "success" | "warning" | "danger" | "info";
}

export interface ActionCardKpi {
  label: string;
  value: string | number;
  change?: string;
  isPositive?: boolean;
}

export interface ActionCardAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  disabled?: boolean;
  icon?: LucideIcon;
}

export interface ActionCardShellProps {
  title: string;
  subtitle?: string;
  badge?: ActionCardBadge;
  icon?: LucideIcon;
  kpis?: ActionCardKpi[];
  actions?: ActionCardAction[];
  children?: React.ReactNode;
  className?: string;
  onDismiss?: () => void;
}

export function ActionCardShell({
  title,
  subtitle,
  badge,
  icon: Icon,
  kpis,
  actions,
  children,
  className = "",
  onDismiss,
}: ActionCardShellProps) {
  const getBadgeStyle = (variant: ActionCardBadge["variant"] = "default") => {
    switch (variant) {
      case "success":
        return {
          bg: "hsl(var(--success, 142 76% 36%) / 0.12)",
          text: "hsl(var(--success, 142 76% 36%))",
          border: "hsl(var(--success, 142 76% 36%) / 0.25)",
        };
      case "warning":
        return {
          bg: "hsl(var(--warning, 38 92% 50%) / 0.12)",
          text: "hsl(var(--warning, 38 92% 50%))",
          border: "hsl(var(--warning, 38 92% 50%) / 0.25)",
        };
      case "danger":
        return {
          bg: "hsl(var(--destructive, 0 84% 60%) / 0.12)",
          text: "hsl(var(--destructive, 0 84% 60%))",
          border: "hsl(var(--destructive, 0 84% 60%) / 0.25)",
        };
      case "info":
        return {
          bg: "hsl(var(--primary, 221 83% 53%) / 0.12)",
          text: "hsl(var(--primary, 221 83% 53%))",
          border: "hsl(var(--primary, 221 83% 53%) / 0.25)",
        };
      default:
        return {
          bg: "hsl(var(--muted))",
          text: "hsl(var(--muted-foreground))",
          border: "hsl(var(--border))",
        };
    }
  };

  const getActionStyle = (variant: ActionCardAction["variant"] = "secondary") => {
    switch (variant) {
      case "primary":
        return {
          bg: "hsl(var(--primary))",
          text: "hsl(var(--primary-foreground))",
          border: "transparent",
        };
      case "danger":
        return {
          bg: "hsl(var(--destructive))",
          text: "hsl(var(--destructive-foreground))",
          border: "transparent",
        };
      case "outline":
        return {
          bg: "transparent",
          text: "hsl(var(--foreground))",
          border: "hsl(var(--border))",
        };
      case "ghost":
        return {
          bg: "transparent",
          text: "hsl(var(--muted-foreground))",
          border: "transparent",
        };
      default:
        return {
          bg: "hsl(var(--muted))",
          text: "hsl(var(--foreground))",
          border: "hsl(var(--border) / 0.6)",
        };
    }
  };

  return (
    <div
      className={`rounded-2xl border transition-all duration-200 shadow-sm ${className}`}
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
        color: "hsl(var(--foreground))",
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-3.5 flex items-start justify-between gap-3 border-b"
        style={{ borderColor: "hsl(var(--border) / 0.6)" }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div
              className="p-2 rounded-xl shrink-0 flex items-center justify-center"
              style={{
                backgroundColor: "hsl(var(--muted) / 0.6)",
                color: "hsl(var(--primary))",
                border: "1px solid hsl(var(--border) / 0.5)",
              }}
            >
              <Icon size={18} />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm tracking-tight truncate leading-tight">
                {title}
              </h3>
              {badge && (
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shrink-0"
                  style={{
                    backgroundColor: getBadgeStyle(badge.variant).bg,
                    color: getBadgeStyle(badge.variant).text,
                    borderColor: getBadgeStyle(badge.variant).border,
                  }}
                >
                  {badge.label}
                </span>
              )}
            </div>
            {subtitle && (
              <p
                className="text-xs truncate mt-0.5"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss card"
            className="p-1 rounded-lg hover:opacity-80 transition-opacity text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            ✕
          </button>
        )}
      </div>

      {/* KPI Chips */}
      {kpis && kpis.length > 0 && (
        <div
          className="px-4 py-2.5 flex items-center gap-2 overflow-x-auto border-b text-xs"
          style={{
            borderColor: "hsl(var(--border) / 0.4)",
            backgroundColor: "hsl(var(--muted) / 0.2)",
          }}
        >
          {kpis.map((kpi, idx) => (
            <div
              key={idx}
              className="px-2.5 py-1 rounded-lg border flex items-center gap-2 shrink-0"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border) / 0.6)",
              }}
            >
              <span style={{ color: "hsl(var(--muted-foreground))" }} className="text-[11px]">
                {kpi.label}:
              </span>
              <span className="font-bold text-[11px] font-mono">{kpi.value}</span>
              {kpi.change && (
                <span
                  className="text-[10px] font-semibold"
                  style={{
                    color: kpi.isPositive
                      ? "hsl(var(--success, 142 76% 36%))"
                      : "hsl(var(--destructive, 0 84% 60%))",
                  }}
                >
                  {kpi.change}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Body */}
      {children && <div className="p-4 text-xs leading-relaxed">{children}</div>}

      {/* Action Footer */}
      {actions && actions.length > 0 && (
        <div
          className="px-4 py-3 flex items-center justify-end gap-2 border-t flex-wrap"
          style={{
            borderColor: "hsl(var(--border) / 0.6)",
            backgroundColor: "hsl(var(--muted) / 0.1)",
          }}
        >
          {actions.map((action, idx) => {
            const style = getActionStyle(action.variant);
            const ActionIcon = action.icon;
            return (
              <button
                key={idx}
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-all disabled:opacity-50 hover:opacity-90"
                style={{
                  backgroundColor: style.bg,
                  color: style.text,
                  borderColor: style.border,
                }}
              >
                {ActionIcon && <ActionIcon size={14} />}
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ActionCardShell;
