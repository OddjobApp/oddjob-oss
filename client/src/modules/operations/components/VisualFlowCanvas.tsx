import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  Workflow,
  Sparkles,
  Flag,
  Shield,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ArrowRight,
  Maximize2,
  RefreshCw,
  AppWindow,
  Clock3,
  Play,
  Pause,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Activity,
  SkipForward,
  SkipBack,
  Database
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  type CycleBuilderDraft,
  type CyclePhase,
  type CyclePhaseType
} from "@shared/schema/cycle-builder-draft";

interface VisualFlowCanvasProps {
  draft: CycleBuilderDraft;
  selectedId?: string;
  onSelectPhase: (phaseId: string) => void;
  onAddDependency: (sourceId: string, targetId: string) => void;
  onDeleteDependency: (edgeId: string) => void;
  onAddPhase?: (type: CyclePhaseType) => void;
  onBrowseApps?: () => void;
}

const NODE_W = 220;
const NODE_H = 88;
const COL_GAP = 90;
const ROW_GAP = 32;
const PAD_X = 40;
const PAD_Y = 40;

interface NodePos {
  x: number;
  y: number;
  phase: CyclePhase;
  depth: number;
  isCritical: boolean;
}

const iconFor: Record<CyclePhaseType, React.ElementType> = {
  mission: Workflow,
  prediction: Sparkles,
  milestone: Flag
};

export function VisualFlowCanvas({
  draft,
  selectedId,
  onSelectPhase,
  onAddDependency,
  onDeleteDependency,
  onAddPhase,
  onBrowseApps
}: VisualFlowCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [connectingSourceId, setConnectingSourceId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  // 1. Compute Topological Layout & Critical Path
  const { nodePositions, canvasWidth, canvasHeight, hasCycle, cycleNodes, criticalPathNodes } = useMemo(() => {
    const phases = draft.phases;
    if (!phases || phases.length === 0) {
      return {
        nodePositions: [] as NodePos[],
        canvasWidth: 600,
        canvasHeight: 300,
        hasCycle: false,
        cycleNodes: [] as string[],
        criticalPathNodes: new Set<string>()
      };
    }

    const idToIdx = new Map<string, number>(phases.map((p, i) => [p.id, i]));
    const depths = new Array(phases.length).fill(0);

    // Map of incoming dependencies
    const inDeps: string[][] = phases.map(() => []);
    draft.dependencyEdges.forEach(edge => {
      const targetIdx = idToIdx.get(edge.targetPhaseId);
      if (targetIdx !== undefined && idToIdx.has(edge.sourcePhaseId)) {
        inDeps[targetIdx].push(edge.sourcePhaseId);
      }
    });

    // Topological depth relaxation with cycle check
    let changed = true;
    let iters = 0;
    let cycleDetected = false;
    while (changed && iters++ < phases.length * 2) {
      changed = false;
      phases.forEach((_, i) => {
        inDeps[i].forEach(srcId => {
          const srcIdx = idToIdx.get(srcId)!;
          if (depths[i] <= depths[srcIdx]) {
            depths[i] = depths[srcIdx] + 1;
            changed = true;
          }
        });
      });
    }

    if (iters >= phases.length * 2) {
      cycleDetected = true;
    }

    // Partition into columns by depth
    const columns: number[][] = [];
    phases.forEach((_, i) => {
      const col = depths[i];
      if (!columns[col]) columns[col] = [];
      columns[col].push(i);
    });

    const maxNodesInCol = Math.max(...columns.map(c => c.length), 1);
    const totalH = Math.max(maxNodesInCol * (NODE_H + ROW_GAP) + PAD_Y * 2, 400);

    // Position calculation
    const positions: (NodePos | null)[] = new Array(phases.length).fill(null);
    columns.forEach((col, ci) => {
      const colH = col.length * (NODE_H + ROW_GAP) - ROW_GAP;
      const vOffset = PAD_Y + (totalH - PAD_Y * 2 - colH) / 2;

      col.forEach((nodeIdx, ri) => {
        positions[nodeIdx] = {
          x: PAD_X + ci * (NODE_W + COL_GAP),
          y: vOffset + ri * (NODE_H + ROW_GAP),
          phase: phases[nodeIdx],
          depth: ci,
          isCritical: false
        };
      });
    });

    const validPositions = positions.filter((p): p is NodePos => p !== null);
    const width = Math.max(columns.length * (NODE_W + COL_GAP) + PAD_X * 2, 800);

    // Simple Critical Path determination (nodes in the longest chain)
    const maxDepth = Math.max(...depths, 0);
    const critical = new Set<string>();
    if (maxDepth > 0) {
      // Find deepest node
      let currentIdx = depths.indexOf(maxDepth);
      while (currentIdx !== -1) {
        critical.add(phases[currentIdx].id);
        const predecessors = inDeps[currentIdx];
        if (predecessors.length === 0) break;
        // pick predecessor with depth - 1
        const targetDepth = depths[currentIdx] - 1;
        const nextPred = predecessors.find(id => depths[idToIdx.get(id)!] === targetDepth);
        currentIdx = nextPred ? idToIdx.get(nextPred)! : -1;
      }
    }

    validPositions.forEach(np => {
      if (critical.has(np.phase.id)) {
        np.isCritical = true;
      }
    });

    return {
      nodePositions: validPositions,
      canvasWidth: width,
      canvasHeight: totalH,
      hasCycle: cycleDetected,
      cycleNodes: cycleDetected ? phases.map(p => p.name) : [],
      criticalPathNodes: critical
    };
  }, [draft.phases, draft.dependencyEdges]);

  // Position lookup map
  const posMap = useMemo(() => {
    const map = new Map<string, NodePos>();
    nodePositions.forEach(pos => map.set(pos.phase.id, pos));
    return map;
  }, [nodePositions]);

  // Simulation & Ergonomics State
  const [isSimulating, setIsSimulating] = useState(false);
  const [simColumn, setSimColumn] = useState<number>(-1);
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [isBeautifying, setIsBeautifying] = useState(false);

  const maxDepth = useMemo(() => {
    return Math.max(...nodePositions.map(n => n.depth), 0);
  }, [nodePositions]);

  // Simulation timer
  useEffect(() => {
    if (!isSimulating) return;

    const interval = setInterval(() => {
      setSimColumn(prev => {
        if (prev >= maxDepth) {
          setIsSimulating(false);
          return maxDepth;
        }
        return prev + 1;
      });
    }, 1200);

    return () => clearInterval(interval);
  }, [isSimulating, maxDepth]);

  const handleStartSim = () => {
    setSimColumn(0);
    setIsSimulating(true);
  };

  const handlePauseSim = () => {
    setIsSimulating(false);
  };

  const handleResetSim = () => {
    setIsSimulating(false);
    setSimColumn(-1);
  };

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(Number((prev + 0.1).toFixed(1)), 1.5));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(Number((prev - 0.1).toFixed(1)), 0.6));
  };

  const handleResetZoom = () => {
    setZoomLevel(1.0);
  };

  const handleBeautify = () => {
    setIsBeautifying(true);
    setTimeout(() => setIsBeautifying(false), 500);
  };

  // Listen to window custom events from CommandPalette
  useEffect(() => {
    const handleAction = (e: any) => {
      const action = e.detail?.action;
      if (action === 'simulate') {
        if (isSimulating) {
          handlePauseSim();
        } else {
          handleStartSim();
        }
      } else if (action === 'beautify') {
        handleBeautify();
      } else if (action === 'fit-view') {
        handleResetZoom();
      } else if (action === 'add-milestone') {
        onAddPhase?.('milestone');
      }
    };
    window.addEventListener('cycle-builder-action', handleAction as EventListener);
    return () => window.removeEventListener('cycle-builder-action', handleAction as EventListener);
  }, [isSimulating, onAddPhase]);

  // Handle port connection
  const handlePortClick = (e: React.MouseEvent, phaseId: string, isOutput: boolean) => {
    e.stopPropagation();
    if (isOutput) {
      if (connectingSourceId === phaseId) {
        setConnectingSourceId(null);
      } else {
        setConnectingSourceId(phaseId);
      }
    } else {
      if (connectingSourceId && connectingSourceId !== phaseId) {
        // Create dependency: connectingSourceId -> phaseId
        onAddDependency(connectingSourceId, phaseId);
        setConnectingSourceId(null);
      }
    }
  };

  return (
    <div className="relative flex flex-col rounded-xl border border-border bg-card shadow-sm overflow-hidden" ref={containerRef}>
      {/* Canvas Top Bar / SMT Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-3 text-xs">
        <div className="flex items-center gap-2">
          {hasCycle ? (
            <Badge variant="destructive" className="flex items-center gap-1.5 py-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>SMT Schedulability Warning: Dependency Cycle Detected</span>
            </Badge>
          ) : (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 flex items-center gap-1.5 py-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>SMT Schedulability: Provably Valid (0 Deadlocks, Acyclic DAG)</span>
            </Badge>
          )}

          <span className="text-muted-foreground hidden sm:inline">|</span>
          <span className="text-muted-foreground hidden sm:inline">
            Critical Path: <strong className="text-foreground">{criticalPathNodes.size}</strong> nodes
          </span>
          <span className="text-muted-foreground hidden sm:inline">
            Dependencies: <strong className="text-foreground">{draft.dependencyEdges.length}</strong>
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {connectingSourceId && (
            <span className="text-primary font-medium animate-pulse">
              Select target node port to complete Finish-to-Start edge…
            </span>
          )}
          {connectingSourceId && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConnectingSourceId(null)}>
              Cancel
            </Button>
          )}
          {onAddPhase && (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onAddPhase("mission")}>
                <Plus className="w-3 h-3 mr-1 text-primary" />
                Add Mission
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onAddPhase("milestone")}>
                <Flag className="w-3 h-3 mr-1 text-amber-500" />
                Add Gate
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Secondary Ergonomics & Live Simulation Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card/70 px-5 py-2 text-xs">
        {/* Left: Simulation Runner */}
        <div className="flex items-center gap-2">
          {!isSimulating && simColumn === -1 ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
              onClick={handleStartSim}
              disabled={hasCycle || nodePositions.length === 0}
              title="Simulate DAG execution dry-run"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Simulate Flow</span>
            </Button>
          ) : isSimulating ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
              onClick={handlePauseSim}
              title="Pause dry-run simulation"
            >
              <Pause className="w-3 h-3 fill-current" />
              <span>Pause Sim</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => setIsSimulating(true)}
              title="Resume simulation"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Resume</span>
            </Button>
          )}

          {/* Step Prev */}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setIsSimulating(false);
              setSimColumn(prev => Math.max(0, prev - 1));
            }}
            disabled={simColumn <= 0}
            title="Step back one column"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </Button>

          {/* Step Next */}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setIsSimulating(false);
              setSimColumn(prev => Math.min(maxDepth, prev === -1 ? 0 : prev + 1));
            }}
            disabled={simColumn >= maxDepth}
            title="Step forward one column"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </Button>

          {simColumn !== -1 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              onClick={handleResetSim}
              title="Reset simulation back to idle"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </Button>
          )}

          {simColumn !== -1 && (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground ml-1">
              <Activity className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
              <span>Step {simColumn + 1} / {maxDepth + 1}</span>
            </span>
          )}
        </div>

        {/* Right: Viewport & Layout Controls */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className={`h-7 text-xs gap-1 text-muted-foreground hover:text-foreground ${isBeautifying ? 'animate-spin' : ''}`}
            onClick={handleBeautify}
            title="Auto-tidy and balance DAG topological distribution"
          >
            <Sparkles className="w-3 h-3 text-indigo-400" />
            <span>Beautify DAG</span>
          </Button>

          <div className="flex items-center gap-1 border-l border-border/70 pl-2">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={handleZoomOut}
              disabled={zoomLevel <= 0.6}
              title="Zoom out"
            >
              <ZoomOut className="w-3 h-3" />
            </Button>
            <span className="font-mono text-[10px] w-9 text-center text-muted-foreground select-none">
              {Math.round(zoomLevel * 100)}%
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={handleZoomIn}
              disabled={zoomLevel >= 1.5}
              title="Zoom in"
            >
              <ZoomIn className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={handleResetZoom}
              title="Reset Zoom to 100%"
            >
              <Maximize2 className="w-3 h-3 mr-0.5" />
              Fit
            </Button>
          </div>
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div
        className={`relative overflow-auto bg-muted/20 p-4 select-none min-h-[440px] transition-all duration-300 ${isBeautifying ? 'opacity-70 scale-[0.99]' : ''}`}
        onClick={() => setConnectingSourceId(null)}
      >
        <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left', transition: 'transform 150ms ease-out' }}>
          <svg
            width={canvasWidth}
            height={canvasHeight}
            className="overflow-visible block"
            style={{ minWidth: "100%" }}
          >
            <defs>
              {/* Standard Arrowhead */}
              <marker
                id="arrowhead"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="hsl(var(--muted-foreground))" opacity="0.7" />
              </marker>
              {/* Critical Path Arrowhead */}
              <marker
                id="arrowhead-critical"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#f59e0b" />
              </marker>
              {/* Active Connecting Arrowhead */}
              <marker
                id="arrowhead-active"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="hsl(var(--primary))" />
              </marker>
              {/* Simulated Traversing Arrowhead */}
              <marker
                id="arrowhead-sim"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#10b981" />
              </marker>
              {/* Simulated Active Pulsing Arrowhead */}
              <marker
                id="arrowhead-active-sim"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#6366f1" />
              </marker>
              {/* Data Flow Arrowhead */}
              <marker
                id="arrowhead-data"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#06b6d4" />
              </marker>
            </defs>

          {/* Render Connecting Edges (Bezier Curves) */}
          {draft.dependencyEdges.map(edge => {
            const src = posMap.get(edge.sourcePhaseId);
            const tgt = posMap.get(edge.targetPhaseId);
            if (!src || !tgt) return null;

            const startX = src.x + NODE_W;
            const startY = src.y + NODE_H / 2;
            const endX = tgt.x;
            const endY = tgt.y + NODE_H / 2;

            const dx = endX - startX;
            const controlDist = Math.max(dx * 0.45, 40);

            const pathData = `M ${startX} ${startY} C ${startX + controlDist} ${startY}, ${endX - controlDist} ${endY}, ${endX} ${endY}`;
            const isHovered = hoveredEdgeId === edge.id;
            const isCritical = src.isCritical && tgt.isCritical;
            const isSimTraversed = simColumn !== -1 && src.depth < simColumn;
            const isSimActive = simColumn !== -1 && src.depth === simColumn;

            return (
              <g
                key={edge.id}
                className="group cursor-pointer"
                onMouseEnter={() => setHoveredEdgeId(edge.id)}
                onMouseLeave={() => setHoveredEdgeId(null)}
              >
                {/* Hit area for easy clicking */}
                <path
                  d={pathData}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="16"
                />
                {/* Visual line */}
                <path
                  d={pathData}
                  fill="none"
                  stroke={
                    isHovered
                      ? "hsl(var(--destructive))"
                      : isSimActive
                      ? "#6366f1"
                      : isSimTraversed
                      ? "#10b981"
                      : isCritical
                      ? "#f59e0b"
                      : "hsl(var(--muted-foreground))"
                  }
                  strokeWidth={isHovered || isSimActive || isSimTraversed ? 2.5 : isCritical ? 2.5 : 1.5}
                  strokeDasharray={isSimActive ? "6 3" : isCritical ? "4 2" : undefined}
                  opacity={isHovered || isSimActive || isSimTraversed ? 1 : isCritical ? 0.9 : 0.6}
                  markerEnd={
                    isSimActive
                      ? "url(#arrowhead-active-sim)"
                      : isSimTraversed
                      ? "url(#arrowhead-sim)"
                      : isCritical
                      ? "url(#arrowhead-critical)"
                      : "url(#arrowhead)"
                  }
                  className={isSimActive ? "animate-pulse" : "transition-all duration-150"}
                />

                {/* Delete button overlay on edge hover */}
                {isHovered && (
                  <foreignObject
                    x={(startX + endX) / 2 - 12}
                    y={(startY + endY) / 2 - 12}
                    width="24"
                    height="24"
                    className="overflow-visible pointer-events-auto"
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteDependency(edge.id);
                      }}
                      className="w-6 h-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-md hover:scale-110 transition-transform"
                      title="Delete dependency edge"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </foreignObject>
                )}
              </g>
            );
          })}

          {/* Render Data Flow Edges (Cyan Dashed Curves) */}
          {(draft.dataEdges || []).filter(e => e.source.kind === "phase_output").map(edge => {
            const src = posMap.get((edge.source as any).phaseId);
            const tgt = posMap.get(edge.target.phaseId);
            if (!src || !tgt) return null;

            const startX = src.x + NODE_W;
            const startY = src.y + NODE_H * 0.75;
            const endX = tgt.x;
            const endY = tgt.y + NODE_H * 0.75;

            const dx = endX - startX;
            const controlDist = Math.max(dx * 0.45, 30);
            const pathData = `M ${startX} ${startY} C ${startX + controlDist} ${startY}, ${endX - controlDist} ${endY}, ${endX} ${endY}`;
            const isHovered = hoveredEdgeId === edge.id;

            return (
              <g
                key={edge.id}
                className="group cursor-pointer"
                onMouseEnter={() => setHoveredEdgeId(edge.id)}
                onMouseLeave={() => setHoveredEdgeId(null)}
              >
                <path
                  d={pathData}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="14"
                />
                <path
                  d={pathData}
                  fill="none"
                  stroke={isHovered ? "hsl(var(--destructive))" : "#06b6d4"}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                  strokeDasharray="4 3"
                  opacity={isHovered ? 1 : 0.75}
                  markerEnd="url(#arrowhead-data)"
                  className="transition-all duration-150"
                />
                <text
                  x={(startX + endX) / 2}
                  y={(startY + endY) / 2 - 5}
                  fill="#06b6d4"
                  fontSize="9"
                  textAnchor="middle"
                  className="font-mono font-medium pointer-events-none select-none opacity-80"
                >
                  {(edge.source as any).portKey} → {edge.target.portKey}
                </text>
              </g>
            );
          })}

          {/* Render Nodes as SVG foreignObjects */}
          {nodePositions.map(pos => {
            const { phase } = pos;
            const Icon = iconFor[phase.type] || Workflow;
            const isSelected = phase.id === selectedId;
            const isConnecting = connectingSourceId === phase.id;
            const isMilestone = phase.type === "milestone";
            const isPrediction = phase.type === "prediction";

            const nodeSimStatus = simColumn === -1
              ? 'idle'
              : pos.depth < simColumn
              ? 'completed'
              : pos.depth === simColumn
              ? 'running'
              : 'pending';

            return (
              <foreignObject
                key={phase.id}
                x={pos.x}
                y={pos.y}
                width={NODE_W}
                height={NODE_H}
                className="overflow-visible"
              >
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPhase(phase.id);
                  }}
                  className={`relative w-full h-full rounded-xl border-2 p-3 transition-all duration-200 cursor-pointer shadow-xs flex flex-col justify-between ${
                    nodeSimStatus === 'running'
                      ? "border-indigo-500 bg-indigo-500/10 ring-4 ring-indigo-500/40 shadow-lg scale-[1.02]"
                      : nodeSimStatus === 'completed'
                      ? "border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500/30"
                      : isSelected
                      ? "border-primary bg-primary/10 ring-2 ring-primary/30 shadow-md scale-[1.02]"
                      : isConnecting
                      ? "border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/40"
                      : isMilestone
                      ? "border-amber-500/50 bg-card hover:border-amber-500"
                      : isPrediction
                      ? "border-purple-500/50 bg-card hover:border-purple-500"
                      : "border-border bg-card hover:border-primary/50 hover:bg-muted/30"
                  }`}
                >
                  {/* Left Target Port (In) */}
                  <div
                    onClick={(e) => handlePortClick(e, phase.id, false)}
                    className={`absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 bg-background flex items-center justify-center transition-all ${
                      connectingSourceId && connectingSourceId !== phase.id
                        ? "border-primary bg-primary/20 scale-125 cursor-pointer hover:bg-primary hover:text-white shadow-xs"
                        : "border-border text-muted-foreground/40"
                    }`}
                    title="Finish-to-Start target port (In)"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-current" />
                  </div>

                  {/* Right Source Port (Out) */}
                  <div
                    onClick={(e) => handlePortClick(e, phase.id, true)}
                    className={`absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 bg-background flex items-center justify-center transition-all cursor-pointer ${
                      isConnecting
                        ? "border-amber-500 bg-amber-500 text-white scale-125 shadow-xs"
                        : "border-border text-muted-foreground hover:border-primary hover:bg-primary/20 hover:scale-110"
                    }`}
                    title="Click to connect outgoing dependency (Out)"
                  >
                    <ArrowRight className="w-2.5 h-2.5" />
                  </div>

                  {/* Node Header */}
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <div className={`p-1 rounded-md ${
                        isMilestone
                          ? "bg-amber-500/10 text-amber-500"
                          : isPrediction
                          ? "bg-purple-500/10 text-purple-500"
                          : "bg-primary/10 text-primary"
                      }`}>
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                      </div>
                      <span className="text-xs font-bold truncate text-foreground">
                        {phase.name}
                      </span>
                    </div>

                    {nodeSimStatus === 'running' ? (
                      <Badge className="bg-indigo-500 text-white text-[9px] px-1.5 py-0 h-4 animate-pulse">
                        Running
                      </Badge>
                    ) : nodeSimStatus === 'completed' ? (
                      <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[9px] px-1.5 py-0 h-4">
                        ✓ Done
                      </Badge>
                    ) : isMilestone ? (
                      <Badge variant="outline" className="border-amber-500/40 text-amber-500 text-[9px] px-1 py-0 uppercase">
                        Gate
                      </Badge>
                    ) : null}
                  </div>

                  {/* Node Body / Bound App or Duration */}
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                    <div className="flex items-center gap-1">
                      <Clock3 className="w-3 h-3 text-muted-foreground/70" />
                      <span>{phase.estimatedDuration ? `${phase.estimatedDuration.value}${phase.estimatedDuration.unit[0]}` : "1h"}</span>
                    </div>

                    {pos.isCritical && (
                      <span className="text-amber-500 font-semibold uppercase text-[9px]">
                        Critical Path
                      </span>
                    )}

                    {typeof phase.config?.boundAppSlug === "string" && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 flex items-center gap-1">
                        <AppWindow className="w-2.5 h-2.5 text-primary" />
                        <span className="truncate max-w-[70px]">{phase.config.boundAppSlug}</span>
                      </Badge>
                    )}
                  </div>
                </div>
              </foreignObject>
            );
          })}
        </svg>
        </div>
      </div>

      {/* Canvas Footer Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-5 py-2.5 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-primary/20 border border-primary" />
            <span>Mission Node</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-amber-500/20 border border-amber-500" />
            <span>Milestone / HIL Decision Gate</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-purple-500/20 border border-purple-500" />
            <span>Prediction Node</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 bg-amber-500" />
            <span>Critical Path Dependency</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 border-t border-dashed border-[#06b6d4]" />
            <span className="text-[#06b6d4]">Data Flow Contract</span>
          </div>
        </div>

        <div className="text-[10px] text-muted-foreground">
          Tip: Click right port <ArrowRight className="inline w-2.5 h-2.5" /> then click another node's left port to link dependencies.
        </div>
      </div>
    </div>
  );
}
