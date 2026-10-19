/**
 * Activity Tab
 * 
 * Delegates to existing MissionActivity component for sophisticated activity display.
 */

import React from "react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Activity, AlertTriangle, CheckCircle2, PlayCircle, TimerReset } from "lucide-react";
import { MissionActivity } from "@domain/mission/ui/modules/missions/components/MissionActivity";

interface ActivityTabProps {
  mission: any;
  run?: any;
  strategy?: string;
  viewMode?: "business" | "developer";
}

const titleCase = (value: string | undefined) =>
  value ? value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) : "Not started";

export default function ActivityTab({ mission, run, viewMode }: ActivityTabProps) {
  const missionContext = (run?.missionContext as any) || {};
  const approvalsPending = missionContext?.forgeStatus?.status === "awaiting_wave_approval";
  const recentDecision = approvalsPending
    ? `Approval needed for phase ${missionContext?.forgeStatus?.currentWaveId || 1}`
    : run?.status === "failed"
      ? "Run needs intervention before work continues"
      : run?.status === "completed"
        ? "Work completed and ready for review"
        : "Work is progressing through the active plan";
  const businessCards = [
    {
      label: "Current status",
      value: titleCase(run?.status),
      helper: approvalsPending ? "Waiting on business review" : "Based on the latest execution state",
      icon: run?.status === "failed" ? AlertTriangle : run?.status === "completed" ? CheckCircle2 : PlayCircle,
    },
    {
      label: "Latest decision",
      value: recentDecision,
      helper: "The most important update for a reviewer",
      icon: Activity,
    },
    {
      label: "Review checkpoint",
      value: approvalsPending ? "Action required" : "No action pending",
      helper: approvalsPending ? "Approve the next phase or request changes" : "Continue monitoring updates and outputs",
      icon: TimerReset,
    },
  ];

  if (viewMode === "business") {
    return (
      <div className="space-y-4">
        <Card className="bg-background/40 backdrop-blur-md border-border">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-muted-foreground" />
              <CardTitle className="text-lg font-bold tracking-tight">Business Updates</CardTitle>
            </div>
            <CardDescription>
              The most important status changes, decisions, and review checkpoints for this run.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-3">
            {businessCards.map((card) => (
              <div key={card.label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">{card.label}</p>
                    <p className="mt-2 text-base font-semibold text-foreground">{card.value}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-foreground/5 text-foreground/85">
                    <card.icon className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{card.helper}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-background/40 backdrop-blur-md border-border">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-lg font-bold tracking-tight">Recent Timeline</CardTitle>
                <CardDescription>
                  Detailed updates are still available below when you need the full history.
                </CardDescription>
              </div>
              {approvalsPending && (
                <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-amber-400">
                  Review Pending
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <MissionActivity missionId={mission.id} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-muted-foreground" />
          <CardTitle className="text-lg font-bold tracking-tight">Mission Activity</CardTitle>
        </div>
        <CardDescription>
          Real-time execution events and status updates.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <MissionActivity missionId={mission.id} />
      </CardContent>
    </Card>
  );
}
