/**
 * Failure Patterns Widget
 * 
 * Shows monitored failure patterns for dynamic autonomous missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ShieldCheck, AlertTriangle } from "lucide-react";

interface FailurePatternsWidgetProps {
  mission?: any;
  run?: any;
}

export default function FailurePatternsWidget({ mission, run }: FailurePatternsWidgetProps) {
  const patterns = run?.failurePatterns || mission?.failurePatterns || [];
  const activePatterns = patterns.filter((p: any) => p.status === "active" || p.active);

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3 text-blue-500" />
            Monitored Patterns
          </CardTitle>
          {activePatterns.length > 0 && (
            <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-500 border-amber-500/20">
              {activePatterns.length} Active
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {patterns.length === 0 ? (
          <p className="text-xs text-muted-foreground">No patterns monitored</p>
        ) : (
          <div className="space-y-2">
            {patterns.slice(0, 3).map((pattern: any, idx: number) => (
              <div key={idx} className="flex items-center gap-2 text-xs p-2 bg-muted/30 rounded">
                {pattern.status === "active" || pattern.active ? (
                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                ) : (
                  <ShieldCheck className="w-3 h-3 text-emerald-500" />
                )}
                <span className="flex-1">{pattern.name || pattern.type || `Pattern ${idx + 1}`}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
