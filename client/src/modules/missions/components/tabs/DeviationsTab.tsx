/**
 * Deviations Tab
 * 
 * Tracks deviations from execution plan for pre-planned missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { AlertTriangle, CheckCircle2, Clock, AlertCircle } from "lucide-react";

interface DeviationsTabProps {
  mission: any;
  run?: any;
  strategy?: string;
}

export default function DeviationsTab({ mission, run }: DeviationsTabProps) {
  const steps = run?.steps || [];
  const members = mission.members || [];
  
  // Find deviations
  const deviations = steps.map((step: any, idx: number) => {
    const member = members[idx];
    const estimatedDuration = member?.estimatedDuration || 1;
    const actualDuration = step.actualDuration || 0;
    const overrun = actualDuration > estimatedDuration * 1.5;
    const failed = step.status === "failed";
    
    return {
      ...step,
      stepNumber: idx + 1,
      jobName: step.jobName || member?.jobName || `Step ${idx + 1}`,
      estimatedDuration,
      actualDuration,
      overrun,
      failed,
      hasDeviation: overrun || failed,
    };
  }).filter((d: any) => d.hasDeviation);

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <CardTitle className="text-lg font-bold">Deviations from Plan</CardTitle>
        </div>
        <CardDescription>
          Steps that deviated from the original execution plan
        </CardDescription>
      </CardHeader>
      <CardContent>
        {deviations.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Mission is following plan.</p>
            <p className="text-xs text-muted-foreground/60">No deviations recorded.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {deviations.map((deviation: any) => (
              <div
                key={deviation.stepNumber}
                className={`p-4 rounded-xl border ${
                  deviation.failed 
                    ? "bg-red-500/5 border-red-500/20" 
                    : "bg-amber-500/5 border-amber-500/20"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    deviation.failed 
                      ? "bg-red-500/20 text-red-500" 
                      : "bg-amber-500/20 text-amber-500"
                  }`}>
                    {deviation.failed ? (
                      <AlertCircle className="w-5 h-5" />
                    ) : (
                      <Clock className="w-5 h-5" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">Step {deviation.stepNumber}: {deviation.jobName}</span>
                      <Badge variant="outline" className={`text-[10px] ${
                        deviation.failed 
                          ? "bg-red-500/10 text-red-500" 
                          : "bg-amber-500/10 text-amber-500"
                      }`}>
                        {deviation.failed ? "Failed" : "Overrun"}
                      </Badge>
                    </div>
                    
                    {deviation.failed && deviation.error && (
                      <p className="text-sm text-red-400 mt-2 font-mono bg-red-500/10 p-2 rounded">
                        {deviation.error}
                      </p>
                    )}
                    
                    {!deviation.failed && (
                      <div className="flex items-center gap-4 mt-2 text-xs">
                        <span className="text-muted-foreground">
                          Estimated: <span className="font-medium">{deviation.estimatedDuration}h</span>
                        </span>
                        <span className="text-amber-500">
                          Actual: <span className="font-medium">{Math.round(deviation.actualDuration * 10) / 10}h</span>
                        </span>
                        <span className="text-red-400">
                          +{Math.round((deviation.actualDuration / deviation.estimatedDuration - 1) * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
