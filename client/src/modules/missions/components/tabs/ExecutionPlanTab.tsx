/**
 * Execution Plan Tab
 * 
 * Predefined mission steps for pre-planned missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollText, CheckCircle2, Clock, MoreHorizontal, AlertTriangle, Users } from "lucide-react";

interface ExecutionPlanTabProps {
  mission: any;
  run?: any;
  strategy?: string;
  viewMode?: "business" | "developer";
}

export default function ExecutionPlanTab({ mission, run, viewMode }: ExecutionPlanTabProps) {
  const members = mission.members || [];
  const completedSteps = run?.steps?.filter((s: any) => s.status === "completed").length || 0;
  const runningSteps = run?.steps?.filter((s: any) => s.status === "running" || s.status === "active").length || 0;
  const blockedSteps = run?.steps?.filter((s: any) => s.status === "failed" || s.status === "blocked").length || 0;

  if (viewMode === "business") {
    return (
      <div className="space-y-4">
        <Card className="bg-background/40 backdrop-blur-md border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ScrollText className="w-5 h-5 text-emerald-500" />
              <CardTitle className="text-lg font-bold">Execution Plan</CardTitle>
            </div>
            <CardDescription>
              A business view of phases, ownership, and what is currently moving.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">Plan progress</p>
              <p className="mt-2 text-2xl font-black text-foreground">{completedSteps} / {members.length}</p>
              <p className="mt-2 text-sm text-muted-foreground">Work items completed so far.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">In motion</p>
              <p className="mt-2 text-2xl font-black text-foreground">{runningSteps}</p>
              <p className="mt-2 text-sm text-muted-foreground">Items currently being worked.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">Needs attention</p>
              <p className="mt-2 text-2xl font-black text-foreground">{blockedSteps}</p>
              <p className="mt-2 text-sm text-muted-foreground">Items blocked or failed.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-background/40 backdrop-blur-md border-border">
          <CardContent className="pt-6">
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No execution plan defined for this mission.
              </p>
            ) : (
              <div className="space-y-3">
                {members.map((member: any, idx: number) => {
                  const stepStatus = run?.steps?.[idx]?.status || "pending";
                  const isCompleted = stepStatus === "completed";
                  const isCurrent = stepStatus === "running" || stepStatus === "active";
                  const isBlocked = stepStatus === "failed" || stepStatus === "blocked";

                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-4 p-4 rounded-xl border transition-all ${
                        isCompleted
                          ? "bg-emerald-500/5 border-emerald-500/20"
                          : isCurrent
                            ? "bg-amber-500/5 border-amber-500/20"
                            : isBlocked
                              ? "bg-red-500/5 border-red-500/20"
                              : "bg-muted/50 border-border/50"
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        isCompleted
                          ? "bg-emerald-500/20 text-emerald-500"
                          : isCurrent
                            ? "bg-amber-500/20 text-amber-500"
                            : isBlocked
                              ? "bg-red-500/20 text-red-400"
                              : "bg-muted text-muted-foreground"
                      }`}>
                        {isCompleted ? (
                          <CheckCircle2 className="w-5 h-5" />
                        ) : isCurrent ? (
                          <Clock className="w-5 h-5 animate-pulse" />
                        ) : isBlocked ? (
                          <AlertTriangle className="w-5 h-5" />
                        ) : (
                          <MoreHorizontal className="w-5 h-5" />
                        )}
                      </div>
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-bold text-foreground">{member.jobName || `Phase ${idx + 1}`}</p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {member.description || member.jobType || "No description available."}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {stepStatus.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5" />
                            {member.roleTitle || member.jobType || "Assigned team member"}
                          </span>
                          {member.estimatedDuration && (
                            <span className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5" />
                              Target: {member.estimatedDuration} hours
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-emerald-500" />
          <CardTitle className="text-lg font-bold">Execution Plan</CardTitle>
        </div>
        <CardDescription>
          {completedSteps} of {members.length} steps completed
        </CardDescription>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No execution plan defined for this mission.
          </p>
        ) : (
          <div className="space-y-3">
            {members.map((member: any, idx: number) => {
              const stepStatus = run?.steps?.[idx]?.status || "pending";
              const isCompleted = stepStatus === "completed";
              const isCurrent = stepStatus === "running" || stepStatus === "active";

              return (
                <div
                  key={idx}
                  className={`flex items-start gap-4 p-4 rounded-xl border transition-all ${
                    isCompleted
                      ? "bg-emerald-500/5 border-emerald-500/20"
                      : isCurrent
                        ? "bg-amber-500/5 border-amber-500/20"
                        : "bg-muted/50 border-border/50"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    isCompleted
                      ? "bg-emerald-500/20 text-emerald-500"
                      : isCurrent
                        ? "bg-amber-500/20 text-amber-500"
                        : "bg-muted text-muted-foreground"
                  }`}>
                    {isCompleted ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : isCurrent ? (
                      <Clock className="w-5 h-5 animate-pulse" />
                    ) : (
                      <MoreHorizontal className="w-5 h-5" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{member.jobName || `Step ${idx + 1}`}</span>
                      <Badge variant="outline" className="text-[9px]">
                        {member.entityType || "task"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {member.description || member.jobType || "No description"}
                    </p>

                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      {member.tool && <span>Tool: {member.tool}</span>}
                      {member.estimatedDuration && <span>Est: {member.estimatedDuration}h</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-[10px] uppercase tracking-wider font-bold ${
                      isCompleted ? "text-emerald-500" : isCurrent ? "text-amber-500" : "text-muted-foreground"
                    }`}>
                      {stepStatus}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
