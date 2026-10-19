import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { ResponsiveContainer, Treemap, Tooltip } from 'recharts';
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Layers, Info, LayoutTemplate } from 'lucide-react';
import { KnowledgeNode } from "@shared/schema/knowledge/graph";

interface KnowledgeTreeMapProps {
    nodes: KnowledgeNode[];
    onNodeClick?: (nodeId: string) => void;
}

// Helper to nest flat data based on grouping fields
const nestData = (nodes: any[], groupBy: string[], sizeBy: string): any[] => {
    if (!nodes.length) return [];
    if (!groupBy.length) return nodes.map(n => ({ ...n, size: 1 }));

    const groupField = groupBy[0];
    const remainingGroups = groupBy.slice(1);

    const groups: Record<string, any[]> = {};
    nodes.forEach(node => {
        const key = String(node[groupField] || 'Uncategorized');
        if (!groups[key]) groups[key] = [];
        groups[key].push(node);
    });

    return Object.entries(groups).map(([key, children]) => {
        // Recursion or Leaf
        const nestedChildren: any[] = remainingGroups.length > 0
            ? nestData(children, remainingGroups, sizeBy)
            : children.map(c => ({
                name: c.name || c.label || 'Unknown',
                size: sizeBy === 'count' ? 1 : (c.confidenceScore || 0.5) * 100,
                ...c
            }));

        // Calculate total size for this group
        const totalSize = nestedChildren.reduce((acc: number, c: any) => acc + (c.size || 0), 0);

        return {
            name: key,
            children: nestedChildren,
            size: totalSize,
            isGroup: true
        };
    });
};

const CustomContent = (props: any) => {
    const { root, depth, x, y, width, height, index, colors, name, size } = props;

    // Determine color based on depth or random for leaf
    const isLeaf = !props.children;
    const color = isLeaf
        ? "#fff" // Leaf nodes are often handled by parent group color in standard treemaps, or need custom logic
        : `rgba(99, 102, 241, ${1 - depth * 0.2})`; // Indigo fade

    // Leaf styling
    if (isLeaf) {
        return (
            <g>
                <rect
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    className={depth === 1 ? "fill-indigo-400 stroke-white" : "fill-indigo-200 stroke-white"}
                    strokeWidth={2 / (depth + 1e-10)}
                    strokeOpacity={1 / (depth + 1e-10)}
                />
                {width > 30 && height > 30 && (
                    <text
                        x={x + width / 2}
                        y={y + height / 2 + 5}
                        textAnchor="middle"
                        fill="#1e293b"
                        fontSize={Math.min(12, width / 5)}
                    >
                        {(name || 'Unknown').substring(0, Math.floor(width / 6))}
                    </text>
                )}
            </g>
        );
    }

    return (
        <g>
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                className="fill-transparent stroke-white"
                strokeWidth={2}
            />
        </g>
    );
};

const KnowledgeTreeMap: React.FC<KnowledgeTreeMapProps> = ({ nodes, onNodeClick }) => {
    const [groupBy, setGroupBy] = useState<string>("label"); // Default group by Label
    const [subGroupBy, setSubGroupBy] = useState<string>("none"); // Secondary grouping
    const [sizeBy, setSizeBy] = useState<string>("count");

    // Extract available keys from node.data
    const availableKeys = useMemo(() => {
        const keys = new Set<string>();
        nodes.forEach(node => {
            if (node.data) {
                Object.keys(node.data as object).forEach(k => keys.add(`data.${k}`));
            }
        });
        return Array.from(keys).sort(); // Only showing data.* keys in addition to standard ones
    }, [nodes]);

    const data = useMemo(() => {
        const groups = [groupBy];
        if (subGroupBy !== 'none') groups.push(subGroupBy);

        return nestData(nodes, groups, sizeBy);
    }, [nodes, groupBy, subGroupBy, sizeBy]);

    // Color palette for top-level groups
    const COLORS = ['#8884d8', '#83a6ed', '#8dd1e1', '#82ca9d', '#a4de6c', '#d0ed57'];

    return (
        <Card className="h-full border-0 shadow-none bg-transparent flex flex-col">
            <CardHeader className="pb-2 flex-none flex-row items-center justify-between space-y-0">
                <div className="space-y-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <LayoutTemplate className="w-5 h-5 text-indigo-600" />
                        Knowledge Map
                    </CardTitle>
                    <CardDescription>
                        Hierarchical view of {nodes.length} entities.
                    </CardDescription>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Group By</span>
                        <Select value={groupBy} onValueChange={setGroupBy}>
                            <SelectTrigger className="h-8 w-[140px] text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="label">Type (Label)</SelectItem>
                                <SelectItem value="verificationStatus">Status</SelectItem>
                                <SelectItem value="organizationId">Organization</SelectItem>
                                {/* Dynamic Data Keys */}
                                {availableKeys.filter(k => !['label', 'verificationStatus', 'organizationId'].includes(k)).map(k => (
                                    <SelectItem key={k} value={k}>{k}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Sub-Group</span>
                        <Select value={subGroupBy} onValueChange={setSubGroupBy}>
                            <SelectTrigger className="h-8 w-[140px] text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                <SelectItem value="label">Type (Label)</SelectItem>
                                <SelectItem value="verificationStatus">Status</SelectItem>
                                {/* Dynamic Data Keys */}
                                {availableKeys.filter(k => !['label', 'verificationStatus', 'organizationId'].includes(k)).map(k => (
                                    <SelectItem key={k} value={k}>{k}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Size By</span>
                        <Select value={sizeBy} onValueChange={setSizeBy}>
                            <SelectTrigger className="h-8 w-[120px] text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="count">Count</SelectItem>
                                <SelectItem value="confidence">Confidence</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="flex-1 min-h-0 relative p-4">
                <ResponsiveContainer width="100%" height="100%">
                    <Treemap
                        data={data}
                        dataKey="size"
                        aspectRatio={4 / 3}
                        stroke="#fff"
                        fill="#8884d8"
                        content={<CustomContent />}
                    >
                        <Tooltip
                            content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    return (
                                        <div className="bg-popover text-popover-foreground rounded-lg border shadow-md p-2 text-xs">
                                            <p className="font-semibold mb-1">{data.name}</p>
                                            <p>Size: {data.size?.toFixed(0)}</p>
                                            <p className="opacity-70 mt-1 capitalize text-[10px]">
                                                {data.isGroup ? 'Group' : data.label}
                                            </p>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                    </Treemap>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
};

export default KnowledgeTreeMap;
