
import React from 'react';
import { Sankey, Tooltip, ResponsiveContainer, Rectangle, Layer } from 'recharts';

interface SankeyDiagramProps {
    data: {
        nodes: any[];
        links: any[];
    };
    isLoading?: boolean;
    onLinkClick?: (link: any) => void;
}

const CustomNode = ({ x, y, width, height, index, payload, containerWidth }: any) => {
    const isOut = x + width + 6 > containerWidth;
    // ... same code ... (colors)
    const colors = ['#8884d8', '#83a6ed', '#8dd1e1', '#82ca9d', '#a4de6c'];

    return (
        <Layer key={`CustomNode${index}`}>
            <Rectangle
                x={x}
                y={y}
                width={width}
                height={height}
                fill={colors[index % colors.length]}
                fillOpacity="1"
            />
            <text
                textAnchor={isOut ? 'end' : 'start'}
                x={isOut ? x - 6 : x + width + 6}
                y={y + height / 2}
                fontSize="12"
                fill="#333" // Slate-800
                stroke="none"
                dominantBaseline="middle"
            >
                {payload.name}
            </text>
        </Layer>
    );
};

export function SankeyDiagram({ data, isLoading, onLinkClick }: SankeyDiagramProps) {
    if (isLoading) {
        return <div className="flex justify-center items-center h-full text-muted-foreground bg-muted/50 border rounded-lg m-4 animate-pulse">Loading Visualization...</div>;
    }

    // Transform data for Recharts (source/target to indices)
    const validNodes = (Array.isArray(data.nodes) ? data.nodes : []).filter(n => n && n.id != null);
    const nodeMap = new Map(validNodes.map((node, i) => [node.id, i]));

    const chartData = {
        nodes: validNodes.map(n => ({ ...n, name: n.name || String(n.id) })),
        links: (Array.isArray(data.links) ? data.links : [])
            .filter(l => l && l.source != null && l.target != null)
            .map(l => ({
                source: nodeMap.get(l.source),
                target: nodeMap.get(l.target),
                value: Number(l.value || 1),
                payload: l // Store original link data including ticketIds
            }))
            .filter(l => l.source !== undefined && l.target !== undefined)
    };

    console.log("Sankey Debug:", {
        rawNodes: data.nodes,
        rawLinks: data.links,
        mappedNodes: chartData.nodes,
        mappedLinks: chartData.links
    });

    if (chartData.nodes.length === 0) {
        return <div className="flex flex-col gap-2 justify-center items-center h-full text-muted-foreground bg-muted border rounded-lg m-4">
            <span className="font-semibold text-lg">No Data Available</span>
            <span className="text-sm">Try selecting a different context or run with ticket data.</span>
        </div>;
    }

    return (
        <div className="w-full h-full p-4 bg-card rounded-lg shadow-sm">
            <ResponsiveContainer width="100%" height="100%">
                <Sankey
                    data={chartData as any}
                    node={<CustomNode />}
                    nodePadding={50}
                    margin={{
                        left: 20,
                        right: 200, // Extra space for labels
                        top: 20,
                        bottom: 20,
                    }}
                    link={{
                        stroke: '#AAA',
                        strokeOpacity: 0.3, // "Thick band" visual
                        cursor: 'pointer'
                    }}
                    onClick={(data: any) => {
                        if (onLinkClick && data.payload) {
                            onLinkClick(data.payload);
                        }
                    }}
                >
                    <Tooltip
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                </Sankey>
            </ResponsiveContainer>
        </div>
    );
}
