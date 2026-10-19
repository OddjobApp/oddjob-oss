/**
 * Impact Analysis Modal Component
 * 
 * Shows what depends on a given entity using graph traversal.
 * Displays dependencies as an expandable tree with relationship details.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    GitBranch,
    Loader2,
    ChevronRight,
    ChevronDown,
    Network,
    ExternalLink,
    AlertTriangle,
} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface KnowledgeNode {
    id: number;
    label: string;
    name: string;
    externalId?: string | null;
    data?: Record<string, any>;
}

interface KnowledgeEdge {
    id: number;
    sourceId: number;
    targetId: number;
    relation: string;
    weight?: number;
}

interface ImpactAnalysisModalProps {
    targetNode: KnowledgeNode | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onNavigateToNode?: (nodeId: number) => void;
}

// Group edges by relation type
function groupEdgesByRelation(nodes: KnowledgeNode[], edges: KnowledgeEdge[], targetNodeId: number): Map<string, KnowledgeNode[]> {
    const groups = new Map<string, KnowledgeNode[]>();

    for (const edge of edges) {
        // Find nodes that point TO our target (dependencies)
        if (edge.targetId === targetNodeId) {
            const sourceNode = nodes.find(n => n.id === edge.sourceId);
            if (sourceNode) {
                const existing = groups.get(edge.relation) || [];
                existing.push(sourceNode);
                groups.set(edge.relation, existing);
            }
        }
        // Also find nodes that our target points TO (what we depend on)
        if (edge.sourceId === targetNodeId) {
            const targetNode = nodes.find(n => n.id === edge.targetId);
            if (targetNode) {
                const relationKey = `${edge.relation} (outbound)`;
                const existing = groups.get(relationKey) || [];
                existing.push(targetNode);
                groups.set(relationKey, existing);
            }
        }
    }

    return groups;
}

// Color mapping for relation types
const relationColors: Record<string, string> = {
    DEPENDS_ON: "text-red-600 bg-red-50",
    AFFECTS: "text-orange-600 bg-orange-50",
    RELATED_TO: "text-blue-600 bg-blue-50",
    ASSIGNED_TO: "text-purple-600 bg-purple-50",
    MAINTAINS: "text-green-600 bg-green-50",
    REFERENCES: "text-primary bg-primary/10",
    default: "text-muted-foreground bg-muted",
};

function getRelationColor(relation: string): string {
    const normalized = relation.replace(/ \(outbound\)$/, "");
    return relationColors[normalized] || relationColors.default;
}

function DependencyNode({ node, onNavigate }: { node: KnowledgeNode; onNavigate?: (id: number) => void }) {
    return (
        <div
            className={cn(
                "flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer",
                onNavigate && "cursor-pointer"
            )}
            onClick={() => onNavigate?.(node.id)}
        >
            <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                        {node.label}
                    </Badge>
                    <span className="font-medium text-sm truncate">{node.name}</span>
                </div>
                {node.externalId && (
                    <span className="text-xs text-muted-foreground font-mono">
                        {node.externalId}
                    </span>
                )}
            </div>
            {onNavigate && (
                <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
            )}
        </div>
    );
}

function RelationGroup({
    relation,
    nodes,
    onNavigate,
}: {
    relation: string;
    nodes: KnowledgeNode[];
    onNavigate?: (id: number) => void;
}) {
    const [expanded, setExpanded] = useState(true);
    const colorClass = getRelationColor(relation);
    const isOutbound = relation.includes("(outbound)");
    const displayRelation = relation.replace(/ \(outbound\)$/, "");

    return (
        <div className="space-y-1">
            <button
                onClick={() => setExpanded(!expanded)}
                className={cn(
                    "flex items-center gap-2 w-full p-2 rounded-lg text-left transition-colors",
                    colorClass
                )}
            >
                {expanded ? (
                    <ChevronDown className="w-4 h-4" />
                ) : (
                    <ChevronRight className="w-4 h-4" />
                )}
                <GitBranch className="w-4 h-4" />
                <span className="font-medium">{displayRelation}</span>
                {isOutbound && (
                    <span className="text-xs opacity-70">(outbound)</span>
                )}
                <Badge variant="secondary" className="ml-auto text-xs">
                    {nodes.length}
                </Badge>
            </button>

            {expanded && (
                <div className="ml-6 space-y-1 border-l-2 pl-3">
                    {nodes.map(node => (
                        <DependencyNode key={node.id} node={node} onNavigate={onNavigate} />
                    ))}
                </div>
            )}
        </div>
    );
}

export function ImpactAnalysisModal({
    targetNode,
    open,
    onOpenChange,
    onNavigateToNode,
}: ImpactAnalysisModalProps) {
    // Fetch impact analysis data
    const { data: impactData, isLoading, error } = useQuery({
        queryKey: ["/api/knowledge-graph/query", targetNode?.id],
        queryFn: async () => {
            if (!targetNode) return null;

            const res = await apiRequest("POST", "/api/knowledge-graph/query", {
                query: `What is connected to ${targetNode.name}?`,
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.message || "Failed to analyze impact");
            }

            return res.json() as Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }>;
        },
        enabled: open && !!targetNode,
    });

    const relationGroups = targetNode && impactData
        ? groupEdgesByRelation(impactData.nodes, impactData.edges, targetNode.id)
        : new Map();

    const totalConnections = impactData?.nodes?.length || 0;
    const totalEdges = impactData?.edges?.length || 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Network className="h-5 w-5 text-blue-600" />
                        Impact Analysis
                    </DialogTitle>
                    <DialogDescription>
                        {targetNode && (
                            <span>
                                Analyzing connections for{" "}
                                <Badge variant="secondary">{targetNode.label}</Badge>{" "}
                                <strong>{targetNode.name}</strong>
                            </span>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <Separator />

                <ScrollArea className="max-h-[400px]">
                    {isLoading && (
                        <div className="flex flex-col items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-3" />
                            <p className="text-sm text-muted-foreground">Analyzing connections...</p>
                        </div>
                    )}

                    {error && (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <AlertTriangle className="w-8 h-8 text-red-500 mb-3" />
                            <p className="text-sm text-muted-foreground">
                                Failed to analyze impact. Please try again.
                            </p>
                        </div>
                    )}

                    {!isLoading && !error && (
                        <div className="space-y-4 p-1">
                            {/* Summary */}
                            <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg">
                                <div className="text-center">
                                    <div className="text-2xl font-bold text-blue-600">
                                        {totalConnections}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        Connected Entities
                                    </div>
                                </div>
                                <Separator orientation="vertical" className="h-10" />
                                <div className="text-center">
                                    <div className="text-2xl font-bold text-green-600">
                                        {totalEdges}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        Relationships
                                    </div>
                                </div>
                                <Separator orientation="vertical" className="h-10" />
                                <div className="text-center">
                                    <div className="text-2xl font-bold text-purple-600">
                                        {relationGroups.size}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        Relation Types
                                    </div>
                                </div>
                            </div>

                            {/* Dependency Tree */}
                            {relationGroups.size > 0 ? (
                                <div className="space-y-2">
                                    {Array.from(relationGroups.entries()).map(([relation, nodes]) => (
                                        <RelationGroup
                                            key={relation}
                                            relation={relation}
                                            nodes={nodes}
                                            onNavigate={onNavigateToNode}
                                        />
                                    ))}
                                </div>
                            ) : (
                                !isLoading && (
                                    <div className="text-center py-8 text-muted-foreground">
                                        <Network className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                        <p className="text-sm">No connections found</p>
                                        <p className="text-xs mt-1">
                                            This entity has no relationships in the knowledge graph.
                                        </p>
                                    </div>
                                )
                            )}
                        </div>
                    )}
                </ScrollArea>

                {/* Footer Actions */}
                <div className="flex items-center justify-between pt-4 border-t">
                    <Button
                        variant="outline"
                        onClick={() => {
                            if (targetNode) {
                                onNavigateToNode?.(targetNode.id);
                                onOpenChange(false);
                            }
                        }}
                    >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        View in Graph
                    </Button>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default ImpactAnalysisModal;
