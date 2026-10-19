/**
 * Phase Indicator Widget
 * 
 * Shows current phase for rolling wave missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { GitBranch } from "lucide-react";

interface PhaseIndicatorWidgetProps {
  mission?: any;
  run?: any;
}

export default function PhaseIndicatorWidget({ mission, run }: PhaseIndicatorWidgetProps) {
  const phases = mission?.blackboard?.phases || [];
  const currentPhase = run?.currentPhase || mission?.currentPhase || phases[0];
  const currentPhaseIndex = phases.findIndex((p: any) => p.id === currentPhase?.id);
  const progress = phases.length > 0 ? ((currentPhaseIndex + 1) / phases.length) * 100 : 0;

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <GitBranch className="w-3 h-3 text-blue-500" />
            Current Phase
          </CardTitle>
          {currentPhase && (
            <Badge variant="outline" className="text-[9px]">
              {currentPhaseIndex + 1} / {phases.length}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {currentPhase ? (
          <>
            <div className="text-sm font-medium">{currentPhase.name || currentPhase.title || "Current Phase"}</div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground">
              {currentPhase.description || "Phase in progress"}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No active phase</p>
        )}
      </CardContent>
    </Card>
  );
}
