import React, { useMemo, useState, useRef, useCallback } from 'react';
import ReactFlow, { 
  Background, 
  Controls, 
  MiniMap,
  Node,
  Edge,
  ReactFlowProvider,
  useReactFlow,
  Connection,
  addEdge,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCcw, Sparkles, Plus, PanelLeftClose, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CalculationGraphNode } from '@/components/calculations/CalculationGraphNode';
import { OperationalWorkflowNode } from '@/components/calculations/OperationalWorkflowNode';
import { CalculationPalette, type CalculationTemplate } from '@/components/calculations/CalculationPalette';
import { CalculationNodeInspector } from '@/components/calculations/CalculationNodeInspector';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';

const nodeTypes = {
  calculation: CalculationGraphNode,
  operationalWorkflow: OperationalWorkflowNode,
};

interface KnowledgeGraphVisualizerProps {
  cycleId?: string | number;
  missionId?: string | number;
  autoRefresh?: boolean;
}

function KnowledgeGraphCanvas({ cycleId, missionId, autoRefresh = true }: KnowledgeGraphVisualizerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { screenToFlowPosition } = useReactFlow();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [selectedCalcNode, setSelectedCalcNode] = useState<any>(null);
  const [isPaletteOpen, setIsPaletteOpen] = useState<boolean>(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["knowledge-graph-semantic", cycleId, missionId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (cycleId) params.append('pipelineExecutionId', String(cycleId));
      
      const res = await fetch(`/api/knowledge/graph/semantic?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch graph");
      return res.json();
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const { layoutedNodes, layoutedEdges } = useMemo(() => {
    if (!data || !data.nodes) return { layoutedNodes: [], layoutedEdges: [] };

    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 100 });

    const rfNodes: Node[] = data.nodes.map((node: any) => {
      const isCalculation = node.label === 'Calculation' || node.type === 'calculation' || !!node.operation;
      const isOperational = node.label === 'OperationalWorkflow' || node.type === 'operationalWorkflow' || !!node.kind;
      
      if (isCalculation) {
        dagreGraph.setNode(String(node.id), { width: 230, height: 90 });
        return {
          id: String(node.id),
          type: 'calculation',
          data: {
            id: node.calculationId || node.id,
            name: node.name,
            operation: node.operation || node.name,
            category: node.category,
            formula: node.formula,
            status: node.status || 'active',
            cachedResult: node.cachedResult ?? node.result,
            selected: (selectedNode && node.id === selectedNode.id) || (selectedCalcNode && node.id === selectedCalcNode.id),
          },
          position: { x: 0, y: 0 },
        };
      }

      if (isOperational) {
        dagreGraph.setNode(String(node.id), { width: 260, height: 110 });
        // A saved workflow node keeps its kind, target, run status and last run in its data.
        const op = node.data ?? {};
        return {
          id: String(node.id),
          type: 'operationalWorkflow',
          data: {
            id: node.id,
            name: node.name,
            kind: op.kind || node.kind || 'tool',
            category: op.category ?? node.category,
            target: op.target ?? node.target,
            status: op.status || node.status || 'idle',
            lastRun: op.lastRun,
            selected: (selectedNode && node.id === selectedNode.id) || (selectedCalcNode && node.id === selectedCalcNode.id),
          },
          position: { x: 0, y: 0 },
        };
      }

      dagreGraph.setNode(String(node.id), { width: 180, height: 60 });
      
      const isSelected = selectedNode && node.id === selectedNode.id;
      
      let borderColor = 'rgba(255,255,255,0.1)';
      let bgColor = 'rgba(0,0,0,0.4)';
      
      if (isSelected) {
        borderColor = '#00f5ff';
        bgColor = 'rgba(0,245,255,0.2)';
      } else if (node.label === 'Concept') {
        borderColor = '#a855f7';
        bgColor = 'rgba(168,85,247,0.2)';
      }

      const nodeClass = `node-${String(node.id).replace(/[^a-zA-Z0-9]/g, '-')}`;

      return {
        id: String(node.id),
        data: { 
          label: (
            <>
              <style>{`
                .${nodeClass} {
                  border-color: ${borderColor};
                  background-color: ${bgColor};
                }
              `}</style>
              <div className={`p-3 border rounded-lg text-foreground text-sm backdrop-blur-md transition-colors w-[180px] min-h-[60px] ${nodeClass}`}>
                <div className="font-medium truncate">{node.name}</div>
                <div className="text-xs text-muted-foreground capitalize">{node.label}</div>
              </div>
            </>
          ) 
        },
        position: { x: 0, y: 0 },
        style: { width: 180, height: 60, background: 'transparent', border: 'none' },
      };
    });

    const rfEdges: Edge[] = data.edges.map((edge: any) => {
      dagreGraph.setEdge(String(edge.sourceNodeId), String(edge.targetNodeId));
      return {
        id: `${edge.sourceNodeId}-${edge.targetNodeId}`,
        source: String(edge.sourceNodeId),
        target: String(edge.targetNodeId),
        animated: true,
        label: edge.label,
        style: { stroke: 'rgba(0,245,255,0.3)', strokeWidth: 1 },
        labelStyle: { fill: '#fff', fontSize: 10, fillOpacity: 0.6 },
        labelBgStyle: { fill: '#000', fillOpacity: 0.6 },
      };
    });

    dagre.layout(dagreGraph);

    const positionedNodes = rfNodes.map((node) => {
      const nodeWithPosition = dagreGraph.node(node.id);
      const isCalc = node.type === 'calculation';
      return {
        ...node,
        position: {
          x: nodeWithPosition?.x !== undefined ? nodeWithPosition.x - (isCalc ? 115 : 90) : (node.position?.x ?? 0),
          y: nodeWithPosition?.y !== undefined ? nodeWithPosition.y - (isCalc ? 45 : 30) : (node.position?.y ?? 0),
        },
      };
    });

    return { layoutedNodes: positionedNodes, layoutedEdges: rfEdges };
  }, [data, selectedNode, selectedCalcNode]);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  React.useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  // Drag and Drop handlers
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow/type');
      const templateData = event.dataTransfer.getData('application/reactflow/template');

      if (!type || !templateData || !reactFlowWrapper.current) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      if (type === 'operationalWorkflow') {
        const opTemplate = JSON.parse(templateData);
        const newNodeId = `op-${Date.now()}`;
        const newNode: Node = {
          id: newNodeId,
          type: 'operationalWorkflow',
          position,
          data: {
            id: newNodeId,
            name: opTemplate.name,
            kind: opTemplate.kind || 'tool',
            category: opTemplate.category,
            target: opTemplate.target,
            status: 'idle',
            selected: true,
          },
        };

        setNodes((nds) => nds.concat(newNode));
        // Saved as a knowledge node, so it is still here after a reload and Run has
        // something to ask approval for.
        try {
          const res = await apiRequest('POST', '/api/workflow-nodes', {
            name: opTemplate.name,
            kind: opTemplate.kind || 'tool',
            category: opTemplate.category,
            target: opTemplate.target,
          });
          const created = await res.json().catch(() => null);
          const createdId = created?.node?.id;
          if (!createdId) throw new Error(created?.error?.message || created?.message || `The server answered ${res.status} without a node.`);
          setNodes((nds) => nds.map((n) => (n.id === newNodeId ? { ...n, data: { ...n.data, id: createdId } } : n)));
          toast({
            title: "Operational node added",
            description: `${opTemplate.name} is saved on the canvas.`,
          });
        } catch (err: any) {
          setNodes((nds) => nds.map((n) => (n.id === newNodeId ? { ...n, data: { ...n.data, status: 'error' } } : n)));
          toast({
            title: "Operational node not saved",
            description: `${err?.message || "The server rejected it."} It is shown on this canvas only and will be gone after a reload.`,
            variant: "destructive",
          });
        }
        return;
      }

      const template: CalculationTemplate = JSON.parse(templateData);

      const newNodeId = `calc-${Date.now()}`;
      const newNode: Node = {
        id: newNodeId,
        type: 'calculation',
        position,
        data: {
          id: undefined,
          name: template.name,
          operation: template.operation,
          category: template.category,
          formula: template.defaultFormula,
          status: 'active',
          cachedResult: undefined,
          selected: true,
        },
      };

      setNodes((nds) => nds.concat(newNode));
      setSelectedCalcNode(newNode);
      setSelectedNode(null);

      // Persist node to backend. The route answers { calculation }, so the id is
      // read from there; and when nothing is saved, say so. The old toast claimed
      // "Saved locally on canvas" for a node that vanished on reload.
      try {
        const res = await apiRequest('POST', '/api/calculations', {
          name: template.name,
          operation: template.operation,
          category: template.category,
          formula: template.defaultFormula,
        });
        const created = await res.json().catch(() => null);
        const createdId = created?.calculation?.id;
        if (!createdId) {
          throw new Error(created?.error || created?.message || `The server answered ${res.status} without a calculation.`);
        }
        newNode.data.id = createdId;
        queryClient.invalidateQueries({ queryKey: ["/api/calculations"] });
        toast({
          title: "Calculation Node Added",
          description: `${template.name} (${template.operation}) placed on graph.`,
        });
      } catch (err: any) {
        setNodes((nds) => nds.map((n) => (n.id === newNodeId ? { ...n, data: { ...n.data, status: 'error' } } : n)));
        toast({
          title: "Calculation not saved",
          description: `${err?.message || "The server rejected it."} It is shown on this canvas only and will be gone after a reload.`,
          variant: "destructive",
        });
      }
    },
    [screenToFlowPosition, setNodes, toast, queryClient]
  );

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: '#818cf8', strokeWidth: 1.5 } }, eds)),
    [setEdges]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[300px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col relative overflow-hidden">
      {/* Top Toolbar */}
      <div className="flex justify-between items-center p-2.5 bg-black/40 border-b border-white/5 z-10">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsPaletteOpen(!isPaletteOpen)}
            className="h-7 px-2.5 text-xs gap-1.5 border-indigo-500/30 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20"
          >
            {isPaletteOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeft className="h-3.5 w-3.5" />}
            Calculation Palette
          </Button>

          <div className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-3">
            <span>Knowledge Graph ({nodes.length} Nodes)</span>
            {data?.entropy !== undefined && (
              <span className="text-cyan-400">Entropy: {data.entropy.toFixed(4)}</span>
            )}
          </div>
        </div>

        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={() => refetch()}>
          <RefreshCcw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Main Workspace Area with Palette, Canvas, and Inspector */}
      <div className="flex-1 w-full flex relative overflow-hidden" ref={reactFlowWrapper}>
        {/* Collapsible Calculation Palette Sidebar */}
        {isPaletteOpen && <CalculationPalette />}

        {/* ReactFlow Canvas */}
        <div className="flex-1 h-full relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onNodeClick={(_, node) => {
              if (node.type === 'calculation') {
                setSelectedCalcNode(node);
                setSelectedNode(null);
              } else {
                const originalNode = data.nodes?.find((n: any) => String(n.id) === node.id);
                setSelectedNode(originalNode || node);
                setSelectedCalcNode(null);
              }
            }}
            fitView
          >
            <Background color="#fff" gap={16} style={{ opacity: 0.05 }} />
            <Controls className="bg-black/80 border border-white/10 text-foreground fill-current" />
            <MiniMap 
              nodeColor={(n) => {
                if (n.type === 'calculation') return '#818cf8';
                const originalNode = data?.nodes?.find((o: any) => String(o.id) === n.id);
                if (originalNode?.label === 'Concept') return '#a855f7';
                return '#00f5ff';
              }}
              className="bg-black/80 border border-white/10"
              maskColor="rgba(0,0,0,0.6)"
            />
          </ReactFlow>
        </div>

        {/* Calculation Node Inspector */}
        {selectedCalcNode && (
          <CalculationNodeInspector
            node={selectedCalcNode}
            onClose={() => setSelectedCalcNode(null)}
            onUpdated={() => refetch()}
          />
        )}

        {/* Standard Knowledge Node Detail Drawer */}
        {selectedNode && !selectedCalcNode && (
          <div className="absolute top-2 right-2 w-64 bg-black/80 border border-white/10 rounded-lg p-4 backdrop-blur-md z-10 max-h-[90%] overflow-auto">
            <div className="flex justify-between items-start mb-2">
              <h3 className="text-sm font-bold text-foreground">{selectedNode.name}</h3>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setSelectedNode(null)}>
                <span className="text-xs">✕</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mb-2">{selectedNode.label}</p>
            {selectedNode.description && (
              <p className="text-xs text-foreground mb-2">{selectedNode.description}</p>
            )}
            {selectedNode.properties && (
              <div className="text-xs text-muted-foreground">
                <p className="font-bold mb-1">Properties:</p>
                <pre className="p-1 bg-black/50 rounded text-[10px] overflow-auto">
                  {JSON.stringify(selectedNode.properties, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function KnowledgeGraphVisualizer(props: KnowledgeGraphVisualizerProps) {
  return (
    <ReactFlowProvider>
      <KnowledgeGraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
