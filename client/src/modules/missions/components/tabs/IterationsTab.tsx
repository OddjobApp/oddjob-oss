/**
 * Iterations Tab
 * 
 * Shows wave iterations and phase progression for rolling wave missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { GitMerge, CheckCircle2, Circle, Clock, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface IterationsTabProps {
  mission?: any;
  run?: any;
  strategy?: string;
}

export default function IterationsTab({ mission, run }: IterationsTabProps) {
  const phases = mission?.blackboard?.phases || run?.phases || [];
  const currentPhase = run?.currentPhase || mission?.currentPhase;
  const currentPhaseIndex = phases.findIndex((p: any) => p.id === currentPhase?.id || p.name === currentPhase?.name);

  const getPhaseStatus = (phase: any, index: number) => {
    if (index < currentPhaseIndex) return "completed";
    if (index === currentPhaseIndex) return "active";
    return "pending";
  };

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <GitMerge className="w-5 h-5 text-blue-500" />
          <CardTitle className="text-lg font-bold tracking-tight">Wave Iterations</CardTitle>
        </div>
        <CardDescription>
          Progressive elaboration through rolling wave phases
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          {phases.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Circle className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No phases defined</p>
              <p className="text-xs mt-1">Iterations will appear as waves progress</p>
            </div>
          ) : (
            <div className="space-y-2">
              {phases.map((phase: any, idx: number) => {
                const status = getPhaseStatus(phase, idx);
                const isLast = idx === phases.length - 1;

                return (
                  <div key={phase.id || idx} className="relative">
                    <div
                      className={cn(
                        "p-3 rounded-lg border transition-colors",
                        status === "completed" && "bg-emerald-500/5 border-emerald-500/20",
                        status === "active" && "bg-blue-500/5 border-blue-500/20 ring-1 ring-blue-500/20",
                        status === "pending" && "bg-muted/30 border-border"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "mt-0.5",
                          status === "completed" && "text-emerald-500",
                          status === "active" && "text-blue-500",
                          status === "pending" && "text-muted-foreground"
                        )}>
                          {status === "completed" ? (
                            <CheckCircle2 className="w-5 h-5" />
                          ) : status === "active" ? (
                            <Clock className="w-5 h-5" />
                          ) : (
                            <Circle className="w-5 h-5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-bold truncate">{phase.name || `Phase ${idx + 1}`}</span>
                            <Badge 
                              variant="outline" 
                              className={cn(
                                "text-[9px] h-4",
                                status === "completed" && "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
                                status === "active" && "bg-blue-500/10 text-blue-500 border-blue-500/20",
                                status === "pending" && "bg-muted text-muted-foreground"
                              )}
                            >
                              {status}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {phase.description || `Wave ${idx + 1} of the rolling wave execution`}
                          </p>
                          {phase.objectives && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {phase.objectives.slice(0, 3).map((obj: string, i: number) => (
                                <span key={i} className="text-[9px] px-1.5 py-0.5 bg-background rounded border border-border">
                                  {obj}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                    {!isLast && (
                      <div className="ml-5 my-1 w-px h-4 bg-border" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Wave Progress Summary */}
        {phases.length > 0 && (
          <div className="mt-4 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-blue-500">Wave Progress</span>
              <span className="text-xs text-muted-foreground">
                {currentPhaseIndex + 1} / {phases.length}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-500"
                style={{ width: `${((currentPhaseIndex + 1) / phases.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
