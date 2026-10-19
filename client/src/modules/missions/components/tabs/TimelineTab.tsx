/**
 * Timeline Tab
 * 
 * Timeline visualization for pre-planned missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Clock, Calendar, TrendingUp, TrendingDown } from "lucide-react";

interface TimelineTabProps {
  mission: any;
  run?: any;
  strategy?: string;
}

export default function TimelineTab({ mission, run }: TimelineTabProps) {
  const estimatedDuration = mission.estimatedDuration || 1;
  const startedAt = run?.startedAt ? new Date(run.startedAt) : null;
  const completedAt = run?.completedAt ? new Date(run.completedAt) : null;
  const now = new Date();
  
  const elapsedHours = startedAt 
    ? (completedAt?.getTime() || now.getTime()) - startedAt.getTime() / (1000 * 60 * 60)
    : 0;
  
  const remainingHours = Math.max(0, estimatedDuration - elapsedHours);
  const variance = startedAt ? ((elapsedHours - estimatedDuration) / estimatedDuration) * 100 : 0;

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-500" />
          <CardTitle className="text-lg font-bold">Timeline</CardTitle>
        </div>
        <CardDescription>
          Mission timeline and schedule variance
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Time Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 rounded-lg bg-background/50 border border-border/50">
            <div className="text-2xl font-black text-blue-500">
              {startedAt ? new Date(startedAt).toLocaleDateString() : "--"}
            </div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Started</p>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border/50">
            <div className="text-2xl font-black text-emerald-500">
              {completedAt ? new Date(completedAt).toLocaleDateString() : "--"}
            </div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Completed</p>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border/50">
            <div className="text-2xl font-black text-amber-500">{Math.round(elapsedHours)}h</div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Elapsed</p>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border/50">
            <div className="text-2xl font-black text-purple-500">{Math.round(remainingHours)}h</div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Remaining</p>
          </div>
        </div>

        {/* Variance Analysis */}
        {startedAt && (
          <div className={`p-4 rounded-xl border ${
            Math.abs(variance) > 20 
              ? "bg-red-500/5 border-red-500/20" 
              : Math.abs(variance) > 10 
                ? "bg-amber-500/5 border-amber-500/20"
                : "bg-emerald-500/5 border-emerald-500/20"
          }`}>
            <div className="flex items-center gap-2 mb-2">
              {variance > 0 ? (
                <TrendingUp className="w-5 h-5 text-red-500" />
              ) : (
                <TrendingDown className="w-5 h-5 text-emerald-500" />
              )}
              <span className="font-bold">Timeline Variance</span>
              <Badge variant="outline" className={`text-[10px] ${
                Math.abs(variance) > 20 
                  ? "bg-red-500/10 text-red-500" 
                  : Math.abs(variance) > 10 
                    ? "bg-amber-500/10 text-amber-500"
                    : "bg-emerald-500/10 text-emerald-500"
              }`}>
                {variance > 0 ? "+" : ""}{Math.round(variance)}%
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {variance > 20 
                ? "Significant delay detected. Consider scope adjustment."
                : variance > 10 
                  ? "Minor variance within acceptable range."
                  : variance < -10
                    ? "Ahead of schedule. On track for early completion."
                    : "On schedule."
              }
            </p>
          </div>
        )}

        {/* Timeline Visualization Placeholder */}
        <div className="h-[200px] bg-muted/50 rounded-lg flex items-center justify-center">
          <div className="text-center">
            <Calendar className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Timeline visualization</p>
            <p className="text-xs text-muted-foreground/60">Gantt chart would render here</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
