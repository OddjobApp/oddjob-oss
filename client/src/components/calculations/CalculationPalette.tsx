import React, { useState } from "react";
import {
  Calculator,
  TrendingUp,
  Percent,
  ShieldCheck,
  Share2,
  Cpu,
  Binary,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Globe,
  Layers,
  Shield,
  MessageSquare,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface CalculationTemplate {
  name: string;
  operation: string;
  category: string;
  description: string;
  defaultFormula?: string;
  icon: React.ElementType;
  badgeClass: string;
}

const TEMPLATES: CalculationTemplate[] = [
  // Basic Arithmetic AST
  {
    name: "Sum Aggregator",
    operation: "SUM",
    category: "basic",
    description: "Multi-node arithmetic summation across input values",
    defaultFormula: "a + b",
    icon: Calculator,
    badgeClass: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
  },
  {
    name: "Dynamic AST Expression",
    // Operation names match calculationOperationEnum. DYNAMIC_FORMULA, YOY_GROWTH
    // and MONTE_CARLO were never evaluated by the service and no longer validate.
    operation: "FORMULA",
    category: "basic",
    description: "Sandboxed arithmetic expression (+ - * / % ^ and parentheses)",
    defaultFormula: "(a * 1.15) - b",
    icon: Binary,
    badgeClass: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
  },
  // Temporal
  {
    name: "Year-over-Year (YoY)",
    operation: "YEAR_OVER_YEAR",
    category: "temporal",
    description: "Calculates annualized growth rate between time windows",
    defaultFormula: "((current - previous) / previous) * 100",
    icon: TrendingUp,
    badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  },
  {
    name: "Compound Growth (CAGR)",
    operation: "CAGR",
    category: "temporal",
    description: "Compound annual growth rate across temporal series",
    defaultFormula: "(endVal / startVal) ^ (1 / periods) - 1",
    icon: TrendingUp,
    badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  },
  // Probabilistic
  {
    name: "Monte Carlo Simulator",
    operation: "MONTE_CARLO_SIMULATION",
    category: "probabilistic",
    description: "1,000+ iteration stochastic distribution simulation",
    defaultFormula: "NORMAL(mean, stdDev, 1000)",
    icon: Percent,
    badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  },
  {
    name: "Bayesian Inference",
    operation: "BAYESIAN_INFERENCE",
    category: "probabilistic",
    description: "Computes posterior probability distribution P(A|B)",
    defaultFormula: "(P_B_given_A * P_A) / P_B",
    icon: Percent,
    badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  },
  // Constraint & Governance
  {
    name: "Policy Gate Condition",
    operation: "POLICY_ENFORCEMENT",
    category: "constraint",
    description: "Halts workflow if risk or blast radius thresholds breach",
    defaultFormula: "safetyScore >= 0.85",
    icon: ShieldCheck,
    badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  },
  // Graph Centrality
  {
    name: "PageRank Centrality",
    operation: "PAGERANK",
    category: "graph_algorithm",
    description: "Calculates entity influence and authority distribution",
    defaultFormula: "dampingFactor: 0.85, iterations: 20",
    icon: Share2,
    badgeClass: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  },
  // ML Inference
  {
    name: "Anomaly Detector",
    operation: "ANOMALY_DETECTION",
    category: "ml_inference",
    description: "Z-score and isolation forest deviation detection",
    defaultFormula: "threshold: 2.5 std_dev",
    icon: Cpu,
    badgeClass: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  },
];

export interface OperationalTemplate {
  name: string;
  kind: "tool" | "saas" | "scaffold_pack" | "hil_gate";
  target: string;
  category: string;
  description: string;
  badgeClass: string;
}

const OPERATIONAL_ACTIONS: OperationalTemplate[] = [
  {
    name: "Jira Issue Dispatch",
    kind: "saas",
    target: "jira_create_issue",
    category: "saas",
    description: "Dispatches synchronized tasks or tickets to Jira project",
    badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  },
  {
    name: "Slack Channel Alert",
    kind: "saas",
    target: "slack_post_message",
    category: "messaging",
    description: "Publishes operational status or metric alerts to Slack",
    badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  },
  {
    name: "Salesforce Lead Sync",
    kind: "saas",
    target: "salesforce_upsert",
    category: "saas",
    description: "Syncs customer state and deal stage with Salesforce CRM",
    badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  },
  {
    name: "HIL Human Review Gate",
    kind: "hil_gate",
    target: "hil_approval_request",
    category: "governance",
    description: "Requires explicit operator sign-off before downstream execution",
    badgeClass: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  },
  {
    name: "W3C Forensic Trace Span",
    kind: "tool",
    target: "trace_span_record",
    category: "observability",
    description: "Emits cryptographically-verifiable distributed trace span",
    badgeClass: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  },
];

const SCAFFOLD_PACK_TEMPLATES: OperationalTemplate[] = [
  {
    name: "Node Express Core",
    kind: "scaffold_pack",
    target: "core-node-express",
    category: "core",
    description: "Express host runtime foundation with graceful shutdown",
    badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  },
  {
    name: "JWT Auth Middleware",
    kind: "scaffold_pack",
    target: "auth-jwt",
    category: "auth",
    description: "Bearer JWT security middleware with role verification",
    badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  },
  {
    name: "Postgres Drizzle ORM",
    kind: "scaffold_pack",
    target: "data-postgres-drizzle",
    category: "data",
    description: "Postgres persistence layer with type-safe Drizzle schemas",
    badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  },
  {
    name: "OpenTelemetry Tracing",
    kind: "scaffold_pack",
    target: "observability-otel",
    category: "observability",
    description: "Distributed tracing and telemetry headers provider",
    badgeClass: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  },
];

interface CalculationPaletteProps {
  className?: string;
}

export function CalculationPalette({ className }: CalculationPaletteProps) {
  const [paletteMode, setPaletteMode] = useState<"calculations" | "actions" | "scaffold">("calculations");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const onDragStartCalc = (event: React.DragEvent, template: CalculationTemplate) => {
    event.dataTransfer.setData("application/reactflow/type", "calculation");
    event.dataTransfer.setData("application/reactflow/template", JSON.stringify(template));
    event.dataTransfer.effectAllowed = "move";
  };

  const onDragStartOp = (event: React.DragEvent, template: OperationalTemplate) => {
    event.dataTransfer.setData("application/reactflow/type", "operationalWorkflow");
    event.dataTransfer.setData("application/reactflow/template", JSON.stringify(template));
    event.dataTransfer.effectAllowed = "move";
  };

  const categories = [
    { id: "all", label: "All Operations" },
    { id: "basic", label: "AST / Math" },
    { id: "temporal", label: "Temporal" },
    { id: "probabilistic", label: "Probabilistic" },
    { id: "constraint", label: "Gates" },
    { id: "graph_algorithm", label: "Graph" },
    { id: "ml_inference", label: "ML" },
  ];

  const filteredCalcs =
    activeCategory === "all"
      ? TEMPLATES
      : TEMPLATES.filter((t) => t.category === activeCategory);


  return (
    <div className={cn("w-72 bg-card/95 border-r border-border/60 flex flex-col h-full backdrop-blur-md", className)}>
      <div className="p-3.5 border-b border-border/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-foreground">Operational Palette</h3>
            <p className="text-[10px] text-muted-foreground">Drag components onto canvas</p>
          </div>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="p-1.5 border-b border-border/40 grid grid-cols-3 gap-1 bg-muted/20">
        <button
          onClick={() => setPaletteMode("calculations")}
          className={cn(
            "py-1 px-1 rounded text-[10px] font-semibold transition-colors text-center truncate",
            paletteMode === "calculations"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          Calculations
        </button>
        <button
          onClick={() => setPaletteMode("actions")}
          className={cn(
            "py-1 px-1 rounded text-[10px] font-semibold transition-colors text-center truncate",
            paletteMode === "actions"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          Actions / SaaS
        </button>
        <button
          onClick={() => setPaletteMode("scaffold")}
          className={cn(
            "py-1 px-1 rounded text-[10px] font-semibold transition-colors text-center truncate",
            paletteMode === "scaffold"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          Scaffold Packs
        </button>
      </div>

      {/* Category Filter Chips for Calculations */}
      {paletteMode === "calculations" && (
        <div className="p-2 border-b border-border/40 flex items-center gap-1 overflow-x-auto no-scrollbar">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={cn(
                "px-2 py-1 rounded-md text-[10px] font-medium whitespace-nowrap transition-colors",
                activeCategory === c.id
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Draggable Cards */}
      <ScrollArea className="flex-1 p-3">
        <div className="space-y-2.5">
          {paletteMode === "calculations" &&
            filteredCalcs.map((template) => {
              const Icon = template.icon;
              return (
                <div
                  key={template.operation}
                  draggable
                  onDragStart={(e) => onDragStartCalc(e, template)}
                  className="group p-2.5 rounded-xl border border-border/60 bg-foreground/[0.02] hover:bg-indigo-500/5 hover:border-indigo-500/30 transition-all cursor-grab active:cursor-grabbing shadow-sm hover:shadow"
                >
                  <div className="flex items-center justify-between gap-1.5 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="text-muted-foreground group-hover:text-indigo-400 transition-colors">
                        <GripVertical className="h-3.5 w-3.5" />
                      </div>
                      <div className="p-1 rounded-md bg-foreground/5 text-foreground shrink-0">
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-xs font-bold text-foreground truncate">{template.name}</span>
                    </div>
                    <Badge variant="outline" className={cn("text-[8px] font-mono px-1 py-0 uppercase shrink-0", template.badgeClass)}>
                      {template.operation}
                    </Badge>
                  </div>

                  <p className="text-[10px] text-muted-foreground leading-relaxed pl-5 line-clamp-2">
                    {template.description}
                  </p>

                  {template.defaultFormula && (
                    <div className="mt-1.5 ml-5 text-[9px] font-mono text-muted-foreground/80 bg-background/50 px-1.5 py-0.5 rounded border border-border/30 truncate">
                      {template.defaultFormula}
                    </div>
                  )}
                </div>
              );
            })}

          {paletteMode === "actions" &&
            OPERATIONAL_ACTIONS.map((item) => (
              <div
                key={item.target}
                draggable
                onDragStart={(e) => onDragStartOp(e, item)}
                className="group p-2.5 rounded-xl border border-border/60 bg-foreground/[0.02] hover:bg-blue-500/5 hover:border-blue-500/30 transition-all cursor-grab active:cursor-grabbing shadow-sm hover:shadow"
              >
                <div className="flex items-center justify-between gap-1.5 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="text-muted-foreground group-hover:text-blue-400 transition-colors">
                      <GripVertical className="h-3.5 w-3.5" />
                    </div>
                    <div className="p-1 rounded-md bg-foreground/5 text-foreground shrink-0">
                      <Globe className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-xs font-bold text-foreground truncate">{item.name}</span>
                  </div>
                  <Badge variant="outline" className={cn("text-[8px] font-mono px-1 py-0 uppercase shrink-0", item.badgeClass)}>
                    {item.category}
                  </Badge>
                </div>

                <p className="text-[10px] text-muted-foreground leading-relaxed pl-5 line-clamp-2">
                  {item.description}
                </p>

                <div className="mt-1.5 ml-5 text-[9px] font-mono text-muted-foreground/80 bg-background/50 px-1.5 py-0.5 rounded border border-border/30 truncate">
                  {item.target}
                </div>
              </div>
            ))}

          {paletteMode === "scaffold" &&
            SCAFFOLD_PACK_TEMPLATES.map((item) => (
              <div
                key={item.target}
                draggable
                onDragStart={(e) => onDragStartOp(e, item)}
                className="group p-2.5 rounded-xl border border-border/60 bg-foreground/[0.02] hover:bg-amber-500/5 hover:border-amber-500/30 transition-all cursor-grab active:cursor-grabbing shadow-sm hover:shadow"
              >
                <div className="flex items-center justify-between gap-1.5 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="text-muted-foreground group-hover:text-amber-400 transition-colors">
                      <GripVertical className="h-3.5 w-3.5" />
                    </div>
                    <div className="p-1 rounded-md bg-foreground/5 text-foreground shrink-0">
                      <Layers className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-xs font-bold text-foreground truncate">{item.name}</span>
                  </div>
                  <Badge variant="outline" className={cn("text-[8px] font-mono px-1 py-0 uppercase shrink-0", item.badgeClass)}>
                    {item.category}
                  </Badge>
                </div>

                <p className="text-[10px] text-muted-foreground leading-relaxed pl-5 line-clamp-2">
                  {item.description}
                </p>

                <div className="mt-1.5 ml-5 text-[9px] font-mono text-muted-foreground/80 bg-background/50 px-1.5 py-0.5 rounded border border-border/30 truncate">
                  {item.target}
                </div>
              </div>
            ))}
        </div>
      </ScrollArea>
    </div>
  );
}

