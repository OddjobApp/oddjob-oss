import React, { useCallback, useMemo, useEffect } from 'react';
import ReactFlow, {
  useNodesState,
  useEdgesState,
  addEdge,
  Node,
  Edge,
  Connection,
  MarkerType,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  NodeProps,
  useReactFlow,
  ReactFlowInstance,
  ReactFlowProvider,
  Panel
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Database, MoreHorizontal, Play, CheckCircle, AlertCircle, Clock, Diamond, Circle, Square, Zap, Globe, GitBranch, Repeat, Split, Terminal, Bot, FileText, ShieldAlert, ShieldCheck, Activity } from 'lucide-react';
import { useDataFlowVisualization } from '@domain-ui/pipeline/ui/modules/pipelines/hooks/useDataFlowVisualization';
import { DataFlowEdge } from './DataFlowEdge.js';
import { cn } from '@/lib/utils';
import { toast } from '@domain-ui/core/ui/hooks/use-toast';
import { FormStep, Job } from './types.js';
import dagre from 'dagre';

// --- RICH PIPELINE NODE COMPONENT (BPMN STYLED) ---
const PipelineNode = ({ data, selected }: NodeProps) => {
  // Determine shape based on type
  // Trigger/Start -> Circle
  // Decision -> Diamond
  // Task -> Rounded Rect
  const isStart = data.type === 'trigger' || data.type === 'webhook';
  const isDecision = data.type === 'logic_gatekeeper' || data.type === 'decision';
  const isEnd = data.type === 'end';

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-emerald-500';
      case 'running': return 'text-blue-500';
      case 'error': return 'text-red-500';
      default: return 'text-foreground/70';
    }
  };

  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-3 h-3 text-emerald-500" />;
      case 'running': return <Clock className="w-3 h-3 text-blue-500 animate-pulse" />;
      case 'error': return <AlertCircle className="w-3 h-3 text-red-500" />;
      default: return null;
    }
  };

  // Determine job type for icon
  const getJobIcon = (type: string) => {
    switch (type) {
      case 'ai_api_call': return <Bot className="w-4 h-4" />;
      case 'sql_query': return <Database className="w-4 h-4" />;
      case 'selenium': return <Globe className="w-4 h-4" />;
      case 'python':
      case 'node_script': return <Terminal className="w-4 h-4" />;
      case 'transformer': return <Zap className="w-4 h-4" />;
      case 'logic_gatekeeper':
      case 'decision': return <GitBranch className="w-4 h-4" />;
      case 'iterator': return <Repeat className="w-4 h-4" />;
      case 'router': return <Split className="w-4 h-4" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  const getIconColorClass = (type: string) => {
    switch (type) {
      case 'ai_api_call': return 'bg-green-500 text-green-600';
      case 'sql_query': return 'bg-blue-500 text-blue-600';
      case 'logic_gatekeeper':
      case 'decision': return 'bg-orange-500/10 text-orange-500';
      case 'iterator': return 'bg-blue-500/10 text-blue-500';
      case 'router': return 'bg-purple-500/10 text-purple-500';
      default: return 'bg-gray-500 text-muted-foreground';
    }
  };


  // BPMN Start Event (Circle / Pill)
  if (isStart) {
    return (
      <div className={cn(
        "relative w-[200px] h-[80px] rounded-full border-2 flex items-center justify-center bg-card shadow-sm transition-all",
        selected ? "border-primary ring-2 ring-primary/30" : "border-emerald-500",
        "group"
      )}>
        <Play className="w-8 h-8 text-emerald-500 ml-0.5" />
        {/* Label inside for uniform width look, or centered below */}
        <div className="absolute -bottom-6 w-full text-center text-[10px] font-medium text-muted-foreground truncate px-2">
          {data.label}
        </div>
        <Handle type="source" position={Position.Right} className="!opacity-0" />
      </div>
    );
  }

  // BPMN Sub-Process / Task (Rounded Rect)
  return (
    <div
      className={cn(
        "relative w-[210px] h-[90px] rounded-xl border-2 glass-panel shadow-lg transition-all duration-300 group flex flex-col justify-center overflow-hidden",
        selected ? "border-primary ring-4 ring-primary/20 scale-105" : isDecision ? "border-amber-400/50" : "border-white/20"
      )}
    >
      {/* Resiliency Indicators */}
      <div className="absolute top-2 right-2 flex gap-1 z-20">
        {data.circuitBreaker === 'open' ? (
          <div className="bg-red-500/10 p-1 rounded shadow-inner" title="Circuit Breaker Open">
            <ShieldAlert className="w-3 h-3 text-red-500 animate-pulse" />
          </div>
        ) : (
          <div className="bg-green-500/10 p-1 rounded opacity-30" title="Resiliency Active">
            <ShieldCheck className="w-3 h-3 text-green-500" />
          </div>
        )}
        {data.tracingEnabled && (
          <div className="bg-blue-500/10 p-1 rounded" title="Forensic Tracing Active">
            <Activity className="w-3 h-3 text-blue-500 animate-pulse" />
          </div>
        )}
      </div>

      {isDecision && (
        <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-white dark:bg-card border-b-2 border-l-2 border-amber-400 rotate-45 z-10" />
      )}

      {/* Body */}
      <div className="px-4 flex flex-col gap-1.5 items-start w-full relative z-10">
        <div className="flex items-center w-full justify-between gap-3">
          {/* Icon */}
          <div className={cn("p-2 rounded-lg bg-opacity-20 shrink-0 shadow-sm",
            data.type === 'ai_api_call' ? 'bg-green-500 text-green-600 dark:text-green-400 neon-glow-green' :
              data.type === 'sql_query' ? 'bg-blue-500 text-blue-600 dark:text-blue-400 neon-glow-blue' :
                data.type === 'logic_gatekeeper' ? 'bg-orange-500 text-orange-600 dark:text-orange-400 neon-glow-amber' :
                  data.type === 'iterator' ? 'bg-blue-500 text-blue-600 dark:text-blue-400 neon-glow-blue' :
                    data.type === 'router' ? 'bg-purple-500 text-purple-600 dark:text-purple-400' :
                      'bg-muted dark:bg-muted text-muted-foreground'
          )}>
            {getJobIcon(data.type)}
          </div>

          <span className="font-black text-[11px] uppercase tracking-tighter text-foreground dark:text-white truncate w-full" title={data.label}>
            {data.label}
          </span>
          <StatusIcon status={data.status} />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap pl-[42px]">
          <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-70">
            {data.type?.replace('_', ' ')}
          </span>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-white/30 !bg-slate-400/50 !backdrop-blur-sm group-hover:!bg-primary transition-colors"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !border-2 !border-white/30 !bg-slate-400/50 !backdrop-blur-sm group-hover:!bg-primary transition-colors"
      />
    </div>
  );
};

const nodeTypes = {
  pipelineStep: PipelineNode,
};

interface EnhancedPipelineCanvasProps {
  className?: string;
  steps: FormStep[];
  jobs: Job[];
  tracks?: any[];
  onUpdateStep: (stepId: string, updates: Partial<FormStep>) => void;
  onNodeClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
  onConnect?: (connection: Connection) => void;
  readOnly?: boolean;
  showDataFlow?: boolean;
  onDropStep?: (type: string, position: { x: number, y: number }, data: any) => void;
}

const EnhancedPipelineCanvasContent: React.FC<EnhancedPipelineCanvasProps> = ({
  className,
  steps,
  jobs,
  onUpdateStep,
  onNodeClick,
  onEdgeClick,
  onConnect: onConnectProp,
  readOnly = false,
  showDataFlow = false,
  onDropStep,
  tracks: propsTracks
}) => {
  const reactFlowWrapper = React.useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = React.useState<ReactFlowInstance | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // --- DAGRE FLAT LAYOUT ---
  useEffect(() => {
    console.log("EnhancedPipelineCanvas: Layout Log Triggered", { stepsCount: steps?.length, jobsCount: jobs?.length });
    if (!steps || !jobs) return;

    try {
      // 1. Initialize Dagre Graph
      // Handle potential ESM/CommonJS interop issues with dagre
      const dagreModule = (dagre as any).graphlib ? dagre : (dagre as any).default;
      if (!dagreModule || !dagreModule.graphlib) {
        console.error("Dagre module not loaded correctly", dagre);
        return;
      }

      const g = new dagreModule.graphlib.Graph();
      g.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 100 });
      g.setDefaultEdgeLabel(() => ({}));

      // 2. Add Nodes
      const NODE_WIDTH = 200;
      const NODE_HEIGHT = 80;

      steps.forEach(step => {
        g.setNode(step.tempId.toString(), { width: NODE_WIDTH, height: NODE_HEIGHT });
      });

      // 3. Add Edges
      // We prioritize explicit connections (destinationStepId / destinationTempId)
      // If none exist, we fall back to implicit linear order (job sequence) IF explicit mode is not active/mixed.
      const newEdges: Edge[] = [];
      const usedSourceIds = new Set<string>();

      // A: Create edges from explicit destinations
      steps.forEach(step => {
        let targetStep: FormStep | undefined;

        // 1. Check destinationTempId (immediate UI connection)
        if (step.destinationTempId) {
          targetStep = steps.find(s => s.tempId === step.destinationTempId);
        }
        // 2. Check destinationStepId (persisted connection)
        else if (step.destinationStepId) {
          targetStep = steps.find(s => s.id === step.destinationStepId);
        }

        if (targetStep) {
          // Check if cross-job
          const isCrossJob = step.jobId !== targetStep.jobId;
          g.setEdge(step.tempId.toString(), targetStep.tempId.toString());
          newEdges.push(createEdge(step, targetStep, isCrossJob));
          usedSourceIds.add(step.tempId);
        }
      });

      // B: Fallback to linear flow for steps that don't have explicit connections
      // Sort jobs by ID or some order
      // const sortedJobs = [...jobs].sort((a, b) => a.id - b.id);

      // FIX: use jobs array as is, or rely on sorted IDs. 
      // If jobs are irrelevant in trackless view, we should just follow step order?
      // But we still group by job for "Implicit" linear flow.
      const sortedJobs = [...jobs]?.sort((a, b) => a.id - b.id) || [];

      sortedJobs.forEach((job, jobIdx) => {
        const jobSteps = steps.filter(s => s.jobId === job.id).sort((a, b) => a.order - b.order);

        // Link steps within job
        jobSteps.forEach((step, stepIdx) => {
          // If this step already has an explicit outgoing edge, don't add implicit one
          if (usedSourceIds.has(step.tempId)) return;

          if (stepIdx < jobSteps.length - 1) {
            const nextStep = jobSteps[stepIdx + 1];
            g.setEdge(step.tempId.toString(), nextStep.tempId.toString());
            newEdges.push(createEdge(step, nextStep));
          }
        });

        // Optional: Link last step of this job to first step of next job
        if (jobIdx < sortedJobs.length - 1) {
          const nextJob = sortedJobs[jobIdx + 1];
          const nextJobSteps = steps.filter(s => s.jobId === nextJob.id).sort((a, b) => a.order - b.order);

          if (jobSteps.length > 0 && nextJobSteps.length > 0) {
            const sourceStep = jobSteps[jobSteps.length - 1];
            // Only add implicit link if source doesn't have explicit one
            if (!usedSourceIds.has(sourceStep.tempId)) {
              const targetStep = nextJobSteps[0];
              g.setEdge(sourceStep.tempId.toString(), targetStep.tempId.toString());
              newEdges.push(createEdge(sourceStep, targetStep, true));
            }
          }
        }
      });

      // 4. Compute Layout
      console.log("EnhancedPipelineCanvas: Running Dagre Layout");
      dagreModule.layout(g);

      // 5. Generate React Flow Nodes
      const newNodes: Node[] = steps.map(step => {
        const nodeWithPos = g.node(step.tempId.toString());
        // Safety check if dagre failed to position
        if (!nodeWithPos) {
          console.warn("Dagre failed to position node:", step.tempId);
          return null;
        }

        return {
          id: step.tempId.toString(),
          type: 'pipelineStep',
          data: {
            // Prefer label (passed from prop) > name > moduleType
            label: step.label || step.name || step.moduleType || 'Unknown Step',
            type: step.moduleType,
            status: 'pending'
          },
          position: {
            x: nodeWithPos.x - (NODE_WIDTH / 2),
            y: nodeWithPos.y - (NODE_HEIGHT / 2)
          },
          zIndex: 10,
        };
      }).filter(Boolean) as Node[]; // Filter out nulls

      console.log("EnhancedPipelineCanvas: Nodes generated", newNodes.length);
      setNodes(newNodes);
      setEdges(newEdges);

      // Force fit view after a short delay to ensure rendering
      setTimeout(() => {
        if (reactFlowInstance) {
          reactFlowInstance.fitView({ padding: 0.2 });
        }
      }, 100);

    } catch (err) {
      console.error("EnhancedPipelineCanvas: Error calculating layout", err);
    }

  }, [steps, jobs, reactFlowInstance]);

  const createEdge = (source: FormStep, target: FormStep, isCrossJob = false) => {
    return {
      id: `e-${source.tempId}-${target.tempId}`,
      source: source.tempId.toString(),
      target: target.tempId.toString(),
      type: 'smoothstep',
      animated: true,
      className: 'animate-pip-flow',
      style: {
        stroke: isCrossJob ? 'hsl(var(--primary) / 0.4)' : 'hsl(var(--primary) / 0.6)',
        strokeWidth: 3,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--primary))' }
    };
  };

  return (
    <div className={cn("h-full w-full bg-muted/50", className)}>
      <div
        className="h-full w-full relative"
        ref={reactFlowWrapper}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => {
          event.preventDefault();
          const type = event.dataTransfer.getData('application/reactflow');
          const dataString = event.dataTransfer.getData('application/json');

          // check if the dropped element is valid
          if (typeof type === 'undefined' || !type) {
            return;
          }

          // Calculate position
          // project was renamed to screenToFlowPosition in v11.3+ but might still be project in older v11
          // Use fallback or check version. For now assuming standard project/screenToFlowPosition usage via instance
          if (reactFlowInstance) {
            const position = reactFlowInstance.screenToFlowPosition({
              x: event.clientX,
              y: event.clientY,
            });

            let data = {};
            try {
              data = dataString ? JSON.parse(dataString) : {};
            } catch (e) { }

            if (onDropStep) {
              onDropStep(type, position, data);
            }
          }
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => {
            if (onNodeClick) onNodeClick(node.id); // node.id is the tempId (string)
          }}
          onConnect={onConnectProp}
          snapToGrid={true}
          snapGrid={[20, 20]}
          connectionRadius={30}
          nodeTypes={nodeTypes}
          onInit={setReactFlowInstance}
          minZoom={0.1}
          maxZoom={2.0}
          defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
          fitView
        >
          <Background color="#e2e8f0" gap={24} size={1} />
          <Controls showInteractive={false} className='bg-card border-border shadow-sm' />
          <MiniMap
            nodeColor='#cbd5e1'
            maskColor="rgba(241, 245, 249, 0.6)"
            className='border border-border shadow-sm rounded-lg overflow-hidden'
          />
        </ReactFlow>
      </div>
    </div>
  );
};

export const EnhancedPipelineCanvas = EnhancedPipelineCanvasContent;
export default EnhancedPipelineCanvas;


