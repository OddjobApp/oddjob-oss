
import React, { useRef, useMemo, useCallback } from 'react';
import ForceGraph2D, { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d';
import { useResizeObserver } from '@domain-ui/core/ui/hooks/use-resize-observer';
import { KnowledgeEdge, KnowledgeNode } from "@shared/schema/knowledge/graph";

// Extend NodeObject to include our data
interface GraphNode extends NodeObject {
    id: string | number;
    label: string;
    name: string;
    val: number; // radius
    color: string;
    nodeData: KnowledgeNode;
}

interface GraphLink extends LinkObject {
    source: string | number;
    target: string | number;
    label?: string;
}

interface GraphVisualizationProps {
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
    onNodeClick?: (node: KnowledgeNode, event?: any) => void;
    width?: number;
    height?: number;
}

export function GraphVisualization({ nodes, edges, onNodeClick, width, height }: GraphVisualizationProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const graphRef = useRef<ForceGraphMethods>(null);

    // Auto-resize if width/height not provided
    const { width: containerWidth, height: containerHeight } = useResizeObserver(containerRef);
    const finalWidth = width || containerWidth || 600;
    const finalHeight = height || containerHeight || 600;

    // Prepare Graph Data
    const graphData = useMemo(() => {
        if (!Array.isArray(nodes)) return { nodes: [], links: [] };

        const fmtNodes: GraphNode[] = nodes
            .filter(n => n && n.id != null)
            .map(n => {
                let color = "#fbbf24"; // Amber-400 (Staging/Unknown)

                if (n.verificationStatus === 'verified') {
                    color = "#4ade80"; // Green-400 (Verified)
                } else if (n.verificationStatus === 'rejected') {
                    color = "#f87171"; // Red-400 (Rejected)
                }

                return {
                    id: String(n.id),
                    label: n.label,
                    name: n.name,
                    val: 5,
                    color,
                    nodeData: n
                };
            });

        // Use a map to ensure unique nodes by ID
        const uniqueNodeMap = new Map();
        fmtNodes.forEach(n => uniqueNodeMap.set(n.id, n));
        const finalNodes = Array.from(uniqueNodeMap.values());
        const nodeIds = new Set(finalNodes.map(n => n.id));

        // Filter edges to only include those where both source and target nodes exist
        const fmtEdges: GraphLink[] = (Array.isArray(edges) ? edges : [])
            .filter(e => e && e.sourceId != null && e.targetId != null)
            .map(e => ({
                source: String(e.sourceId),
                target: String(e.targetId),
                label: e.relation
            }))
            .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

        return { nodes: finalNodes, links: fmtEdges };
    }, [nodes, edges]);

    const handleNodeClick = useCallback((node: GraphNode, event: any) => {
        if (!node) return;

        if (onNodeClick) {
            // ForceGraph handles event as second argument
            onNodeClick(node.nodeData, event);
        }

        // Center view on node
        if (graphRef.current) {
            // Safety check for coordinates
            const x = typeof node.x === 'number' ? node.x : 0;
            const y = typeof node.y === 'number' ? node.y : 0;
            graphRef.current.centerAt(x, y, 1000);
            graphRef.current.zoom(2, 2000);
        }
    }, [onNodeClick]);

    return (
        <div ref={containerRef} className="w-full h-full border rounded-lg bg-muted overflow-hidden relative">
            <ForceGraph2D
                ref={graphRef as any}
                width={finalWidth}
                height={finalHeight}
                graphData={graphData}
                nodeLabel="name"
                nodeColor="color"
                nodeRelSize={6}
                linkLabel="label"
                linkDirectionalArrowLength={3.5}
                linkDirectionalArrowRelPos={1}
                onNodeClick={handleNodeClick as any}
                backgroundColor="#f8fafc" // slate-50
            />

            <div className="absolute top-4 right-4 bg-foreground/90 p-2 rounded shadow text-xs space-y-1 backdrop-blur-sm">
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-[#4ade80]"></div> Verified / Good</div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-[#fbbf24]"></div> Staging / Unknown</div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-[#f87171]"></div> Bad / Rejected</div>
            </div>
        </div>
    );
}

