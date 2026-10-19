/**
 * Dynamic Flow Hero Component
 * 
 * Displays real-time execution flow graph with health indicators
 * for dynamic autonomous missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { 
  Activity, 
  Zap, 
  ShieldCheck, 
  AlertTriangle,
  GitBranch,
  BrainCircuit,
  Bot
} from "lucide-react";

interface DynamicFlowHeroProps {
  mission: any;
  run: any;
}

export default function DynamicFlowHero({ mission, run }: DynamicFlowHeroProps) {
  const dynamicTrace = run?.dynamicTrace || [];
  const adaptations = dynamicTrace.filter((t: any) => 
    t.type === "adaptation" || t.event === "path_change"
  );
  const selfHealingEvents = run?.selfHealingEvents || [];
  const activeAgents = (mission as any)?.agentCount || 1;
  
  // Calculate health score
  const healthScore = selfHealingEvents.length 
    ? Math.round((selfHealingEvents.filter((e: any) => e.status === "resolved").length / selfHealingEvents.length) * 100)
    : 100;

  const getHealthColor = (score: number) => {
    if (score >= 80) return "bg-success-500";
    if (score >= 60) return "bg-warning-500";
    return "bg-danger-500";
  };

  return (
    <Card className="relative overflow-hidden bg-gradient-to-br from-recovery-500/5 via-recovery-600/5 to-transparent border-recovery-500/20">
      {/* Animated background effect */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(139,92,246,0.1),transparent_50%)] animate-pulse" />
      
      <CardHeader className="relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-recovery-500/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-recovery-500" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-recovery-500">
                Dynamic Execution Flow
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Adaptive AI-driven execution with self-healing
              </p>
            </div>
          </div>
          
          {/* Health Score Gauge */}
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Health Score</div>
              <div className={`text-2xl font-black ${healthScore >= 80 ? "text-emerald-500" : healthScore >= 60 ? "text-amber-500" : "text-red-500"}`}>
                {healthScore}%
              </div>
            </div>
            <div className={`w-16 h-16 rounded-full border-4 border-background ${getHealthColor(healthScore)} flex items-center justify-center relative`}>
              <Activity className="w-6 h-6 text-foreground" />
              {healthScore < 80 && (
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-3 h-3 text-foreground" />
                </div>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="relative z-10 space-y-4">
        {/* Flow Visualization */}
        <div className="grid grid-cols-4 gap-4">
          {/* Metric Cards */}
          <div className="bg-background/40 backdrop-blur-sm rounded-xl p-4 border border-purple-500/10">
            <div className="flex items-center gap-2 mb-2">
              <GitBranch className="w-4 h-4 text-purple-500" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Adaptations</span>
            </div>
            <div className="text-2xl font-black text-purple-500">{adaptations.length}</div>
            <p className="text-[10px] text-muted-foreground">Path changes detected</p>
          </div>

          <div className="bg-background/40 backdrop-blur-sm rounded-xl p-4 border border-purple-500/10">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Healing Events</span>
            </div>
            <div className="text-2xl font-black text-emerald-500">{selfHealingEvents.length}</div>
            <p className="text-[10px] text-muted-foreground">Auto-recoveries</p>
          </div>

          <div className="bg-background/40 backdrop-blur-sm rounded-xl p-4 border border-purple-500/10">
            <div className="flex items-center gap-2 mb-2">
              <BrainCircuit className="w-4 h-4 text-violet-500" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">AI Decisions</span>
            </div>
            <div className="text-2xl font-black text-violet-500">
              {dynamicTrace.filter((t: any) => t.decisionConfidence).length}
            </div>
            <p className="text-[10px] text-muted-foreground">Autonomous choices</p>
          </div>

          <div className="bg-background/40 backdrop-blur-sm rounded-xl p-4 border border-purple-500/10">
            <div className="flex items-center gap-2 mb-2">
              <Bot className="w-4 h-4 text-blue-500" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Active Agents</span>
            </div>
            <div className="text-2xl font-black text-blue-500">{activeAgents}</div>
            <p className="text-[10px] text-muted-foreground">Coordinating</p>
          </div>
        </div>

        {/* Recent Activity Stream */}
        <div className="bg-background/30 rounded-lg p-3 border border-purple-500/10">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-3 h-3 text-purple-500 animate-pulse" />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Recent Activity</span>
          </div>
          <div className="space-y-1 max-h-20 overflow-y-auto">
            {dynamicTrace.slice(-3).reverse().map((trace: any, idx: number) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                  {trace.event || trace.type}
                </Badge>
                <span className="text-muted-foreground truncate">
                  {trace.note || trace.intent || trace.error || "Activity recorded"}
                </span>
                <span className="text-[9px] text-muted-foreground ml-auto">
                  {new Date(trace.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
            {!dynamicTrace.length && (
              <p className="text-xs text-muted-foreground italic">No activity recorded yet</p>
            )}
          </div>
        </div>

        {/* Phase 5 Feature Indicators */}
        <div className="flex items-center gap-2 pt-2 border-t border-purple-500/10">
          <Badge variant="outline" className="bg-purple-500/10 text-purple-500 border-purple-500/20 text-[10px]">
            <Zap className="w-3 h-3 mr-1" /> Dynamic Orchestration
          </Badge>
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px]">
            <ShieldCheck className="w-3 h-3 mr-1" /> Self-Healing Active
          </Badge>
          {(mission as any)?.enableMultiAgent !== false && (
            <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-[10px]">
              <Bot className="w-3 h-3 mr-1" /> Multi-Agent
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
