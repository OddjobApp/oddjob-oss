/**
 * Mini Graph Visualization Component
 * 
 * A compact force-directed graph visualization for displaying
 * knowledge graph query results inline in the Universal Search.
 */

import './knowledge-styles.css';

import { useRef, useEffect, useState } from "react";
import * as d3 from "d3";
import { cn } from "@/lib/utils";

interface GraphNode {
    id: number;
    label: string;
    name: string;
    x?: number;
    y?: number;
    fx?: number | null;
    fy?: number | null;
}

interface GraphEdge {
    source: number | GraphNode;
    target: number | GraphNode;
    relation: string;
}

interface MiniGraphVisualizationProps {
    nodes: Array<{ id: number; label: string; name: string }>;
    edges: Array<{ sourceId: number; targetId: number; relation: string }>;
    width?: number;
    height?: number;
    className?: string;
    onNodeClick?: (nodeId: number) => void;
}

// Color palette for different node labels
const labelColors: Record<string, string> = {
    Ticket: "#3b82f6",
    User: "#8b5cf6",
    Organization: "#f59e0b",
    Repository: "#10b981",
    PullRequest: "#ec4899",
    Infrastructure: "#06b6d4",
    Incident: "#ef4444",
    Document: "#f97316",
    default: "#64748b",
};

function getNodeColor(label: string): string {
    return labelColors[label] || labelColors.default;
}

export function MiniGraphVisualization({
    nodes,
    edges,
    width = 280,
    height = 180,
    className,
    onNodeClick,
}: MiniGraphVisualizationProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string } | null>(null);

    // Set container dimensions via Ref to avoid inline styles lint
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.style.setProperty('--graph-width', typeof width === 'number' ? `${width}px` : width);
            containerRef.current.style.setProperty('--graph-height', typeof height === 'number' ? `${height}px` : height);
        }
    }, [width, height]);

    // Set tooltip position via Ref to avoid inline styles lint
    useEffect(() => {
        if (tooltipRef.current && tooltip) {
            tooltipRef.current.style.left = `${tooltip.x}px`;
            tooltipRef.current.style.top = `${tooltip.y}px`;
        }
    }, [tooltip]);

    useEffect(() => {
        if (!svgRef.current || nodes.length === 0) return;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();

        // Convert edges to d3 format with filtering to ensure source/target nodes exist
        const nodeIds = new Set(nodes.map(n => n.id));
        const d3Nodes: GraphNode[] = nodes.map(n => ({ ...n }));
        const d3Edges: GraphEdge[] = edges
            .filter(e => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId))
            .map(e => ({
                source: e.sourceId,
                target: e.targetId,
                relation: e.relation,
            }));

        // Create container group with zoom
        const g = svg.append("g");

        // Create simulation
        const simulation = d3.forceSimulation(d3Nodes as d3.SimulationNodeDatum[])
            .force("link", d3.forceLink(d3Edges)
                .id((d: any) => d.id)
                .distance(50))
            .force("charge", d3.forceManyBody().strength(-80))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collision", d3.forceCollide().radius(20));

        // Draw edges
        const link = g.append("g")
            .attr("class", "links")
            .selectAll("line")
            .data(d3Edges)
            .enter()
            .append("line")
            .attr("stroke", "#94a3b8")
            .attr("stroke-opacity", 0.6)
            .attr("stroke-width", 1.5);

        // Draw edge labels (relations)
        const linkLabel = g.append("g")
            .attr("class", "link-labels")
            .selectAll("text")
            .data(d3Edges)
            .enter()
            .append("text")
            .attr("font-size", "6px")
            .attr("fill", "#64748b")
            .attr("text-anchor", "middle")
            .text(d => d.relation.length > 12 ? d.relation.substring(0, 10) + "..." : d.relation);

        // Draw nodes
        const node = g.append("g")
            .attr("class", "nodes")
            .selectAll("g")
            .data(d3Nodes)
            .enter()
            .append("g")
            .attr("class", "node")
            .style("cursor", onNodeClick ? "pointer" : "default")
            .call(d3.drag<any, GraphNode>()
                .on("start", (event, d) => {
                    if (!event.active) simulation.alphaTarget(0.3).restart();
                    d.fx = d.x;
                    d.fy = d.y;
                })
                .on("drag", (event, d) => {
                    d.fx = event.x;
                    d.fy = event.y;
                })
                .on("end", (event, d) => {
                    if (!event.active) simulation.alphaTarget(0);
                    d.fx = null;
                    d.fy = null;
                }) as any);

        // Node circles
        node.append("circle")
            .attr("r", 8)
            .attr("fill", d => getNodeColor(d.label))
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5);

        // Node labels
        node.append("text")
            .attr("dx", 12)
            .attr("dy", 4)
            .attr("font-size", "8px")
            .attr("fill", "#334155")
            .text(d => d.name.length > 15 ? d.name.substring(0, 12) + "..." : d.name);

        // Hover and click handlers
        node.on("mouseover", (event, d) => {
            const rect = svgRef.current!.getBoundingClientRect();
            setTooltip({
                x: event.clientX - rect.left,
                y: event.clientY - rect.top - 30,
                content: `${d.label}: ${d.name}`,
            });
        })
            .on("mouseout", () => setTooltip(null))
            .on("click", (event, d) => {
                if (onNodeClick) {
                    event.stopPropagation();
                    onNodeClick(d.id);
                }
            });

        // Tick function
        simulation.on("tick", () => {
            link
                .attr("x1", (d: any) => d.source?.x ?? 0)
                .attr("y1", (d: any) => d.source?.y ?? 0)
                .attr("x2", (d: any) => d.target?.x ?? 0)
                .attr("y2", (d: any) => d.target?.y ?? 0);

            linkLabel
                .attr("x", (d: any) => ((d.source?.x ?? 0) + (d.target?.x ?? 0)) / 2)
                .attr("y", (d: any) => ((d.source?.y ?? 0) + (d.target?.y ?? 0)) / 2);

            node.attr("transform", (d: any) => `translate(${d.x ?? 0},${d.y ?? 0})`);
        });

        // Run simulation for a bit then cool down
        simulation.alpha(1).restart();
        setTimeout(() => simulation.alphaTarget(0), 2000);

        return () => {
            simulation.stop();
        };
    }, [nodes, edges, width, height, onNodeClick]);

    if (nodes.length === 0) {
        return (
            <div
                ref={containerRef}
                className={cn("mini-graph-container", className)}
            >
                No graph data
            </div>
        );
    }

    return (
        <div className={cn("relative", className)}>
            <svg
                ref={svgRef}
                width={width}
                height={height}
                className="bg-muted/20 rounded border"
            />
            {tooltip && (
                <div
                    ref={tooltipRef}
                    className="mini-graph-tooltip"
                >
                    {tooltip.content}
                </div>
            )}

            {/* Legend */}
            <div className="absolute bottom-1 right-1 flex gap-1">
                <span className="text-[8px] text-muted-foreground bg-foreground/80 px-1 rounded">
                    {nodes.length} nodes, {edges.length} edges
                </span>
            </div>
        </div>
    );
}

export default MiniGraphVisualization;
