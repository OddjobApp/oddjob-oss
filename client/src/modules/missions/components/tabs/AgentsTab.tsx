/**
 * Agents Tab
 * 
 * Displays multi-agent coordination status from Phase 5.3
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@domain-ui/core/ui/components/ui/avatar";
import { 
  Bot, 
  Users,
  MessageSquare,
  CheckCircle2,
  Clock,
  AlertTriangle,
  BrainCircuit,
  GitMerge,
  Target,
  Activity,
  Network,
  Wallet
} from "lucide-react";

interface AgentsTabProps {
  mission: any;
  run?: any;
  strategy?: string;
}

const roleIcons: Record<string, React.ComponentType<any>> = {
  planner: Target,
  executor: Activity,
  reviewer: CheckCircle2,
  specialist: BrainCircuit,
  coordinator: Users,
};

const roleColors: Record<string, string> = {
  planner: "blue",
  executor: "amber",
  reviewer: "emerald",
  specialist: "purple",
  coordinator: "orange",
};

export default function AgentsTab({ mission, run }: AgentsTabProps) {
  // Extract sub-missions from blackboard (missionContext)
  const subMissions = (run?.missionContext as any)?.active_sub_missions || [];
  
  // Extract agent members from mission
  const members = mission?.members || [];
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case "working":
      case "active":
      case "running": return "emerald";
      case "idle":
      case "paused": return "blue";
      case "offline":
      case "failed": return "red";
      case "completed": return "emerald";
      default: return "gray";
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-Missions Section (Hierarchical Delegation) */}
      {subMissions.length > 0 && (
        <Card className="bg-background/40 backdrop-blur-md border-border overflow-hidden relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 via-fuchsia-500 to-purple-500 opacity-50" />
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Network className="w-5 h-5 text-purple-500" />
                <CardTitle className="text-lg font-bold">Hierarchical Delegation</CardTitle>
              </div>
              <Badge variant="outline" className="bg-purple-500/10 text-purple-500 border-purple-500/20">
                {subMissions.length} Active Sub-Missions
              </Badge>
            </div>
            <CardDescription>
              Child missions spawned by the orchestrator for specialized sub-tasks
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {subMissions.map((sub: any, idx: number) => (
                <div 
                  key={idx}
                  className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/20 hover:bg-purple-500/10 transition-colors group cursor-pointer"
                  onClick={() => window.location.href = `/operations/missions/${sub.missionId}/runs/${sub.runId}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                        <Bot className="w-5 h-5 text-purple-500" />
                      </div>
                      <div>
                        <p className="font-bold text-sm text-foreground group-hover:text-purple-400 transition-colors">
                          Run #{sub.runId}
                        </p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                          Mission ID: {sub.missionId}
                        </p>
                      </div>
                    </div>
                    <Badge className={`bg-${getStatusColor(sub.status)}-500/10 text-${getStatusColor(sub.status)}-500 border-${getStatusColor(sub.status)}-500/20`}>
                      {sub.status}
                    </Badge>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="text-xs text-foreground/80 line-clamp-2 italic bg-background/40 p-2 rounded border border-border/50">
                      "{sub.goal}"
                    </div>
                    
                    <div className="flex items-center justify-between text-[10px]">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Wallet className="w-3 h-3" />
                        <span>Budget Cap: <span className="text-foreground font-medium">${sub.budget || 0}</span></span>
                      </div>
                      <div className="flex items-center gap-1 text-purple-400 font-bold uppercase tracking-tighter">
                        View Details →
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Primary Agents Section */}
      <Card className="bg-background/40 backdrop-blur-md border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500" />
            <CardTitle className="text-lg font-bold">Assigned Resources</CardTitle>
          </div>
          <CardDescription>
            Agents and pipelines participating in this mission lifecycle
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {members.length > 0 ? members.map((member: any) => {
              const role = member.role || "executor";
              const RoleIcon = roleIcons[role] || Bot;
              const color = roleColors[role] || "blue";
              
              return (
                <div 
                  key={member.id}
                  className={`p-3 rounded-xl bg-${color}-500/5 border border-${color}-500/20 relative overflow-hidden`}
                >
                  <div className={`absolute top-2 right-2 w-2 h-2 rounded-full bg-${getStatusColor(member.status)}-500 ${member.status === "working" || member.status === "active" ? "animate-pulse" : ""}`} />
                  <div className={`w-10 h-10 rounded-xl bg-${color}-500/20 flex items-center justify-center mb-2`}>
                    <RoleIcon className={`w-5 h-5 text-${color}-500`} />
                  </div>
                  <p className="font-bold text-sm truncate">{member.name}</p>
                  <p className={`text-[10px] uppercase tracking-wider text-${color}-500`}>{role}</p>
                  <p className="text-[9px] text-muted-foreground/60 mt-1 capitalize">{member.status}</p>
                </div>
              );
            }) : (
              // Fallback for demo/empty state
              ["Planner", "Executor", "Quality Guard"].map((name, i) => (
                <div key={i} className="p-3 rounded-xl bg-slate-500/5 border border-slate-500/10 grayscale opacity-40">
                  <div className="w-10 h-10 rounded-xl bg-slate-500/10 flex items-center justify-center mb-2">
                    <Bot className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <p className="font-bold text-sm truncate">{name}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Autonomous Unit</p>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Message Stream */}
      <Card className="bg-background/40 backdrop-blur-md border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-purple-500" />
            <CardTitle className="text-lg font-bold">Coordination Feed</CardTitle>
          </div>
          <CardDescription>Real-time agent-to-agent signaling</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[200px]">
            <div className="p-4 space-y-3">
              {(run?.missionContext as any)?.coordination_logs?.map((msg: any, idx: number) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                    <span className="font-medium text-foreground">{msg.from}</span>
                    <span>→</span>
                    <span className="font-medium text-foreground">{msg.to}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 mb-1 bg-primary/5">
                      {msg.type}
                    </Badge>
                    <p className="text-sm text-foreground/90">{msg.content}</p>
                    <p className="text-[9px] text-muted-foreground">
                      {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ""}
                    </p>
                  </div>
                </div>
              )) || (
                <div className="flex items-center justify-center h-full py-12 text-muted-foreground/50 italic text-sm">
                   No coordination messages captured in this cycle.
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
