import React, { useMemo } from 'react';
import ReactFlow, { 
  Background, 
  Controls, 
  MiniMap,
  Node,
  Edge
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';

interface ReactFlowRendererProps {
  flow: any;
  selectedNodeId?: string;
  onNodeSelect?: (node: any) => void;
}

export function ReactFlowRenderer({ flow, selectedNodeId, onNodeSelect }: ReactFlowRendererProps) {
  const { nodes, edges } = useMemo(() => {
    // 1. Create Dagre graph for layout
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 100 });

    // 2. Map Oddjob nodes to React Flow nodes and add to Dagre
    const rfNodes: Node[] = flow.nodes.map((node: any) => {
      dagreGraph.setNode(node.id, { width: 180, height: 60 });
      
      const isSelected = node.id === selectedNodeId;
      const isFailed = node.status === 'failed';
      const isSlow = node.durationMs && node.durationMs > 5000;
      
      let borderColor = 'rgba(255,255,255,0.1)';
      let bgColor = 'rgba(0,0,0,0.4)';
      
      if (isSelected) {
        borderColor = '#a855f7'; // Purple
        bgColor = 'rgba(168,85,247,0.2)';
      } else if (isFailed || isSlow) {
        borderColor = '#ef4444'; // Red
        bgColor = 'rgba(239,68,68,0.2)';
      }

      const nodeClass = `node-${node.id.replace(/[^a-zA-Z0-9]/g, '-')}`;

      return {
        id: node.id,
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
                <div className="font-medium truncate">{node.label}</div>
                <div className="text-xs text-muted-foreground capitalize">{node.type}</div>
                {node.durationMs && (
                  <div className="text-xs text-muted-foreground mt-1">{(node.durationMs / 1000).toFixed(1)}s</div>
                )}
              </div>
            </>
          ) 
        },
        position: { x: 0, y: 0 }, // Will be set by Dagre
        style: { width: 180, height: 60, background: 'transparent', border: 'none' },
      };
    });

    // 3. Map Oddjob edges to React Flow edges and add to Dagre
    const rfEdges: Edge[] = flow.edges.map((edge: any) => {
      dagreGraph.setEdge(edge.source, edge.target);
      return {
        id: `${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        animated: true,
        style: { stroke: 'rgba(168,85,247,0.5)', strokeWidth: 2 }, // Purple edges
      };
    });

    // 4. Calculate layout
    dagre.layout(dagreGraph);

    // 5. Update node positions from Dagre
    const layoutedNodes = rfNodes.map((node) => {
      const nodeWithPosition = dagreGraph.node(node.id);
      return {
        ...node,
        position: {
          x: nodeWithPosition?.x !== undefined ? nodeWithPosition.x - 90 : (node.position?.x ?? 0),
          y: nodeWithPosition?.y !== undefined ? nodeWithPosition.y - 30 : (node.position?.y ?? 0),
        },
      };
    });

    return { nodes: layoutedNodes, edges: rfEdges };
  }, [flow, selectedNodeId]);

  return (
    <div className="w-full bg-black/20 h-[600px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={(_, node) => {
          const originalNode = flow.nodes.find((n: any) => n.id === node.id);
          if (originalNode && onNodeSelect) {
            onNodeSelect(originalNode);
          }
        }}
        fitView
      >
        <Background color="#fff" gap={16} style={{ opacity: 0.05 }} />
        <Controls className="bg-black/80 border border-white/10 text-foreground fill-current" />
        <MiniMap 
          nodeColor={(n) => {
            const originalNode = flow.nodes.find((o: any) => o.id === n.id);
            if (originalNode?.status === 'failed') return '#ef4444';
            return '#a855f7';
          }}
          className="bg-black/80 border border-white/10"
          maskColor="rgba(0,0,0,0.6)"
        />
      </ReactFlow>
    </div>
  );
}
