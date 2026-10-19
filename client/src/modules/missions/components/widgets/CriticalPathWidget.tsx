/**
 * Critical Path Widget
 * 
 * Shows critical path items for pre-planned missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { AlertTriangle } from "lucide-react";

interface CriticalPathWidgetProps {
  mission?: any;
  run?: any;
}

export default function CriticalPathWidget({ mission, run }: CriticalPathWidgetProps) {
  const criticalItems = mission?.blackboard?.criticalPath || [];

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 text-amber-500" />
          Critical Path
        </CardTitle>
      </CardHeader>
      <CardContent>
        {criticalItems.length === 0 ? (
          <p className="text-xs text-muted-foreground">No critical path items</p>
        ) : (
          <div className="space-y-2">
            {criticalItems.map((item: any, idx: number) => (
              <div key={idx} className="text-xs p-2 bg-amber-500/5 border border-amber-500/20 rounded">
                {item.name || item.title || `Critical item ${idx + 1}`}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
