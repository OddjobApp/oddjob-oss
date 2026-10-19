/**
 * Mission Strategy Configuration System
 * 
 * Defines UI components, metrics, tabs, and features for each execution strategy.
 * This enables the Mission Detail and Run Report screens to adapt dynamically
 * based on the mission's execution type.
 */

import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import { lazy } from "react";
import {
  Activity,
  BrainCircuit,
  Calendar,
  Zap,
  GitBranch,
  ShieldCheck,
  Clock,
  Bot,
  Users,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Globe,
  Terminal,
  ScrollText,
  MessageSquare,
  GitMerge,
  Sparkles,
  Wand2,
  Flag,
  HandMetal,
  Network,
  Radio,
  Eye,
  ListChecks,
  Inbox,
  Wallet,
} from "lucide-react";

// ============================================================================
// TYPES
// ============================================================================

export type ExecutionStrategy = "pre_planned" | "dynamic_autonomous" | "rolling_wave" | "human_driven" | "parallel_fan_out" | "reactive";
export type MissionType = "supervisor_led" | "governed" | "manual" | "mission_based" | "rescue";

export interface MetricConfig {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
  getValue: (mission: any, runs: any[]) => string | number;
  format?: (value: any) => string;
}

export interface TabConfig {
  id: string;
  label: string;
  icon: LucideIcon;
  component: ComponentType<any>;
  showForStrategies: ExecutionStrategy[];
  priority: number; // Lower = appears first
}

export interface WidgetConfig {
  id: string;
  label: string;
  component: ComponentType<any>;
  position: "sidebar" | "hero" | "header";
  showForStrategies: ExecutionStrategy[];
}

export interface StrategyConfig {
  // Identity
  id: ExecutionStrategy;
  name: string;
  description: string;
  icon: LucideIcon;
  colorScheme: {
    primary: string;
    secondary: string;
    accent: string;
    bgGradient: string;
  };

  // Hero Component (top of page)
  heroComponent: ComponentType<any>;

  // Metrics (shown below hero)
  primaryMetrics: MetricConfig[];

  // Tabs
  tabs: TabConfig[];

  // Sidebar widgets
  sidebarWidgets: WidgetConfig[];

  // Phase 5 Features
  features: {
    predictivePlanning: boolean;
    selfHealing: boolean;
    multiAgentCoordination: boolean;
  };

  // Layout preferences
  layout: {
    showChat: boolean;
    showPreview: boolean;
    resizablePanels: boolean;
    fullWidth: boolean;
  };
}

// ============================================================================
// METRIC CALCULATORS
// ============================================================================

const calculatePlanAdherence = (mission: any, runs: any[]): number => {
  if (!runs.length) return 0;
  const completedSteps = runs[0]?.steps?.filter((s: any) => s.status === "completed").length || 0;
  const totalSteps = mission.members?.length || 1;
  return Math.round((completedSteps / totalSteps) * 100);
};

const calculateAdaptationCount = (mission: any, runs: any[]): number => {
  if (!runs.length || !runs[0]?.dynamicTrace) return 0;
  return runs[0].dynamicTrace.filter((t: any) => t.type === "adaptation" || t.event === "path_change").length;
};

const calculateSelfHealingRate = (mission: any, runs: any[]): number => {
  if (!runs.length || !runs[0]?.selfHealingEvents) return 0;
  const events = runs[0].selfHealingEvents;
  const successful = events.filter((e: any) => e.status === "resolved").length;
  return events.length ? Math.round((successful / events.length) * 100) : 0;
};

const calculatePhaseProgress = (mission: any, runs: any[]): number => {
  const phase = (runs[0] as any)?.missionContext?.phase || "PLANNING";
  const phases = ["PLANNING", "EXECUTING", "CRITIQUING", "WAITING_FOR_ORDERS"];
  const idx = phases.indexOf(phase);
  return idx >= 0 ? Math.round(((idx + 1) / phases.length) * 100) : 0;
};

const calculateAgentCount = (mission: any, runs: any[]): number => {
  return (mission as any)?.agentCount || 1;
};

const calculateDeliverableProgress = (mission: any, runs: any[]): number => {
  const deliverables = mission.deliverables || [];
  if (!deliverables.length) return 0;
  const completed = deliverables.filter((d: any) => d.status === "completed").length;
  return Math.round((completed / deliverables.length) * 100);
};

// ============================================================================
// STRATEGY CONFIGURATIONS
// ============================================================================

export const strategyConfigs: Record<ExecutionStrategy, StrategyConfig> = {
  pre_planned: {
    id: "pre_planned",
    name: "Pre-Planned",
    description: "Static execution with predefined steps and milestones",
    icon: Calendar,
    colorScheme: {
      primary: "emerald",
      secondary: "teal",
      accent: "green",
      bgGradient: "from-emerald-500/10 via-teal-500/5 to-transparent",
    },
    heroComponent: lazy(() => import("../components/heroes/PrePlannedTimelineHero")),
    primaryMetrics: [
      {
        id: "plan_adherence",
        label: "Plan Adherence",
        icon: CheckCircle2,
        color: "emerald",
        getValue: calculatePlanAdherence,
        format: (v) => `${v}%`,
      },
      {
        id: "milestone_progress",
        label: "Milestones",
        icon: Flag,
        color: "teal",
        getValue: (m, r) => {
          const completed = r[0]?.milestones?.filter((x: any) => x.completed).length || 0;
          const total = m.milestones?.length || 1;
          return `${completed}/${total}`;
        },
      },
      {
        id: "timeline_variance",
        label: "Timeline Variance",
        icon: Clock,
        color: "blue",
        getValue: (m, r) => {
          if (!r[0]?.startedAt || !m.estimatedDuration) return "N/A";
          const elapsed = Date.now() - new Date(r[0].startedAt).getTime();
          const estimated = m.estimatedDuration * 60 * 60 * 1000; // hours to ms
          const variance = ((elapsed - estimated) / estimated) * 100;
          return `${variance > 0 ? "+" : ""}${Math.round(variance)}%`;
        },
      },
      {
        id: "budget_vs_plan",
        label: "Budget vs Plan",
        icon: TrendingUp,
        color: "amber",
        getValue: (m, r) => {
          const spent = parseFloat(m.currentSpendUsd || "0");
          const planned = parseFloat(m.budgetLimitUsd || "1");
          return `${Math.round((spent / planned) * 100)}%`;
        },
      },
    ],
    tabs: [
      {
        id: "plan",
        label: "Execution Plan",
        icon: ScrollText,
        component: lazy(() => import("../components/tabs/ExecutionPlanTab")),
        showForStrategies: ["pre_planned"],
        priority: 1,
      },
      {
        id: "timeline",
        label: "Timeline",
        icon: Calendar,
        component: lazy(() => import("../components/tabs/TimelineTab")),
        showForStrategies: ["pre_planned"],
        priority: 2,
      },
      {
        id: "deviations",
        label: "Deviations",
        icon: GitBranch,
        component: lazy(() => import("../components/tabs/DeviationsTab")),
        showForStrategies: ["pre_planned"],
        priority: 3,
      },
      {
        id: "activity",
        label: "Activity",
        icon: Activity,
        component: lazy(() => import("../components/tabs/ActivityTab")),
        showForStrategies: ["pre_planned", "dynamic_autonomous", "rolling_wave"],
        priority: 10,
      },
      {
        id: "budget",
        label: "Economics",
        icon: Wallet,
        component: lazy(() => import("../components/tabs/EconomicControlTab")),
        showForStrategies: ["pre_planned", "dynamic_autonomous", "rolling_wave", "parallel_fan_out", "human_driven"],
        priority: 11,
      },
      {
        id: "deliverables",
        label: "Deliverables",
        icon: CheckCircle2,
        component: lazy(() => import("../components/tabs/DeliverablesTab")),
        showForStrategies: ["pre_planned"],
        priority: 12,
      },
    ],
    sidebarWidgets: [
      {
        id: "upcoming_steps",
        label: "Upcoming Steps",
        component: lazy(() => import("../components/widgets/UpcomingStepsWidget")),
        position: "sidebar",
        showForStrategies: ["pre_planned"],
      },
      {
        id: "critical_path",
        label: "Critical Path",
        component: lazy(() => import("../components/widgets/CriticalPathWidget")),
        position: "sidebar",
        showForStrategies: ["pre_planned"],
      },
    ],
    features: {
      predictivePlanning: false,
      selfHealing: false,
      multiAgentCoordination: false,
    },
    layout: {
      showChat: false,
      showPreview: false,
      resizablePanels: false,
      fullWidth: false,
    },
  },

  dynamic_autonomous: {
    id: "dynamic_autonomous",
    name: "Dynamic Autonomous",
    description: "Adaptive execution with AI-driven decisions and self-healing",
    icon: Zap,
    colorScheme: {
      primary: "purple",
      secondary: "violet",
      accent: "fuchsia",
      bgGradient: "from-purple-500/10 via-violet-500/5 to-transparent",
    },
    heroComponent: lazy(() => import("../components/heroes/DynamicFlowHero")),
    primaryMetrics: [
      {
        id: "adaptations",
        label: "Adaptations",
        icon: GitBranch,
        color: "purple",
        getValue: calculateAdaptationCount,
      },
      {
        id: "health_score",
        label: "Health Score",
        icon: ShieldCheck,
        color: "emerald",
        getValue: calculateSelfHealingRate,
        format: (v) => `${v}%`,
      },
      {
        id: "ai_confidence",
        label: "AI Confidence",
        icon: BrainCircuit,
        color: "violet",
        getValue: (m, r) => {
          const traces = r[0]?.dynamicTrace || [];
          const decisions = traces.filter((t: any) => t.decisionConfidence);
          if (!decisions.length) return "N/A";
          const avg = decisions.reduce((sum: number, d: any) => sum + (d.decisionConfidence || 0), 0) / decisions.length;
          return `${Math.round(avg * 100)}%`;
        },
      },
      {
        id: "active_agents",
        label: "Active Agents",
        icon: Users,
        color: "blue",
        getValue: calculateAgentCount,
      },
    ],
    tabs: [
      {
        id: "flow",
        label: "Execution Flow",
        icon: GitMerge,
        component: lazy(() => import("../components/tabs/ExecutionFlowTab")),
        showForStrategies: ["dynamic_autonomous"],
        priority: 1,
      },
      {
        id: "adaptations",
        label: "Adaptations",
        icon: Zap,
        component: lazy(() => import("../components/tabs/AdaptationsTab")),
        showForStrategies: ["dynamic_autonomous"],
        priority: 2,
      },
      {
        id: "healing",
        label: "Self-Healing",
        icon: Wand2,
        component: lazy(() => import("../components/tabs/SelfHealingTab")),
        showForStrategies: ["dynamic_autonomous"],
        priority: 3,
      },
      {
        id: "agents",
        label: "Agents",
        icon: Bot,
        component: lazy(() => import("../components/tabs/AgentsTab")),
        showForStrategies: ["dynamic_autonomous"],
        priority: 4,
      },
      {
        id: "ai_decisions",
        label: "AI Decisions",
        icon: Sparkles,
        component: lazy(() => import("../components/tabs/AIDecisionsTab")),
        showForStrategies: ["dynamic_autonomous"],
        priority: 5,
      },
      {
        id: "thoughts",
        label: "Thoughts",
        icon: BrainCircuit,
        component: lazy(() => import("../components/tabs/ThoughtsTab")),
        showForStrategies: ["dynamic_autonomous", "rolling_wave"],
        priority: 6,
      },
      {
        id: "predictive",
        label: "Predictions",
        icon: TrendingUp,
        component: lazy(() => import("../components/tabs/PredictiveTab")),
        showForStrategies: ["dynamic_autonomous"],
        priority: 7,
      },
      {
        id: "activity",
        label: "Activity",
        icon: Activity,
        component: lazy(() => import("../components/tabs/ActivityTab")),
        showForStrategies: ["pre_planned", "dynamic_autonomous", "rolling_wave"],
        priority: 10,
      },
      {
        id: "budget",
        label: "Economics",
        icon: Wallet,
        component: lazy(() => import("../components/tabs/EconomicControlTab")),
        showForStrategies: ["pre_planned", "dynamic_autonomous", "rolling_wave", "parallel_fan_out", "human_driven"],
        priority: 11,
      },
      {
        id: "deliverables",
        label: "Deliverables",
        icon: CheckCircle2,
        component: lazy(() => import("../components/tabs/DeliverablesTab")),
        showForStrategies: ["dynamic_autonomous"],
        priority: 12,
      },
    ],
    sidebarWidgets: [
      {
        id: "health_dashboard",
        label: "Health",
        component: lazy(() => import("../components/widgets/HealthDashboardWidget")),
        position: "sidebar",
        showForStrategies: ["dynamic_autonomous"],
      },
      {
        id: "recent_adaptations",
        label: "Recent Changes",
        component: lazy(() => import("../components/widgets/RecentAdaptationsWidget")),
        position: "sidebar",
        showForStrategies: ["dynamic_autonomous"],
      },
      {
        id: "failure_patterns",
        label: "Monitored Patterns",
        component: lazy(() => import("../components/widgets/FailurePatternsWidget")),
        position: "sidebar",
        showForStrategies: ["dynamic_autonomous"],
      },
    ],
    features: {
      predictivePlanning: true,
      selfHealing: true,
      multiAgentCoordination: true,
    },
    layout: {
      showChat: true,
      showPreview: false,
      resizablePanels: true,
      fullWidth: true,
    },
  },

  rolling_wave: {
    id: "rolling_wave",
    name: "Rolling Wave",
    description: "Phase-based Forge app building with iterative deliverables",
    icon: Activity,
    colorScheme: {
      primary: "amber",
      secondary: "orange",
      accent: "yellow",
      bgGradient: "from-amber-500/10 via-orange-500/5 to-transparent",
    },
    heroComponent: lazy(() => import("../components/heroes/RollingWaveHero")),
    primaryMetrics: [
      {
        id: "phase_progress",
        label: "Phase Progress",
        icon: Activity,
        color: "amber",
        getValue: calculatePhaseProgress,
        format: (v) => `${v}%`,
      },
      {
        id: "deliverables",
        label: "Deliverables",
        icon: CheckCircle2,
        color: "emerald",
        getValue: calculateDeliverableProgress,
        format: (v) => `${v}%`,
      },
      {
        id: "iterations",
        label: "Iterations",
        icon: GitMerge,
        color: "orange",
        getValue: (m, r) => r[0]?.iterations?.length || 1,
      },
      {
        id: "app_health",
        label: "App Health",
        icon: Globe,
        color: "blue",
        getValue: (m, r) => {
          const health = r[0]?.appHealth || {};
          const checks = Object.values(health);
          if (!checks.length) return "N/A";
          const passed = checks.filter((c: any) => c.status === "pass").length;
          return `${Math.round((passed / checks.length) * 100)}%`;
        },
      },
    ],
    tabs: [
      {
        id: "phases",
        label: "Phases",
        icon: Activity,
        component: lazy(() => import("../components/tabs/PhasesTab")),
        showForStrategies: ["rolling_wave"],
        priority: 1,
      },
      {
        id: "deliverables",
        label: "Deliverables",
        icon: CheckCircle2,
        component: lazy(() => import("../components/tabs/DeliverablesTab")),
        showForStrategies: ["rolling_wave", "pre_planned"],
        priority: 2,
      },
      {
        id: "iterations",
        label: "Iterations",
        icon: GitMerge,
        component: lazy(() => import("../components/tabs/IterationsTab")),
        showForStrategies: ["rolling_wave"],
        priority: 3,
      },
      {
        id: "preview",
        label: "Live Preview",
        icon: Globe,
        component: lazy(() => import("../components/tabs/PreviewTab")),
        showForStrategies: ["rolling_wave"],
        priority: 4,
      },
      {
        id: "terminal",
        label: "Build Terminal",
        icon: Terminal,
        component: lazy(() => import("../components/tabs/TerminalTab")),
        showForStrategies: ["rolling_wave"],
        priority: 5,
      },
      {
        id: "thoughts",
        label: "Thoughts",
        icon: BrainCircuit,
        component: lazy(() => import("../components/tabs/ThoughtsTab")),
        showForStrategies: ["dynamic_autonomous", "rolling_wave"],
        priority: 6,
      },
      {
        id: "activity",
        label: "Activity",
        icon: Activity,
        component: lazy(() => import("../components/tabs/ActivityTab")),
        showForStrategies: ["pre_planned", "dynamic_autonomous", "rolling_wave"],
        priority: 10,
      },
      {
        id: "budget",
        label: "Economics",
        icon: Wallet,
        component: lazy(() => import("../components/tabs/EconomicControlTab")),
        showForStrategies: ["pre_planned", "dynamic_autonomous", "rolling_wave", "parallel_fan_out", "human_driven"],
        priority: 11,
      },
    ],
    sidebarWidgets: [
      {
        id: "phase_indicator",
        label: "Current Phase",
        component: lazy(() => import("../components/widgets/PhaseIndicatorWidget")),
        position: "sidebar",
        showForStrategies: ["rolling_wave"],
      },
      {
        id: "app_preview_thumb",
        label: "App Preview",
        component: lazy(() => import("../components/widgets/AppPreviewThumbnailWidget")),
        position: "sidebar",
        showForStrategies: ["rolling_wave"],
      },
      {
        id: "deliverable_checklist",
        label: "Deliverables",
        component: lazy(() => import("../components/widgets/DeliverableChecklistWidget")),
        position: "sidebar",
        showForStrategies: ["rolling_wave"],
      },
    ],
    features: {
      predictivePlanning: false,
      selfHealing: false,
      multiAgentCoordination: false,
    },
    layout: {
      showChat: true,
      showPreview: true,
      resizablePanels: true,
      fullWidth: true,
    },
  },

  human_driven: {
    id: "human_driven",
    name: "Human-Driven",
    description: "AI proposes actions, but every step requires human approval before execution",
    icon: HandMetal,
    colorScheme: {
      primary: "sky",
      secondary: "cyan",
      accent: "blue",
      bgGradient: "from-sky-500/10 via-cyan-500/5 to-transparent",
    },
    heroComponent: lazy(() => import("../components/heroes/DynamicFlowHero")),
    primaryMetrics: [
      {
        id: "pending_approvals",
        label: "Pending Approvals",
        icon: Eye,
        color: "sky",
        getValue: (m, r) => {
          return r[0]?.status === "waiting_on_human" ? 1 : 0;
        },
      },
      {
        id: "approved_actions",
        label: "Approved Actions",
        icon: CheckCircle2,
        color: "emerald",
        getValue: (m, r) => {
          const ctx = r[0]?.missionContext || {};
          return ctx.cycleCount || 0;
        },
      },
      {
        id: "rejection_rate",
        label: "Rejection Rate",
        icon: AlertTriangle,
        color: "amber",
        getValue: (m, r) => {
          const ctx = r[0]?.missionContext || {};
          const history = ctx.triggerHistory || [];
          const rejected = history.filter((h: any) => !h.approved).length;
          return history.length ? `${Math.round((rejected / history.length) * 100)}%` : "0%";
        },
      },
      {
        id: "budget_used",
        label: "Budget Used",
        icon: TrendingUp,
        color: "blue",
        getValue: (m) => {
          const spent = parseFloat(m.currentSpendUsd || "0");
          const limit = parseFloat(m.budgetLimitUsd || "1");
          return `${Math.round((spent / limit) * 100)}%`;
        },
      },
    ],
    tabs: [
      {
        id: "flow",
        label: "Execution Flow",
        icon: GitMerge,
        component: lazy(() => import("../components/tabs/ExecutionFlowTab")),
        showForStrategies: ["human_driven", "dynamic_autonomous"],
        priority: 1,
      },
      {
        id: "ai_decisions",
        label: "AI Proposals",
        icon: Sparkles,
        component: lazy(() => import("../components/tabs/AIDecisionsTab")),
        showForStrategies: ["human_driven", "dynamic_autonomous"],
        priority: 2,
      },
      {
        id: "activity",
        label: "Activity",
        icon: Activity,
        component: lazy(() => import("../components/tabs/ActivityTab")),
        showForStrategies: ["pre_planned", "dynamic_autonomous", "rolling_wave", "human_driven", "parallel_fan_out", "reactive"],
        priority: 10,
      },
      {
        id: "budget",
        label: "Economics",
        icon: Wallet,
        component: lazy(() => import("../components/tabs/EconomicControlTab")),
        showForStrategies: ["pre_planned", "dynamic_autonomous", "rolling_wave", "parallel_fan_out", "human_driven"],
        priority: 11,
      },
    ],
    sidebarWidgets: [
      {
        id: "health_dashboard",
        label: "Health",
        component: lazy(() => import("../components/widgets/HealthDashboardWidget")),
        position: "sidebar",
        showForStrategies: ["human_driven", "dynamic_autonomous"],
      },
    ],
    features: {
      predictivePlanning: true,
      selfHealing: false,
      multiAgentCoordination: false,
    },
    layout: {
      showChat: true,
      showPreview: false,
      resizablePanels: true,
      fullWidth: true,
    },
  },

  parallel_fan_out: {
    id: "parallel_fan_out",
    name: "Parallel Fan-Out",
    description: "Execute child missions in parallel based on a dependency graph, merging results when all complete",
    icon: Network,
    colorScheme: {
      primary: "indigo",
      secondary: "blue",
      accent: "violet",
      bgGradient: "from-indigo-500/10 via-blue-500/5 to-transparent",
    },
    heroComponent: lazy(() => import("../components/heroes/DynamicFlowHero")),
    primaryMetrics: [
      {
        id: "child_progress",
        label: "Child Missions",
        icon: Network,
        color: "indigo",
        getValue: (m, r) => {
          const ctx = r[0]?.missionContext || {};
          const completed = (ctx.completedChildren || []).length;
          const total = (ctx.dependencyGraph || []).length;
          return `${completed}/${total}`;
        },
      },
      {
        id: "active_children",
        label: "Active",
        icon: Zap,
        color: "blue",
        getValue: (m, r) => {
          const ctx = r[0]?.missionContext || {};
          const launched = (ctx.launchedChildren || []).length;
          const completed = (ctx.completedChildren || []).length;
          return launched - completed;
        },
      },
      {
        id: "fan_out_phase",
        label: "Phase",
        icon: ListChecks,
        color: "violet",
        getValue: (m, r) => {
          return (r[0]?.missionContext as any)?.phase || "LAUNCHING";
        },
      },
      {
        id: "budget_used",
        label: "Budget Used",
        icon: TrendingUp,
        color: "amber",
        getValue: (m) => {
          const spent = parseFloat(m.currentSpendUsd || "0");
          const limit = parseFloat(m.budgetLimitUsd || "1");
          return `${Math.round((spent / limit) * 100)}%`;
        },
      },
    ],
    tabs: [
      {
        id: "flow",
        label: "Dependency Graph",
        icon: Network,
        component: lazy(() => import("../components/tabs/ExecutionFlowTab")),
        showForStrategies: ["parallel_fan_out"],
        priority: 1,
      },
      {
        id: "agents",
        label: "Child Missions",
        icon: Bot,
        component: lazy(() => import("../components/tabs/AgentsTab")),
        showForStrategies: ["parallel_fan_out", "dynamic_autonomous"],
        priority: 2,
      },
      {
        id: "activity",
        label: "Activity",
        icon: Activity,
        component: lazy(() => import("../components/tabs/ActivityTab")),
        showForStrategies: ["pre_planned", "dynamic_autonomous", "rolling_wave", "human_driven", "parallel_fan_out", "reactive"],
        priority: 10,
      },
      {
        id: "budget",
        label: "Economics",
        icon: Wallet,
        component: lazy(() => import("../components/tabs/EconomicControlTab")),
        showForStrategies: ["pre_planned", "dynamic_autonomous", "rolling_wave", "parallel_fan_out", "human_driven"],
        priority: 11,
      },
      {
        id: "deliverables",
        label: "Deliverables",
        icon: CheckCircle2,
        component: lazy(() => import("../components/tabs/DeliverablesTab")),
        showForStrategies: ["parallel_fan_out"],
        priority: 12,
      },
    ],
    sidebarWidgets: [],
    features: {
      predictivePlanning: false,
      selfHealing: false,
      multiAgentCoordination: true,
    },
    layout: {
      showChat: false,
      showPreview: false,
      resizablePanels: false,
      fullWidth: true,
    },
  },

  reactive: {
    id: "reactive",
    name: "Reactive (Event-Driven)",
    description: "Dormant mission that wakes and processes when external events arrive (webhooks, emails, file uploads)",
    icon: Radio,
    colorScheme: {
      primary: "rose",
      secondary: "pink",
      accent: "red",
      bgGradient: "from-rose-500/10 via-pink-500/5 to-transparent",
    },
    heroComponent: lazy(() => import("../components/heroes/DynamicFlowHero")),
    primaryMetrics: [
      {
        id: "trigger_count",
        label: "Triggers Processed",
        icon: Radio,
        color: "rose",
        getValue: (m, r) => (r[0]?.missionContext as any)?.triggerCount || 0,
      },
      {
        id: "listening_status",
        label: "Status",
        icon: Inbox,
        color: "emerald",
        getValue: (m, r) => {
          const ctx = (r[0]?.missionContext as any) || {};
          return ctx.status === "listening" ? "Listening" : ctx.status === "processing" ? "Processing" : r[0]?.status || "—";
        },
      },
      {
        id: "event_types",
        label: "Event Types",
        icon: Zap,
        color: "pink",
        getValue: (m, r) => {
          const types = (r[0]?.missionContext as any)?.triggerConfig?.eventTypes || [];
          return types.length;
        },
      },
      {
        id: "budget_used",
        label: "Budget Used",
        icon: TrendingUp,
        color: "amber",
        getValue: (m) => {
          const spent = parseFloat(m.currentSpendUsd || "0");
          const limit = parseFloat(m.budgetLimitUsd || "1");
          return `${Math.round((spent / limit) * 100)}%`;
        },
      },
    ],
    tabs: [
      {
        id: "flow",
        label: "Event Log",
        icon: Radio,
        component: lazy(() => import("../components/tabs/ExecutionFlowTab")),
        showForStrategies: ["reactive"],
        priority: 1,
      },
      {
        id: "activity",
        label: "Activity",
        icon: Activity,
        component: lazy(() => import("../components/tabs/ActivityTab")),
        showForStrategies: ["pre_planned", "dynamic_autonomous", "rolling_wave", "human_driven", "parallel_fan_out", "reactive"],
        priority: 10,
      },
      {
        id: "budget",
        label: "Economics",
        icon: Wallet,
        component: lazy(() => import("../components/tabs/EconomicControlTab")),
        showForStrategies: ["pre_planned", "dynamic_autonomous", "rolling_wave", "parallel_fan_out", "human_driven"],
        priority: 11,
      },
    ],
    sidebarWidgets: [],
    features: {
      predictivePlanning: false,
      selfHealing: false,
      multiAgentCoordination: false,
    },
    layout: {
      showChat: true,
      showPreview: false,
      resizablePanels: true,
      fullWidth: true,
    },
  },
};

// ============================================================================
// HELPERS
// ============================================================================

export function getStrategyConfig(strategy: ExecutionStrategy): StrategyConfig {
  return strategyConfigs[strategy] || strategyConfigs.pre_planned;
}

export function getTabsForStrategy(strategy: ExecutionStrategy): TabConfig[] {
  const config = getStrategyConfig(strategy);
  return config.tabs
    .filter((tab) => tab.showForStrategies.includes(strategy))
    .sort((a, b) => a.priority - b.priority);
}

export function getWidgetsForStrategy(
  strategy: ExecutionStrategy,
  position: "sidebar" | "hero" | "header"
): WidgetConfig[] {
  const config = getStrategyConfig(strategy);
  return config.sidebarWidgets.filter(
    (w) => w.showForStrategies.includes(strategy) && w.position === position
  );
}

export function getMetricsForStrategy(strategy: ExecutionStrategy): MetricConfig[] {
  const config = getStrategyConfig(strategy);
  return config.primaryMetrics;
}

export function shouldShowFeature(
  strategy: ExecutionStrategy,
  feature: keyof StrategyConfig["features"]
): boolean {
  const config = getStrategyConfig(strategy);
  return config.features[feature];
}

// Mission type overlays
export const missionTypeOverlays: Record<MissionType, { badge: string; icon: LucideIcon; color: string }> = {
  supervisor_led: { badge: "AI Supervised", icon: Bot, color: "purple" },
  governed: { badge: "Governed", icon: ShieldCheck, color: "amber" },
  manual: { badge: "Manual", icon: Users, color: "blue" },
  mission_based: { badge: "Multi-Mission", icon: GitMerge, color: "emerald" },
  rescue: { badge: "Rescue", icon: AlertTriangle, color: "red" },
};
