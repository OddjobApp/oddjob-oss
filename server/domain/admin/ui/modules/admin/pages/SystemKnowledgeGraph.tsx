import React, { useState, Suspense } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
const SemanticGraph3D = React.lazy(() => import("@domain-ui/knowledge/ui/components/knowledge/SemanticGraph3D"));
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Loader2, RefreshCw, Filter } from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Checkbox } from "@domain-ui/core/ui/components/ui/checkbox";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { cn } from "@/lib/utils";
import { Zap, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

export default function SystemKnowledgeGraph() {
    const { toast } = useToast();
    const baseLabels = ["Concept", "Topic", "Feature", "Task", "Service", "API_Route", "MCP_Tool", "Component_Group", "Schema_Model", "Component", "Page", "FormAgent", "Document", "Infrastructure", "Package", "JiraIssue", "Requirement", "AgentReasoning", "Attachment", "Dataset"];
    const [unselectedLabels, setUnselectedLabels] = useState<string[]>([]);

    const { data: graphData, isLoading, error, refetch } = useQuery({
        queryKey: ["/api/system-admin-graph/internal-kg"],
        queryFn: async () => {
            console.log("[SystemKnowledgeGraph] Fetching internal-kg data...");
            try {
                const resp = await apiRequest("GET", "/api/system-admin-graph/internal-kg");
                const data = await resp.json();
                console.log("[SystemKnowledgeGraph] Received data:", { nodes: data?.nodes?.length, edges: data?.edges?.length });
                return data;
            } catch (err) {
                console.error("[SystemKnowledgeGraph] Fetch error:", err);
                throw err;
            }
        },
        retry: false, // Don't retry on auth errors
    });

    const availableLabels = React.useMemo(() => {
        const set = new Set<string>(baseLabels);
        if (graphData?.nodes) {
            graphData.nodes.forEach((node: any) => {
                if (node.label) set.add(node.label);
            });
        }
        return Array.from(set);
    }, [graphData]);

    const selectedLabels = React.useMemo(() => {
        return availableLabels.filter(label => !unselectedLabels.includes(label));
    }, [availableLabels, unselectedLabels]);

    const syncMutation = useMutation({
        mutationFn: async () => {
            const resp = await apiRequest("POST", "/api/system-admin-graph/internal-kg/sync");
            if (!resp.ok) throw new Error("Failed to start sync");
            return resp.json();
        },
        onSuccess: () => {
            toast({
                title: "Sync Started",
                description: "The internal knowledge graph is being updated. This may take a few minutes.",
            });
            // Refetch after sync
            setTimeout(() => refetch(), 5000);
        },
        onError: (error: any) => {
            toast({
                title: "Sync Failed",
                description: error.message,
                variant: "destructive",
            });
        }
    });

    // Show toast if there's an error
    if (error) {
        console.error("Graph data fetch error:", error);
    }

    const filteredNodes = graphData?.nodes?.filter((node: any) => selectedLabels.includes(node.label)) || [];
    const visibleNodeIds = new Set(filteredNodes.map((n: any) => n.id));
    const filteredEdges = graphData?.edges?.filter((edge: any) => {
        return visibleNodeIds.has(edge.sourceId) && visibleNodeIds.has(edge.targetId);
    }) || [];

    const toggleLabel = (label: string) => {
        setUnselectedLabels(prev =>
            prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]
        );
    };

  return (
    <div className="h-screen bg-background text-foreground relative overflow-hidden font-sans selection:bg-primary/30 flex flex-col">
      {/* Cinematic Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 cinematic-grid opacity-10" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-primary/5 blur-[150px] rounded-full animate-pulse" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5 mix-blend-overlay" />
      </div>

      {/* Header */}
      <header className="relative z-20 px-8 py-8 border-b border-foreground/5 bg-background/40 backdrop-blur-xl flex items-center justify-between">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[9px] font-black tracking-[0.3em] uppercase italic">
            <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
            Neural Architect Active
          </div>
          <h1 className="text-4xl font-black tracking-tighter italic uppercase text-foreground leading-none">
            Brain <span className="text-primary font-light not-italic tracking-[-0.05em]">Architecture Graph</span>
          </h1>
          <p className="text-[10px] font-black uppercase tracking-widest text-foreground/20 italic">
            3D SPATIAL RECONSTRUCTION OF PLATFORM LOGIC & OPERATIONAL NODES
          </p>
        </div>

        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            className="h-12 px-6 rounded-2xl glass-panel border-foreground/10 text-[10px] font-black uppercase tracking-widest text-foreground/60 hover:text-foreground hover:bg-foreground/10 transition-all italic"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && 'animate-spin')} />
            Refresh Feed
          </Button>
          <Button
            className="h-12 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-primary/20 italic"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Zap className="mr-2 h-4 w-4" />
            )}
            Sync Memory Matrix
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative z-10 p-6 gap-6">
        {/* Vertical HUD */}
        <div className="w-80 glass-panel-deep border-foreground/5 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
          <div className="p-8 border-b border-foreground/5 bg-foreground/[0.02]">
            <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-primary flex items-center mb-6 italic">
              <Filter className="mr-3 h-4 w-4 shadow-glow" /> Node Class Filter
            </Label>
            <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
              {availableLabels.map(label => (
                <div key={label} className="group flex items-center justify-between p-3 rounded-xl hover:bg-foreground/[0.03] transition-all border border-transparent hover:border-foreground/5">
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id={`label-${label}`}
                      checked={selectedLabels.includes(label)}
                      onCheckedChange={() => toggleLabel(label)}
                      className="border-foreground/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                    <label
                      htmlFor={`label-${label}`}
                      className="text-[10px] font-black uppercase tracking-widest text-foreground/40 group-hover:text-foreground transition-colors cursor-pointer italic"
                    >
                      {label.replace("_", " ")}
                    </label>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-foreground/5 group-hover:bg-primary/50 transition-all shadow-[0_0_8px_rgba(var(--primary),0)] group-hover:shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
                </div>
              ))}
            </div>
          </div>

          <div className="p-8 flex-1 flex flex-col justify-end gap-6 bg-gradient-to-b from-transparent to-primary/5">
            <Card className="bg-background/40 border-foreground/5 rounded-2xl overflow-hidden backdrop-blur-md">
              <CardHeader className="p-6 border-b border-foreground/5">
                <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic">Telemetry Summary</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="flex justify-between items-center text-[11px] font-black italic uppercase tracking-widest">
                  <span className="text-foreground/20">Source Nodes:</span>
                  <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 rounded-lg h-6 px-3">{graphData?.nodes?.length || 0}</Badge>
                </div>
                <div className="flex justify-between items-center text-[11px] font-black italic uppercase tracking-widest">
                  <span className="text-foreground/20">Rendered Units:</span>
                  <Badge variant="outline" className="border-foreground/10 text-foreground/60 rounded-lg h-6 px-3">{filteredNodes.length}</Badge>
                </div>
              </CardContent>
            </Card>

            <div className="p-6 rounded-2xl bg-foreground/[0.02] border border-foreground/5 space-y-3">
                <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-primary italic">
                    <Sparkles className="w-3 h-3" /> Spatial Optimization Active
                </div>
                <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-foreground/20 italic leading-relaxed">
                    3D ENGINE UTILIZING SPATIAL INDEXING FOR REAL-TIME ARCHITECTURAL TRAVERSAL.
                </p>
            </div>
          </div>
        </div>

        {/* 3D Scanner Viewport */}
        <div className="flex-1 relative glass-panel-deep border-foreground/5 rounded-[3rem] overflow-hidden shadow-2xl group">
          <div className="absolute inset-0 bg-primary/[0.02] pointer-events-none" />
          
          {/* Scanner Overlays */}
          <div className="absolute top-8 left-8 z-30 pointer-events-none space-y-2">
             <div className="h-1 w-24 bg-primary/20 rounded-full overflow-hidden">
                <motion.div 
                    animate={{ x: [-100, 100] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                    className="h-full w-1/2 bg-primary shadow-glow" 
                />
             </div>
             <p className="text-[9px] font-black text-primary/40 tracking-[0.3em] uppercase italic">SCANNING MATRIX...</p>
          </div>

          <div className="absolute bottom-8 right-8 z-30 pointer-events-none text-right">
             <p className="text-[20px] font-black text-foreground/5 tracking-tighter uppercase italic leading-none">O JOB.BRAIN.V2</p>
             <p className="text-[9px] font-black text-foreground/10 tracking-[0.2em] uppercase italic pt-1">SECURE ARCHITECT VIEWPORT</p>
          </div>

          {isLoading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center space-y-6 bg-background/40 backdrop-blur-sm">
                <Loader2 className="h-12 w-12 animate-spin text-primary shadow-glow" />
                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-primary italic animate-pulse">RECONSTRUCTING GEOMETRY...</p>
            </div>
          ) : filteredNodes.length > 0 ? (
            <Suspense fallback={
              <div className="absolute inset-0 flex flex-col items-center justify-center space-y-6 bg-background/40 backdrop-blur-sm">
                <Loader2 className="h-12 w-12 animate-spin text-primary shadow-glow" />
                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-primary italic animate-pulse">LOADING 3D GRAPH...</p>
              </div>
            }>
              <SemanticGraph3D
                nodes={filteredNodes}
                edges={filteredEdges}
                onNodeClick={(node: any) => {
                  toast({
                    title: `${node.name.toUpperCase()}`,
                    description: `CLASS: ${node.label} | SIG: ${Object.entries(node.data || {}).map(([k, v]) => `${k}:${v}`).join(', ')}`,
                    className: "glass-panel-deep border-primary/20 text-foreground font-black italic uppercase text-[10px] tracking-widest",
                  });
                }}
              />
            </Suspense>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-12 bg-background/40">
              <div className="w-24 h-24 rounded-full bg-foreground/5 border border-foreground/10 flex items-center justify-center mb-8">
                <RefreshCw className="h-10 w-10 text-foreground/10" />
              </div>
              <h3 className="text-2xl font-black italic uppercase tracking-tighter text-foreground mb-4">No Data Detected</h3>
              <p className="text-[10px] font-black uppercase tracking-widest text-foreground/20 italic max-w-sm leading-relaxed">
                TRIGGER A SYNCHRONIZATION PULSE TO POPULATE THE ARCHITECTURAL MATRIX FROM SYSTEM MEMORY AND REPOSITORY SOURCES.
              </p>
              <Button 
                onClick={() => syncMutation.mutate()}
                className="mt-8 h-12 px-8 rounded-xl bg-foreground/5 border border-foreground/10 hover:bg-foreground/10 text-foreground text-[10px] font-black uppercase tracking-widest italic"
              >
                INITIALIZE SYNC
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

