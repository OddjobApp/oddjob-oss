/**
 * Strategy Context Panel
 * 
 * Shows contextual help, recommended tools, and tips based on the selected
 * execution strategy. This helps users understand what to expect from each
 * strategy type during mission creation.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { 
  Lightbulb, 
  Wrench, 
  AlertTriangle,
  CheckCircle2,
  Clock,
  Zap,
  Bot,
  GitBranch,
  Route,
  Workflow,
  Users,
  UserPlus
} from "lucide-react";
import { ExecutionStrategy } from "../config/mission-strategies.config";
import { cn } from "@/lib/utils";

interface StrategyContextPanelProps {
  strategy: ExecutionStrategy;
}

const strategyContext: Record<ExecutionStrategy, {
  title: string;
  icon: React.ElementType;
  tips: string[];
  recommendedTools: string[];
  warnings: string[];
  phase5Features: string[];
  recruitment: {
    mode: string;
    guidance: string[];
    synthesisRequired: boolean;
  };
}> = {
  pre_planned: {
    title: "Pre-Planned Mission",
    icon: Route,
    tips: [
      "Define clear milestones and deadlines for best results",
      "Upload reference documents to guide the execution",
      "Specify deliverable formats and acceptance criteria",
      "Use for compliance, reporting, and repeatable workflows"
    ],
    recommendedTools: [
      "Document templates for standardization",
      "Knowledge assets for context",
      "Scheduled triggers for recurring missions"
    ],
    warnings: [
      "Deviations from plan will be flagged for review",
      "Timeline slippage triggers automatic alerts"
    ],
    phase5Features: [
      "Predictive Planning - AI estimates completion times",
      "Timeline Variance Tracking - Monitor schedule adherence"
    ],
    recruitment: {
      mode: "Fixed Roster",
      guidance: [
        "All team members must be defined before launch",
        "Every agent requires synthesis before mission start",
        "Team composition is locked after launch",
        "Use for predictable, repeatable workflows"
      ],
      synthesisRequired: true
    }
  },
  dynamic_autonomous: {
    title: "Dynamic Autonomous Mission",
    icon: Workflow,
    tips: [
      "Describe the goal clearly but allow flexibility in approach",
      "Set budget limits to control costs",
      "Use for R&D, creative work, and problem-solving",
      "The AI will adapt its approach based on findings"
    ],
    recommendedTools: [
      "Research agents for information gathering",
      "Analysis tools for data processing",
      "Multi-agent coordination for complex tasks"
    ],
    warnings: [
      "Execution path may change based on AI decisions",
      "Review agent adaptations in the Adaptations tab",
      "Requires more oversight for regulated industries"
    ],
    phase5Features: [
      "Self-Healing - Automatic recovery from failures",
      "Multi-Agent Coordination - Parallel agent execution",
      "Predictive Planning - AI-driven path optimization"
    ],
    recruitment: {
      mode: "Fluid Pool",
      guidance: [
        "Start with core team - expand as mission evolves",
        "Agents can be synthesized on-demand during execution",
        "AI can autonomously recruit additional specialists",
        "Perfect for exploratory and research missions"
      ],
      synthesisRequired: false
    }
  },
  rolling_wave: {
    title: "Rolling Wave Mission",
    icon: GitBranch,
    tips: [
      "Break work into phases (waves) with clear boundaries",
      "Define detailed requirements for the current wave only",
      "Use for long-term projects with evolving scope",
      "Forge apps work best with this strategy"
    ],
    recommendedTools: [
      "Forge blueprint templates",
      "App preview for live testing",
      "Build terminal for deployment monitoring"
    ],
    warnings: [
      "Future waves are planned at high-level only",
      "Budget is allocated per wave, not upfront",
      "App deployments happen at wave completion"
    ],
    phase5Features: [
      "Wave-based Budgeting - Cost tracking per phase",
      "Phase Gates - Automatic quality checks",
      "Progressive Elaboration - Details added as waves approach"
    ],
    recruitment: {
      mode: "Wave-Based Assignment",
      guidance: [
        "Assign agents to specific waves/phases",
        "Wave 1 agents must be synthesized before launch",
        "Future wave agents synthesized at phase boundaries",
        "Team evolves as project progresses through waves"
      ],
      synthesisRequired: true
    }
  },
  human_driven: {
    title: "Human-Driven Mission",
    icon: Users,
    tips: [
      "You remain in control of every decision point",
      "AI agents surface options, you make the final call",
      "Best for high-stakes or sensitive work requiring judgment",
      "Combine human expertise with AI speed"
    ],
    recommendedTools: [
      "Approval workflows for decision gates",
      "HIL checkpoint triggers",
      "Copilot for AI-assisted recommendations"
    ],
    warnings: [
      "Mission pauses at each human checkpoint",
      "Response time directly affects mission throughput",
      "Avoid for time-critical automated pipelines"
    ],
    phase5Features: [
      "Decision Audit Trail - Full log of human decisions",
      "Escalation Paths - Auto-escalate unanswered approvals"
    ],
    recruitment: {
      mode: "Human-Led",
      guidance: [
        "Assign agents as advisors, not autonomous actors",
        "All synthesis is optional and advisory",
        "Human operator drives all key decisions",
        "Use minimal agents for lean, focused execution"
      ],
      synthesisRequired: false
    }
  },
  parallel_fan_out: {
    title: "Parallel Fan-Out Mission",
    icon: GitBranch,
    tips: [
      "Ideal for work that can be split across independent threads",
      "Define clear boundaries between parallel tasks",
      "Use aggregation checkpoints to merge results",
      "Best for large-scale data processing and research sweeps"
    ],
    recommendedTools: [
      "Multi-agent task distribution",
      "Result aggregation pipelines",
      "Parallel compute budgeting"
    ],
    warnings: [
      "Parallel agents consume budget simultaneously",
      "Ensure tasks are truly independent to avoid conflicts",
      "Result aggregation requires a final synthesis step"
    ],
    phase5Features: [
      "Fan-Out Orchestration - Automatic task splitting",
      "Aggregate & Synthesize - Merge parallel outputs"
    ],
    recruitment: {
      mode: "Parallel Pool",
      guidance: [
        "Recruit one specialized agent per parallel thread",
        "Each thread agent must be synthesized before launch",
        "Aggregator agent handles result merging",
        "Scale team to match number of parallel tasks"
      ],
      synthesisRequired: true
    }
  },
  reactive: {
    title: "Reactive Mission",
    icon: Zap,
    tips: [
      "Triggered by events, webhooks, or threshold breaches",
      "Define clear trigger conditions and response playbooks",
      "Best for monitoring, alerting, and incident response",
      "Pair with integrations to watch external systems"
    ],
    recommendedTools: [
      "Event stream monitors",
      "Webhook connectors",
      "Threshold-based alert triggers"
    ],
    warnings: [
      "Excessive triggers can exhaust budget rapidly",
      "Set rate limits to prevent trigger storms",
      "Ensure idempotent handling of repeated events"
    ],
    phase5Features: [
      "Event-Driven Activation - Auto-launch on trigger",
      "Adaptive Throttling - Prevent runaway reactions"
    ],
    recruitment: {
      mode: "On-Demand",
      guidance: [
        "Keep team small and fast-activating",
        "Agents are pre-synthesized and standby-ready",
        "Minimize synthesis time for rapid response",
        "Single specialist agent is usually sufficient"
      ],
      synthesisRequired: true
    }
  }
};

export default function StrategyContextPanel({ strategy }: StrategyContextPanelProps) {
  const context = strategyContext[strategy];
  const Icon = context.icon;

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-primary" />
          <CardTitle className="text-base font-bold">{context.title}</CardTitle>
        </div>
        <CardDescription className="text-xs">
          Contextual guidance for this execution strategy
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <ScrollArea className="h-[400px]">
          {/* Tips Section */}
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-1.5">
              <Lightbulb className="w-4 h-4 text-amber-500" />
              <h4 className="text-xs font-bold uppercase tracking-wider">Tips</h4>
            </div>
            <ul className="space-y-1.5">
              {context.tips.map((tip, idx) => (
                <li key={idx} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Recommended Tools */}
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-1.5">
              <Wrench className="w-4 h-4 text-blue-500" />
              <h4 className="text-xs font-bold uppercase tracking-wider">Recommended Tools</h4>
            </div>
            <div className="flex flex-wrap gap-1">
              {context.recommendedTools.map((tool, idx) => (
                <Badge 
                  key={idx} 
                  variant="outline" 
                  className="text-[9px] bg-blue-500/5 text-blue-500 border-blue-500/20"
                >
                  {tool}
                </Badge>
              ))}
            </div>
          </div>

          {/* Phase 5 Features */}
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-purple-500" />
              <h4 className="text-xs font-bold uppercase tracking-wider">AI Capabilities</h4>
            </div>
            <ul className="space-y-1">
              {context.phase5Features.map((feature, idx) => (
                <li key={idx} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Bot className="w-3 h-3 text-purple-500 mt-0.5 shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Recruitment Model */}
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-cyan-500" />
              <h4 className="text-xs font-bold uppercase tracking-wider">Team Recruitment</h4>
              <Badge 
                variant="outline" 
                className={cn(
                  "text-[9px] h-4 ml-1",
                  context.recruitment.synthesisRequired 
                    ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                    : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                )}
              >
                {context.recruitment.mode}
              </Badge>
            </div>
            <ul className="space-y-1">
              {context.recruitment.guidance.map((guidance, idx) => (
                <li key={idx} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <UserPlus className="w-3 h-3 text-cyan-500 mt-0.5 shrink-0" />
                  <span>{guidance}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Warnings */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h4 className="text-xs font-bold uppercase tracking-wider">Important Notes</h4>
            </div>
            <ul className="space-y-1">
              {context.warnings.map((warning, idx) => (
                <li key={idx} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <span className="text-amber-500 mt-0.5">•</span>
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
