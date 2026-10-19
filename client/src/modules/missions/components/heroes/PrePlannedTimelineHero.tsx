/**
 * Pre-Planned Timeline Hero Component
 * 
 * Displays Gantt-style timeline with plan adherence metrics
 * for pre-planned missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { 
  Calendar, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  TrendingUp,
  TrendingDown,
  MoreHorizontal,
  Flag
} from "lucide-react";

interface PrePlannedTimelineHeroProps {
  mission: any;
  run: any;
}

export default function PrePlannedTimelineHero({ mission, run }: PrePlannedTimelineHeroProps) {
  const members = mission.members || [];
  const completedSteps = run?.steps?.filter((s: any) => s.status === "completed").length || 0;
  const totalSteps = members.length || 1;
  const progressPercent = Math.round((completedSteps / totalSteps) * 100);
  
  const estimatedDuration = mission.estimatedDuration || 1; // hours
  const startedAt = run?.startedAt ? new Date(run.startedAt) : null;
  const now = new Date();
  const elapsedHours = startedAt 
    ? (now.getTime() - startedAt.getTime()) / (1000 * 60 * 60) 
    : 0;
  const timelineVariance = startedAt 
    ? ((elapsedHours - estimatedDuration) / estimatedDuration) * 100 
    : 0;
  
  const milestones = mission.milestones || [
    { name: "Planning", percent: 25 },
    { name: "Execution", percent: 50 },
    { name: "Review", percent: 75 },
    { name: "Completion", percent: 100 },
  ];
  
  // Calculate current milestone
  const currentMilestoneIdx = milestones.findIndex((m: any) => progressPercent < (m.percent || m.targetPercent || 100));
  const currentMilestone = currentMilestoneIdx >= 0 ? milestones[currentMilestoneIdx] : milestones[milestones.length - 1];

  return (
    <Card className="relative overflow-hidden bg-gradient-to-br from-emerald-500/5 via-teal-500/5 to-transparent border-emerald-500/20">
      {/* Background */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(16,185,129,0.1),transparent_50%)]" />
      
      <CardHeader className="relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-emerald-500">
                Pre-Planned Execution
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Static timeline with milestone tracking
              </p>
            </div>
          </div>
          
          {/* Timeline Variance */}
          {startedAt && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Timeline Variance</div>
              <div className={`flex items-center gap-1 text-lg font-black ${
                timelineVariance > 10 ? "text-red-500" : timelineVariance < -10 ? "text-emerald-500" : "text-amber-500"
              }`}>
                {timelineVariance > 0 ? (
                  <TrendingUp className="w-4 h-4" />
                ) : (
                  <TrendingDown className="w-4 h-4" />
                )}
                {timelineVariance > 0 ? "+" : ""}{Math.round(timelineVariance)}%
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="relative z-10 space-y-4">
        {/* Overall Progress */}
        <div className="bg-background/40 backdrop-blur-sm rounded-xl p-4 border border-emerald-500/10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Flag className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-medium">Plan Progress</span>
            </div>
            <Badge variant="outline" className="text-[10px]">
              {completedSteps}/{totalSteps} Steps
            </Badge>
          </div>
          
          <Progress value={progressPercent} className="h-3 bg-muted" />
          
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>{progressPercent}% Complete</span>
            <span>Est. {Math.max(0, Math.round(estimatedDuration - elapsedHours))}h remaining</span>
          </div>
        </div>

        {/* Milestone Track */}
        <div className="bg-background/40 backdrop-blur-sm rounded-xl p-4 border border-emerald-500/10">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Milestones</div>
          
          <div className="relative">
            {/* Connecting line */}
            <div className="absolute top-4 left-0 right-0 h-0.5 bg-muted" />
            
            <div className="flex justify-between relative">
              {milestones.map((milestone: any, idx: number) => {
                const targetPercent = milestone.percent || milestone.targetPercent || ((idx + 1) / milestones.length) * 100;
                const isCompleted = progressPercent >= targetPercent;
                const isCurrent = !isCompleted && (progressPercent >= (targetPercent - 25));
                
                return (
                  <div key={idx} className="flex flex-col items-center gap-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center z-10 transition-all ${
                      isCompleted 
                        ? "bg-emerald-500 text-foreground" 
                        : isCurrent 
                          ? "bg-amber-500 text-foreground ring-4 ring-amber-500/20" 
                          : "bg-muted text-muted-foreground"
                    }`}>
                      {isCompleted ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <span className="text-[10px] font-bold">{idx + 1}</span>
                      )}
                    </div>
                    <span className={`text-[9px] uppercase tracking-wider text-center max-w-[60px] ${
                      isCompleted ? "text-emerald-500" : isCurrent ? "text-amber-500 font-bold" : "text-muted-foreground"
                    }`}>
                      {milestone.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Step Status Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-background/40 backdrop-blur-sm rounded-xl p-4 border border-emerald-500/10">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Completed</span>
            </div>
            <div className="text-2xl font-black text-emerald-500">{completedSteps}</div>
            <p className="text-[10px] text-muted-foreground">Steps finished</p>
          </div>

          <div className="bg-background/40 backdrop-blur-sm rounded-xl p-4 border border-emerald-500/10">
            <div className="flex items-center gap-2 mb-2">
              <MoreHorizontal className="w-4 h-4 text-amber-500" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Remaining</span>
            </div>
            <div className="text-2xl font-black text-amber-500">{totalSteps - completedSteps}</div>
            <p className="text-[10px] text-muted-foreground">Steps pending</p>
          </div>
        </div>

        {/* Time Tracking */}
        {startedAt && (
          <div className="bg-background/40 backdrop-blur-sm rounded-xl p-4 border border-emerald-500/10">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-blue-500" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Time Tracking</span>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-lg font-bold text-blue-500">{Math.round(elapsedHours)}h</div>
                <p className="text-[9px] text-muted-foreground">Elapsed</p>
              </div>
              <div>
                <div className="text-lg font-bold text-emerald-500">{estimatedDuration}h</div>
                <p className="text-[9px] text-muted-foreground">Estimated</p>
              </div>
              <div>
                <div className={`text-lg font-bold ${timelineVariance > 10 ? "text-red-500" : "text-emerald-500"}`}>
                  {timelineVariance > 0 ? "+" : ""}{Math.round(timelineVariance)}%
                </div>
                <p className="text-[9px] text-muted-foreground">Variance</p>
              </div>
            </div>
          </div>
        )}

        {/* Feature Badges */}
        <div className="flex items-center gap-2 pt-2 border-t border-emerald-500/10">
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px]">
            <Calendar className="w-3 h-3 mr-1" /> Pre-Planned
          </Badge>
          <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-[10px]">
            <Flag className="w-3 h-3 mr-1" /> Milestone Tracking
          </Badge>
          <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px]">
            <Clock className="w-3 h-3 mr-1" /> Timeline Variance
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
