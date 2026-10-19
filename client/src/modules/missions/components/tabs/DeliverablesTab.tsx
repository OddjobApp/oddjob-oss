/**
 * Deliverables Tab
 * 
 * Delegates to existing DeliverablesView component for sophisticated deliverable management.
 */

import React from "react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Package, CheckCircle2, Clock3, FileOutput } from "lucide-react";
import { DeliverablesView } from "@domain/mission/ui/modules/missions/components/DeliverablesView";

interface DeliverablesTabProps {
  mission: any;
  run?: any;
  strategy?: string;
  viewMode?: "business" | "developer";
}

export default function DeliverablesTab({ mission, run, viewMode }: DeliverablesTabProps) {
  const missionContext = (run?.missionContext as any) || {};
  const expectedFromBlackboard = mission?.blackboard?.expected_deliverables || mission?.blackboard?.deliverables || [];
  const expectedFromRun = missionContext?.deliverables || [];
  const expectedDeliverables = Array.from(new Set([
    ...(Array.isArray(expectedFromBlackboard) ? expectedFromBlackboard : []),
    ...(Array.isArray(expectedFromRun) ? expectedFromRun : []),
  ]));
  const completedDeliverables = Array.isArray(mission?.deliverables)
    ? mission.deliverables.filter((item: any) => item?.status === "completed").length
    : 0;
  const reviewReadiness = completedDeliverables > 0 ? "Outputs ready for review" : "Outputs still in progress";

  if (viewMode === "business") {
    return (
      <div className="space-y-4">
        <Card className="bg-background/40 backdrop-blur-md border-border">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-muted-foreground" />
              <CardTitle className="text-lg font-bold tracking-tight">Outputs</CardTitle>
            </div>
            <CardDescription>
              Review what this run is expected to produce and whether those outputs are ready for business review.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">Outputs expected</p>
              <p className="mt-2 text-2xl font-black text-foreground">{expectedDeliverables.length}</p>
              <p className="mt-2 text-sm text-muted-foreground">Planned reports, files, or app assets for this run.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">Outputs completed</p>
              <p className="mt-2 text-2xl font-black text-foreground">{completedDeliverables}</p>
              <p className="mt-2 text-sm text-muted-foreground">Items already marked complete in mission records.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">Review status</p>
              <p className="mt-2 text-base font-semibold text-foreground">{reviewReadiness}</p>
              <p className="mt-2 text-sm text-muted-foreground">Use the list below to inspect each deliverable.</p>
            </div>
          </CardContent>
        </Card>

        {expectedDeliverables.length > 0 && (
          <Card className="bg-background/40 backdrop-blur-md border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-bold tracking-tight">Output Checklist</CardTitle>
              <CardDescription>
                A quick scan of what should be delivered from this mission.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {expectedDeliverables.map((name: string) => {
                const isComplete = Array.isArray(mission?.deliverables) && mission.deliverables.some((item: any) => item?.name === name && item?.status === "completed");
                return (
                  <div key={name} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-foreground/5 text-foreground/85">
                        {isComplete ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Clock3 className="h-4 w-4 text-amber-400" />}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{name}</p>
                        <p className="text-xs text-muted-foreground">{isComplete ? "Ready to review" : "Still being prepared"}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className={isComplete ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"}>
                      {isComplete ? "Ready" : "Pending"}
                    </Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Card className="bg-background/40 backdrop-blur-md border-border">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-lg font-bold tracking-tight">Detailed Outputs</CardTitle>
                <CardDescription>
                  Open any completed deliverable for the full content preview.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileOutput className="h-4 w-4" />
                Detailed asset view
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <DeliverablesView mission={mission} run={run} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-muted-foreground" />
          <CardTitle className="text-lg font-bold tracking-tight">Deliverables</CardTitle>
        </div>
        <CardDescription>
          Mission outputs and their completion status.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DeliverablesView mission={mission} run={run} />
      </CardContent>
    </Card>
  );
}
