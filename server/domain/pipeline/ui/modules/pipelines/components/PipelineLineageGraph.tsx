
import React, { useMemo, useEffect } from 'react';
import ReactFlow, {
    Background,
    Controls,
    useNodesState,
    useEdgesState,
    Node,
    Edge,
    Position,
    MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { usePipelineLineage } from '@domain-ui/mission/ui/modules/missions/hooks/use-lineage';
import { Loader2 } from 'lucide-react';

interface PipelineLineageGraphProps {
    pipelineId: number;
}

const nodeWidth = 172;
const nodeHeight = 36;

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    dagreGraph.setGraph({ rankdir: 'LR' });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        node.targetPosition = Position.Left;
        node.sourcePosition = Position.Right;

        // We are shifting the dagre node position (anchor=center center) to the top left
        // so it matches the React Flow node anchor point (top left).
        node.position = {
            x: nodeWithPosition.x - nodeWidth / 2,
            y: nodeWithPosition.y - nodeHeight / 2,
        };

        return node;
    });

    return { nodes: layoutedNodes, edges };
};

export function PipelineLineageGraph({ pipelineId }: PipelineLineageGraphProps) {
    const { data: lineage, isLoading } = usePipelineLineage(pipelineId);
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    useEffect(() => {
        if (lineage) {
            // Transform API nodes to ReactFlow nodes
            const flowNodes: Node[] = lineage.nodes.map((node) => ({
                id: node.id,
                data: { label: node.data.label },
                position: { x: 0, y: 0 }, // Position handled by layout
                type: 'default', // Using default node type for now
                style: {
                    background: node.type === 'pipeline' ? '#eef2ff' : '#fff',
                    border: node.type === 'pipeline' ? '1px solid #6366f1' : '1px solid #777',
                    borderRadius: '8px',
                    fontSize: '12px',
                    padding: '8px',
                    width: 150,
                }
            }));

            // Transform API edges to ReactFlow edges
            const flowEdges: Edge[] = lineage.edges.map((edge, index) => ({
                id: `e${index}-${edge.source}-${edge.target}`,
                source: edge.source,
                target: edge.target,
                type: 'smoothstep',
                animated: edge.type === 'implicit',
                label: edge.label,
                style: {
                    stroke: edge.type === 'implicit' ? '#f59e0b' : '#64748b',
                    strokeDasharray: edge.type === 'implicit' ? '5,5' : undefined,
                },
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                    color: edge.type === 'implicit' ? '#f59e0b' : '#64748b',
                },
            }));

            const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
                flowNodes,
                flowEdges
            );

            setNodes(layoutedNodes);
            setEdges(layoutedEdges);
        }
    }, [lineage, setNodes, setEdges]);

    if (isLoading) {
        return <div className="flex justify-center p-10"><Loader2 className="animate-spin h-6 w-6" /></div>;
    }

    // If no data or nodes
    if (!nodes.length) {
        return <div className="text-center p-10 text-muted-foreground">No lineage data available.</div>;
    }

    return (
        <div className="h-[500px] w-full border rounded-md bg-muted">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                fitView
            >
                <Controls />
                <Background color="#aaa" gap={16} />
            </ReactFlow>
        </div>
    );
}

