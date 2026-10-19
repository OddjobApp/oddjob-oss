/**
 * Recent Adaptations Widget
 * 
 * Shows recent AI adaptations for dynamic autonomous missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Zap } from "lucide-react";

interface RecentAdaptationsWidgetProps {
  mission?: any;
  run?: any;
}
export default function RecentAdaptationsWidget({ mission, run }: RecentAdaptationsWidgetProps) {
  const trace = run?.dynamicTrace || mission?.dynamicTrace || [];
  const adaptations = trace
    .filter((t: any) => t.type === "adaptation" || t.event === "path_change")
    .map((t: any) => ({
      description: t.note || t.intent || "Execution path changed",
      type: t.event || "adaptation"
    }));
  const recent = adaptations.slice(0, 3);

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-purple-500" />
            Recent Changes
          </CardTitle>
          {recent.length > 0 && <Badge variant="outline" className="text-[9px]">{recent.length}</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">No recent adaptations</p>
        ) : (
          <div className="space-y-2">
            {recent.map((adaptation: any, idx: number) => (
              <div key={idx} className="text-xs p-2 bg-purple-500/5 border border-purple-500/20 rounded">
                {adaptation.description || adaptation.type || `Adaptation ${idx + 1}`}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
