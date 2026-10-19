/**
 * Execution Flow Visualizer Component
 * 
 * Interactive visualization of agent execution flows using Mermaid diagrams.
 */

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Download, 
  Maximize2,
  Zap,
  Filter,
  Clock,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Plus,
  Minus,
  X,
  Search
} from "lucide-react";
import { ReactFlowRenderer } from "./ReactFlowRenderer";

// Mermaid is loaded dynamically
let mermaid: any = null;

interface ExecutionFlowProps {
  flowId?: string;
  sessionId?: string;
  agentId?: string;
  autoRefresh?: boolean;
}

async function fetchFlow(flowId: string) {
  const res = await fetch(`/api/execution-flow/${flowId}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch flow");
  return res.json();
}

async function exportFlow(flowId: string, format: "json" | "mermaid" | "dot") {
  const res = await fetch(`/api/execution-flow/${flowId}/export?format=${format}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to export flow");
  return format === "json" ? res.json() : res.text();
}

export function ExecutionFlowVisualizer({ 
  flowId, 
  sessionId, 
  agentId,
  autoRefresh = false 
}: ExecutionFlowProps) {
  const [format, setFormat] = useState<"mermaid" | "json">("mermaid");
  const [diagram, setDiagram] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [zoom, setZoom] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [scrollPos, setScrollPos] = useState({ top: 0, left: 0, maxTop: 1, maxLeft: 1 });

  // Fetch flow data
  const { data: flow, isLoading, refetch } = useQuery({
    queryKey: ["execution-flow", flowId || sessionId],
    queryFn: () => fetchFlow(flowId || sessionId!),
    enabled: !!(flowId || sessionId),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  // Load Mermaid and render diagram
  useEffect(() => {
    if (!flow) return;

    const loadAndRender = async () => {
      if (!mermaid) {
        mermaid = await import("mermaid");
        mermaid.default.initialize({
          startOnLoad: false,
          suppressErrorRendering: true,
          theme: "default",
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            curve: "basis",
          },
        });
      }

      try {
        let mermaidDiagram = await exportFlow(flow.id, "mermaid");
        
        if (searchQuery) {
            const matchedNodes = flow.nodes.filter((n: any) => 
                n.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                n.id.toLowerCase().includes(searchQuery.toLowerCase())
            );
            if (matchedNodes.length > 0) {
                mermaidDiagram += `\n    classDef highlight fill:#fef08a,stroke:#eab308,stroke-width:2px;`;
                matchedNodes.forEach((n: any) => {
                    mermaidDiagram += `\n    class ${n.id} highlight;`;
                });
            }
        }
        
        // Add highlight for anomalies (failed or slow nodes)
        const anomalousNodes = flow.nodes.filter((n: any) => 
            n.status === "failed" || (n.durationMs && n.durationMs > 5000)
        );
        if (anomalousNodes.length > 0) {
            mermaidDiagram += `\n    classDef anomaly fill:#fee2e2,stroke:#ef4444,stroke-width:2px;`;
            anomalousNodes.forEach((n: any) => {
                mermaidDiagram += `\n    class ${n.id} anomaly;`;
            });
        }
        
        setDiagram(mermaidDiagram);

        // Render
        const element = document.getElementById("mermaid-diagram");
        if (element) {
          element.innerHTML = mermaidDiagram;
          await mermaid.default.run({
            querySelector: "#mermaid-diagram",
          });

          // Add click handlers to nodes
          const nodes = element.querySelectorAll(".node");
          nodes.forEach((node: any, index: number) => {
            node.style.cursor = "pointer";
            node.onclick = () => {
              const nodeData = flow.nodes[index];
              setSelectedNode(nodeData);
            };
          });
        }
      } catch (err) {
        console.error("Failed to render diagram:", err);
      }
    };

    loadAndRender();
  }, [flow, searchQuery]);

  // Playback animation
  useEffect(() => {
    if (!isPlaying || !flow) return;

    const interval = setInterval(() => {
      setCurrentStep(prev => {
        if (prev >= flow.nodes.length - 1) {
          setIsPlaying(false);
          return 0;
        }
        return prev + 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, flow]);

  // Highlight current step during playback
  useEffect(() => {
    if (!flow) return;

    const element = document.getElementById("mermaid-diagram");
    if (element) {
      const nodes = element.querySelectorAll(".node");
      nodes.forEach((node: any, index: number) => {
        if (index === currentStep) {
          node.style.setProperty("filter", "drop-shadow(0 0 8px #3b82f6)");
          node.style.setProperty("transform", "scale(1.05)");
          node.style.setProperty("transition", "all 0.3s ease");
        } else {
          node.style.setProperty("filter", "none");
          node.style.setProperty("transform", "scale(1)");
        }
      });
    }
  }, [currentStep, flow]);

  const handleSimulate = async () => {
    const targetSessionId = sessionId || flowId || "demo-session";
    try {
      // 1. Start Flow
      await fetch("/api/execution-flow/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: targetSessionId,
          agentId: "demo-agent",
          layout: "vertical"
        }),
        credentials: "include",
      });

      // 2. Add Step
      await fetch(`/api/execution-flow/${targetSessionId}/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "action",
          label: "Start Simulation",
          description: "Simulated start of execution"
        }),
        credentials: "include",
      });

      // 3. Add Tool Call
      await fetch(`/api/execution-flow/${targetSessionId}/tool-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "web_search",
          args: { query: "Oddjob Mach 3" },
          output: "Found 10 results"
        }),
        credentials: "include",
      });

      // 4. Add Success
      await fetch(`/api/execution-flow/${targetSessionId}/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "action",
          label: "Success",
          description: "Simulation completed"
        }),
        credentials: "include",
      });

      // Refresh
      refetch();
    } catch (err) {
      console.error("Failed to simulate flow:", err);
    }
  };

  const handleDownload = async () => {
    if (!flow) return;
    
    const content = await exportFlow(flow.id, format);
    const blob = new Blob([typeof content === "string" ? content : JSON.stringify(content, null, 2)], {
      type: format === "json" ? "application/json" : "text/plain",
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `execution-flow-${flow.id}.${format === "json" ? "json" : "mmd"}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!flow) {
    return (
      <div className="text-center p-8 text-muted-foreground">
        <p>No execution flow data available</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-lg">Execution Flow</h2>
          <p className="text-sm text-muted-foreground">
            {flow.nodes.length} nodes • {flow.stats.totalSteps} steps • {flow.status}
          </p>
        </div>
        
        <div className="flex items-center gap-1">
          {/* Playback controls */}
          <button
            onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
            className="p-2 rounded-lg hover:bg-muted disabled:opacity-50"
            title="Step Backward"
            disabled={currentStep === 0}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-2 rounded-lg hover:bg-muted"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
          
          <button
            onClick={() => setCurrentStep(prev => Math.min(flow.nodes.length - 1, prev + 1))}
            className="p-2 rounded-lg hover:bg-muted disabled:opacity-50"
            title="Step Forward"
            disabled={currentStep === flow.nodes.length - 1}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          
          <button
            onClick={() => setCurrentStep(0)}
            className="p-2 rounded-lg hover:bg-muted"
            title="Reset"
          >
            <RotateCcw className="w-5 h-5" />
          </button>

          <div className="w-px h-6 bg-muted mx-1" />
          
          {/* Zoom controls */}
          <button
            onClick={() => setZoom(prev => Math.max(0.5, prev - 0.1))}
            className="p-2 rounded-lg hover:bg-muted"
            title="Zoom Out"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="text-xs min-w-[35px] text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(prev => Math.min(2, prev + 0.1))}
            className="p-2 rounded-lg hover:bg-muted"
            title="Zoom In"
          >
            <Plus className="w-4 h-4" />
          </button>

          {/* Search input */}
          <div className="relative flex items-center">
              <Search className="w-4 h-4 text-muted-foreground absolute left-2" />
              <input
                  type="text"
                  placeholder="Search nodes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-8 py-1 border border-border rounded-lg text-sm w-40 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {searchQuery && (
                  <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 text-muted-foreground hover:text-muted-foreground"
                      title="Clear search"
                  >
                      <X className="w-4 h-4" />
                  </button>
              )}
          </div>

          <div className="w-px h-6 bg-muted mx-1" />

          {/* Format toggle */}
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as any)}
            className="px-3 py-1 border border-border rounded-lg text-sm"
            title="Diagram Format"
          >
            <option value="mermaid">Mermaid</option>
            <option value="json">JSON</option>
          </select>

          <button
            onClick={handleDownload}
            className="p-2 rounded-lg hover:bg-muted"
            title="Download"
          >
            <Download className="w-5 h-5" />
          </button>

          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg hover:bg-muted"
            title="Refresh"
          >
            <RotateCcw className="w-5 h-5" />
          </button>

          <button
            onClick={handleSimulate}
            className="p-2 rounded-lg hover:bg-muted text-blue-600"
            title="Simulate Flow"
          >
            <Zap className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="px-4 py-2 bg-muted border-b border-border flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span>{(flow.stats.totalDurationMs / 1000).toFixed(1)}s</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Reflections:</span>
          <span>{flow.stats.reflections}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Corrections:</span>
          <span>{flow.stats.corrections}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Tool calls:</span>
          <span>{flow.stats.toolCalls}</span>
        </div>
        {flow.stats.errors > 0 && (
          <div className="flex items-center gap-2 text-red-600">
            <XCircle className="w-4 h-4" />
            <span>{flow.stats.errors} errors</span>
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex">
        {/* Diagram Wrapper */}
        <div className="flex-1 relative">
            <div 
              className="p-4 overflow-auto min-h-96 max-h-[600px]"
              onScroll={(e) => {
                const target = e.currentTarget;
                setScrollPos({
                  top: target.scrollTop,
                  left: target.scrollLeft,
                  maxTop: target.scrollHeight - target.clientHeight || 1,
                  maxLeft: target.scrollWidth - target.clientWidth || 1
                });
              }}
            >
              <style>{`
                .zoomed-diagram {
                  transform: scale(${zoom});
                  transform-origin: center center;
                  transition: transform 0.2s ease;
                }
              `}</style>
              
              {flow.nodes.length >= 50 ? (
                <ReactFlowRenderer 
                  flow={flow} 
                  selectedNodeId={selectedNode?.id}
                  onNodeSelect={setSelectedNode}
                />
              ) : (
                <div 
                  id="mermaid-diagram" 
                  className="flex items-center justify-center min-h-80 zoomed-diagram"
                >
                  {!diagram && (
                    <div className="text-muted-foreground">Loading diagram...</div>
                  )}
                </div>
              )}
            </div>
            
            {/* Mini-Map */}
            <div className="absolute bottom-4 right-4 hidden h-24 w-32 select-none overflow-hidden rounded-lg border border-border bg-foreground/90 p-1.5 text-[10px] shadow-lg backdrop-blur-sm z-20 sm:block">
                <p className="text-muted-foreground mb-0.5 font-medium">Viewport</p>
                <div className="relative w-full h-16 bg-muted border border-border rounded overflow-hidden">
                    {/* Simulated nodes and edges */}
                    <div className="absolute top-2 left-2 w-2 h-2 bg-muted rounded-sm" />
                    <div className="absolute top-2 left-8 w-2 h-2 bg-muted rounded-sm" />
                    <div className="absolute top-6 left-5 w-2 h-2 bg-muted rounded-sm" />
                    <div className="absolute top-10 left-1 w-2 h-2 bg-muted rounded-sm" />
                    <div className="absolute top-10 left-10 w-2 h-2 bg-muted rounded-sm" />
                    <svg className="absolute inset-0 w-full h-full stroke-gray-200 stroke-[0.5]">
                        <line x1="10%" y1="15%" x2="40%" y2="15%" />
                        <line x1="40%" y1="15%" x2="25%" y2="40%" />
                        <line x1="25%" y1="40%" x2="5%" y2="65%" />
                        <line x1="25%" y1="40%" x2="50%" y2="65%" />
                    </svg>
                    
                    {/* Viewport box */}
                    <style>{`
                      .viewport-box {
                        top: ${(scrollPos.top / (scrollPos.maxTop || 1)) * 70}%;
                        left: ${(scrollPos.left / (scrollPos.maxLeft || 1)) * 70}%;
                        width: 30%;
                        height: 30%;
                      }
                    `}</style>
                    <div className="absolute border border-blue-500 bg-blue-500/10 viewport-box" />
                </div>
            </div>
        </div>

        {/* Sidebar */}
        <div className="w-80 border-l border-border bg-muted">
          {selectedNode ? (
            <div className="p-4">
              <h3 className="font-semibold mb-3">Node Details</h3>
              
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Type:</span>
                  <span className="ml-2 font-medium capitalize">{selectedNode.type}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Label:</span>
                  <span className="ml-2">{selectedNode.label}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <span className={`ml-2 px-2 py-1 rounded-full text-xs ${
                    selectedNode.status === "completed" ? "bg-green-100 text-green-700" :
                    selectedNode.status === "failed" ? "bg-red-100 text-red-700" :
                    selectedNode.status === "running" ? "bg-blue-100 text-blue-700" :
                    "bg-muted text-foreground"
                  }`}>
                    {selectedNode.status}
                  </span>
                </div>
                {selectedNode.description && (
                  <div>
                    <span className="text-muted-foreground">Description:</span>
                    <p className="mt-1 text-foreground">{selectedNode.description}</p>
                  </div>
                )}
                {selectedNode.durationMs && (
                  <div>
                    <span className="text-muted-foreground">Duration:</span>
                    <span className="ml-2">{(selectedNode.durationMs / 1000).toFixed(2)}s</span>
                  </div>
                )}
                {selectedNode.metadata && Object.keys(selectedNode.metadata).length > 0 && (
                  <div>
                    <span className="text-muted-foreground">Metadata:</span>
                    <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto">
                      {JSON.stringify(selectedNode.metadata, null, 2)}
                    </pre>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Timestamp:</span>
                  <span className="ml-2">{new Date(selectedNode.timestamp).toLocaleString()}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              <Maximize2 className="w-12 h-12 mx-auto mb-3" />
              <p>Click a node to view details</p>
            </div>
          )}
        </div>
      </div>

      {/* Step indicator */}
      {isPlaying && (
        <div className="px-4 py-2 bg-blue-50 border-t border-blue-200">
          <style>{`
            .playback-progress-bar {
              width: ${((currentStep + 1) / flow.nodes.length) * 100}%;
            }
          `}</style>
          <div className="flex items-center gap-2">
            <span className="text-sm text-blue-700">Playing:</span>
            <span className="text-sm font-medium">{currentStep + 1} / {flow.nodes.length}</span>
            <div className="flex-1 h-2 bg-blue-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all playback-progress-bar"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
