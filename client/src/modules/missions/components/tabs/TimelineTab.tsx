/**
 * Timeline Tab
 * 
 * Timeline visualization for pre-planned missions.
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Clock, TrendingUp, TrendingDown } from "lucide-react";

interface TimelineTabProps {
  mission: any;
  run?: any;
  strategy?: string;
}

export default function TimelineTab({ mission, run }: TimelineTabProps) {
  const { selectedOrgId } = useOrgContext();
  const evidence = useQuery<{ events: Array<{ id: string; kind: string; title: string; timestamp: string; status?: string | null; summary?: string; actor?: string | null }> }>({
    queryKey: ["/api/mission-runs", run?.id, "evidence-timeline", selectedOrgId],
    enabled: !!run?.id && selectedOrgId != null,
    queryFn: async ({ signal }) => {
      const response = await apiRequest("GET", `/api/mission-runs/${run.id}/evidence-timeline?orgId=${selectedOrgId}&includePayloads=false&direction=desc`, undefined, undefined, signal);
      return response.json();
    },
  });
  const estimatedDuration = mission.estimatedDuration || 1;
  const startedAt = run?.startedAt ? new Date(run.startedAt) : null;
  const completedAt = run?.completedAt ? new Date(run.completedAt) : null;
  const now = new Date();
  
  const elapsedHours = startedAt 
    ? ((completedAt?.getTime() || now.getTime()) - startedAt.getTime()) / (1000 * 60 * 60)
    : 0;
  
  const remainingHours = Math.max(0, estimatedDuration - elapsedHours);
  const variance = startedAt ? ((elapsedHours - estimatedDuration) / estimatedDuration) * 100 : 0;

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-500" />
          <CardTitle className="text-lg font-bold">Timeline</CardTitle>
        </div>
        <CardDescription>
          Mission timeline and schedule variance
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Time Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 rounded-lg bg-background/50 border border-border/50">
            <div className="text-2xl font-black text-blue-500">
              {startedAt ? new Date(startedAt).toLocaleDateString() : "--"}
            </div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Started</p>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border/50">
            <div className="text-2xl font-black text-emerald-500">
              {completedAt ? new Date(completedAt).toLocaleDateString() : "--"}
            </div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Completed</p>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border/50">
            <div className="text-2xl font-black text-amber-500">{Math.round(elapsedHours)}h</div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Elapsed</p>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border/50">
            <div className="text-2xl font-black text-purple-500">{Math.round(remainingHours)}h</div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Remaining</p>
          </div>
        </div>

        {/* Variance Analysis */}
        {startedAt && (
          <div className={`p-4 rounded-xl border ${
            Math.abs(variance) > 20 
              ? "bg-red-500/5 border-red-500/20" 
              : Math.abs(variance) > 10 
                ? "bg-amber-500/5 border-amber-500/20"
                : "bg-emerald-500/5 border-emerald-500/20"
          }`}>
            <div className="flex items-center gap-2 mb-2">
              {variance > 0 ? (
                <TrendingUp className="w-5 h-5 text-red-500" />
              ) : (
                <TrendingDown className="w-5 h-5 text-emerald-500" />
              )}
              <span className="font-bold">Timeline Variance</span>
              <Badge variant="outline" className={`text-[10px] ${
                Math.abs(variance) > 20 
                  ? "bg-red-500/10 text-red-500" 
                  : Math.abs(variance) > 10 
                    ? "bg-amber-500/10 text-amber-500"
                    : "bg-emerald-500/10 text-emerald-500"
              }`}>
                {variance > 0 ? "+" : ""}{Math.round(variance)}%
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {variance > 20 
                ? "Significant delay detected. Consider scope adjustment."
                : variance > 10 
                  ? "Minor variance within acceptable range."
                  : variance < -10
                    ? "Ahead of schedule. On track for early completion."
                    : "On schedule."
              }
            </p>
          </div>
        )}

        <section aria-label="Execution evidence" className="space-y-4">
          <div><h3 className="font-semibold">Execution evidence</h3><p className="text-sm text-muted-foreground">Recorded state changes, approval decisions, tool actions, and computer-use steps. Payloads are excluded from this view.</p></div>
          {!run?.id || selectedOrgId == null ? <p className="text-sm text-muted-foreground">Select a run in an organization to inspect its evidence.</p>
            : evidence.isPending ? <p role="status">Loading execution evidence...</p>
            : evidence.isError ? <div role="alert"><p>Execution evidence could not be loaded.</p><button type="button" className="min-h-11 font-semibold underline" onClick={() => evidence.refetch()}>Retry evidence</button></div>
            : !evidence.data?.events.length ? <p className="text-sm text-muted-foreground">No execution evidence has been recorded for this run.</p>
            : <ol className="space-y-3">{evidence.data.events.map(event => <li key={event.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{event.kind.replace(/_/g, " ")}</Badge>{event.status && <Badge variant="secondary">{event.status}</Badge>}<time dateTime={event.timestamp} className="text-xs text-muted-foreground">{new Date(event.timestamp).toLocaleString()}</time></div>
                <h4 className="mt-2 font-semibold">{event.title}</h4>{event.summary && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{event.summary}</p>}{event.actor && <p className="mt-2 text-xs text-muted-foreground">Actor: {event.actor}</p>}
              </li>)}</ol>}
        </section>
      </CardContent>
    </Card>
  );
}
