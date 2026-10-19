/**
 * Phases Tab
 * 
 * Rolling Wave phase status for Forge missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { Activity, BrainCircuit, Rocket, Eye, Clock } from "lucide-react";

interface PhasesTabProps {
  mission: any;
  run?: any;
  strategy?: string;
}

const phases = [
  { id: "PLANNING", name: "Strategy", description: "AI generates execution structure and initial plan", icon: BrainCircuit, color: "blue" },
  { id: "EXECUTING", name: "Execution", description: "Processing tasks and implementing deliverables", icon: Rocket, color: "amber" },
  { id: "CRITIQUING", name: "Verification", description: "Reviewing and validating mission output", icon: Eye, color: "purple" },
  { id: "WAITING_FOR_ORDERS", name: "Awaiting Input", description: "Ready for human review or direction", icon: Clock, color: "orange" },
];

export default function PhasesTab({ run }: PhasesTabProps) {
  const currentPhase = (run as any)?.missionContext?.phase || "PLANNING";
  const currentIdx = phases.findIndex(p => p.id === currentPhase);
  const progress = ((currentIdx + 1) / phases.length) * 100;

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-amber-500" />
          <CardTitle className="text-lg font-bold">Rolling Wave Phases</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <div className="flex justify-between mb-2 text-sm">
            <span className="text-muted-foreground">Overall Progress</span>
            <span className="font-bold">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2 bg-muted" />
        </div>

        <div className="space-y-3">
          {phases.map((phase, idx) => {
            const Icon = phase.icon;
            const isActive = idx === currentIdx;
            const isCompleted = idx < currentIdx;
            const isPending = idx > currentIdx;

            return (
              <div
                key={phase.id}
                className={`relative p-4 rounded-xl border transition-all ${
                  isActive
                    ? `bg-${phase.color}-500/10 border-${phase.color}-500/30 ring-1 ring-${phase.color}-500/20`
                    : isCompleted
                      ? "bg-emerald-500/5 border-emerald-500/20"
                      : "bg-muted/50 border-border/50"
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                    isActive
                      ? `bg-${phase.color}-500/20`
                      : isCompleted
                        ? "bg-emerald-500/20"
                        : "bg-muted"
                  }`}>
                    <Icon className={`w-6 h-6 ${
                      isActive
                        ? `text-${phase.color}-500`
                        : isCompleted
                          ? "text-emerald-500"
                          : "text-muted-foreground"
                    }`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className={`font-bold ${isActive ? `text-${phase.color}-500` : ""}`}>
                        {phase.name}
                      </h4>
                      {isActive && (
                        <Badge variant="outline" className={`text-[10px] bg-${phase.color}-500/10 text-${phase.color}-500`}>
                          Active
                        </Badge>
                      )}
                      {isCompleted && (
                        <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-500">
                          Completed
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{phase.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
