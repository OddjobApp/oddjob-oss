/**
 * Design System Hooks
 *
 * Reusable hooks for accessing design tokens and system utilities.
 */

import { useCallback } from "react";
import { colors, statusBadges, spacing, typography } from "../tokens";
import type { colors as colorType } from "../tokens";

// ─────────────────────────────────────────────────────────────────────────────
// useStatusBadge - Get styling for a status
// ─────────────────────────────────────────────────────────────────────────────

export function useStatusBadge(status: keyof typeof statusBadges) {
  return statusBadges[status];
}

// ─────────────────────────────────────────────────────────────────────────────
// useStatusColor - Get color for a status
// ─────────────────────────────────────────────────────────────────────────────

type StatusColorKey = "completed" | "running" | "paused" | "warning" | "failed" | "pending" | "replanning";

export function useStatusColor(status: StatusColorKey) {
  const statusMap: Record<StatusColorKey, string> = {
    completed: colors.success[500],
    running: colors.accent[500],
    paused: colors.manual[500],
    warning: colors.warning[500],
    failed: colors.danger[500],
    pending: colors.info[500],
    replanning: colors.recovery[500],
  };

  return statusMap[status] || colors.neutral[500];
}

// ─────────────────────────────────────────────────────────────────────────────
// useContrastColor - Ensure text color has sufficient contrast
// ─────────────────────────────────────────────────────────────────────────────

export function useContrastColor(backgroundColor: string): string {
  // Simple contrast checker - returns white or black based on luminance
  const hex = backgroundColor.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return white text for dark backgrounds, black for light
  return luminance > 0.5 ? colors.neutral[900] : colors.neutral[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// useExecutionColor - Get color for execution metrics
// ─────────────────────────────────────────────────────────────────────────────

type ExecutionMetric = "critical" | "normal" | "actual" | "float";

export function useExecutionColor(metric: ExecutionMetric): string {
  const colorMap: Record<ExecutionMetric, string> = {
    critical: colors.execution.critical,
    normal: colors.execution.normal,
    actual: colors.execution.actual,
    float: colors.execution.float,
  };

  return colorMap[metric];
}

// ─────────────────────────────────────────────────────────────────────────────
// useResponsiveSpacing - Get responsive spacing values
// ─────────────────────────────────────────────────────────────────────────────

export function useResponsiveSpacing(
  base: keyof typeof spacing,
  md?: keyof typeof spacing,
  lg?: keyof typeof spacing
) {
  return {
    base: spacing[base],
    md: spacing[md || base],
    lg: spacing[lg || (md || base)],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useThemeColors - Get a subset of theme colors
// ─────────────────────────────────────────────────────────────────────────────

export function useThemeColors(
  variant: "primary" | "success" | "warning" | "danger" | "info" | "recovery"
) {
  const variants = {
    primary: colors.primary,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    info: colors.info,
    recovery: colors.recovery,
  };

  return variants[variant];
}

// ─────────────────────────────────────────────────────────────────────────────
// useTailwindClass - Generate Tailwind class names from tokens
// ─────────────────────────────────────────────────────────────────────────────

export function useTailwindClass(
  token: "bg" | "text" | "border",
  color: string
): string {
  // Maps hex colors to Tailwind class names
  const colorMap: Record<string, string> = {
    [colors.primary[500]]: "cyan",
    [colors.success[500]]: "emerald",
    [colors.warning[500]]: "amber",
    [colors.danger[500]]: "red",
    [colors.info[500]]: "indigo",
    [colors.recovery[500]]: "purple",
    // colors.accent[500] is also #f59e0b (→ amber); covered by warning above.
    [colors.manual[500]]: "cyan",
  };

  const colorName = colorMap[color];
  if (!colorName) return "";

  return `${token}-${colorName}-500`;
}

export default {
  useStatusBadge,
  useStatusColor,
  useContrastColor,
  useExecutionColor,
  useResponsiveSpacing,
  useThemeColors,
  useTailwindClass,
};
