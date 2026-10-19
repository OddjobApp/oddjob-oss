/**
 * Strategy Selector
 * 
 * Allows users to choose execution strategy when creating a new mission.
 * Provides visual cards with descriptions for each strategy type.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { 
  Route, 
  Workflow, 
  GitBranch,
  CheckCircle2,
  Sparkles,
  ShieldCheck,
  Clock,
  Bot,
  HandMetal,
  Network,
  Radio
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ExecutionStrategy } from "../config/mission-strategies.config";

interface StrategySelectorProps {
  value: ExecutionStrategy;
  onChange: (strategy: ExecutionStrategy) => void;
  disabled?: boolean;
}

const strategies = [
  {
    id: "pre_planned" as ExecutionStrategy,
    name: "Pre-Planned",
    description: "Structured execution with predefined steps, timeline, and clear deliverables. Best for compliance, reporting, and repeatable workflows.",
    icon: Route,
    features: [
      "Gantt timeline visualization",
      "Step-by-step execution plan",
      "Deviation tracking",
      "Schedule variance alerts"
    ],
    recommendedFor: ["Compliance audits", "Monthly reports", "Data migration"],
    badge: "Structured"
  },
  {
    id: "dynamic_autonomous" as ExecutionStrategy,
    name: "Dynamic Autonomous",
    description: "AI-driven execution that adapts in real-time based on context and outcomes. Best for R&D, creative work, and complex problem solving.",
    icon: Workflow,
    features: [
      "Real-time path optimization",
      "Self-healing capabilities",
      "Predictive planning",
      "Multi-agent coordination"
    ],
    recommendedFor: ["Research", "App development", "Troubleshooting"],
    badge: "AI-Powered"
  },
  {
    id: "rolling_wave" as ExecutionStrategy,
    name: "Rolling Wave",
    description: "Phased approach with detailed planning for near-term work and high-level planning for future phases. Best for long-term projects with evolving requirements.",
    icon: GitBranch,
    features: [
      "Phase-based milestones",
      "Progressive elaboration",
      "Forge app integration",
      "Wave-based budgeting"
    ],
    recommendedFor: ["Product launches", "System rollouts", "Multi-phase projects"],
    badge: "Phased"
  },
  {
    id: "human_driven" as ExecutionStrategy,
    name: "Human-Driven",
    description: "AI proposes actions but every step requires your explicit approval before executing. Maximum oversight with AI assistance.",
    icon: HandMetal,
    features: [
      "Step-by-step approval gates",
      "Full action transparency",
      "AI-assisted reasoning",
      "Rejection-aware replanning"
    ],
    recommendedFor: ["Sensitive operations", "Learning workflows", "Regulatory tasks"],
    badge: "Supervised"
  },
  {
    id: "parallel_fan_out" as ExecutionStrategy,
    name: "Parallel Fan-Out",
    description: "Launch multiple child missions in parallel based on a dependency graph. Results merge when all branches complete.",
    icon: Network,
    features: [
      "DAG-based execution",
      "Parallel child missions",
      "Fan-in result merging",
      "Dependency gating"
    ],
    recommendedFor: ["Multi-team projects", "Data pipelines", "Parallel workstreams"],
    badge: "Parallel"
  },
  {
    id: "reactive" as ExecutionStrategy,
    name: "Reactive",
    description: "Dormant mission that wakes and acts when external events arrive — webhooks, emails, file uploads, or scheduled triggers.",
    icon: Radio,
    features: [
      "Event-driven activation",
      "Webhook & email triggers",
      "Cooldown & debounce",
      "Auto-return to listening"
    ],
    recommendedFor: ["Alert response", "Inbox automation", "Monitoring & triage"],
    badge: "Event-Driven"
  }
];

export default function StrategySelector({ value, onChange, disabled }: StrategySelectorProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-5 h-5 text-amber-500 animate-pulse" />
        <h3 className="text-lg font-black tracking-tight uppercase italic text-foreground">Execution Strategy</h3>
        <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/20 font-bold uppercase tracking-wider px-2 py-0.5">
          Select Mission Core Engine
        </Badge>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {strategies.map((strategy) => {
          const Icon = strategy.icon;
          const isSelected = value === strategy.id;
          
          return (
            <Card
              key={strategy.id}
              onClick={() => !disabled && onChange(strategy.id)}
              className={cn(
                "cursor-pointer transition-all duration-300 relative overflow-hidden bg-card/40 border backdrop-blur-md rounded-2xl group hover:scale-[1.02]",
                isSelected 
                  ? "border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.1)] bg-amber-500/5" 
                  : "border-white/5 hover:border-amber-500/20 hover:bg-card/60 shadow-lg animate-in fade-in duration-300"
              )}
            >
              {/* Selected indicator */}
              {isSelected && (
                <div className="absolute top-3 right-3 animate-in zoom-in-50 duration-200">
                  <CheckCircle2 className="w-5 h-5 text-amber-500 fill-amber-950/50" />
                </div>
              )}
              
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center border transition-all duration-300",
                    isSelected 
                      ? "bg-amber-500/20 border-amber-500/30 text-amber-500 shadow-md shadow-amber-500/10" 
                      : "bg-foreground/5 border-white/5 text-muted-foreground group-hover:text-foreground group-hover:border-white/10"
                  )}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <CardTitle className={cn(
                      "text-sm font-bold tracking-tight transition-colors",
                      isSelected ? "text-amber-500" : "text-foreground"
                    )}>{strategy.name}</CardTitle>
                    <Badge variant="outline" className={cn(
                      "text-[9px] mt-1 font-bold uppercase tracking-wider",
                      isSelected ? "border-amber-500/30 text-amber-500 bg-amber-500/5" : "border-white/10 text-muted-foreground"
                    )}>
                      {strategy.badge}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                <CardDescription className="text-xs leading-relaxed text-muted-foreground">
                  {strategy.description}
                </CardDescription>
                
                {/* Features list */}
                <div className="space-y-1.5">
                  {strategy.features.slice(0, 2).map((feature, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-[10px] text-foreground/60 font-medium">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
                
                {/* Recommended use cases */}
                <div className="pt-3 border-t border-white/5">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">
                    Recommended for:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {strategy.recommendedFor.map((useCase, idx) => (
                      <span 
                        key={idx}
                        className="text-[9px] px-2 py-0.5 bg-foreground/5 border border-white/5 rounded-md text-foreground/70 font-medium"
                      >
                        {useCase}
                      </span>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      
      {/* Strategy tip */}
      <div className="flex items-start gap-3 p-4 bg-card/40 border border-white/5 rounded-2xl backdrop-blur-md shadow-inner">
        <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500">
          <Bot className="w-4 h-4 shrink-0" />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-bold text-foreground uppercase tracking-wider">Strategy Tip:</span> Execution strategies fundamentally shape how child agents collaborate, make decisions, compile telemetry logs, and expose HIL governance gates. Choose the strategy that matches your operational tolerance.
        </p>
      </div>
    </div>
  );
}
