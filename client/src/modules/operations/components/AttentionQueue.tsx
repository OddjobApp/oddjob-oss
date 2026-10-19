import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Lightbulb,
  PlugZap,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Workflow,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import type { AttentionKind, AttentionQueueItem, AttentionQueueResponse, AttentionSeverity, RecoveryStrategy } from "@shared/operations-attention";
import { cn } from "@/lib/utils";

async function fetchAttentionQueue(): Promise<AttentionQueueResponse> {
  const response = await fetch("/api/operations/attention?limit=8", { credentials: "include" });
  if (!response.ok) throw new Error("Unable to load the attention queue");
  return response.json();
}

const severityStyles: Record<AttentionSeverity, string> = {
  critical: "border-rose-400/30 bg-rose-500/10 text-rose-700 dark:text-rose-200",
  high: "border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-200",
  medium: "border-sky-400/30 bg-sky-500/10 text-sky-700 dark:text-sky-200",
  low: "border-slate-400/20 bg-slate-500/10 text-foreground/70",
};

const kindIcons: Record<AttentionKind, React.ComponentType<{ className?: string }>> = {
  approval: ShieldAlert,
  mission: CircleAlert,
  cycle: Workflow,
  connection: PlugZap,
};

export function AttentionQueue() {
  const query = useQuery({
    queryKey: ["/api/operations/attention"],
    queryFn: fetchAttentionQueue,
    refetchInterval: 30_000,
  });

  return (
    <Card className="border-border bg-muted/30 dark:border-white/10 dark:bg-foreground/[0.04]">
      <CardHeader className="gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-300" aria-hidden="true" />
            <CardTitle className="text-base font-black uppercase tracking-wide text-foreground">Needs attention</CardTitle>
          </div>
          <CardDescription className="mt-1 text-sm text-muted-foreground">
            Risk-sorted approvals, blocked work, budget issues, and connection failures.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {query.data && (
            <>
              <SummaryBadge label="Critical" count={query.data.summary.critical} className="border-rose-400/30 text-rose-700 dark:text-rose-200" />
              <SummaryBadge label="High" count={query.data.summary.high} className="border-amber-400/30 text-amber-700 dark:text-amber-200" />
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            aria-label="Refresh attention queue"
            className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          >
            <RefreshCw className={cn("h-4 w-4", query.isFetching && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {query.isLoading ? (
          <div className="grid gap-2 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-xl bg-foreground/10" />)}
          </div>
        ) : query.isError ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-400/20 bg-rose-500/10 p-4">
            <p className="text-sm text-rose-700 dark:text-rose-200">The attention queue could not be loaded.</p>
            <Button variant="outline" size="sm" onClick={() => query.refetch()} className="border-rose-300/20">Retry</Button>
          </div>
        ) : !query.data?.items.length ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-5">
            <CheckCircle2 className="h-5 w-5 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-emerald-100">No urgent work</p>
              <p className="text-sm text-emerald-700 dark:text-emerald-200/70">Approvals, active runs, budgets, and configured connections are nominal.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {query.data.items.map((item) => <AttentionItem key={item.id} item={item} />)}
          </div>
        )}
        {query.data && query.data.summary.total > query.data.items.length && (
          <p className="mt-3 text-right text-xs text-muted-foreground">
            Showing {query.data.items.length} of {query.data.summary.total} items.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const STRATEGY_LABEL: Record<RecoveryStrategy, string> = {
  retry: "Retry",
  reset: "Reset & retry",
  replan: "Replan",
  safe_state: "Safe state",
};

function AttentionItem({ item }: { item: AttentionQueueItem }) {
  const Icon = kindIcons[item.kind];
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const recovery = item.recovery;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/operations/attention"] });

  const retry = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/mission-runs/${recovery!.missionRunId}/recovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ strategy: recovery!.strategy }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? "Recovery failed to start");
      return res.json().catch(() => ({}));
    },
    onSuccess: () => { toast({ title: `${STRATEGY_LABEL[recovery!.strategy]} started`, description: "The run is being recovered." }); invalidate(); },
    onError: (e: Error) => toast({ title: "Recovery failed", description: e.message, variant: "destructive" }),
  });

  const dismiss = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/mission-runs/${recovery!.missionRunId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? "Could not dismiss the run");
    },
    onSuccess: () => { toast({ title: "Dismissed", description: "Removed from the attention queue." }); invalidate(); },
    onError: (e: Error) => toast({ title: "Dismiss failed", description: e.message, variant: "destructive" }),
  });

  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); fn(); };

  return (
    <Link href={item.href}>
      <div className="group flex h-full cursor-pointer gap-3 rounded-xl border border-border bg-muted/40 p-3 transition-colors hover:border-foreground/20 hover:bg-foreground/[0.05] dark:border-white/10 dark:bg-black/20 dark:hover:border-white/20">
        <div className={cn("mt-0.5 h-fit rounded-lg border p-2", severityStyles[item.severity])}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn("text-[10px] font-bold uppercase", severityStyles[item.severity])}>
              {item.severity}
            </Badge>
            {/* slate-500 measured 4.04:1 here; the token is tuned for both themes. */}
            <span className="text-xs font-medium capitalize text-muted-foreground">{item.kind} · {formatAge(item.ageMinutes)}</span>
          </div>
          <p className="mt-2 truncate text-sm font-bold text-foreground">{item.title}</p>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{item.summary}</p>
          {item.recommendation && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-5 text-amber-700 dark:text-amber-200/80">
              <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
              <span className="line-clamp-2">{item.recommendation}</span>
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-bold text-primary">
              {item.actionLabel}<ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </span>
            {recovery && (
              <>
                <Button
                  size="sm" variant="outline"
                  onClick={stop(() => retry.mutate())}
                  disabled={retry.isPending}
                  className="h-6 gap-1 border-primary/30 px-2 text-[11px] font-bold text-primary hover:bg-primary/10"
                >
                  <RotateCcw className={cn("h-3 w-3", retry.isPending && "animate-spin")} /> {STRATEGY_LABEL[recovery.strategy]}
                </Button>
                <Button
                  size="sm" variant="ghost"
                  onClick={stop(() => dismiss.mutate())}
                  disabled={dismiss.isPending}
                  className="h-6 gap-1 px-2 text-[11px] font-bold text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                >
                  <X className="h-3 w-3" /> Dismiss
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function SummaryBadge({ label, count, className }: { label: string; count: number; className: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1 text-xs font-bold", className)}>
      <span>{count}</span><span>{label}</span>
    </Badge>
  );
}

function formatAge(minutes: number) {
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

