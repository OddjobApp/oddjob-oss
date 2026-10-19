import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import cytoscape from "cytoscape";
import { 
  Search, X, Network, FileText, Sparkles, ChevronRight, ExternalLink, 
  Loader2, ZoomIn, ZoomOut, Maximize, RotateCcw, Share2, Info,
  Filter, Grid3X3, List, MousePointer2
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Badge } from '../ui/badge.js';
import { Skeleton } from '../ui/skeleton.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.js';
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface KnowledgeNode {
  id: string;
  name: string;
  label: string;
  description?: string;
  properties?: Record<string, any>;
  score?: number;
}

interface KnowledgeEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
}

interface GraphData {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

interface SearchResult extends GraphData {
  query: string;
}

interface PlatformKnowledgeSearchBlockProps {
  placeholder?: string;
  maxResults?: number;
  defaultView?: "graph" | "list";
  title?: string;
  onNodeSelect?: (node: KnowledgeNode) => void;
  height?: string;
}

// ============================================================================
// Color Scheme for Node Labels
// ============================================================================

const LABEL_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  Person: { bg: "#3b82f6", border: "#2563eb", text: "#ffffff" },
  Organization: { bg: "#10b981", border: "#059669", text: "#ffffff" },
  Location: { bg: "#f59e0b", border: "#d97706", text: "#ffffff" },
  Event: { bg: "#ef4444", border: "#dc2626", text: "#ffffff" },
  Document: { bg: "#8b5cf6", border: "#7c3aed", text: "#ffffff" },
  Topic: { bg: "#ec4899", border: "#db2777", text: "#ffffff" },
  Technology: { bg: "#06b6d4", border: "#0891b2", text: "#ffffff" },
  Concept: { bg: "#64748b", border: "#475569", text: "#ffffff" },
};

const DEFAULT_COLOR = { bg: "#64748b", border: "#475569", text: "#ffffff" };

// ============================================================================
// Graph Component
// ============================================================================

interface KnowledgeGraphProps {
  data: GraphData;
  onNodeClick: (node: KnowledgeNode) => void;
  selectedNodeId?: string;
  height: string;
}

function KnowledgeGraph({ data, onNodeClick, selectedNodeId, height }: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (wrapperRef.current) {
      // Set height directly. This used a --dynamic-height custom property read by
      // a .dynamic-height class that only exists in the platform stylesheet, so
      // inside a forged app the height fell back to auto and the block collapsed.
      wrapperRef.current.style.height = height;
    }
  }, [height]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...data.nodes.map(n => ({
          data: { 
            id: n.id, 
            label: n.name,
            nodeLabel: n.label,
            description: n.description,
            ...n.properties 
          }
        })),
        ...data.edges.map(e => ({
          data: { 
            id: e.id, 
            source: e.source, 
            target: e.target, 
            label: e.relation 
          }
        }))
      ],
      style: [
        {
          selector: "node",
          style: {
            "background-color": (ele: any) => {
              const label = ele.data("nodeLabel") || "Concept";
              return LABEL_COLORS[label]?.bg || DEFAULT_COLOR.bg;
            },
            "border-width": 2,
            "border-color": (ele: any) => {
              const label = ele.data("nodeLabel") || "Concept";
              return LABEL_COLORS[label]?.border || DEFAULT_COLOR.border;
            },
            "label": "data(label)",
            "color": "#ffffff",
            "font-size": "12px",
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "wrap",
            "text-max-width": "80px",
            "width": "60px",
            "height": "60px",
            "shape": "ellipse",
            "text-background-color": "#000000",
            "text-background-opacity": 0.7,
            "text-background-padding": "4px",
            "text-background-shape": "roundrectangle",
          }
        },
        {
          selector: "edge",
          style: {
            "width": 2,
            "line-color": "#94a3b8",
            "target-arrow-color": "#94a3b8",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            "label": "data(label)",
            "font-size": "10px",
            "color": "#64748b",
            "text-background-color": "#ffffff",
            "text-background-opacity": 0.8,
            "text-background-padding": "2px",
          }
        },
        {
          selector: ":selected",
          style: {
            "border-width": 4,
            "border-color": "#fbbf24",
            "background-color": "#f59e0b",
          }
        },
        {
          selector: ".highlighted",
          style: {
            "border-width": 3,
            "border-color": "#fbbf24",
          }
        },
        {
          selector: ".dimmed",
          style: {
            "opacity": 0.2,
          }
        }
      ],
      layout: {
        name: "cose",
        padding: 20,
        nodeRepulsion: 400000,
        edgeElasticity: 100,
        gravity: 80,
        numIter: 1000,
        initialTemp: 200,
        coolingFactor: 0.95,
        minTemp: 1.0,
      }
    });

    // Event handlers
    cy.on("tap", "node", (evt: cytoscape.EventObject) => {
      const node = evt.target;
      const nodeData = data.nodes.find(n => n.id === node.id());
      if (nodeData) {
        onNodeClick(nodeData);
      }
    });

    cy.on("tap", (evt: cytoscape.EventObject) => {
      if (evt.target === cy) {
        cy.nodes().removeClass("dimmed highlighted");
      }
    });

    cy.on("mouseover", "node", (evt: cytoscape.EventObject) => {
      const node = evt.target;
      cy.nodes().addClass("dimmed");
      node.removeClass("dimmed").addClass("highlighted");
      node.neighborhood().removeClass("dimmed");
    });

    cy.on("mouseout", "node", () => {
      cy.nodes().removeClass("dimmed highlighted");
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
    };
  }, [data.nodes.length, data.edges.length]);

  // Update selection
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !selectedNodeId) return;

    cy.nodes().unselect();
    const node = cy.getElementById(selectedNodeId);
    if (node) {
      node.select();
      cy.center(node);
      cy.zoom({ level: 1.5, position: node.position() });
    }
  }, [selectedNodeId]);

  // Controls
  const handleZoomIn = () => cyRef.current?.zoom(cyRef.current.zoom() * 1.2);
  const handleZoomOut = () => cyRef.current?.zoom(cyRef.current.zoom() * 0.8);
  const handleFit = () => cyRef.current?.fit(undefined, 50);
  const handleReset = () => {
    cyRef.current?.layout({ name: "cose", padding: 20 } as any).run();
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <div ref={containerRef} className="w-full h-full bg-background rounded-lg" />
      
      {/* Graph Controls */}
      <div className="absolute bottom-24 right-3 flex flex-col gap-2 sm:bottom-4 sm:right-4">
        <Button variant="secondary" size="icon" onClick={handleZoomIn} className="bg-background/60 backdrop-blur hover:bg-background/80">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon" onClick={handleZoomOut} className="bg-background/60 backdrop-blur hover:bg-background/80">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon" onClick={handleFit} className="bg-background/60 backdrop-blur hover:bg-background/80">
          <Maximize className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon" onClick={handleReset} className="bg-background/60 backdrop-blur hover:bg-background/80">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>

      {/* Legend */}
      <div className="absolute left-3 top-3 max-w-[160px] rounded-lg bg-background/60 p-2 backdrop-blur sm:left-4 sm:top-4 sm:max-w-[200px] sm:p-3">
        <p className="text-xs font-medium text-foreground/60 mb-2">Node Types</p>
        <div className="max-h-32 space-y-1 overflow-y-auto sm:max-h-none">
          {Object.entries(LABEL_COLORS).slice(0, 6).map(([label, colors]) => (
            <div key={label} className="flex items-center gap-2 text-xs">
              <div 
                className={cn("w-3 h-3 rounded-full", `node-bg-${label.toLowerCase()}`)} 
              />
              <span className="text-foreground/80">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function PlatformKnowledgeSearchBlock({
  placeholder = "Search knowledge graph...",
  maxResults = 20,
  defaultView = "graph",
  title = "Knowledge Graph Explorer",
  onNodeSelect,
  height = "500px",
}: PlatformKnowledgeSearchBlockProps) {
  const [query, setQuery] = useState("");
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);
  const [viewMode, setViewMode] = useState<"graph" | "list">(defaultView);
  const [nodeDetails, setNodeDetails] = useState<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search
  const debouncedSearch = useCallback(
    debounce(async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setGraphData({ nodes: [], edges: [] });
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/knowledge/graph/search?q=${encodeURIComponent(searchQuery)}&limit=${maxResults}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: SearchResult = await res.json();
        
        setGraphData({
          nodes: data.nodes ?? [],
          edges: data.edges ?? []
        });
      } catch (e: any) {
        setError(e.message || "Search failed");
      } finally {
        setLoading(false);
      }
    }, 300),
    [maxResults]
  );

  useEffect(() => {
    debouncedSearch(query);
  }, [query, debouncedSearch]);

  // Fetch node details
  const fetchNodeDetails = async (nodeId: string) => {
    try {
      const [detailsRes, relatedRes] = await Promise.all([
        fetch(`/api/knowledge/graph/nodes/${nodeId}`),
        fetch(`/api/knowledge/graph/nodes/${nodeId}/related`)
      ]);

      if (detailsRes.ok && relatedRes.ok) {
        const details = await detailsRes.json();
        const related = await relatedRes.json();
        setNodeDetails({ ...details, relatedNodes: related.nodes ?? [] });
      }
    } catch (e) {
      console.error("Failed to fetch node details:", e);
    }
  };

  const handleNodeClick = (node: KnowledgeNode) => {
    setSelectedNode(node);
    fetchNodeDetails(node.id);
    onNodeSelect?.(node);
  };

  const handleClear = () => {
    setQuery("");
    setGraphData({ nodes: [], edges: [] });
    setSelectedNode(null);
    setNodeDetails(null);
    inputRef.current?.focus();
  };

  return (
    <Card className="bg-background/40 border-foreground/10 backdrop-blur-xl">
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Network className="h-5 w-5 text-indigo-400" />
            <CardTitle className="text-lg font-bold text-foreground">{title}</CardTitle>
            <Badge variant="outline" className="bg-foreground/10 text-foreground/60">
              {graphData.nodes.length} nodes
            </Badge>
            <Badge variant="outline" className="bg-foreground/10 text-foreground/60">
              {graphData.edges.length} edges
            </Badge>
          </div>
          
          <ToggleGroup 
            type="single" 
            value={viewMode} 
            onValueChange={(v) => v && setViewMode(v as any)}
            className="bg-foreground/5 rounded-lg p-1"
          >
            <ToggleGroupItem value="graph" aria-label="Graph view" className="data-[state=on]:bg-foreground/20">
              <Grid3X3 className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view" className="data-[state=on]:bg-foreground/20">
              <List className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/40" />
          <Input
            ref={inputRef}
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10 pr-10 bg-foreground/5 border-foreground/10 text-foreground placeholder:text-foreground/30"
          />
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-foreground/40 hover:text-foreground"
              onClick={handleClear}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-4">
            <p className="text-rose-700 dark:text-rose-300 text-sm">{error}</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && graphData.nodes.length === 0 && (
          <div className="text-center py-12 text-foreground/30">
            <Network className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Search to explore the knowledge graph</p>
            <p className="text-sm mt-1">Find people, organizations, documents, and their relationships</p>
          </div>
        )}

        {/* Graph View */}
        {!loading && !error && graphData.nodes.length > 0 && viewMode === "graph" && (
          <KnowledgeGraph
            data={graphData}
            onNodeClick={handleNodeClick}
            selectedNodeId={selectedNode?.id}
            height={height}
          />
        )}

        {/* List View */}
        {!loading && !error && graphData.nodes.length > 0 && viewMode === "list" && (
          <ScrollArea className="h-[500px]">
            <div className="space-y-2">
              {graphData.nodes.map((node) => (
                <motion.div
                  key={node.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedNode?.id === node.id
                      ? "bg-foreground/10 border-indigo-500/50"
                      : "bg-foreground/5 border-foreground/10 hover:bg-foreground/10"
                  }`}
                  onClick={() => handleNodeClick(node)}
                >
                  <div className="flex items-start gap-3">
                    <Badge 
                      className={cn(
                        "shrink-0 text-foreground", 
                        `node-bg-${node.label.toLowerCase()}`,
                        `node-border-${node.label.toLowerCase()}`
                      )}
                    >
                      {node.label}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{node.name}</p>
                      {node.description && (
                        <p className="text-sm text-foreground/60 line-clamp-2">{node.description}</p>
                      )}
                      {node.score !== undefined && (
                        <div className="flex items-center gap-1 mt-1">
                          <Sparkles className="h-3 w-3 text-amber-400" />
                          <span className="text-xs text-foreground/40">Relevance: {(node.score * 100).toFixed(0)}%</span>
                        </div>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-foreground/40" />
                  </div>
                </motion.div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>

      {/* Node Detail Dialog */}
      <Dialog open={!!selectedNode} onOpenChange={() => setSelectedNode(null)}>
        <DialogContent className="max-w-2xl bg-card border-foreground/10 text-foreground">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <Badge 
                className={cn("text-foreground", `node-bg-${(selectedNode?.label || "").toLowerCase()}`)}
              >
                {selectedNode?.label}
              </Badge>
              <DialogTitle className="text-xl">{selectedNode?.name}</DialogTitle>
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-6">
              {/* Description */}
              {selectedNode?.description && (
                <div>
                  <h4 className="text-sm font-medium text-foreground/60 mb-2 flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    Description
                  </h4>
                  <p className="text-foreground/80">{selectedNode.description}</p>
                </div>
              )}

              {/* Properties */}
              {selectedNode?.properties && Object.keys(selectedNode.properties).length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-foreground/60 mb-2 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Properties
                  </h4>
                  <div className="bg-background/40 rounded-lg p-3 space-y-1">
                    {Object.entries(selectedNode.properties).map(([key, value]) => (
                      <div key={key} className="flex justify-between text-sm">
                        <span className="text-foreground/40">{key}</span>
                        <span className="text-foreground/80 font-mono truncate max-w-[200px]">
                          {typeof value === "string" ? value : JSON.stringify(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Related Nodes */}
              {nodeDetails?.relatedNodes && nodeDetails.relatedNodes.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-foreground/60 mb-2 flex items-center gap-2">
                    <Share2 className="h-4 w-4" />
                    Related ({nodeDetails.relatedNodes.length})
                  </h4>
                  <div className="space-y-2">
                    {nodeDetails.relatedNodes.slice(0, 5).map((node: KnowledgeNode) => (
                      <div 
                        key={node.id}
                        className="flex items-center gap-2 p-2 bg-foreground/5 rounded hover:bg-foreground/10 cursor-pointer"
                        onClick={() => handleNodeClick(node)}
                      >
                        <Badge 
                          variant="outline" 
                          className={cn("text-xs", `node-border-${node.label.toLowerCase()}`, `node-color-${node.label.toLowerCase()}`)}
                        >
                          {node.label}
                        </Badge>
                        <span className="text-sm text-foreground">{node.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Graph Edges */}
              {graphData.edges.filter(e => e.source === selectedNode?.id || e.target === selectedNode?.id).length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-foreground/60 mb-2 flex items-center gap-2">
                    <MousePointer2 className="h-4 w-4" />
                    Connections
                  </h4>
                  <div className="space-y-1">
                    {graphData.edges
                      .filter(e => e.source === selectedNode?.id || e.target === selectedNode?.id)
                      .map((edge, idx) => {
                        const isSource = edge.source === selectedNode?.id;
                        const otherId = isSource ? edge.target : edge.source;
                        const otherNode = graphData.nodes.find(n => n.id === otherId);
                        
                        return (
                          <div key={idx} className="flex items-center gap-2 text-sm">
                            <span className="text-foreground/40">{isSource ? "→" : "←"}</span>
                            <Badge variant="outline" className="text-xs border-indigo-500/30 text-indigo-700 dark:text-indigo-300">
                              {edge.relation}
                            </Badge>
                            <span className="text-foreground/60">{otherNode?.name || otherId}</span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============================================================================
// Utility: Debounce
// ============================================================================

function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}
