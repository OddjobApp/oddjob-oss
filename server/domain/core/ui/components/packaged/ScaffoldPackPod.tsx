import React, { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Check, Package, Shield, Database, Cpu, Layers, Sparkles, Activity, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { emitWorkbenchSaved, generateW3CTraceparent, usePodEventListener } from "./pod-event-bus.js";

export interface ScaffoldPackItem {
  id: string;
  name: string;
  category: "core" | "auth" | "data" | "observability" | "ui" | "agent";
  description: string;
  requires: string[];
  conflicts: string[];
  provides: string[];
  badge?: string;
  coldStartMs?: number;
  ramMb?: number;
}

export const AVAILABLE_PACKS: ScaffoldPackItem[] = [
  {
    id: "core-node-express",
    name: "Node Express Core",
    category: "core",
    description: "Production Node.js & Express host runtime with TypeScript",
    requires: [],
    conflicts: [],
    provides: ["web-host"],
    badge: "Foundation",
    coldStartMs: 45,
    ramMb: 35,
  },
  {
    id: "core-fastapi-python",
    name: "Python FastAPI Core",
    category: "core",
    description: "High-performance Python ASGI runtime with Pydantic v2 schemas",
    requires: [],
    conflicts: [],
    provides: ["web-host", "python-runtime"],
    badge: "Pythonic",
    coldStartMs: 65,
    ramMb: 45,
  },
  {
    id: "auth-jwt",
    name: "JWT Bearer Authentication",
    category: "auth",
    description: "Stateless JWT token verification, claim parsing & middleware",
    requires: ["core-node-express"],
    conflicts: ["auth-session"],
    provides: ["auth-provider"],
    badge: "Recommended",
    coldStartMs: 15,
    ramMb: 10,
  },
  {
    id: "auth-session",
    name: "Session Cookie Auth",
    category: "auth",
    description: "Stateful session cookies with Redis / Postgres store",
    requires: ["core-node-express"],
    conflicts: ["auth-jwt"],
    provides: ["auth-provider"],
    coldStartMs: 20,
    ramMb: 12,
  },
  {
    id: "data-postgres-drizzle",
    name: "PostgreSQL & Drizzle ORM",
    category: "data",
    description: "Type-safe Drizzle schema, migrations, and connection pooling",
    requires: ["core-node-express"],
    conflicts: [],
    provides: ["database"],
    badge: "Relational",
    coldStartMs: 35,
    ramMb: 25,
  },
  {
    id: "data-qdrant-vector",
    name: "Qdrant Vector Database",
    category: "data",
    description: "Dense embedding similarity search and semantic graph memory",
    requires: [],
    conflicts: [],
    provides: ["vector-db"],
    badge: "Vector RAG",
    coldStartMs: 30,
    ramMb: 30,
  },
  {
    id: "ui-oddjob-design-system",
    name: "Oddjob Component Library",
    category: "ui",
    description: "50+ pre-built accessible UI blocks, Tailwind tokens, and dark theme",
    requires: [],
    conflicts: [],
    provides: ["ui-components"],
    badge: "Design System",
    coldStartMs: 10,
    ramMb: 15,
  },
  {
    id: "observability-otel",
    name: "OpenTelemetry & Hermes Tracing",
    category: "observability",
    description: "W3C distributed trace context, spans, and forensic audit logging",
    requires: ["core-node-express"],
    conflicts: [],
    provides: ["telemetry"],
    badge: "Gov & Audit",
    coldStartMs: 25,
    ramMb: 20,
  },
  {
    id: "agent-langgraph",
    name: "LangGraph StateGraph Engine",
    category: "agent",
    description: "Stateful cyclical multi-agent graph workflows and human-in-the-loop pausing",
    requires: [],
    conflicts: [],
    provides: ["multi-agent-dag"],
    badge: "Multi-Agent",
    coldStartMs: 40,
    ramMb: 35,
  },
];

interface ScaffoldPackPodProps {
  stageId?: string;
  title?: string;
  defaultPacks?: string[];
  defaultSelectedPacks?: string[];
  onStageComplete?: (payload: any) => void;
  onComplete?: (payload: any) => void;
  onConfirm?: (payload: any) => void;
  className?: string;
}

export default function ScaffoldPackPod({
  stageId = "stage-scaffold",
  title = "Scaffold & Feature Pack Architecture",
  defaultPacks,
  defaultSelectedPacks,
  onStageComplete,
  onComplete,
  onConfirm,
  className
}: ScaffoldPackPodProps) {
  const initialPacks = defaultPacks || defaultSelectedPacks || ["core-node-express", "auth-jwt", "data-postgres-drizzle", "ui-oddjob-design-system"];
  const [selectedPacks, setSelectedPacks] = useState<string[]>(initialPacks);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>("all");

  // Two-way sync: Listen for agent events from Crew Chat
  usePodEventListener(
    stageId,
    useCallback((event) => {
      if (event.action === "toggle-pack" && event.payload?.packId) {
        togglePack(event.payload.packId);
      } else if (event.action === "set-packs" && Array.isArray(event.payload?.packs)) {
        setSelectedPacks(event.payload.packs);
      }
    }, [])
  );

  const togglePack = (packId: string) => {
    setSelectedPacks(prev => {
      if (prev.includes(packId)) {
        return prev.filter(id => id !== packId);
      } else {
        const pack = AVAILABLE_PACKS.find(p => p.id === packId);
        // Automatically drop conflicting packs
        let updated = prev.filter(id => !(pack?.conflicts || []).includes(id));
        // Automatically include required dependency packs
        if (pack?.requires) {
          for (const reqId of pack.requires) {
            if (!updated.includes(reqId)) {
              updated.push(reqId);
            }
          }
        }
        return [...updated, packId];
      }
    });
  };

  // Calculate estimated footprint
  const totalRam = selectedPacks.reduce((acc, id) => {
    const p = AVAILABLE_PACKS.find(x => x.id === id);
    return acc + (p?.ramMb || 15);
  }, 0);

  const totalColdStart = selectedPacks.reduce((acc, id) => {
    const p = AVAILABLE_PACKS.find(x => x.id === id);
    return acc + (p?.coldStartMs || 20);
  }, 0);

  const handleConfirm = () => {
    setIsSubmitting(true);
    const traceparent = generateW3CTraceparent();
    const payload = {
      stageId,
      selectedPacks,
      selectedPackIds: selectedPacks,
      metrics: {
        totalRamMb: totalRam,
        coldStartMs: totalColdStart,
      },
      telemetryFootprint: {
        estimatedRamMb: totalRam,
        coldStartMs: totalColdStart,
      },
      timestamp: new Date().toISOString(),
      _trace: {
        traceparent,
        generatedAt: new Date().toISOString(),
      }
    };

    if (onStageComplete) onStageComplete(payload);
    if (onComplete) onComplete(payload);
    if (onConfirm) onConfirm(payload);

    emitWorkbenchSaved({
      stageId,
      summary: `Configured ${selectedPacks.length} scaffold packs: ${selectedPacks.join(", ")} (~${totalRam}MB RAM, ~${totalColdStart}ms cold start)`,
      data: payload,
      traceparent,
    });

    setTimeout(() => setIsSubmitting(false), 500);
  };

  const categoryIcons: Record<string, React.ReactNode> = {
    core: <Cpu className="w-3.5 h-3.5" />,
    auth: <Shield className="w-3.5 h-3.5" />,
    data: <Database className="w-3.5 h-3.5" />,
    ui: <Layers className="w-3.5 h-3.5" />,
    observability: <Sparkles className="w-3.5 h-3.5" />,
    agent: <Activity className="w-3.5 h-3.5" />,
  };

  const filteredPacks = AVAILABLE_PACKS.filter(p =>
    activeFilter === "all" ? true : p.category === activeFilter
  );

  return (
    <Card className={cn("border border-border/70 bg-card/80 shadow-md backdrop-blur-md", className)} data-testid="scaffold-pack-pod">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary/10 text-primary">
              <Package className="w-4 h-4" />
            </span>
            <div>
              <CardTitle className="text-sm font-bold tracking-tight">{title}</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Select foundational hosts, database ORMs, auth handlers, and component packs
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] font-mono uppercase bg-primary/5 text-primary border-primary/20">
              {selectedPacks.length} Packs Active
            </Badge>
          </div>
        </div>

        {/* Runtime Footprint Summary */}
        <div className="flex items-center gap-3 pt-2 text-[10px] text-muted-foreground font-mono">
          <span className="flex items-center gap-1">
            <Activity className="w-3 h-3 text-emerald-500" />
            Est. Memory: <strong className="text-foreground">{totalRam} MB</strong>
          </span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-amber-500" />
            Cold Start: <strong className="text-foreground">~{totalColdStart} ms</strong>
          </span>
        </div>

        {/* Category Filters */}
        <div className="flex gap-1.5 pt-2 flex-wrap">
          {["all", "core", "auth", "data", "ui", "observability", "agent"].map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveFilter(cat)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize transition-colors",
                activeFilter === cat
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {filteredPacks.map(pack => {
            const isSelected = selectedPacks.includes(pack.id);
            return (
              <div
                key={pack.id}
                onClick={() => togglePack(pack.id)}
                className={cn(
                  "cursor-pointer rounded-lg border p-3 transition-all duration-200 text-left relative",
                  isSelected
                    ? "border-primary/50 bg-primary/5 shadow-xs"
                    : "border-border/60 bg-card/40 opacity-75 hover:opacity-100 hover:border-border"
                )}
                data-testid={`pack-item-${pack.id}`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">{categoryIcons[pack.category]}</span>
                    <span className="text-xs font-semibold text-foreground">{pack.name}</span>
                  </div>
                  <div className={cn(
                    "h-4 w-4 rounded-full border grid place-items-center transition-colors shrink-0",
                    isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                  )}>
                    {isSelected && <Check className="h-2.5 w-2.5" />}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                  {pack.description}
                </p>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {pack.badge && (
                    <span className="rounded bg-muted/70 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                      {pack.badge}
                    </span>
                  )}
                  {pack.requires.length > 0 && (
                    <span className="rounded bg-primary/10 text-primary px-1.5 py-0.5 text-[9px] font-mono">
                      needs: {pack.requires.join(", ")}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <span className="text-[11px] text-muted-foreground">
            Prerequisites resolved topologically by DAG engine
          </span>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={selectedPacks.length === 0 || isSubmitting}
            className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs h-8 px-4"
            data-testid="scaffold-pack-confirm"
          >
            {isSubmitting ? "Confirming..." : "Confirm Architecture & Continue"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
