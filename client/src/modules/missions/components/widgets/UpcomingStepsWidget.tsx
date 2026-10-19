/**
 * Upcoming Steps Widget
 * 
 * Shows upcoming steps for pre-planned missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Clock, ChevronRight } from "lucide-react";

interface UpcomingStepsWidgetProps {
  mission?: any;
  run?: any;
}

export default function UpcomingStepsWidget({ mission, run }: UpcomingStepsWidgetProps) {
  const steps = mission?.blackboard?.plan?.phases || [];
  const upcoming = steps.slice(0, 3);

  if (upcoming.length === 0) {
    return (
      <Card className="bg-background/40 backdrop-blur-md border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-bold uppercase tracking-wider">Upcoming Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">No upcoming steps defined</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-bold uppercase tracking-wider">Upcoming Steps</CardTitle>
          <Badge variant="outline" className="text-[9px]">{upcoming.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {upcoming.map((step: any, idx: number) => (
          <div key={idx} className="flex items-center gap-2 p-2 bg-muted/30 rounded text-xs">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="flex-1 truncate">{step.name || step.title || `Step ${idx + 1}`}</span>
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
