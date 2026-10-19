import React, { useState } from "react";
import {
  Sparkles,
  Image as ImageIcon,
  Layout,
  Table as TableIcon,
  BarChart3,
  Layers,
  RefreshCw,
  AlertCircle,
  LucideIcon,
} from "lucide-react";
import { colors } from "../tokens";

export type PlaceholderVariant = "image" | "card" | "table" | "chart" | "component";
export type PlaceholderStatus = "idle" | "loading" | "generating" | "ready" | "error";

export interface PlaceholderPreviewProps {
  /** Visual variant matching the destination asset type */
  variant?: PlaceholderVariant;
  /** Aspect ratio class (e.g. 'aspect-video', 'aspect-square', 'aspect-4/3', or custom) */
  aspectRatio?: string;
  /** Status of the underlying asset */
  status?: PlaceholderStatus;
  /** Shorthand boolean: true = loading/generating, false = ready */
  isLoading?: boolean;
  /** Primary label displayed on the placeholder */
  title?: string;
  /** Subtitle or prompt metadata description */
  subtitle?: string;
  /** Optional badge text (e.g. 'AI Asset', 'Synthesizing...', 'QuickBooks') */
  badgeText?: string;
  /** Custom icon override */
  icon?: LucideIcon;
  /** Progress percentage (0 - 100) */
  progress?: number;
  /** Error message to display when status is 'error' or hasError is true */
  errorMessage?: string;
  /** Retry handler */
  onRetry?: () => void;
  /** Interactive click handler on the placeholder (e.g. 'Click to mount') */
  onClick?: () => void;
  /** The live content to mount and display once loaded */
  children?: React.ReactNode;
  /** Additional wrapper CSS classes */
  className?: string;
  /** Minimum container height */
  minHeight?: string;
}

export function PlaceholderPreview({
  variant = "image",
  aspectRatio = "aspect-video",
  status = "loading",
  isLoading,
  title,
  subtitle,
  badgeText,
  icon: CustomIcon,
  progress,
  errorMessage,
  onRetry,
  onClick,
  children,
  className = "",
  minHeight = "min-h-[14rem]",
}: PlaceholderPreviewProps) {
  const isActivelyLoading = isLoading !== undefined ? isLoading : (status === "loading" || status === "generating");
  const isError = status === "error" || Boolean(errorMessage);

  const getVariantIcon = (): LucideIcon => {
    if (CustomIcon) return CustomIcon;
    switch (variant) {
      case "image":
        return status === "generating" ? Sparkles : ImageIcon;
      case "card":
        return Layout;
      case "table":
        return TableIcon;
      case "chart":
        return BarChart3;
      case "component":
        return Layers;
      default:
        return Sparkles;
    }
  };

  const Icon = getVariantIcon();

  const getDefaultTitle = () => {
    if (title) return title;
    if (status === "generating") return "Generating asset preview...";
    if (isActivelyLoading) return "Loading asset preview...";
    if (isError) return "Failed to load asset";
    return "Preview available";
  };

  const getDefaultBadge = () => {
    if (badgeText) return badgeText;
    if (status === "generating") return "AI Synthesizing";
    if (isActivelyLoading) return "Hydrating";
    if (isError) return "Load Error";
    return "Asset Ready";
  };

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-border/70 bg-card transition-all duration-300 ${minHeight} ${className}`}
      data-testid="placeholder-preview-container"
    >
      {/* ─── LIVE CONTENT LAYER (Fades in when loaded) ─── */}
      {children && (
        <div
          className={`w-full h-full transition-opacity duration-500 ease-out ${
            isActivelyLoading || isError
              ? "opacity-0 pointer-events-none absolute inset-0 -z-10"
              : "opacity-100 relative z-10"
          }`}
          data-testid="placeholder-live-content"
        >
          {children}
        </div>
      )}

      {/* ─── PLACEHOLDER / SKELETON LAYER (Fades out when ready) ─── */}
      {(isActivelyLoading || isError || !children) && (
        <div
          onClick={onClick}
          className={`relative z-20 flex flex-col justify-between p-4 sm:p-5 w-full h-full ${aspectRatio} ${
            onClick ? "cursor-pointer hover:border-primary/50 transition-colors" : ""
          } ${
            !isActivelyLoading && !isError && children
              ? "opacity-0 pointer-events-none absolute inset-0"
              : "opacity-100"
          }`}
          data-testid="placeholder-skeleton"
        >
          {/* Subtle background blueprint grid */}
          <div
            className="absolute inset-0 opacity-[0.03] dark:opacity-[0.07] pointer-events-none"
            style={{
              backgroundImage:
                "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }}
          />

          {/* Animated shimmering beam */}
          {isActivelyLoading && (
            <div
              className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-foreground/5 to-transparent pointer-events-none"
              style={{
                animation: "shimmer 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite",
              }}
            />
          )}

          {/* Top Bar: Icon + Badge + Progress */}
          <div className="flex items-center justify-between gap-3 relative z-10">
            <div className="flex items-center gap-2">
              <div
                className={`p-2 rounded-lg border border-border/80 transition-transform ${
                  isActivelyLoading ? "animate-pulse" : ""
                }`}
                style={{
                  backgroundColor: "hsl(var(--muted) / 0.5)",
                }}
              >
                <Icon className="h-4 w-4 text-primary shrink-0" />
              </div>
              <div className="space-y-0.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-foreground block truncate">
                  {getDefaultTitle()}
                </span>
                {subtitle && (
                  <span className="text-[10px] text-muted-foreground block truncate max-w-[260px]">
                    {subtitle}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase border border-border"
                style={{
                  backgroundColor: isError
                    ? "hsl(var(--destructive) / 0.1)"
                    : "hsl(var(--muted) / 0.6)",
                  color: isError
                    ? "hsl(var(--destructive))"
                    : "hsl(var(--muted-foreground))",
                }}
              >
                {getDefaultBadge()}
              </span>
            </div>
          </div>

          {/* Center Graphic: Wireframe Preview based on variant */}
          <div className="my-auto py-3 relative z-10 flex flex-col items-center justify-center">
            {isError ? (
              <div className="text-center space-y-2 max-w-sm px-4">
                <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
                <p className="text-xs text-muted-foreground">
                  {errorMessage || "Unable to load preview asset. The source may be unavailable or expired."}
                </p>
                {onRetry && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry();
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-background hover:bg-muted text-foreground transition-colors shadow-xs"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Retry loading</span>
                  </button>
                )}
              </div>
            ) : variant === "image" ? (
              <div className="w-full max-w-[320px] aspect-video rounded-lg border border-border/60 bg-muted/20 flex flex-col items-center justify-center relative overflow-hidden shadow-xs">
                <div className="absolute inset-0 flex items-center justify-center opacity-10">
                  <Sparkles className="w-24 h-24 text-primary animate-pulse" />
                </div>
                <div className="space-y-1.5 text-center relative z-10 px-4">
                  <div className="w-8 h-8 rounded-full border border-border/80 bg-background/80 flex items-center justify-center mx-auto shadow-xs">
                    <ImageIcon className="h-4 w-4 text-primary/80" />
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground block">
                    {status === "generating" ? "Synthesizing pixels..." : "Buffering asset..."}
                  </span>
                </div>
              </div>
            ) : variant === "table" ? (
              <div className="w-full space-y-2 px-2">
                <div className="h-4 w-full rounded bg-muted/40 animate-pulse" />
                <div className="h-3 w-4/5 rounded bg-muted/30 animate-pulse" />
                <div className="h-3 w-full rounded bg-muted/20 animate-pulse" />
                <div className="h-3 w-3/4 rounded bg-muted/25 animate-pulse" />
              </div>
            ) : variant === "chart" ? (
              <div className="w-full max-w-xs flex items-end justify-center gap-2 h-20 px-4">
                <div className="w-6 rounded-t bg-muted/30 h-10 animate-pulse" />
                <div className="w-6 rounded-t bg-muted/40 h-16 animate-pulse" />
                <div className="w-6 rounded-t bg-primary/20 h-12 animate-pulse" />
                <div className="w-6 rounded-t bg-muted/30 h-8 animate-pulse" />
                <div className="w-6 rounded-t bg-primary/30 h-18 animate-pulse" />
                <div className="w-6 rounded-t bg-muted/40 h-14 animate-pulse" />
              </div>
            ) : variant === "card" || variant === "component" ? (
              <div className="w-full max-w-sm rounded-lg border border-border/40 p-3 space-y-2 bg-muted/10 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="h-3.5 w-24 rounded bg-muted/50 animate-pulse" />
                  <div className="h-3 w-12 rounded bg-muted/40 animate-pulse" />
                </div>
                <div className="h-2.5 w-full rounded bg-muted/30 animate-pulse" />
                <div className="h-2.5 w-3/4 rounded bg-muted/25 animate-pulse" />
              </div>
            ) : null}
          </div>

          {/* Bottom Bar: Progress or Wireframe metadata */}
          <div className="relative z-10 pt-2 border-t border-border/40 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="font-mono">
              {progress !== undefined ? `${Math.round(progress)}% complete` : "Oddjob Modern Asset Pipeline"}
            </span>
            <div className="flex items-center gap-1.5 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
              <span>Live cross-fade ready</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PlaceholderPreview;
