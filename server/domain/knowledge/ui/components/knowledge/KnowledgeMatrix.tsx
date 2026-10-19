import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea, ScrollBar } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@domain-ui/core/ui/components/ui/tooltip";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@domain-ui/core/ui/components/ui/dropdown-menu";
import { Info, Filter, Grip } from 'lucide-react';
import './knowledge-styles.css';

interface KnowledgeMatrixProps {
    nodes: any[];
    edges: any[];
    matrixSummary?: {
        nodes: any[];
        matrix: Record<string, { weight: number, count: number }>;
    };
    onNodeClick?: (nodeId: string) => void;
}

const KnowledgeMatrix: React.FC<KnowledgeMatrixProps> = ({ nodes, edges, matrixSummary, onNodeClick }) => {
    const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

    // 1. Prepare Data & Filters
    const { sortedNodes, matrixMap, uniqueLabels } = useMemo(() => {
        // Fallback for empty nodes
        if (!nodes || nodes.length === 0) return { sortedNodes: [], matrixMap: new Map(), uniqueLabels: [] };

        // Consolidate duplicates by Name + Label
        const consolidatedMap = new Map<string, any>();
        const nameToIdSet = new Map<string, string[]>(); // Map composite key to list of original IDs

        nodes.forEach(node => {
            const compositeKey = `${node.name || 'Unnamed'}-${node.label || 'Other'}`;
            if (!consolidatedMap.has(compositeKey)) {
                consolidatedMap.set(compositeKey, { ...node, id: compositeKey }); // Use composite key as ID
                nameToIdSet.set(compositeKey, [node.id.toString()]);
            } else {
                nameToIdSet.get(compositeKey)?.push(node.id.toString());
            }
        });

        const consolidatedNodes = Array.from(consolidatedMap.values());

        // Extract Unique Labels
        const labels = Array.from(new Set(consolidatedNodes.map(n => n.label).filter(Boolean)));

        // Filter Nodes
        const filteredNodes = selectedLabels.length > 0
            ? consolidatedNodes.filter((n: any) => selectedLabels.includes(n.label))
            : consolidatedNodes;

        // Sort nodes: Label -> Name
        const sorted = [...filteredNodes].sort((a: any, b: any) => {
            if (a.label !== b.label) {
                return (a.label || '').localeCompare(b.label || '');
            }
            return (a.name || '').localeCompare(b.name || '');
        });

        // Limit display for performance unless using summary (summary is pre-limited/pre-aggregated)
        // Hard limit of 80 nodes (6400 cells) for direct graph data to ensure UI stability
        const nodeLimit = matrixSummary ? 300 : 80;
        const displayNodes = sorted.slice(0, nodeLimit);

        // Build lookup: "sourceKey-targetKey" -> { edges: [], weight: 0 }
        const map = new Map<string, { edges: any[], weight: number }>();

        // We need to map original edge IDs to our new consolidated keys
        const idToCompositeKey = new Map<string, string>();
        nameToIdSet.forEach((ids, compositeKey) => {
            ids.forEach(id => idToCompositeKey.set(id, compositeKey));
        });

        (Array.isArray(edges) ? edges : []).forEach(edge => {
            const sourceKey = idToCompositeKey.get(edge.sourceId.toString());
            const targetKey = idToCompositeKey.get(edge.targetId.toString());

            if (sourceKey && targetKey) {
                const key = `${sourceKey}-${targetKey}`;
                if (!map.has(key)) map.set(key, { edges: [], weight: 0 });
                const cell = map.get(key)!;
                cell.edges.push(edge);
                cell.weight += (edge.weight || 1);
            }
        });

        return { sortedNodes: displayNodes, matrixMap: map, uniqueLabels: labels };
    }, [nodes, edges, selectedLabels, matrixSummary]);

    const isLarge = sortedNodes.length > 50;
    const cellSize = isLarge ? 20 : 32;
    const labelWidth = 180;

    if (!nodes || nodes.length === 0) {
        return (
            <div className="h-full flex items-center justify-center text-muted-foreground">
                No nodes available for matrix view.
            </div>
        )
    }

    const isTruncated = (matrixSummary ? sortedNodes.length < (nodes?.length || 0) : nodes.length > 80);

    return (
        <Card className="h-full border-0 shadow-none bg-transparent flex flex-col">
            {isTruncated && (
                <div className="bg-amber-50 border-b border-amber-100 p-2 text-[10px] text-amber-700 font-medium flex items-center gap-2">
                    <Info className="w-3 h-3" />
                    Matrix View is currenty displaying a limited subset of data ({sortedNodes.length} nodes) to ensure UI performance. Use search or filters to refine results.
                </div>
            )}
            <CardHeader className="pb-2 flex-none flex-row items-center justify-between space-y-0">
                <div className="space-y-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Grip className="w-5 h-5 text-indigo-600" />
                        Dependency Matrix
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger>
                                    <Info className="w-4 h-4 text-muted-foreground" />
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Rows are Sources, Columns are Targets.</p>
                                    <p>Color intensity indicates relationship strength.</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </CardTitle>
                    <CardDescription>
                        {sortedNodes.length} entities shown. Darker cells = stronger connection.
                    </CardDescription>
                </div>

                {/* Filter Controls */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-2">
                            <Filter className="w-4 h-4" />
                            Filter Types {selectedLabels.length > 0 && `(${selectedLabels.length})`}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        {uniqueLabels.map(label => (
                            <DropdownMenuCheckboxItem
                                key={label}
                                checked={selectedLabels.includes(label)}
                                onCheckedChange={(checked) => {
                                    if (checked) setSelectedLabels([...selectedLabels, label]);
                                    else setSelectedLabels(selectedLabels.filter(l => l !== label));
                                }}
                            >
                                {label}
                            </DropdownMenuCheckboxItem>
                        ))}
                        {selectedLabels.length > 0 && (
                            <div className="p-2 border-t mt-2">
                                <Button size="sm" variant="ghost" className="w-full justify-center text-xs h-6" onClick={() => setSelectedLabels([])}>
                                    Clear Filters
                                </Button>
                            </div>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>

            <CardContent
                className="flex-1 overflow-hidden relative p-0 border rounded-tl-lg mt-2"
                style={{
                    '--matrix-min-width': `${(sortedNodes.length * cellSize) + labelWidth}px`,
                    '--matrix-min-height': `${(sortedNodes.length * cellSize) + 120}px`,
                    '--label-width': `${labelWidth}px`,
                    '--cell-size': `${cellSize}px`,
                } as React.CSSProperties}
            >
                <ScrollArea className="h-full w-full bg-muted/50">
                    <div className="matrix-container">

                        {/* Header Row (Column Labels) */}
                        <div className="matrix-header">
                            {sortedNodes.map(node => (
                                <div
                                    key={`col-${node.id}`}
                                    className="matrix-col-header group transition-colors"
                                    title={node.name}
                                >
                                    <span
                                        className="transform -rotate-45 text-[10px] text-muted-foreground whitespace-nowrap absolute origin-bottom-left bottom-3 left-1/2 w-0 overflow-visible font-medium"
                                    >
                                        {node.name || node.id}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Grid Rows */}
                        {sortedNodes.map(sourceNode => (
                            <div key={`row-${sourceNode.id}`} className="flex items-center hover:bg-muted/50 group/row">
                                {/* Row Label */}
                                <div
                                    className="matrix-row-label group-hover/row:text-foreground"
                                    title={sourceNode.name}
                                >
                                    <Badge variant="outline" className="mr-2 text-[9px] h-4 px-1 opacity-50">{sourceNode.label?.substring(0, 3)}</Badge>
                                    {sourceNode.name || sourceNode.id}
                                </div>

                                {/* Cells */}
                                {sortedNodes.map(targetNode => {
                                    const cellData = matrixMap.get(`${sourceNode.id}-${targetNode.id}`);
                                    const isSelf = sourceNode.id === targetNode.id;

                                    // Heatmap Logic
                                    let bgClass = "bg-transparent";

                                    if (isSelf) {
                                        bgClass = "bg-muted dark:bg-muted diagonal-pattern";
                                    } else if (cellData) {
                                        if (cellData.weight >= 4) bgClass = "bg-indigo-600";
                                        else if (cellData.weight >= 2) bgClass = "bg-indigo-400";
                                        else bgClass = "bg-indigo-200";
                                    }

                                    return (
                                        <div
                                            key={`${sourceNode.id}-${targetNode.id}`}
                                            className={`matrix-cell border-border ${bgClass} ${cellData ? 'hover:scale-105 hover:z-30 hover:shadow-md cursor-pointer' : ''}`}
                                            title={cellData ? `${sourceNode.name} → ${targetNode.name}\nWeight: ${cellData.weight}\n(${cellData.edges.length} connections)` : undefined}
                                            onClick={() => {
                                                if (cellData && onNodeClick) {
                                                    onNodeClick(sourceNode.id);
                                                }
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        ))}

                    </div>
                    <ScrollBar orientation="horizontal" />
                    <ScrollBar orientation="vertical" />
                </ScrollArea>
            </CardContent>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2 px-2">
                <span className="font-medium">Legend:</span>
                <div className="flex items-center gap-1"><div className="w-3 h-3 bg-indigo-200 rounded-sm"></div> Low (1)</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 bg-indigo-400 rounded-sm"></div> Medium (2-3)</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 bg-indigo-600 rounded-sm"></div> High (4+)</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 bg-muted border border-border rounded-sm"></div> Self</div>
            </div>
        </Card>
    );
};

export default KnowledgeMatrix;
