/**
 * Knowledge Garden - Human-in-the-Loop Review Interface
 * 
 * A curated review interface for verifying AI-extracted entities
 * before they are promoted to the "Live" Knowledge Graph.
 */

import { useState, useMemo, useEffect } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Leaf,
    Check,
    X,
    Pencil,
    ChevronDown,
    Filter,
    Sparkles,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    Loader2,
    RefreshCw,
    FileText,
    Zap,
    MessageSquare,
    Smile,
    ShieldCheck,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import { Checkbox } from "@domain-ui/core/ui/components/ui/checkbox";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@domain-ui/core/ui/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@domain-ui/core/ui/components/ui/dropdown-menu";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { SourceDocumentPanel } from "@domain-ui/knowledge/ui/components/knowledge/garden/SourceDocumentPanel";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { cn } from "@/lib/utils";
import { ExportButton } from "@domain-ui/core/ui/components/shared/ExportButton";
import { formatDateForExport, formatJSONForExport } from "@/lib/export-utils";

interface KnowledgeNode {
    id: number;
    label: string;
    name: string;
    externalId?: string | null;
    data: Record<string, any>;
    extractionSources?: any[];
    confidenceScore?: number | null;
    verificationStatus: string;
    pipelineExecutionId?: number | null;
    knowledgeTopicId?: number | null;
    topicName?: string | null;
    createdAt: string;
}

interface TopicStat {
    id: number | null;
    name: string;
    staging: number;
    verified: number;
    rejected: number;
}

interface StagingStats {
    byStatus: { staging: number; verified: number; rejected: number };
    byLabel: Record<string, { staging: number; verified: number; rejected: number }>;
    byTopic: Record<string, TopicStat>;
    totalStaging: number;
}

export default function KnowledgeGarden() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { selectedOrgId } = useOrgContext();

    // Parse URL params for initial state
    const searchString = useSearch();
    const searchParams = new URLSearchParams(searchString);

    // State
    const [selectedNodes, setSelectedNodes] = useState<number[]>([]);
    const [filterLabel, setFilterLabel] = useState<string>(searchParams.get("label") || "");
    const [filterTopicId, setFilterTopicId] = useState<number | null>(
        searchParams.get("topicId") ? parseInt(searchParams.get("topicId")!, 10) : null
    );
    const [correctionNode, setCorrectionNode] = useState<KnowledgeNode | null>(null);
    const [corrections, setCorrections] = useState<{ label?: string; name?: string }>({});
    const [page, setPage] = useState(1);
    const [selectedSourceNode, setSelectedSourceNode] = useState<KnowledgeNode | null>(null);

    // Fetch staging nodes
    const { data: stagingData, isLoading: isLoadingStaging, refetch } = useQuery<{
        nodes: KnowledgeNode[];
        total: number;
        page: number;
        limit: number;
    }>({
        queryKey: ["/api/knowledge-graph/staging", page, filterLabel, filterTopicId, selectedOrgId],
        queryFn: async () => {
            const params = new URLSearchParams();
            params.append("page", page.toString());
            params.append("limit", "50");
            if (filterLabel) params.append("label", filterLabel);
            if (filterTopicId) params.append("topicId", filterTopicId.toString());
            if (selectedOrgId) params.append("orgId", selectedOrgId.toString());

            const res = await apiRequest("GET", `/api/knowledge-graph/staging?${params.toString()}`);
            return res.json();
        },
    });

    // Fetch stats
    const { data: stats } = useQuery<StagingStats>({
        queryKey: ["/api/knowledge-graph/staging/stats", selectedOrgId],
        queryFn: async () => {
            const orgParam = selectedOrgId ? `?orgId=${selectedOrgId}` : '';
            const res = await apiRequest("GET", `/api/knowledge-graph/staging/stats${orgParam}`);
            return res.json();
        },
    });

    // Fetch pipeline executions for context
    const { data: executions = [] } = useQuery<any[]>({
        queryKey: ["/api/pipeline-executions"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/pipeline-executions?limit=50");
            return res.json();
        },
    });

    // Single verify mutation
    const verifyMutation = useMutation({
        mutationFn: async ({ nodeId, action, corrections }: { nodeId: number; action: string; corrections?: any }) => {
            const orgParam = selectedOrgId ? `?orgId=${selectedOrgId}` : '';
            const res = await apiRequest("POST", `/api/knowledge-graph/nodes/${nodeId}/verify${orgParam}`, {
                action,
                corrections,
            });
            if (!res.ok) throw new Error("Failed to verify node");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/knowledge-graph/staging"] });
            queryClient.invalidateQueries({ queryKey: ["/api/knowledge-graph/staging/stats"] });
            setCorrectionNode(null);
            setCorrections({});
        },
        onError: (error: any) => {
            toast({
                title: "Verification Failed",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    // Bulk verify mutation
    const bulkVerifyMutation = useMutation({
        mutationFn: async ({ action, nodeIds, label }: { action: string; nodeIds?: number[]; label?: string }) => {
            const orgParam = selectedOrgId ? `?orgId=${selectedOrgId}` : '';
            const res = await apiRequest("POST", `/api/knowledge-graph/staging/bulk-verify${orgParam}`, {
                action,
                nodeIds,
                label,
            });
            if (!res.ok) throw new Error("Bulk verification failed");
            return res.json();
        },
        onSuccess: (data) => {
            toast({
                title: `Bulk ${data.action === "verified" ? "Approved" : "Rejected"}`,
                description: `${data.count} entities have been ${data.action}.`,
            });
            queryClient.invalidateQueries({ queryKey: ["/api/knowledge-graph/staging"] });
            queryClient.invalidateQueries({ queryKey: ["/api/knowledge-graph/staging/stats"] });
            setSelectedNodes([]);
        },
        onError: (error: any) => {
            toast({
                title: "Bulk Action Failed",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    const handleApprove = (nodeId: number) => {
        verifyMutation.mutate({ nodeId, action: "approve" });
    };

    const handleReject = (nodeId: number) => {
        verifyMutation.mutate({ nodeId, action: "reject" });
    };

    const handleCorrectSubmit = () => {
        if (!correctionNode) return;
        verifyMutation.mutate({
            nodeId: correctionNode.id,
            action: "correct",
            corrections,
        });
    };

    const handleBulkApprove = () => {
        if (selectedNodes.length > 0) {
            bulkVerifyMutation.mutate({ action: "approve", nodeIds: selectedNodes });
        }
    };

    const handleBulkReject = () => {
        if (selectedNodes.length > 0) {
            bulkVerifyMutation.mutate({ action: "reject", nodeIds: selectedNodes });
        }
    };

    const handleApproveAllLabel = (label: string) => {
        bulkVerifyMutation.mutate({ action: "approve", label });
    };

    const toggleNodeSelection = (nodeId: number) => {
        setSelectedNodes(prev =>
            prev.includes(nodeId) ? prev.filter(id => id !== nodeId) : [...prev, nodeId]
        );
    };

    const toggleSelectAll = () => {
        if (!stagingData?.nodes) return;
        if (selectedNodes.length === stagingData.nodes.length) {
            setSelectedNodes([]);
        } else {
            setSelectedNodes(stagingData.nodes.map(n => n.id));
        }
    };

    // Get unique labels from stats
    const availableLabels = useMemo(() => {
        if (!stats?.byLabel) return [];
        return Object.keys(stats.byLabel).sort((a, b) => {
            const countA = (stats.byLabel[a]?.staging || 0) + (stats.byLabel[a]?.verified || 0);
            const countB = (stats.byLabel[b]?.staging || 0) + (stats.byLabel[b]?.verified || 0);
            return countB - countA;
        });
    }, [stats]);

    const getConfidenceColor = (score: number | null | undefined) => {
        if (score === null || score === undefined) return "bg-muted";
        if (score >= 0.9) return "bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]";
        if (score >= 0.7) return "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]";
        if (score >= 0.4) return "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]";
        return "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]";
    };

    return (
        <>
        <div className="h-screen flex flex-col bg-background relative cinematic-grid font-sans overflow-hidden">
            {/* Background pattern */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(var(--primary),0.02),transparent_60%)] pointer-events-none" />
            <div className="scanline-overlay absolute inset-0 pointer-events-none opacity-[0.02]" />

            {/* Header */}
            <div className="border-b bg-background/60 backdrop-blur-xl px-8 py-6 flex items-center justify-between sticky top-0 z-50">
                <div className="flex items-center gap-3">
                    <motion.div 
                        initial={{ rotate: -20, scale: 0.8 }}
                        animate={{ rotate: 0, scale: 1 }}
                        className="p-2.5 bg-primary/20 rounded-2xl shadow-inner border border-primary/20"
                    >
                        <Leaf className="w-6 h-6 text-primary fill-primary/20" />
                    </motion.div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">
                            Knowledge Garden
                        </h1>
                        <p className="text-sm text-muted-foreground/80 font-medium">
                            Synthesize and verify the Unified Operational Truth
                        </p>
                    </div>
                </div>

                {/* Stats Summary */}
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-sm">
                        <motion.div 
                            whileHover={{ scale: 1.05 }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-xl"
                        >
                            <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                            <span className="font-semibold text-yellow-700 dark:text-yellow-400">
                                {stats?.totalStaging || 0} Pending
                            </span>
                        </motion.div>
                        <motion.div 
                            whileHover={{ scale: 1.05 }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-xl"
                        >
                            <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                            <span className="font-semibold text-green-700 dark:text-green-400">
                                {stats?.byStatus?.verified || 0} Verified
                            </span>
                        </motion.div>
                        <motion.div 
                            whileHover={{ scale: 1.05 }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-xl"
                        >
                            <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                            <span className="font-semibold text-red-700 dark:text-red-400">
                                {stats?.byStatus?.rejected || 0} Rejected
                            </span>
                        </motion.div>
                    </div>

                    <ExportButton
                        data={stagingData?.nodes || []}
                        filename="knowledge_garden_staging"
                        columns={[
                            { key: 'id', header: 'ID' },
                            { key: 'label', header: 'Type' },
                            { key: 'name', header: 'Name' },
                            { key: 'externalId', header: 'External ID', formatter: (v) => v || '' },
                            { key: 'verificationStatus', header: 'Status' },
                            { key: 'confidenceScore', header: 'Confidence', formatter: (v) => v !== null && v !== undefined ? `${Math.round(v * 100)}%` : '' },
                            { key: 'topicName', header: 'Topic', formatter: (v) => v || '' },
                            { key: 'data', header: 'Data', formatter: formatJSONForExport },
                            { key: 'pipelineExecutionId', header: 'Run ID', formatter: (v) => v ? String(v) : '' },
                            { key: 'createdAt', header: 'Created At', formatter: formatDateForExport },
                        ]}
                    />

                    <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => refetch()} 
                        className="rounded-xl hover:bg-primary/5 text-muted-foreground hover:text-primary transition-colors"
                        aria-label="Refresh staging nodes"
                    >
                        <RefreshCw className={cn("w-4 h-4 mr-2", isLoadingStaging && "animate-spin")} aria-hidden="true" />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Toolbar */}
            <div className="border-b bg-background/40 backdrop-blur-md px-8 py-3 flex items-center gap-4 z-40">
                {/* Filter by Label */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-9 gap-1">
                            <Filter className="w-3.5 h-3.5 mr-1" />
                            {filterLabel || "All Labels"}
                            <ChevronDown className="w-3.5 h-3.5 opacity-50" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                        <DropdownMenuLabel>Filter by Entity Type</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuCheckboxItem
                            checked={!filterLabel}
                            onCheckedChange={() => setFilterLabel("")}
                        >
                            All Labels
                        </DropdownMenuCheckboxItem>
                        {availableLabels.map(label => {
                            const stagingCount = stats?.byLabel[label]?.staging || 0;
                            const verifiedCount = stats?.byLabel[label]?.verified || 0;
                            const countText = stagingCount > 0 ? `${stagingCount} pending` : `${verifiedCount} verified`;
                            return (
                                <DropdownMenuCheckboxItem
                                    key={label}
                                    checked={filterLabel === label}
                                    onCheckedChange={() => setFilterLabel(label)}
                                >
                                    {label} ({countText})
                                </DropdownMenuCheckboxItem>
                            );
                        })}
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Filter by Topic */}
                {stats?.byTopic && Object.keys(stats.byTopic).length > 0 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="h-9 gap-1">
                                <FileText className="w-3.5 h-3.5 mr-1" />
                                {filterTopicId
                                    ? stats.byTopic[String(filterTopicId)]?.name || "Topic"
                                    : "All Topics"}
                                <ChevronDown className="w-3.5 h-3.5 opacity-50" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-64">
                            <DropdownMenuLabel>Filter by Knowledge Topic</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuCheckboxItem
                                checked={!filterTopicId}
                                onCheckedChange={() => setFilterTopicId(null)}
                            >
                                All Topics
                            </DropdownMenuCheckboxItem>
                            {Object.entries(stats.byTopic).map(([key, topic]) => (
                                <DropdownMenuCheckboxItem
                                    key={key}
                                    checked={filterTopicId === topic.id}
                                    onCheckedChange={() => setFilterTopicId(topic.id)}
                                >
                                    {topic.name} ({topic.staging || 0})
                                </DropdownMenuCheckboxItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}

                <Separator orientation="vertical" className="h-6" />

                {/* Bulk Actions */}
                {selectedNodes.length > 0 && (
                    <>
                        <span className="text-sm text-muted-foreground">
                            {selectedNodes.length} selected
                        </span>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleBulkApprove}
                            disabled={bulkVerifyMutation.isPending}
                            className="text-primary border-primary/20 hover:bg-primary/5"
                        >
                            <Check className="w-4 h-4 mr-1" />
                            Approve Selected
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleBulkReject}
                            disabled={bulkVerifyMutation.isPending}
                            className="text-destructive border-destructive/20 hover:bg-destructive/10"
                        >
                            <X className="w-4 h-4 mr-1" />
                            Reject Selected
                        </Button>
                        <Separator orientation="vertical" className="h-6" />
                    </>
                )}

                {/* Approve All by Label */}
                {filterLabel && (
                    <Button
                        size="sm"
                        onClick={() => handleApproveAllLabel(filterLabel)}
                        disabled={bulkVerifyMutation.isPending}
                        className=""
                    >
                        <Sparkles className="w-4 h-4 mr-1" />
                        Approve All {filterLabel}
                    </Button>
                )}
            </div>

                <div className={cn(
                    "flex-1 overflow-hidden p-8 transition-all duration-500 glass-panel-deep m-4 rounded-[2rem] shadow-2xl relative z-10",
                    selectedSourceNode ? "w-1/2" : "w-full"
                )}>
                    {isLoadingStaging ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="w-8 h-8 animate-spin text-green-600" />
                        </div>
                    ) : (stagingData?.nodes?.length || 0) === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                            <div className="p-4 bg-primary/10 rounded-full mb-4">
                                <CheckCircle2 className="w-12 h-12 text-primary" />
                            </div>
                            <h2 className="text-xl font-semibold text-foreground mb-2">All Caught Up!</h2>
                            <p className="text-muted-foreground max-w-md">
                                There are no entities pending review. New extractions will appear here automatically.
                            </p>
                        </div>
                    ) : (
                        <ScrollArea className="h-full">
                            <div className="space-y-4 pr-4">
                                {/* Select All Header */}
                                <div className="flex items-center gap-2 px-4 py-3 bg-background/40 backdrop-blur-sm rounded-2xl sticky top-0 z-10 border border-border/50 shadow-sm transition-all">
                                    <Checkbox
                                        checked={stagingData?.nodes && selectedNodes.length === stagingData.nodes.length}
                                        onCheckedChange={toggleSelectAll}
                                        className="rounded-md"
                                    />
                                    <span className="text-sm font-semibold tracking-tight">
                                        Select All ({stagingData?.nodes?.length || 0} items)
                                    </span>
                                </div>

                                <AnimatePresence mode="popLayout">
                                    {/* Entity Cards */}
                                    {stagingData?.nodes?.map((node, idx) => (
                                        <motion.div
                                            key={node.id}
                                            layout
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.95 }}
                                            transition={{ duration: 0.3, delay: idx * 0.03 }}
                                        >
                                            <Card
                                                className={cn(
                                                    "border-border/40 shadow-sm transition-all duration-500 group overflow-hidden relative holographic-card rounded-[1.25rem]",
                                                    selectedNodes.includes(node.id) 
                                                        ? "ring-2 ring-primary/40 bg-primary/5 border-primary/20" 
                                                        : "bg-card/30 hover:bg-card/80 hover:shadow-xl hover:border-primary/20 backdrop-blur-md"
                                                )}
                                            >
                                                {/* Confidence Gradient Border */}
                                                <div className={cn(
                                                    "absolute left-0 top-0 bottom-0 w-1 opacity-80",
                                                    getConfidenceColor(node.confidenceScore)
                                                )} />
                                        <CardContent className="p-4">
                                            <div className="flex items-start gap-4">
                                                {/* Checkbox */}
                                                <Checkbox
                                                    checked={selectedNodes.includes(node.id)}
                                                    onCheckedChange={() => toggleNodeSelection(node.id)}
                                                    className="mt-1"
                                                />

                                                {/* Entity Info */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <Badge variant="secondary" className="text-xs">
                                                            {node.label}
                                                        </Badge>
                                                        {node.confidenceScore !== null && node.confidenceScore !== undefined && (
                                                            <div className="flex items-center gap-1">
                                                                <div
                                                                    className={`w-2 h-2 rounded-full ${getConfidenceColor(node.confidenceScore)}`}
                                                                />
                                                                <span className="text-xs text-muted-foreground">
                                                                    {Math.round(node.confidenceScore * 100)}% confidence
                                                                </span>
                                                            </div>
                                                        )}
                                                        {node.externalId && (
                                                            <span className="text-xs text-muted-foreground font-mono">
                                                                {node.externalId}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <h3 className="font-medium truncate">{node.name}</h3>

                                                    {/* Data Preview */}
                                                    {node.data && Object.keys(node.data).length > 0 && (
                                                        <div className="mt-2 text-xs text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 w-full min-w-0">
                                                            {Object.entries(node.data || {}).slice(0, 4).map(([key, value]) => (
                                                                <div key={key} className="truncate min-w-0">
                                                                    <span className="font-medium">{key}:</span>{" "}
                                                                    <span>{value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "")}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Extraction Source */}
                                                    {node.pipelineExecutionId && (
                                                        <div className="mt-2 text-xs text-muted-foreground">
                                                            <span className="opacity-60">From Run #{node.pipelineExecutionId}</span>
                                                        </div>
                                                    )}

                                                    {/* Topic */}
                                                    {node.topicName && (
                                                        <div className="mt-1 flex items-center gap-1 text-xs text-primary/70">
                                                            <FileText className="w-3 h-3" />
                                                            <span>{node.topicName}</span>
                                                        </div>
                                                    )}

                                                     {/* Auto-Summary (Semantic Enrichment Pillar) */}
                                                     {node.data?.auto_summary && (
                                                         <div className="mt-2 text-sm text-foreground/90 bg-primary/5 p-2 rounded-lg border border-primary/10 italic">
                                                             <MessageSquare className="w-3.5 h-3.5 inline mr-1.5 opacity-60" />
                                                             {node.data.auto_summary}
                                                         </div>
                                                     )}

                                                     {/* Topics (Tagging Pillar) */}
                                                     {node.data?.topics && Array.isArray(node.data.topics) && node.data.topics.length > 0 && (
                                                         <div className="mt-3 flex flex-wrap gap-1.5">
                                                             {node.data.topics.map((t: string) => (
                                                                 <Badge key={t} variant="outline" className="text-[10px] uppercase tracking-wider font-bold bg-muted/50 border-border/60">
                                                                     {t}
                                                                 </Badge>
                                                             ))}
                                                         </div>
                                                     )}

                                                     {/* Sentiment & Urgency Indicators */}
                                                     <div className="flex items-center gap-3 mt-3">
                                                         {node.data?.sentiment !== undefined && (
                                                             <div className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground uppercase tracking-widest bg-muted/30 px-2 py-1 rounded-md">
                                                                 <Smile className={cn("w-3 h-3", node.data.sentiment > 0 ? "text-emerald-500" : "text-rose-400")} />
                                                                 Sentiment: {node.data.sentiment > 0 ? "+" : ""}{node.data.sentiment.toFixed(1)}
                                                             </div>
                                                         )}
                                                         {node.data?.urgency !== undefined && node.data.urgency > 0.5 && (
                                                             <div className="flex items-center gap-1 text-[10px] font-bold text-rose-500 uppercase tracking-widest animate-pulse bg-rose-500/10 px-2 py-1 rounded-md border border-rose-500/20">
                                                                 <Zap className="w-3 h-3" />
                                                                 Critical Priority
                                                             </div>
                                                         )}
                                                         {node.confidenceScore && node.confidenceScore > 0.9 && (
                                                             <div className="flex items-center gap-1 text-[10px] font-bold text-primary uppercase tracking-widest ml-auto bg-primary/10 px-2 py-1 rounded-md border border-primary/20 animate-pulse-glow">
                                                                 <ShieldCheck className="w-3.5 h-3.5" />
                                                                 AI Verified
                                                             </div>
                                                         )}
                                                     </div>
                                                 </div>

                                                 {/* Actions */}
                                                 <div className="flex flex-col gap-2 flex-shrink-0 ml-auto self-stretch justify-center opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0 duration-500">
                                                     <Button
                                                         size="sm"
                                                         onClick={() => handleApprove(node.id)}
                                                         disabled={verifyMutation.isPending}
                                                         className="h-9 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 font-bold uppercase tracking-widest text-[10px] rounded-xl px-4"
                                                     >
                                                         <Check className="w-3.5 h-3.5 mr-2" />
                                                         Promote
                                                     </Button>
                                                     <Button
                                                         size="sm"
                                                         variant="ghost"
                                                         onClick={() => {
                                                             setCorrectionNode(node);
                                                             setCorrections({ label: node.label, name: node.name });
                                                         }}
                                                         className="h-9 text-muted-foreground hover:text-primary hover:bg-primary/5 font-bold uppercase tracking-widest text-[10px] rounded-xl"
                                                     >
                                                         <Pencil className="w-3.5 h-3.5 mr-2" />
                                                         Edit
                                                     </Button>
                                                     <Button
                                                         size="sm"
                                                         variant="ghost"
                                                         onClick={() => handleReject(node.id)}
                                                         disabled={verifyMutation.isPending}
                                                         className="h-9 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/5 font-bold uppercase tracking-widest text-[10px] rounded-xl"
                                                     >
                                                         <X className="w-3.5 h-3.5 mr-2" />
                                                         Drop
                                                     </Button>
                                                     <Button
                                                         size="sm"
                                                         variant="ghost"
                                                         onClick={() => setSelectedSourceNode(node)}
                                                         className="h-9 text-muted-foreground hover:text-indigo-500 hover:bg-indigo-500/5 font-bold uppercase tracking-widest text-[10px] rounded-xl"
                                                     >
                                                         <FileText className="w-3.5 h-3.5 mr-2" />
                                                         Context
                                                     </Button>
                                                 </div>
                                             </div>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            ))}

                                {/* Pagination */}
                                {stagingData && stagingData.total > stagingData.limit && (
                                    <div className="flex items-center justify-center gap-2 py-4">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setPage(p => Math.max(1, p - 1))}
                                            disabled={page === 1}
                                        >
                                            Previous
                                        </Button>
                                        <span className="text-sm text-muted-foreground">
                                            Page {page} of {Math.ceil(stagingData.total / stagingData.limit)}
                                        </span>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setPage(p => p + 1)}
                                            disabled={page >= Math.ceil(stagingData.total / stagingData.limit)}
                                        >
                                            Next
                                        </Button>
                                    </div>
                                )}
                            </AnimatePresence>
                        </div>
                    </ScrollArea>
                )}
                </div>

                {/* Source Document Panel */}
                {selectedSourceNode && (
                    <SourceDocumentPanel
                        node={selectedSourceNode}
                        onClose={() => setSelectedSourceNode(null)}
                        className="w-1/2"
                    />
                )}
            </div>

            {/* Correction Dialog */}
            <Dialog open={!!correctionNode} onOpenChange={() => setCorrectionNode(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Pencil className="w-5 h-5 text-primary" />
                            Correct Entity
                        </DialogTitle>
                        <DialogDescription>
                            Make corrections before approving this entity.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Entity Type (Label)</Label>
                            <Input
                                value={corrections.label || ""}
                                onChange={e => setCorrections(prev => ({ ...prev, label: e.target.value }))}
                                placeholder={correctionNode?.label}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Entity Name</Label>
                            <Input
                                value={corrections.name || ""}
                                onChange={e => setCorrections(prev => ({ ...prev, name: e.target.value }))}
                                placeholder={correctionNode?.name}
                            />
                        </div>

                        {correctionNode?.data && (
                            <div className="space-y-2">
                                <Label>Current Data</Label>
                                <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-32">
                                    {JSON.stringify(correctionNode.data, null, 2)}
                                </pre>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setCorrectionNode(null)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleCorrectSubmit}
                            disabled={verifyMutation.isPending}
                            className=""
                        >
                            {verifyMutation.isPending ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <Check className="w-4 h-4 mr-2" />
                                    Approve with Corrections
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

