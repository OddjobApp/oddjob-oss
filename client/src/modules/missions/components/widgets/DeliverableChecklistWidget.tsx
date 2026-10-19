/**
 * Deliverable Checklist Widget
 * 
 * Shows deliverable checklist for rolling wave missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { CheckCircle2, Circle, Package } from "lucide-react";

interface DeliverableChecklistWidgetProps {
  mission?: any;
  run?: any;
}

export default function DeliverableChecklistWidget({ mission, run }: DeliverableChecklistWidgetProps) {
  const deliverables = mission?.blackboard?.deliverables || [];
  const completed = deliverables.filter((d: any) => d.status === "completed" || d.done).length;
  const total = deliverables.length;

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <Package className="w-3 h-3 text-emerald-500" />
            Deliverables
          </CardTitle>
          {total > 0 && (
            <Badge variant="outline" className="text-[9px]">
              {completed}/{total}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-xs text-muted-foreground">No deliverables defined</p>
        ) : (
          <div className="space-y-1">
            {deliverables.slice(0, 4).map((deliverable: any, idx: number) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                {deliverable.status === "completed" || deliverable.done ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Circle className="w-3 h-3 text-muted-foreground" />
                )}
                <span className={deliverable.status === "completed" || deliverable.done ? "" : "text-muted-foreground"}>
                  {deliverable.name || deliverable.title || `Deliverable ${idx + 1}`}
                </span>
              </div>
            ))}
            {total > 4 && (
              <p className="text-[10px] text-muted-foreground pl-5">+{total - 4} more</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
