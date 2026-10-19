import { KnowledgeNode } from "@shared/schema/knowledge/graph";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@domain-ui/core/ui/components/ui/table";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { X, ExternalLink, Trash2, Download, GitPullRequest } from "lucide-react";

interface KnowledgeWorkbenchProps {
    nodes: KnowledgeNode[];
    onRemoveNode: (nodeId: number) => void;
    onClearAll: () => void;
    onFocusNode: (node: KnowledgeNode) => void;
    onFindPath: (sourceId: number, targetId: number) => void;
}

export function KnowledgeWorkbench({ nodes, onRemoveNode, onClearAll, onFocusNode, onFindPath }: KnowledgeWorkbenchProps) {
    const getCognitiveBadge = (node: KnowledgeNode) => {
        const state = (node.data as any)?.cognitive_state || (node.data as any)?.cognitiveState;
        if (!state) return null;

        const colors: Record<string, string> = {
            symptom: "bg-amber-100 text-amber-700 border-amber-200",
            cause: "bg-red-100 text-red-700 border-red-200",
            effect: "bg-blue-100 text-blue-700 border-blue-200",
            outcome: "bg-green-100 text-green-700 border-green-200",
            resource: "bg-purple-100 text-purple-700 border-purple-200",
        };

        return (
            <Badge variant="outline" className={`${colors[state.toLowerCase()] || ""} capitalize font-medium`}>
                {state}
            </Badge>
        );
    };

    const handleExport = () => {
        const data = nodes.map(n => ({
            id: n.id,
            name: n.name,
            label: n.label,
            externalId: n.externalId,
            cognitiveState: (n.data as any)?.cognitive_state || 'none',
            properties: JSON.stringify(n.data)
        }));

        const csv = [
            ["ID", "Name", "Type", "External ID", "Cognitive State", "Properties"],
            ...data.map(row => [row.id, row.name, row.label, row.externalId || "", row.cognitiveState, row.properties])
        ].map(e => e.join(",")).join("\n");

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `workbench_export_${new Date().toISOString()}.csv`;
        a.click();
    };

    if (nodes.length === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground bg-muted/50">
                <p className="text-sm">No nodes selected for analysis.</p>
                <p className="text-xs">Shift+Click nodes in the graph to add them to the workbench.</p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-card">
            <div className="p-3 border-b flex items-center justify-between bg-muted/50">
                <div className="flex items-center gap-4">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                        Analytical Workbench
                        <Badge variant="secondary" className="rounded-full px-2 py-0 h-5">{nodes.length}</Badge>
                    </h3>
                    <div className="h-4 w-[1px] bg-muted" />
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-red-600" onClick={onClearAll}>
                        Clear Workbench
                    </Button>
                </div>
                <div className="flex items-center gap-2">
                    {nodes.length === 2 && (
                        <Button variant="outline" size="sm" className="h-8 gap-2 border-indigo-200 text-indigo-600 hover:bg-indigo-50" onClick={() => onFindPath(nodes[0].id, nodes[1].id)}>
                            <GitPullRequest className="w-3.5 h-3.5" />
                            Find Path
                        </Button>
                    )}
                    <Button variant="outline" size="sm" className="h-8 gap-2" onClick={handleExport}>
                        <Download className="w-3.5 h-3.5" />
                        Export CSV
                    </Button>
                </div>
            </div>

            <ScrollArea className="flex-1">
                <Table>
                    <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
                        <TableRow>
                            <TableHead className="w-[200px]">Node Name</TableHead>
                            <TableHead className="w-[120px]">Type</TableHead>
                            <TableHead className="w-[150px]">Cognitive State</TableHead>
                            <TableHead>External ID / Metadata</TableHead>
                            <TableHead className="text-right w-[100px]">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {nodes.map((node) => (
                            <TableRow key={node.id} className="group transition-colors hover:bg-muted/80">
                                <TableCell className="font-medium">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-indigo-400" />
                                        <span className="truncate max-w-[180px]" title={node.name}>{node.name}</span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" className="font-normal">{node.label}</Badge>
                                </TableCell>
                                <TableCell>
                                    {getCognitiveBadge(node)}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-xs font-mono">
                                    {node.externalId || (Object.keys(node.data as object).length > 0 ? "{...}" : "-")}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onFocusNode(node)} title="Focus in Graph">
                                            <ExternalLink className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500" onClick={() => onRemoveNode(node.id)} title="Remove from Workbench">
                                            <X className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </ScrollArea>
        </div>
    );
}
