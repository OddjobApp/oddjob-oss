
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { 
  ShieldCheck,
  AlertTriangle,
  Search,
  Zap,
  User,
  History,
  MessageSquare,
  Scale,
  CheckCircle2,
  XCircle,
  Clock
} from "lucide-react";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface SupervisorTask {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'rejected' | 'skipped';
  assignedAgent?: string;
  assignedAgentFeedback?: string;
  dependencies: string[];
  output?: any;
}

interface SupervisorPlan {
  tasks: SupervisorTask[];
  history: {
    type: 'thought' | 'critique' | 'action';
    observation: string;
    timestamp: string;
  }[];
}

interface SupervisorStatusPanelProps {
  plan: SupervisorPlan;
  className?: string;
}

export const SupervisorStatusPanel: React.FC<SupervisorStatusPanelProps> = ({ plan, className }) => {
  const completedTasks = plan.tasks.filter(t => t.status === 'completed').length;
  const totalTasks = plan.tasks.length;
  const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
  const rejectedTasks = plan.tasks.filter(t => t.status === 'rejected');

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardDescription className="text-[10px] uppercase tracking-wider">Overall Progress</CardDescription>
            <CardTitle className="text-2xl font-bold flex items-center justify-between">
              {Math.round(progress)}%
              <Zap className="w-4 h-4 text-yellow-500" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={progress} className="h-1.5 bg-muted" />
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardDescription className="text-[10px] uppercase tracking-wider">Active Workers</CardDescription>
            <CardTitle className="text-2xl font-bold flex items-center justify-between">
              {plan.tasks.filter(t => t.status === 'in_progress').length}
              <User className="w-4 h-4 text-blue-500" />
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className={cn("bg-card/50 border-border", rejectedTasks.length > 0 && "border-red-500/30 bg-red-500/5")}>
          <CardHeader className="pb-2">
            <CardDescription className="text-[10px] uppercase tracking-wider">Judge Interventions</CardDescription>
            <CardTitle className={cn("text-2xl font-bold flex items-center justify-between", rejectedTasks.length > 0 && "text-red-400")}>
              {rejectedTasks.length}
              <Scale className="w-4 h-4" />
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardDescription className="text-[10px] uppercase tracking-wider">Security Guard</CardDescription>
            <CardTitle className="text-2xl font-bold flex items-center justify-between text-green-400">
              Active
              <ShieldCheck className="w-4 h-4" />
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Task List */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
            <Search className="w-4 h-4" />
            Mission Task Strategy
          </h3>
          <div className="space-y-3">
            {plan.tasks.map((task) => (
              <div 
                key={task.id} 
                className={cn(
                  "p-4 rounded-xl border transition-all",
                  task.status === 'completed' ? "bg-green-500/5 border-green-500/20" :
                  task.status === 'rejected' ? "bg-red-500/5 border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.1)]" :
                  task.status === 'in_progress' ? "bg-blue-500/5 border-blue-500/30 animate-pulse" :
                  "bg-card/30 border-border"
                )}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "p-2 rounded-lg",
                      task.status === 'completed' ? "bg-green-500/20 text-green-400" :
                      task.status === 'rejected' ? "bg-red-500/20 text-red-400" :
                      task.status === 'in_progress' ? "bg-blue-500/20 text-blue-400" :
                      "bg-muted text-muted-foreground"
                    )}>
                      {task.status === 'completed' ? <CheckCircle2 className="w-4 h-4" /> :
                       task.status === 'rejected' ? <AlertTriangle className="w-4 h-4" /> :
                       task.status === 'in_progress' ? <Zap className="w-4 h-4" /> :
                       <Clock className="w-4 h-4" />}
                    </div>
                    <div>
                      <h4 className="font-semibold text-foreground">{task.name}</h4>
                      <p className="text-xs text-muted-foreground">{task.description}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className={cn(
                    "text-[10px] uppercase",
                    task.status === 'completed' ? "border-green-500/30 text-green-400" :
                    task.status === 'rejected' ? "border-red-500/50 text-red-400" :
                    task.status === 'in_progress' ? "border-blue-500/50 text-blue-400" :
                    "border-border text-muted-foreground"
                  )}>
                    {task.status}
                  </Badge>
                </div>

                {task.assignedAgentFeedback && (
                  <div className="mt-3 p-3 bg-background/50 rounded-lg border border-border flex gap-3 items-start">
                    <Scale className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-[10px] font-bold text-purple-400 uppercase tracking-tighter">AI Judge Verdict</span>
                      <p className="text-xs text-foreground mt-1 italic">"{task.assignedAgentFeedback}"</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Supervisor History */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
            <History className="w-4 h-4" />
            Supervisor Monologue
          </h3>
          <ScrollArea className="h-[500px] rounded-xl border border-border bg-card/30 p-4">
            <div className="space-y-6 relative">
              <div className="absolute left-2.5 top-0 bottom-0 w-px bg-muted" />
              {plan.history.map((entry, i) => (
                <div key={i} className="relative pl-8">
                  <div className={cn(
                    "absolute left-0 w-5 h-5 rounded-full border-4 border-border flex items-center justify-center",
                    entry.type === 'critique' ? "bg-red-500" : "bg-muted"
                  )}>
                    {entry.type === 'critique' ? <AlertTriangle className="w-2.5 h-2.5 text-foreground" /> : <MessageSquare className="w-2.5 h-2.5 text-muted-foreground" />}
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-widest",
                        entry.type === 'critique' ? "text-red-400" : "text-muted-foreground"
                      )}>
                        {entry.type}
                      </span>
                      <span className="text-[9px] text-muted-foreground">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-xs text-foreground leading-relaxed">{entry.observation}</p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
};
