import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@domain-ui/core/ui/components/ui/table";
import { TableProperties, Plus, X } from 'lucide-react';
import { KnowledgeNode } from "@shared/schema/knowledge/graph";
import { cn } from "@/lib/utils";

interface KnowledgePivotProps {
    nodes: KnowledgeNode[];
    onNodeClick?: (nodeId: string) => void;
}

// Helper to safely get nested values
const getValue = (obj: any, path: string): string => {
    if (!path) return 'Uncategorized';

    // Direct property access
    if (obj[path] !== undefined && typeof obj[path] !== 'object') {
        return String(obj[path]);
    }

    // Check inside data object
    if (path.startsWith('data.')) {
        const key = path.replace('data.', '');
        return String(obj.data?.[key] || 'Uncategorized');
    }

    // Fallback check in data if not specific
    if (obj.data?.[path]) {
        return String(obj.data[path]);
    }

    return 'Uncategorized';
};

// Helper to pivot data
const pivotData = (nodes: any[], rowField: string, colField: string, valueField: string) => {
    // 1. Extract Unique Row/Col Keys
    const rowKeys = Array.from(new Set(nodes.map(n => getValue(n, rowField)))).sort();
    const colKeys = Array.from(new Set(nodes.map(n => getValue(n, colField)))).sort();

    // 2. Build Matrix
    const matrix: Record<string, Record<string, number>> = {};

    nodes.forEach(node => {
        const r = getValue(node, rowField);
        const c = getValue(node, colField);

        if (!matrix[r]) matrix[r] = {};

        // Aggregation: Count (default) or Sum (if numeric valueField)
        if (valueField === 'count') {
            matrix[r][c] = (matrix[r][c] || 0) + 1;
        } else if (valueField === 'confidence') {
            // For Average Confidence, we store [sum, count] temporarily? 
            // Simplifying to Sum for now
            matrix[r][c] = (matrix[r][c] || 0) + (node.confidenceScore || 0);
        }
    });

    // Post-process Average if needed
    if (valueField === 'confidence') {
        return { rowKeys, colKeys, matrix, isAverage: true, rawNodes: nodes };
    }

    return { rowKeys, colKeys, matrix, isAverage: false };
};

const KnowledgePivot: React.FC<KnowledgePivotProps> = ({ nodes, onNodeClick }) => {
    const [rowField, setRowField] = useState<string>("label");
    const [colField, setColField] = useState<string>("verificationStatus");
    const [valueField, setValueField] = useState<string>("count");

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

    // Memoize the pivot computation
    const { rowKeys, colKeys, matrix, isAverage } = useMemo(() => {
        // If "confidence", we need a refined approach to get averages
        if (valueField === 'confidence') {
            const rowKeys = Array.from(new Set(nodes.map(n => getValue(n, rowField)))).sort();
            const colKeys = Array.from(new Set(nodes.map(n => getValue(n, colField)))).sort();
            const sums: any = {};
            const counts: any = {};

            nodes.forEach(n => {
                const r = getValue(n, rowField);
                const c = getValue(n, colField);
                if (!sums[r]) { sums[r] = {}; counts[r] = {}; }

                sums[r][c] = (sums[r][c] || 0) + (n.confidenceScore || 0);
                counts[r][c] = (counts[r][c] || 0) + 1;
            });

            // Convert to matrix of averages
            const finalMatrix: any = {};
            rowKeys.forEach(r => {
                finalMatrix[r] = {};
                colKeys.forEach(c => {
                    if (counts[r]?.[c]) {
                        finalMatrix[r][c] = sums[r][c] / counts[r][c];
                    }
                });
            });
            return { rowKeys, colKeys, matrix: finalMatrix, isAverage: true };
        }

        // Default Count
        return pivotData(nodes, rowField, colField, 'count');
    }, [nodes, rowField, colField, valueField]);

    return (
        <Card className="h-full border-0 shadow-none bg-transparent flex flex-col">
            <CardHeader className="pb-2 flex-none flex-row items-center justify-between space-y-0">
                <div className="space-y-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <TableProperties className="w-5 h-5 text-emerald-600" />
                        Pivot Report
                    </CardTitle>
                    <CardDescription>
                        Cross-analysis of {nodes.length} entities.
                    </CardDescription>
                </div>

                {/* Configuration Panel */}
                <div className="flex items-center gap-4 bg-muted/30 p-2 rounded-lg border">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground w-8">Rows</span>
                        <Select value={rowField} onValueChange={setRowField}>
                            <SelectTrigger className="h-7 w-[130px] text-xs bg-background">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="label">Type</SelectItem>
                                <SelectItem value="verificationStatus">Status</SelectItem>
                                <SelectItem value="organizationId">Org ID</SelectItem>
                                <SelectItem value="knowledgeTopicId">Topic ID</SelectItem>
                                {/* Dynamic Data Keys */}
                                {availableKeys.filter(k => !['label', 'verificationStatus', 'organizationId', 'knowledgeTopicId'].includes(k)).map(k => (
                                    <SelectItem key={k} value={k}>{k}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="w-px h-6 bg-border" />

                    <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground w-8">Cols</span>
                        <Select value={colField} onValueChange={setColField}>
                            <SelectTrigger className="h-7 w-[130px] text-xs bg-background">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="verificationStatus">Status</SelectItem>
                                <SelectItem value="label">Type</SelectItem>
                                <SelectItem value="sourceType">Source</SelectItem>
                                {/* Dynamic Data Keys */}
                                {availableKeys.filter(k => !['label', 'verificationStatus', 'sourceType'].includes(k)).map(k => (
                                    <SelectItem key={k} value={k}>{k}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="w-px h-6 bg-border" />

                    <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground w-8">Values</span>
                        <Select value={valueField} onValueChange={setValueField}>
                            <SelectTrigger className="h-7 w-[130px] text-xs bg-background">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="count">Count</SelectItem>
                                <SelectItem value="confidence">Avg Confidence</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="flex-1 overflow-auto p-0 border-t">
                <div className="relative w-full">
                    <Table>
                        <TableHeader className="sticky top-0 bg-secondary/50 backdrop-blur z-10">
                            <TableRow>
                                <TableHead className="w-[200px] font-bold border-r bg-secondary/50">
                                    {rowField} \ {colField}
                                </TableHead>
                                {colKeys.map(col => (
                                    <TableHead key={col} className="text-center min-w-[100px]">
                                        {col || 'Uncategorized'}
                                    </TableHead>
                                ))}
                                <TableHead className="font-bold text-center bg-secondary/30">Total</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rowKeys.map(row => {
                                const rowTotal = colKeys.reduce((acc, col) => acc + (matrix[row]?.[col] || 0), 0);
                                const count = isAverage ? colKeys.filter(c => matrix[row]?.[c]).length : 0;
                                const rowAvg = isAverage && count > 0 ? rowTotal / count : rowTotal;

                                return (
                                    <TableRow key={row}>
                                        <TableCell className="font-medium border-r bg-muted/10 sticky left-0">
                                            {row || 'Uncategorized'}
                                        </TableCell>
                                        {colKeys.map(col => {
                                            const val = matrix[row]?.[col];
                                            return (
                                                <TableCell key={col} className="text-center p-0">
                                                    {val !== undefined ? (
                                                        <div className={cn(
                                                            "w-full h-full py-2 px-4 transition-colors",
                                                            "hover:bg-muted/50 cursor-pointer",
                                                            val > 0 && "font-medium"
                                                        )}>
                                                            {isAverage ? `${(val * 100).toFixed(0)}%` : val}
                                                        </div>
                                                    ) : (
                                                        <span className="text-muted-foreground/30">-</span>
                                                    )}
                                                </TableCell>
                                            );
                                        })}
                                        <TableCell className="text-center font-bold bg-muted/5">
                                            {isAverage
                                                ? `${(rowAvg * 100).toFixed(0)}%`
                                                : rowTotal}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>

                {rowKeys.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <p>No data available for the selected configuration.</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default KnowledgePivot;
