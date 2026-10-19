import React, { useState, useCallback } from 'react';
import { Brain, Check, X, Edit, ChevronDown, ChevronRight, AlertCircle, Sparkles, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@domain-ui/core/ui/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@domain-ui/core/ui/components/ui/dialog';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';

interface ErrorCluster {
    id: number;
    name: string | null;
    errorCount: number;
    sampleErrors: string[];
    suggestedPattern: {
        id?: string;
        category?: string;
        name?: string;
        triggers?: Array<{ type: string; value: string; weight?: number }>;
        diagnosis?: { summary?: string; explanation?: string };
        fixes?: Array<{ id: string; description: string }>;
    } | null;
    centroidText: string | null;
    status: string;
    createdAt: string;
}

interface ClusterReviewPanelProps {
    clusters: ErrorCluster[];
    onRefresh: () => void;
    loading?: boolean;
}

export function ClusterReviewPanel({
    clusters,
    onRefresh,
    loading = false,
}: ClusterReviewPanelProps) {
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [editingCluster, setEditingCluster] = useState<ErrorCluster | null>(null);
    const [editedPattern, setEditedPattern] = useState<ErrorCluster['suggestedPattern']>(null);
    const [processing, setProcessing] = useState<number | null>(null);
    const { toast } = useToast();

    const handleApprove = useCallback(async (cluster: ErrorCluster, pattern?: ErrorCluster['suggestedPattern']) => {
        setProcessing(cluster.id);
        try {
            await apiRequest('POST', `/api/clusters/${cluster.id}/approve`, {
                pattern: pattern || cluster.suggestedPattern,
            });
            toast({
                title: 'Pattern Approved',
                description: `Added "${cluster.suggestedPattern?.name || 'pattern'}" to knowledge base`,
            });
            onRefresh();
        } catch (err: any) {
            toast({
                title: 'Failed to approve',
                description: err.message,
                variant: 'destructive',
            });
        } finally {
            setProcessing(null);
        }
    }, [onRefresh, toast]);

    const handleReject = useCallback(async (clusterId: number) => {
        setProcessing(clusterId);
        try {
            await apiRequest('POST', `/api/clusters/${clusterId}/reject`);
            toast({
                title: 'Cluster Rejected',
                description: 'Errors will be re-clustered in future runs',
            });
            onRefresh();
        } catch (err: any) {
            toast({
                title: 'Failed to reject',
                description: err.message,
                variant: 'destructive',
            });
        } finally {
            setProcessing(null);
        }
    }, [onRefresh, toast]);

    const handleEdit = useCallback((cluster: ErrorCluster) => {
        setEditingCluster(cluster);
        setEditedPattern(cluster.suggestedPattern);
    }, []);

    const handleSaveEdit = useCallback(async () => {
        if (!editingCluster || !editedPattern) return;
        await handleApprove(editingCluster, editedPattern);
        setEditingCluster(null);
        setEditedPattern(null);
    }, [editingCluster, editedPattern, handleApprove]);

    const getCategoryColor = (category: string): string => {
        switch (category) {
            case 'auth': return 'bg-red-100 text-red-700';
            case 'rate_limit': return 'bg-orange-100 text-orange-700';
            case 'server_error': return 'bg-muted text-foreground';
            case 'timeout': return 'bg-yellow-100 text-yellow-700';
            case 'network': return 'bg-blue-100 text-blue-700';
            default: return 'bg-purple-100 text-purple-700';
        }
    };

    if (clusters.length === 0) {
        return (
            <Card className="border-dashed">
                <CardContent className="py-8 text-center">
                    <Brain className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                    <h3 className="font-medium text-lg mb-2">No Pending Clusters</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                        When similar errors are detected, they'll appear here for review.
                    </p>
                    <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
                        <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
                        Check for New Clusters
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Brain className="h-5 w-5 text-purple-600" />
                        Discovered Error Clusters
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Review AI-discovered patterns and add them to your knowledge base
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
                    <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
                    Refresh
                </Button>
            </div>

            {clusters.map((cluster) => (
                <Collapsible
                    key={cluster.id}
                    open={expandedId === cluster.id}
                    onOpenChange={(open) => setExpandedId(open ? cluster.id : null)}
                >
                    <Card className="border-purple-200 bg-purple-50/30">
                        <CardHeader className="py-3 px-4">
                            <CollapsibleTrigger className="flex items-center justify-between w-full">
                                <div className="flex items-center gap-3">
                                    {expandedId === cluster.id ? (
                                        <ChevronDown className="h-4 w-4 text-purple-600" />
                                    ) : (
                                        <ChevronRight className="h-4 w-4 text-purple-600" />
                                    )}
                                    <div className="text-left">
                                        <CardTitle className="text-sm font-medium">
                                            {cluster.suggestedPattern?.name || `Cluster #${cluster.id}`}
                                        </CardTitle>
                                        <CardDescription className="text-xs">
                                            {cluster.errorCount} similar errors detected
                                        </CardDescription>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {cluster.suggestedPattern?.category && (
                                        <Badge className={cn("text-xs", getCategoryColor(cluster.suggestedPattern.category))}>
                                            {cluster.suggestedPattern.category}
                                        </Badge>
                                    )}
                                    <Badge variant="outline" className="text-xs bg-purple-100 text-purple-700">
                                        <Sparkles className="h-3 w-3 mr-1" />
                                        AI Discovered
                                    </Badge>
                                </div>
                            </CollapsibleTrigger>
                        </CardHeader>

                        <CollapsibleContent>
                            <CardContent className="pt-0 px-4 pb-4 space-y-4">
                                {/* Sample Errors */}
                                <div>
                                    <Label className="text-xs font-medium text-purple-700">Sample Errors</Label>
                                    <div className="mt-1 space-y-1">
                                        {cluster.sampleErrors.slice(0, 3).map((error, i) => (
                                            <div key={i} className="p-2 bg-card rounded text-xs font-mono text-foreground truncate">
                                                {error}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Suggested Pattern */}
                                {cluster.suggestedPattern && (
                                    <div>
                                        <Label className="text-xs font-medium text-purple-700">Suggested Pattern</Label>
                                        <div className="mt-1 p-3 bg-card rounded border border-purple-100">
                                            <div className="flex items-center gap-2 mb-2">
                                                <AlertCircle className="h-4 w-4 text-purple-600" />
                                                <span className="font-medium text-sm">
                                                    {cluster.suggestedPattern.diagnosis?.summary || 'Unknown pattern'}
                                                </span>
                                            </div>
                                            {cluster.suggestedPattern.triggers && (
                                                <div className="flex flex-wrap gap-1 mb-2">
                                                    {cluster.suggestedPattern.triggers.slice(0, 5).map((trigger, i) => (
                                                        <Badge key={i} variant="outline" className="text-[10px]">
                                                            {trigger.type}: "{trigger.value}"
                                                        </Badge>
                                                    ))}
                                                </div>
                                            )}
                                            {cluster.suggestedPattern.diagnosis?.explanation && (
                                                <p className="text-xs text-muted-foreground">
                                                    {cluster.suggestedPattern.diagnosis.explanation}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="flex items-center gap-2 pt-2 border-t border-purple-200">
                                    <Button
                                        size="sm"
                                        className="bg-green-600 hover:bg-green-700 text-foreground"
                                        onClick={() => handleApprove(cluster)}
                                        disabled={processing === cluster.id}
                                    >
                                        <Check className="h-4 w-4 mr-1" />
                                        Approve
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleEdit(cluster)}
                                        disabled={processing === cluster.id}
                                    >
                                        <Edit className="h-4 w-4 mr-1" />
                                        Edit & Approve
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                        onClick={() => handleReject(cluster.id)}
                                        disabled={processing === cluster.id}
                                    >
                                        <X className="h-4 w-4 mr-1" />
                                        Reject
                                    </Button>
                                </div>
                            </CardContent>
                        </CollapsibleContent>
                    </Card>
                </Collapsible>
            ))}

            {/* Edit Dialog */}
            <Dialog open={!!editingCluster} onOpenChange={() => setEditingCluster(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit Pattern</DialogTitle>
                    </DialogHeader>
                    {editedPattern && (
                        <div className="space-y-4">
                            <div>
                                <Label>Pattern Name</Label>
                                <Input
                                    value={editedPattern.name || ''}
                                    onChange={(e) => setEditedPattern({ ...editedPattern, name: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label>Summary</Label>
                                <Input
                                    value={editedPattern.diagnosis?.summary || ''}
                                    onChange={(e) => setEditedPattern({
                                        ...editedPattern,
                                        diagnosis: { ...editedPattern.diagnosis, summary: e.target.value }
                                    })}
                                />
                            </div>
                            <div>
                                <Label>Explanation</Label>
                                <Textarea
                                    value={editedPattern.diagnosis?.explanation || ''}
                                    onChange={(e) => setEditedPattern({
                                        ...editedPattern,
                                        diagnosis: { ...editedPattern.diagnosis, explanation: e.target.value }
                                    })}
                                    rows={3}
                                />
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingCluster(null)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSaveEdit}>
                            Save & Approve
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default ClusterReviewPanel;

