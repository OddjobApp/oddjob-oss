import React, { useState } from "react";
import { Link } from "wouter";
import {
  Calculator,
  Sparkles,
  PlusCircle,
  Network,
  Activity,
  ArrowLeft,
  Filter,
  CheckCircle2,
  Cpu,
  Layers,
  HelpCircle,
} from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@domain-ui/core/ui/components/ui/tabs";
import { CalculationList } from "@/components/calculations/CalculationList";
import { CalculationBuilder } from "@/components/calculations/CalculationBuilder";
import { KnowledgeGraphVisualizer } from "@/modules/agents/components/KnowledgeGraphVisualizer";

export default function CalculationsPage() {
  const [activeTab, setActiveTab] = useState<string>("list");
  const [refreshKey, setRefreshKey] = useState<number>(0);

  const handleCreated = () => {
    setActiveTab("list");
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/60 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link href="/knowledge">
              <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4 mr-1" /> Knowledge
              </Button>
            </Link>
            <span className="text-muted-foreground">/</span>
            <Badge variant="outline" className="font-mono text-xs text-indigo-400 border-indigo-500/30 bg-indigo-500/10">
              Neuro-Symbolic
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Calculator className="h-7 w-7 text-indigo-500" />
            Calculation Studio & Graph Metrics
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Configure reactive mathematical formulas, PageRank & graph centrality algorithms, Monte Carlo simulations,
            Bayesian inferences, and constraint validation gates directly across knowledge entities.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActiveTab("canvas")}
            className="h-9 gap-1.5 text-xs bg-background/50"
          >
            <Network className="h-4 w-4 text-blue-400" />
            Graph Topology Canvas
          </Button>
          <Button
            size="sm"
            onClick={() => setActiveTab(activeTab === "create" ? "list" : "create")}
            className="h-9 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
          >
            {activeTab === "create" ? (
              <>
                <Layers className="h-4 w-4" /> View Calculations
              </>
            ) : (
              <>
                <PlusCircle className="h-4 w-4" /> New Calculation Node
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Capability Overview Highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/40 border-border/60 backdrop-blur-sm shadow-sm">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Arithmetic & AST
            </CardTitle>
            <Calculator className="h-4 w-4 text-indigo-400" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-lg font-bold text-foreground">35+ Operations</p>
            <p className="text-xs text-muted-foreground mt-1">Multi-variable formulas & mathematical AST evaluation.</p>
          </CardContent>
        </Card>

        <Card className="bg-card/40 border-border/60 backdrop-blur-sm shadow-sm">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Graph Centrality
            </CardTitle>
            <Network className="h-4 w-4 text-purple-400" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-lg font-bold text-foreground">PageRank & Louvain</p>
            <p className="text-xs text-muted-foreground mt-1">Community clusters, betweenness & node centrality.</p>
          </CardContent>
        </Card>

        <Card className="bg-card/40 border-border/60 backdrop-blur-sm shadow-sm">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Probabilistic
            </CardTitle>
            <Sparkles className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-lg font-bold text-foreground">Monte Carlo & Bayes</p>
            <p className="text-xs text-muted-foreground mt-1">Sensitivity analysis & confidence interval modeling.</p>
          </CardContent>
        </Card>

        <Card className="bg-card/40 border-border/60 backdrop-blur-sm shadow-sm">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Temporal & ML
            </CardTitle>
            <Activity className="h-4 w-4 text-cyan-400" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-lg font-bold text-foreground">YoY, CAGR & ML</p>
            <p className="text-xs text-muted-foreground mt-1">Anomaly scoring, classification & rolling windows.</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Workspace Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-card/60 border border-border/60">
          <TabsTrigger value="list" className="text-xs gap-1.5 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
            <Layers className="h-3.5 w-3.5" /> Calculation Inventory
          </TabsTrigger>
          <TabsTrigger value="create" className="text-xs gap-1.5 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
            <PlusCircle className="h-3.5 w-3.5" /> Builder & Evaluator
          </TabsTrigger>
          <TabsTrigger value="canvas" className="text-xs gap-1.5 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
            <Network className="h-3.5 w-3.5" /> Graph Topology Canvas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4 focus-visible:outline-none">
          <CalculationList key={refreshKey} />
        </TabsContent>

        <TabsContent value="create" className="space-y-4 focus-visible:outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <CalculationBuilder onCreated={handleCreated} />
            </div>
            <div className="space-y-4">
              <Card className="border border-border/60 bg-card/60 backdrop-blur-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="h-4 w-4 text-indigo-400" />
                    <CardTitle className="text-sm font-semibold">Formula Context Tips</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    How inputs are resolved in the Knowledge Graph
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-xs text-muted-foreground leading-relaxed">
                  <p>
                    <strong className="text-foreground">Explicit Dependencies:</strong> Connect upstream nodes with{" "}
                    <code className="px-1.5 py-0.5 rounded bg-black/30 font-mono text-[11px] text-indigo-300">INPUT_TO</code> edges.
                  </p>
                  <p>
                    <strong className="text-foreground">Reactive Cascades:</strong> Updating any referenced node
                    automatically invalidates cached results and triggers re-computation.
                  </p>
                  <p>
                    <strong className="text-foreground">Gating & Constraints:</strong> When configured with{" "}
                    <code className="px-1.5 py-0.5 rounded bg-black/30 font-mono text-[11px] text-amber-300">POLICY_ENFORCEMENT</code> or{" "}
                    <code className="px-1.5 py-0.5 rounded bg-black/30 font-mono text-[11px] text-amber-300">BLOCK</code>, failures halt dependent agentic workflows.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="canvas" className="space-y-4 focus-visible:outline-none">
          <Card className="border border-border/60 bg-card/60 backdrop-blur-sm overflow-hidden min-h-[600px] h-[700px]">
            <KnowledgeGraphVisualizer autoRefresh={false} />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
