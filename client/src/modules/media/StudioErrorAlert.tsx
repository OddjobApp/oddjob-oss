import React from "react";
import { AlertTriangle, ExternalLink, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { describeStudioError, type StudioErrorAction } from "./errors";
import { openInMediaStudio } from "./navigation";

/** An error in the studio: what went wrong, what to do, and a way to do it. */
export function StudioErrorAlert({ error, onRetry, retryLabel = "Retry", onDismiss, className }: {
  error: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
  className?: string;
}) {
  if (!error) return null;
  const guidance = describeStudioError(error);
  const { message, fix } = guidance;
  const actions: StudioErrorAction[] = guidance.actions ?? (guidance.action ? [guidance.action] : []);
  const rawMessage = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const showDetails = Boolean(rawMessage && rawMessage !== message && rawMessage !== fix);

  return (
    <div role="alert" className={cn("flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs", className)} data-testid="studio-error">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-destructive">{message}</p>
        <p className="text-foreground/80">{fix}</p>
        {(actions.length > 0 || onRetry) && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {actions.map((act, i) =>
              "href" in act ? (
                <a
                  key={i}
                  href={act.href}
                  target={act.href.startsWith("http") ? "_blank" : undefined}
                  rel={act.href.startsWith("http") ? "noreferrer" : undefined}
                  className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted"
                >
                  {act.label}
                  {act.href.startsWith("http") && <ExternalLink className="h-3 w-3 text-muted-foreground" />}
                </a>
              ) : (
                <Button key={i} type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => openInMediaStudio(act.location)}>
                  {act.label}
                </Button>
              )
            )}
            {onRetry && (
              <Button type="button" size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={onRetry}>
                <RotateCcw className="h-3 w-3" aria-hidden />{retryLabel}
              </Button>
            )}
          </div>
        )}
        {showDetails && (
          <details className="mt-1 text-[10px] text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">Technical details</summary>
            <p className="mt-1 font-mono break-all rounded bg-background/50 p-1 text-[10px] select-all">{rawMessage}</p>
          </details>
        )}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="h-5 w-5 shrink-0 rounded text-muted-foreground hover:text-foreground">
          <X className="mx-auto h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
