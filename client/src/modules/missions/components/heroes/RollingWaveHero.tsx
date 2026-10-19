/**
 * Rolling Wave Hero Component
 * 
 * Displays phase-based progress with Forge app preview for rolling wave missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { 
  Activity, 
  CheckCircle2, 
  Globe,
  Terminal,
  Clock,
  GitMerge,
  BrainCircuit,
  Rocket
} from "lucide-react";

interface RollingWaveHeroProps {
  mission: any;
  run: any;
}

const phases = [
  { id: "PLANNING", label: "Strategy", icon: BrainCircuit, color: "blue" },
  { id: "EXECUTING", label: "Execution", icon: Rocket, color: "amber" },
  { id: "CRITIQUING", label: "Verification", icon: Activity, color: "purple" },
  { id: "WAITING_FOR_ORDERS", label: "Awaiting Input", icon: Clock, color: "orange" },
];

export default function RollingWaveHero({ mission, run }: RollingWaveHeroProps) {
  const currentPhase = (run as any)?.missionContext?.phase || "PLANNING";
  const currentPhaseIdx = Math.max(0, phases.findIndex(p => p.id === currentPhase));
  const phaseProgress = ((currentPhaseIdx + 1) / phases.length) * 100;
  
  const deliverables = mission.deliverables || [];
  const completedDeliverables = deliverables.filter((d: any) => d.status === "completed").length;
  const deliverableProgress = deliverables.length 
    ? (completedDeliverables / deliverables.length) * 100 
    : 0;
  
  const iterations = run?.iterations?.length || 1;
  const previewSlug = (mission.blackboard as any)?.viaAppSlug || 
    (mission.blackboard as any)?.forge_app_slug || 
    (mission.blackboard as any)?.appSlug;

  const isForge = mission.type?.includes("Forge") || (mission.blackboard as any)?.isForge || !!previewSlug;

  return (
    <Card className="relative overflow-hidden bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-transparent border-amber-500/20">
      {/* Background glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(251,146,60,0.1),transparent_50%)]" />
      
      <CardHeader className="relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <Activity className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-amber-500">
                Rolling Wave Orchestrator
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Phase-based iterative mission execution
              </p>
            </div>
          </div>
          
          {previewSlug && (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
              <Globe className="w-3 h-3 mr-1" /> App Deployed
            </Badge>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="relative z-10 space-y-4">
        {/* Phase Progress Bar */}
        <div className="bg-background/40 backdrop-blur-sm rounded-xl p-4 border border-amber-500/10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Phase Progress</span>
            <Badge variant="outline" className="text-[10px]">
              {phases[currentPhaseIdx]?.label || "Strategy"}
            </Badge>
          </div>
          
          {/* Phase Indicators */}
          <div className="flex items-center justify-between mb-2">
            {phases.map((phase, idx) => {
              const Icon = phase.icon;
              const isActive = idx === currentPhaseIdx;
              const isPast = idx < currentPhaseIdx;
              
              return (
                <div key={phase.id} className="flex flex-col items-center gap-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                    isActive 
                      ? `bg-${phase.color}-500 text-foreground shadow-lg shadow-${phase.color}-500/30` 
                      : isPast 
                        ? "bg-emerald-500/20 text-emerald-500" 
                        : "bg-muted text-muted-foreground"
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className={`text-[9px] uppercase tracking-wider ${isActive ? `text-${phase.color}-500 font-bold` : "text-muted-foreground"}`}>
                    {phase.label}
                  </span>
                </div>
              );
            })}
          </div>
          
          <Progress value={phaseProgress} className="h-2 bg-muted" />
          <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
            <span>Phase {currentPhaseIdx + 1} of {phases.length}</span>
            <span>{Math.round(phaseProgress)}% complete</span>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-background/40 backdrop-blur-sm rounded-xl p-4 border border-amber-500/10">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Deliverables</span>
            </div>
            <div className="text-2xl font-black text-emerald-500">{completedDeliverables}/{deliverables.length || 1}</div>
            <Progress value={deliverableProgress} className="h-1.5 mt-2 bg-muted" />
          </div>

          <div className="bg-background/40 backdrop-blur-sm rounded-xl p-4 border border-amber-500/10">
            <div className="flex items-center gap-2 mb-2">
              <GitMerge className="w-4 h-4 text-orange-500" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Iterations</span>
            </div>
            <div className="text-2xl font-black text-orange-500">#{iterations}</div>
            <p className="text-[10px] text-muted-foreground">Execution cycles completed</p>
          </div>

          <div className="bg-background/40 backdrop-blur-sm rounded-xl p-4 border border-amber-500/10">
            <div className="flex items-center gap-2 mb-2">
              <Terminal className="w-4 h-4 text-blue-500" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{isForge ? "Build Status" : "Run Status"}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${run?.status === "running" || run?.status === "active" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
              <span className="text-sm font-bold capitalize">{run?.status || "pending"}</span>
            </div>
          </div>
        </div>

        {/* App Preview Thumbnail */}
        {previewSlug && (
          <div className="bg-background/40 backdrop-blur-sm rounded-xl p-3 border border-emerald-500/20">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-medium">Live App Preview</span>
              </div>
              <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-500">
                {previewSlug}
              </Badge>
            </div>
            <div className="aspect-video bg-muted rounded-lg flex items-center justify-center border border-border/50">
              <div className="text-center">
                <Globe className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">App preview available</p>
              </div>
            </div>
          </div>
        )}

        {/* Feature Badges */}
        <div className="flex items-center gap-2 pt-2 border-t border-amber-500/10">
          <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px]">
            <Activity className="w-3 h-3 mr-1" /> Rolling Wave Strategy
          </Badge>
          {previewSlug && (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px]">
              <Globe className="w-3 h-3 mr-1" /> Live Preview
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>

  );
}
