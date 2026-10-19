/**
 * Health Dashboard Widget
 * 
 * Shows mission health metrics for dynamic autonomous missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Activity, CheckCircle2, AlertCircle } from "lucide-react";

interface HealthDashboardWidgetProps {
  mission?: any;
  run?: any;
}

export default function HealthDashboardWidget({ mission, run }: HealthDashboardWidgetProps) {
  const health = run?.health || mission?.health || { status: "unknown", score: 0 };

  const getStatusIcon = () => {
    switch (health.status) {
      case "healthy": return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case "warning": return <AlertCircle className="w-4 h-4 text-amber-500" />;
      default: return <Activity className="w-4 h-4 text-blue-500" />;
    }
  };

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
          {getStatusIcon()}
          Health
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${health.score || 0}%` }}
            />
          </div>
          <span className="text-xs font-mono">{health.score || 0}%</span>
        </div>
      </CardContent>
    </Card>
  );
}
