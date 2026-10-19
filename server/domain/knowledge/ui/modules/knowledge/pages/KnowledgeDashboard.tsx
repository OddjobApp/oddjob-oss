import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
    Activity,
    CheckCircle2,
    Clock,
    Leaf,
    XCircle,
    ArrowRight,
    BarChart3,
    FileText,
    Search,
    Filter,
    Check,
    X,
    AlertTriangle,
    Loader2,
    Tag,
    Database,
    BookOpen,
    ShieldCheck
} from "lucide-react";

import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator
} from "@domain-ui/core/ui/components/ui/command";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { cn } from "@/lib/utils";
import { useDebounce } from "@domain-ui/core/ui/hooks/useDebounce";
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend
} from "recharts";

// --- Types ---

interface TopicStat {
    id: number;
    name: string;
    total: number;
    verified: number;
    staging: number;
}

interface PendingNode {
    id: number;
    name: string;
    label: string;
    confidenceScore: string | number;
    createdAt: string;
    topicName?: string;
    userEngagementScore: string | null;
    effectivenessRating: number | null;
}

interface DashboardStats {
    totalNodes: number;
    pendingApprovals: number;
    verifiedToday: number;
    rejectedToday: number;
    topicsSummary: TopicStat[];
    pendingNodes: PendingNode[];
    datasetStats?: {
        totalDatasets: number;
        totalExamples: number;
        recentExamples: Array<{
            id: number;
            input: string;
            output: string;
            datasetId: number;
            datasetName: string;
            createdAt: string;
            humanConfidence: number | null;
        }>;
    };
    extractionTrends?: Array<{
        date: string;
        verified: number;
        staging: number;
        rejected: number;
    }>;
    labelsSummary?: Array<{
        label: string;
        count: number;
    }>;
}

// --- Components ---

function MetricCard({
    title,
    value,
    icon: Icon,
    trend,
    trendLabel,
    colorClass
}: {
    title: string;
    value: string | number;
    icon: any;
    trend?: string;
    trendLabel?: string;
    colorClass: string;
}) {
    return (
        <motion.div
            whileHover={{ y: -5, scale: 1.02 }}
            transition={{ type: "spring", stiffness: 300 }}
        >
            <Card className="p-6 transition-all group border-muted/50 holographic-card">
                <div className="flex items-center justify-between mb-4">
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center bg-muted/30 border border-border/50 group-hover:scale-110 transition-transform group-hover:bg-primary/5")}>
                        <Icon className={cn("w-5 h-5", colorClass)} />
                    </div>
                    {trend && (
                        <span className={cn("text-[8px] font-bold px-2 py-0.5 rounded border uppercase tracking-widest",
                            trend.startsWith("+") || trend === "Urgent" ? "bg-primary/10 text-primary border-primary/20" : "bg-destructive/10 text-destructive border-destructive/20"
                        )}>
                            {trend}
                        </span>
                    )}
                </div>
                <div className="space-y-1">
                    <h3 className="text-3xl font-bold tracking-tight text-foreground tabular-nums text-glow-bronze">{value}</h3>
                    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{title}</p>
                </div>
                {trendLabel && (
                    <p className="mt-4 text-[9px] font-medium text-muted-foreground/80 uppercase tracking-widest leading-relaxed">
                        {trendLabel}
                    </p>
                )}
            </Card>
        </motion.div>
    );
}

function TopicRow({ topic }: { topic: TopicStat }) {
    const percentVerified = topic.total > 0 ? Math.round((topic.verified / topic.total) * 100) : 0;

    return (
        <Link href={`/knowledge/garden?topicId=${topic.id}`}>
            <Card className="flex flex-col gap-3 p-4 rounded-xl border border-border/50 hover:bg-muted/30 transition-all cursor-pointer group shadow-sm">
                <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                        <span className="text-[11px] font-bold uppercase tracking-widest text-foreground/80 group-hover:text-primary transition-colors truncate max-w-[180px]" title={topic.name}>
                            {topic.name}
                        </span>
                    </div>
                    <span className="text-[9px] font-bold text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-sm uppercase tracking-tighter">
                        {topic.total} Nodes
                    </span>
                </div>

                <div className="space-y-2">
                    <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-widest">
                        <span className="text-primary/80">{percentVerified}% Verified</span>
                        <span className="text-muted-foreground">{topic.staging} Pending</span>
                    </div>
                    <Progress value={percentVerified} className="h-1.5" indicatorClassName="bg-primary" />
                </div>
            </Card>
        </Link>
    );
}

function PendingNodeRow({
    node,
    onAction
}: {
    node: PendingNode;
    onAction: (id: number, action: 'approve' | 'reject') => void
}) {
    const confidence = Number(node.confidenceScore);
    const confidenceColor = confidence > 0.8 ? "text-primary" : confidence > 0.5 ? "text-amber-500" : "text-destructive";

    return (
        <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-muted/20 hover:bg-muted/30 transition-all group">
            <div className="flex items-start gap-4 min-w-0">
                <div className="mt-1 p-1.5 rounded-lg bg-muted border border-border/50 group-hover:border-amber-500/50 transition-colors">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <h4 className="text-[12px] font-bold text-foreground truncate group-hover:text-primary transition-colors" title={node.name}>{node.name}</h4>
                        <div className="px-1.5 py-0.5 rounded border border-border/50 bg-muted text-[8px] font-bold uppercase tracking-widest text-muted-foreground group-hover:text-primary/80 transition-colors">
                            {node.label}
                        </div>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">
                        <span className={cn("font-bold", confidenceColor)}>
                            {Math.round(confidence * 100)}% RELIABILITY
                        </span>
                        <span>•</span>
                        <span className="italic">{new Date(node.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {node.topicName && (
                            <>
                                <span>•</span>
                                <span className={cn("text-primary/70", "transition-colors group-hover:text-primary")}>{node.topicName}</span>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive hover:text-foreground hover:bg-destructive rounded-lg group/reject"
                    onClick={() => onAction(node.id, 'reject')}
                    title="Reject"
                >
                    <X className="w-4 h-4 transition-transform group-hover/reject:scale-110" />
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-primary hover:text-primary-foreground hover:bg-primary rounded-lg group/approve"
                    onClick={() => onAction(node.id, 'approve')}
                    title="Approve"
                >
                    <Check className="w-4 h-4 transition-transform group-hover/approve:scale-110" />
                </Button>
            </div>
        </div>
    );
}

// --- Main Page Component ---

export default function KnowledgeDashboard() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { selectedOrgId } = useOrgContext();
    const [selectedTopic, setSelectedTopic] = useState<string>("all");
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const debouncedQuery = useDebounce(searchQuery, 300);

    // Unified Search Query
    const { data: searchResults, isLoading: isSearching } = useQuery({
        queryKey: ['unified-search', debouncedQuery],
        queryFn: async () => {
            if (!debouncedQuery || debouncedQuery.length < 2) return [];
            const res = await apiRequest("POST", "/api/knowledge-graph/search/unified", {
                query: debouncedQuery,
                limit: 10
            });
            const data = await res.json();
            return data.results || [];
        },
        enabled: debouncedQuery.length >= 2,
    });

    React.useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                setSearchOpen((open) => !open)
            }
        }
        document.addEventListener("keydown", down)
        return () => document.removeEventListener("keydown", down)
    }, [])

    // Fetch Stats
    const { data: stats, isLoading } = useQuery<DashboardStats>({
        queryKey: ["/api/knowledge-graph/dashboard-stats", selectedOrgId],
        queryFn: async () => {
            const orgParam = selectedOrgId ? `?orgId=${selectedOrgId}` : '';
            const res = await apiRequest("GET", `/api/knowledge-graph/dashboard-stats${orgParam}`);
            return res.json();
        },
        refetchInterval: 30000, 
    });

    // Verify Mutation
    const verifyMutation = useMutation({
        mutationFn: async ({ nodeId, action }: { nodeId: number; action: 'approve' | 'reject' }) => {
            const orgParam = selectedOrgId ? `?orgId=${selectedOrgId}` : '';
            const res = await apiRequest("POST", `/api/knowledge-graph/nodes/${nodeId}/verify${orgParam}`, {
                action,
            });
            if (!res.ok) throw new Error("Failed to verify node");
            return res.json();
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ["/api/knowledge-graph/dashboard-stats"] });
            toast({
                title: variables.action === "approve" ? "Node Authenticated" : "Node Diverged",
                description: "Telemetry points updated successfully.",
            });
        },
        onError: (error: any) => {
            toast({
                title: "Action Failed",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    const handleQuickAction = (nodeId: number, action: 'approve' | 'reject') => {
        verifyMutation.mutate({ nodeId, action });
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-background">
                <div className="text-center space-y-4">
                    <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
                    <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground animate-pulse">Syncing Cognitive Core...</h2>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background flex flex-col font-sans relative cinematic-grid">
            {/* Background pattern */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(var(--primary),0.03),transparent_70%)] pointer-events-none" />
            <div className="scanline-overlay absolute inset-0 pointer-events-none opacity-[0.03]" />

            {/* Header */}
            <header className="border-b bg-background/80 backdrop-blur-md px-8 py-6 flex items-center justify-between sticky top-0 z-50">
                <div className="flex items-center gap-5">
                    <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center relative shadow-sm">
                        <Database className="w-6 h-6 text-primary-foreground" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-foreground italic tracking-tight uppercase leading-none">
                            Knowledge <span className="text-primary">Core</span>
                        </h1>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-1">
                            Operational Intelligence • Semantic Density
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Link href="/knowledge/maturity">
                        <Button variant="outline" className="h-9 font-bold uppercase tracking-widest px-4 rounded-lg">
                            <Activity className="w-4 h-4 mr-2" />
                            Maturity Lab
                        </Button>
                    </Link>
                    
                    <div className="h-9 w-px bg-border mx-1" />

                    <div className="relative w-48">
                        <Select value={selectedTopic} onValueChange={setSelectedTopic}>
                            <SelectTrigger className="h-9 text-[10px] font-bold uppercase tracking-widest rounded-lg">
                                <SelectValue placeholder="All Clusters" />
                            </SelectTrigger>
                            <SelectContent className="bg-popover border-border text-popover-foreground">
                                <SelectItem value="all" className="text-[10px] font-bold uppercase tracking-widest">Global Graph</SelectItem>
                                {stats?.topicsSummary.map(topic => (
                                    <SelectItem key={topic.id} value={String(topic.id)} className="text-[10px] font-bold uppercase tracking-widest">
                                        {topic.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <button
                        onClick={() => setSearchOpen(true)}
                        className="h-9 px-4 flex items-center justify-between gap-6 bg-muted border border-border rounded-lg text-muted-foreground hover:bg-muted/80 transition-all min-w-[240px] group"
                    >
                        <span className="flex items-center gap-3">
                            <Search className="w-3.5 h-3.5 group-hover:text-primary transition-colors" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Search...</span>
                        </span>
                        <kbd className="hidden md:inline-flex h-5 px-1.5 items-center gap-1 rounded border border-border bg-background font-mono text-[9px] font-bold text-muted-foreground">
                             ⌘K
                        </kbd>
                    </button>

                    <Link href="/knowledge/garden">
                        <Button className="h-10 font-bold uppercase tracking-widest px-6 rounded-lg flex items-center gap-2">
                            REVIEW GARDEN
                            <ArrowRight className="w-4 h-4" />
                        </Button>
                    </Link>
                </div>
            </header>

            <main className="flex-1 p-8 overflow-auto relative z-10">
                <div className="max-w-[1600px] mx-auto space-y-10">

                    {/* Operational Metrics */}
                    <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ staggerChildren: 0.1 }}
                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
                    >
                        <MetricCard
                            title="Total Entities"
                            value={stats?.totalNodes || 0}
                            icon={Database}
                            colorClass="text-primary"
                            trend="+12%"
                            trendLabel="Active graph density"
                        />
                        <MetricCard
                            title="System Clearance"
                            value={stats?.pendingApprovals || 0}
                            icon={Clock}
                            colorClass="text-amber-500"
                            trend="Urgent"
                            trendLabel="Awaiting operator verification"
                        />
                        <MetricCard
                            title="Authenticated Today"
                            value={stats?.verifiedToday || 0}
                            icon={CheckCircle2}
                            colorClass="text-emerald-400"
                            trend="+5%"
                            trendLabel="Successful node convergence"
                        />
                        <MetricCard
                            title="Signal Divergence"
                            value={stats?.rejectedToday || 0}
                            icon={XCircle}
                            colorClass="text-rose-400"
                            trend="-2%"
                            trendLabel="Redundant or false nodes pruned"
                        />
                    </motion.div>

                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">

                        <div className="space-y-10">
                            {/* Topics & Coverage */}
                            <Card className="p-0 overflow-hidden">
                                <div className="px-8 py-5 border-b bg-muted/30 flex items-center justify-between">
                                    <div className="space-y-1">
                                        <h2 className="text-[12px] font-bold uppercase tracking-widest flex items-center gap-3">
                                            <FileText className="w-4 h-4 text-primary" />
                                            Cluster Coverage
                                        </h2>
                                        <p className="text-[9px] font-medium uppercase tracking-widest text-muted-foreground">Knowledge density across active protocols</p>
                                    </div>
                                    <Button variant="outline" size="sm" className="h-7 text-[8px] font-bold uppercase tracking-widest">Expand View</Button>
                                </div>
                                <div className="p-8">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                        {stats?.topicsSummary.length === 0 ? (
                                            <div className="col-span-2 text-center py-12 rounded-2xl border border-dashed border-foreground/5 bg-foreground/[0.01]">
                                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Zero active clusters detected</p>
                                            </div>
                                        ) : (
                                            stats?.topicsSummary.map(topic => (
                                                <TopicRow key={topic.id} topic={topic} />
                                            ))
                                        )}
                                    </div>
                                </div>
                            </Card>

                            {/* Signal Types Tag Cloud */}
                            <Card className="p-8">
                                <div className="flex items-center gap-3 mb-8">
                                    <Tag className="w-4 h-4 text-purple-500" />
                                    <h2 className="text-[12px] font-bold uppercase tracking-widest">Semantic Labels</h2>
                                </div>
                                <div className="flex flex-wrap gap-3">
                                    {!stats?.labelsSummary || stats.labelsSummary.length === 0 ? (
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">No telemetry labels analyzed</p>
                                    ) : (
                                        stats.labelsSummary.map((item, i) => (
                                            <Link key={item.label} href={`/knowledge/garden?label=${item.label}`}>
                                                <div className={cn(
                                                    "px-4 py-2 rounded-xl border transition-all cursor-pointer flex items-center gap-3",
                                                    i < 3 ? "bg-primary/10 border-primary/20 text-primary hover:bg-primary/20" :
                                                        "bg-muted border-border/50 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                                                )}>
                                                    <span className={cn("font-bold uppercase tracking-widest", i < 3 ? "text-[11px]" : "text-[9px]")}>
                                                        {item.label}
                                                    </span>
                                                    <span className="text-[9px] font-bold opacity-30 tabular-nums">[{item.count}]</span>
                                                </div>
                                            </Link>
                                        ))
                                    )}
                                </div>
                            </Card>
                        </div>

                        {/* Sidebar: Queue & Trends */}
                        <div className="space-y-8">
                            {/* Validation Queue */}
                            <Card className="overflow-hidden bg-amber-500/5 border-amber-500/20">
                                <div className="px-6 py-4 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <ShieldCheck className="w-4 h-4 text-amber-500" />
                                        <h2 className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Validation Queue</h2>
                                    </div>
                                    <div className="w-6 h-6 rounded flex items-center justify-center bg-amber-500/20 text-amber-500 text-[10px] font-bold">
                                        {stats?.pendingApprovals || 0}
                                    </div>
                                </div>
                                <div className="p-3 space-y-3 bg-muted/20">
                                    {stats?.pendingNodes.length === 0 ? (
                                        <div className="text-center py-10 opacity-40">
                                             <CheckCircle2 className="w-8 h-8 mx-auto text-primary mb-3" />
                                             <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground italic">Integrity Verified</p>
                                        </div>
                                    ) : (
                                        stats?.pendingNodes.map(node => (
                                            <PendingNodeRow
                                                key={node.id}
                                                node={node}
                                                onAction={handleQuickAction}
                                            />
                                        ))
                                    )}
                                    
                                    <div className="pt-3">
                                        <Link href="/knowledge/garden">
                                            <Button className="w-full text-amber-500 border-amber-500/20 text-[10px] font-bold uppercase tracking-widest h-10 rounded-xl" variant="outline">
                                                Access Review Bay
                                                <ArrowRight className="w-3 h-3 ml-2" />
                                            </Button>
                                        </Link>
                                    </div>
                                </div>
                            </Card>

                            {/* Chronological Trends */}
                            <Card className="p-6">
                                <div className="flex items-center gap-3 mb-6">
                                    <BarChart3 className="w-4 h-4 text-blue-500" />
                                    <h2 className="text-[10px] font-bold uppercase tracking-widest">Extraction Velocity</h2>
                                </div>
                                {stats?.extractionTrends && stats.extractionTrends.length > 0 ? (
                                    <div className="h-44">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart
                                                data={stats.extractionTrends.map(t => ({
                                                    ...t,
                                                    label: new Date(t.date).toLocaleDateString('en-US', { weekday: 'short' })
                                                }))}
                                            >
                                                <defs>
                                                    <linearGradient id="colorVerified" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8} />
                                                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                                                    </linearGradient>
                                                    <linearGradient id="colorStaging" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.8} />
                                                        <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                                                    </linearGradient>
                                                    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                                                        <feGaussianBlur stdDeviation="2" result="blur" />
                                                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                                    </filter>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))" opacity={0.3} />
                                                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={9} axisLine={false} tickLine={false} />
                                                <Tooltip 
                                                    contentStyle={{ 
                                                        backgroundColor: 'rgba(0,0,0,0.8)', 
                                                        backdropFilter: 'blur(10px)',
                                                        border: '1px solid rgba(255,255,255,0.1)', 
                                                        fontSize: '10px', 
                                                        borderRadius: '12px', 
                                                        color: '#fff',
                                                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                                                    }} 
                                                />
                                                <Area type="monotone" dataKey="verified" stroke="hsl(var(--primary))" strokeWidth={3} fill="url(#colorVerified)" filter="url(#glow)" />
                                                <Area type="monotone" dataKey="staging" stroke="hsl(var(--accent))" strokeWidth={3} fill="url(#colorStaging)" filter="url(#glow)" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="h-44 flex items-center justify-center opacity-20 border border-dashed border-foreground/10 rounded-xl">
                                        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Awaiting Signal Data</span>
                                    </div>
                                )}
                            </Card>

                            {/* Unified Archive Card */}
                            {stats?.datasetStats && (
                                <Card className="p-6 border-purple-500/20 bg-purple-500/5">
                                    <div className="flex items-center justify-between mb-6">
                                        <div className="flex items-center gap-3">
                                            <Database className="w-4 h-4 text-purple-500" />
                                            <h2 className="text-[10px] font-bold uppercase tracking-widest">Tactical Datasets</h2>
                                        </div>
                                        <Badge variant="outline" className="bg-purple-500/10 text-purple-500 border-purple-500/20 text-[8px] font-bold">
                                            {stats.datasetStats.totalDatasets} Active
                                        </Badge>
                                    </div>
                                    <div className="space-y-3">
                                        {stats.datasetStats.recentExamples.slice(0, 3).map(ex => (
                                            <div key={ex.id} className="p-3 bg-foreground/[0.02] border border-foreground/5 rounded-xl hover:bg-foreground/[0.05] transition-all">
                                                <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-2 truncate">{ex.datasetName}</p>
                                                <div className="space-y-1.5">
                                                    <p className="text-[10px] text-foreground font-bold line-clamp-1"><span className="text-purple-500">IN:</span> {ex.input}</p>
                                                    <p className="text-[10px] text-foreground font-bold line-clamp-1"><span className="text-emerald-500">OUT:</span> {ex.output}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <Link href="/knowledge/fine-tuning">
                                        <Button className="w-full mt-6 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 text-[10px] font-black uppercase tracking-widest h-10 rounded-xl" variant="outline">
                                            Browse Archive
                                        </Button>
                                    </Link>
                                </Card>
                            )}
                        </div>
                    </div>
                </div>
            </main>

            <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
                <CommandInput
                    placeholder="Query semantic index..."
                    value={searchQuery}
                    onValueChange={setSearchQuery}
                    className="h-14 font-sans text-sm"
                />
                <CommandList>
                    <CommandEmpty className="py-10 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">No matching clusters found</CommandEmpty>
                    {isSearching ? (
                        <div className="py-10 text-center">
                            <Loader2 className="w-5 h-5 animate-spin mx-auto text-primary" />
                        </div>
                    ) : (
                        searchResults?.length > 0 && (
                            <CommandGroup heading="TELEMETRY RESULTS" className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest px-4 py-3">
                                {searchResults.map((result: any) => (
                                    <CommandItem
                                        key={`${result.type}-${result.id}`}
                                        className="flex flex-col items-start gap-2 py-4 px-4 hover:bg-muted cursor-pointer rounded-xl group/item transition-all"
                                    >
                                        <div className="flex items-center gap-3 w-full">
                                            {result.type === 'document' ? (
                                                <FileText className="w-4 h-4 text-primary/70" />
                                            ) : (
                                                <Tag className="w-4 h-4 text-primary/70" />
                                            )}
                                            <span className="text-sm font-bold text-foreground group-hover/item:text-primary transition-colors">{result.title}</span>
                                            <div className="ml-auto px-1.5 py-0.5 rounded border border-border bg-muted text-[8px] font-bold uppercase tracking-widest text-muted-foreground group-hover/item:text-primary transition-colors">
                                                {result.type}
                                            </div>
                                        </div>
                                        {result.content && (
                                            <p className="text-[11px] text-muted-foreground line-clamp-2 w-full leading-relaxed group-hover/item:text-foreground transition-colors italic">
                                                "{result.content}"
                                            </p>
                                        )}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        )
                    )}
                </CommandList>
            </CommandDialog>
        </div>
    );
}

