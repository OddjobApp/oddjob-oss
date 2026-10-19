import React, { useState, useMemo } from "react";
import { ErrorBoundary } from "@domain-ui/core/ui/components/shared/ErrorBoundary";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { 
    Card, 
    CardContent, 
    CardDescription, 
    CardHeader, 
    CardTitle 
} from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { 
    Plus, 
    Search, 
    Briefcase, 
    Play, 
    Settings2, 
    MoreVertical, 
    Trash2, 
    CheckCircle2, 
    XCircle,
    Activity,
    ExternalLink,
    List,
    Grid,
    Shield,
    ShieldAlert,
    Info,
    Clock,
    ArrowLeft,
    Database,
    FolderOpen,
    Layers,
    Cpu,
    Target,
    Globe,
    FileText,
    Boxes,
    Sparkles,
    Wand2,
    GitGraph,
    BarChart3,
    Tag,
    Filter,
    LayoutTemplate,
    RefreshCw,
    Zap,
    TrendingUp,
    PieChart
} from "lucide-react";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { 
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@domain-ui/core/ui/components/ui/dropdown-menu";
import { 
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@domain-ui/core/ui/components/ui/table";
import { 
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@domain-ui/core/ui/components/ui/tabs";
import { 
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Link, useLocation, useSearch } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { EmptyState } from "@domain-ui/core/ui/components/ui/empty-state";
import { formatDistanceToNow } from "date-fns";
import type { Job } from "@shared/schema/jobs/table";
import { cn } from "@/lib/utils";

export default function AgentLibrary() {
    const { selectedOrgId } = useOrgContext();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState("");
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [isSecurityReportDialogOpen, setIsSecurityReportDialogOpen] = useState(false);
    const [securityReportCollection, setSecurityReportCollection] = useState<any>(null);
    const [, setLocation] = useLocation();
    const [collectionViewTab, setCollectionViewTab] = useState("agents");
    const [agentViewMode, setAgentViewMode] = useState<"grid" | "table">("grid");

    // New feature states
    const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
    const [isSmartCollectionDialogOpen, setIsSmartCollectionDialogOpen] = useState(false);
    const [isStatsDialogOpen, setIsStatsDialogOpen] = useState(false);
    const [isDependencyGraphOpen, setIsDependencyGraphOpen] = useState(false);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedCollectionForView, setSelectedCollectionForView] = useState<any>(null);

    // Fetch templates
    const { data: templatesData } = useQuery({
        queryKey: ["/api/collections/templates/all"],
        queryFn: async () => {
            const res = await fetch("/api/collections/templates/all", { credentials: "include" });
            if (!res.ok) throw new Error("Failed to fetch templates");
            return res.json();
        },
    });

    // Fetch smart collection presets
    const { data: smartPresets } = useQuery({
        queryKey: ["/api/collections/smart/presets"],
        queryFn: async () => {
            const res = await fetch("/api/collections/smart/presets", { credentials: "include" });
            if (!res.ok) throw new Error("Failed to fetch smart presets");
            return res.json();
        },
    });

    // Collection stats query (lazy)
    const { data: collectionStats, refetch: fetchStats } = useQuery({
        queryKey: ["/api/collections", selectedCollectionForView?.id, "stats"],
        queryFn: async () => {
            const res = await fetch(`/api/collections/${selectedCollectionForView?.id}/stats`, { credentials: "include" });
            if (!res.ok) throw new Error("Failed to fetch stats");
            return res.json();
        },
        enabled: !!selectedCollectionForView?.id && isStatsDialogOpen,
    });

    // Dependency graph query (lazy)
    const { data: dependencyGraph, refetch: fetchDependencyGraph } = useQuery({
        queryKey: ["/api/collections", selectedCollectionForView?.id, "dependencies"],
        queryFn: async () => {
            const res = await fetch(`/api/collections/${selectedCollectionForView?.id}/dependencies`, { credentials: "include" });
            if (!res.ok) throw new Error("Failed to fetch dependencies");
            return res.json();
        },
        enabled: !!selectedCollectionForView?.id && isDependencyGraphOpen,
    });

    // Mission execution history query (lazy)
    const { data: collectionExecutions, refetch: fetchExecutions } = useQuery({
        queryKey: ["/api/collections", selectedCollectionForView?.id, "executions"],
        queryFn: async () => {
            const res = await fetch(`/api/collections/${selectedCollectionForView?.id}/executions`, { credentials: "include" });
            if (!res.ok) throw new Error("Failed to fetch execution history");
            return res.json();
        },
        enabled: !!selectedCollectionForView?.id,
    });

    // Execute collection with mission context
    const executeCollectionMutation = useMutation({
        mutationFn: async ({ collectionId, missionId, missionRunId }: { collectionId: number; missionId?: number; missionRunId?: number }) => {
            const res = await fetch(`/api/collections/${collectionId}/execute`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ missionId, missionRunId, triggeredBy: 'manual', executionType: 'test' }),
            });
            if (!res.ok) throw new Error("Failed to execute collection");
            return res.json();
        },
        onSuccess: () => {
            toast({ title: "Collection executed successfully" });
            fetchExecutions();
        },
        onError: (error: any) => {
            toast({ title: "Execution failed", description: error.message, variant: "destructive" });
        },
    });

    // Get collectionId from URL query params
    const searchString = useSearch();
    const collectionId = new URLSearchParams(searchString).get("collection");

    const { data: jobsResponse, isLoading } = useQuery<{ items: Job[], total: number }>({
        queryKey: ["/api/jobs", selectedOrgId],
    });

    const jobs = jobsResponse?.items || [];

    // Fetch collections
    const { data: collections, isLoading: isLoadingCollections } = useQuery<any[]>({
        queryKey: ["/api/collections", selectedOrgId],
        enabled: !!selectedOrgId,
    });

    // Group collections by Cycle and Mission
    const groupedCollections = useMemo(() => {
        if (!collections || collections.length === 0) return {};
        const groups: Record<string, Record<string, any[]>> = {};

        collections.forEach((col: any) => {
            const cycleKey = col.cycleName || (col.cycleId ? `Cycle #${col.cycleId}` : "General Operational Cycles");
            const missionKey = col.missionName || (col.missionId ? `Mission #${col.missionId}` : "General Missions");

            if (!groups[cycleKey]) groups[cycleKey] = {};
            if (!groups[cycleKey][missionKey]) groups[cycleKey][missionKey] = [];
            groups[cycleKey][missionKey].push(col);
        });

        return groups;
    }, [collections]);

    // Fetch missions count for default tab logic
    const { data: missionsCount, isLoading: isLoadingMissionsCount } = useQuery<{ count: number }>({
        queryKey: ["/api/missions/count", selectedOrgId],
        queryFn: async () => {
            const res = await fetch("/api/missions/count", { credentials: "include" });
            if (!res.ok) throw new Error("Failed to fetch missions count");
            return res.json();
        },
        enabled: !!selectedOrgId,
    });

    // Determine default tab: show agents if no missions and no collections exist
    const hasMissions = (missionsCount?.count || 0) > 0;
    const hasCollections = (collections?.length || 0) > 0;
    const defaultTab = !hasMissions && !hasCollections ? "agents" : "collections";
    const [activeTab, setActiveTab] = useState(defaultTab);

    // Update active tab when data loads if still on default
    React.useEffect(() => {
        if (!isLoadingCollections && !isLoadingMissionsCount && !collectionId) {
            const newDefault = !hasMissions && !hasCollections ? "agents" : "collections";
            if (activeTab !== newDefault && (activeTab === "agents" || activeTab === "collections")) {
                setActiveTab(newDefault);
            }
        }
    }, [hasMissions, hasCollections, isLoadingCollections, isLoadingMissionsCount, collectionId]);

    // Fetch collection detail if viewing a specific collection
    const { data: collectionData } = useQuery<any>({
        queryKey: ["/api/collections", collectionId],
        enabled: !!collectionId,
    });

    // Fetch collection items with resources for scoped view
    const { data: collectionItemsData, isLoading: isLoadingCollectionItems } = useQuery<{
        agents: Job[];
        resources: {
            datasets: any[];
            knowledgeTopics: any[];
            governorPolicies: any[];
            tools: string[];
        };
        mission?: any;
    }>({
        queryKey: ["/api/collections", collectionId, "items"],
        queryFn: async () => {
            const res = await fetch(`/api/collections/${collectionId}/items`, { credentials: "include" });
            if (!res.ok) throw new Error("Failed to fetch collection items");
            return res.json();
        },
        enabled: !!collectionId,
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await apiRequest("DELETE", `/api/jobs/${id}`);
            if (!res.ok) throw new Error("Failed to decommission agent");
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
            toast({ title: "Agent Decommissioned", description: "Standalone configuration has been removed." });
        }
    });

    const runMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await apiRequest("POST", `/api/jobs/${id}/run`, {});
            if (!res.ok) throw new Error("Deployment failed");
            return res.json();
        },
        onSuccess: (data) => {
            toast({ 
                title: "Agent Deployed", 
                description: `Execution started. Run ID: ${data.runId || 'Active'}` 
            });
        }
    });

    const testAllMutation = useMutation({
        mutationFn: async (collectionId: number) => {
            const res = await apiRequest("POST", `/api/collections/${collectionId}/test-all`);
            if (!res.ok) throw new Error("Failed to test all agents in collection");
            return res.json();
        },
        onSuccess: () => {
            toast({ 
                title: "Tests Initiated", 
                description: "All agents in collection are now being tested." 
            });
        }
    });

    const securityReportMutation = useMutation({
        mutationFn: async (collectionId: number) => {
            const res = await apiRequest("POST", `/api/collections/${collectionId}/security-report`);
            if (!res.ok) throw new Error("Failed to generate security report");
            return res.json();
        },
        onSuccess: (data) => {
            setSecurityReportCollection(data);
            setIsSecurityReportDialogOpen(true);
        }
    });

    const deleteCollectionMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await apiRequest("DELETE", `/api/collections/${id}`);
            if (!res.ok) throw new Error("Failed to delete collection");
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
            toast({ title: "Collection Deleted", description: "Collection has been removed." });
        }
    });

    const filteredJobs = useMemo(() => {
        if (!jobs) return [];
        return jobs.filter(j => 
            !j.isHidden && 
            (j.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
             (j.description && j.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
             j.type.toLowerCase().includes(searchQuery.toLowerCase()))
        );
    }, [jobs, searchQuery]);

    const agentStats = useMemo(() => {
        const visible = filteredJobs;
        const failed = visible.filter(job => job.lastTestStatus === "failure").length;
        const healthy = visible.filter(job => job.lastTestStatus === "success").length;
        const neverSynced = visible.filter(job => !job.lastTestedAt).length;
        return { total: visible.length, failed, healthy, neverSynced };
    }, [filteredJobs]);

    const AgentViewToggle = (
        <div className="flex rounded-lg border border-border bg-card p-1">
            <Button
                type="button"
                variant={agentViewMode === "grid" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 gap-1.5 px-3 text-[10px] font-bold uppercase"
                onClick={() => setAgentViewMode("grid")}
            >
                <Grid className="h-3.5 w-3.5" />
                Grid
            </Button>
            <Button
                type="button"
                variant={agentViewMode === "table" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 gap-1.5 px-3 text-[10px] font-bold uppercase"
                onClick={() => setAgentViewMode("table")}
            >
                <List className="h-3.5 w-3.5" />
                Table
            </Button>
        </div>
    );

    return (
        <ErrorBoundary name="Agent Library">
        <div className="p-6 md:p-8 space-y-6 w-full max-w-full animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-3">
                        {collectionId && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setLocation("/operations/agents")}
                                className="h-8 w-8"
                            >
                                <ArrowLeft className="h-4 w-4" />
                            </Button>
                        )}
                        <h1 className="text-4xl font-black tracking-tighter text-foreground uppercase italic px-1">
                            Agent <span className="text-primary">Library</span>
                        </h1>
                    </div>
                    <p className="text-muted-foreground font-bold uppercase tracking-widest text-[10px] px-1">
                        {collectionId ? (
                            <span className="flex items-center gap-2">
                                <Boxes className="w-3 h-3" />
                                Collection: {collectionData?.name}
                                {collectionItemsData?.mission && (
                                    <>
                                        <span className="text-border">|</span>
                                        <Target className="w-3 h-3 text-primary" />
                                        <span className="text-primary">Mission: {collectionItemsData.mission.name}</span>
                                    </>
                                )}
                            </span>
                        ) : 'Standalone Agents • Specialized Skills • Deployment Directives'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative group">
                        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground transition-colors group-focus-within:text-primary" />
                        <Input
                            placeholder="Search agents..."
                            className="pl-8 bg-card border-border focus:border-primary/50 focus:ring-primary/20 w-64 text-xs h-9 transition-all"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                    </div>
                    {collectionId && (
                        <Button
                            variant="default"
                            className="bg-indigo-600 hover:bg-indigo-700"
                            onClick={() => testAllMutation.mutate(parseInt(collectionId))}
                            disabled={testAllMutation.isPending}
                        >
                            {testAllMutation.isPending ? (
                                <Clock className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <Play className="w-4 h-4 mr-2" />
                            )}
                            Run All Tests
                        </Button>
                    )}
                    <Link href="/operations/agents/hr">
                        <Button className="font-bold uppercase tracking-widest text-xs h-9 shadow-sm px-4 bg-amber-500 hover:bg-amber-600 text-background mr-2">
                            Agentic HR
                        </Button>
                    </Link>
                    <Link href="/operations/agents/new">
                        <Button className="font-bold uppercase tracking-widest text-xs h-9 shadow-sm px-4">
                            <Plus className="w-4 h-4 mr-1.5" />
                            Create Agent
                        </Button>
                    </Link>
                </div>
            </div>

            {!collectionId && activeTab === "agents" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                        { label: "Visible agents", value: agentStats.total, helper: "matching current search", tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300", icon: Briefcase },
                        { label: "Needs attention", value: agentStats.failed, helper: "latest test failed", tone: "border-red-400/20 bg-red-500/10 text-red-700 dark:text-red-300", icon: ShieldAlert },
                        { label: "Healthy", value: agentStats.healthy, helper: "latest test succeeded", tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
                        { label: "Never synced", value: agentStats.neverSynced, helper: "no test timestamp yet", tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300", icon: Clock },
                    ].map(stat => (
                        <Card key={stat.label} className="border-border/60 bg-card/50">
                            <CardContent className="flex items-center justify-between gap-3 p-4">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{stat.label}</p>
                                    <p className="mt-1 text-2xl font-black">{stat.value}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">{stat.helper}</p>
                                </div>
                                <div className={cn("rounded-xl border p-3", stat.tone)}>
                                    <stat.icon className="h-5 w-5" />
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <Tabs value={collectionId ? "agents" : activeTab} onValueChange={setActiveTab} className="w-full">
                {!collectionId && (
                    <TabsList className="mb-4">
                        <TabsTrigger value="collections" className="flex items-center gap-2">
                            <Grid className="w-4 h-4" />
                            Collections
                        </TabsTrigger>
                        <TabsTrigger value="agents" className="flex items-center gap-2">
                            <List className="w-4 h-4" />
                            All Agents
                        </TabsTrigger>
                    </TabsList>
                )}

                <TabsContent value="agents" className="mt-0">
                    {collectionId ? (
                        // Scoped Collection View
                        <div className="space-y-4">
                            {/* Collection Stats Cards */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <Card className="bg-card/50">
                                    <CardContent className="p-4 flex items-center gap-3">
                                        <div className="p-2 bg-primary/10 rounded-lg">
                                            <Briefcase className="w-4 h-4 text-primary" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground uppercase tracking-wider">Agents</p>
                                            <p className="text-xl font-bold">{collectionItemsData?.agents?.length || 0}</p>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="bg-card/50">
                                    <CardContent className="p-4 flex items-center gap-3">
                                        <div className="p-2 bg-blue-500/10 rounded-lg">
                                            <Database className="w-4 h-4 text-blue-500" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground uppercase tracking-wider">Datasets</p>
                                            <p className="text-xl font-bold">{collectionItemsData?.resources?.datasets?.length || 0}</p>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="bg-card/50">
                                    <CardContent className="p-4 flex items-center gap-3">
                                        <div className="p-2 bg-amber-500/10 rounded-lg">
                                            <FileText className="w-4 h-4 text-amber-500" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground uppercase tracking-wider">Knowledge</p>
                                            <p className="text-xl font-bold">{collectionItemsData?.resources?.knowledgeTopics?.length || 0}</p>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="bg-card/50">
                                    <CardContent className="p-4 flex items-center gap-3">
                                        <div className="p-2 bg-emerald-500/10 rounded-lg">
                                            <Shield className="w-4 h-4 text-emerald-500" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground uppercase tracking-wider">Policies</p>
                                            <p className="text-xl font-bold">{collectionItemsData?.resources?.governorPolicies?.length || 0}</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Collection Items Tabs */}
                            <Tabs value={collectionViewTab} onValueChange={setCollectionViewTab}>
                                <TabsList className="mb-4">
                                    <TabsTrigger value="agents" className="flex items-center gap-2">
                                        <Briefcase className="w-4 h-4" />
                                        Agents ({collectionItemsData?.agents?.length || 0})
                                    </TabsTrigger>
                                    <TabsTrigger value="resources" className="flex items-center gap-2">
                                        <Layers className="w-4 h-4" />
                                        Resources
                                    </TabsTrigger>
                                </TabsList>

                                <TabsContent value="agents" className="mt-0">
                                    <Card>
                                        {isLoadingCollectionItems ? (
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
                                                {[1, 2, 3, 4].map(i => (
                                                    <Card key={i} className="animate-pulse h-48 bg-muted/20 rounded-xl" />
                                                ))}
                                            </div>
                                        ) : !collectionItemsData?.agents?.length ? (
                                            <CardContent className="p-12">
                                                <EmptyState
                                                    icon={Briefcase}
                                                    title="No Agents in Collection"
                                                    description="This collection doesn't have any agents yet."
                                                />
                                            </CardContent>
                                        ) : (
                                            <CardContent className="p-6">
                                                <div className="mb-4 flex justify-end">{AgentViewToggle}</div>
                                                <AgentList
                                                    jobs={collectionItemsData.agents}
                                                    viewMode={agentViewMode}
                                                    onRun={(job) => runMutation.mutate(job.id)}
                                                    onDelete={(job) => deleteMutation.mutate(job.id)}
                                                />
                                            </CardContent>
                                        )}
                                    </Card>
                                </TabsContent>

                                <TabsContent value="resources" className="mt-0 space-y-4">
                                    {/* Datasets */}
                                    {(collectionItemsData?.resources?.datasets?.length || 0) > 0 && (
                                        <Card>
                                            <CardHeader className="pb-3">
                                                <CardTitle className="text-sm flex items-center gap-2">
                                                    <Database className="w-4 h-4 text-blue-500" />
                                                    Datasets
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="p-0">
                                                <Table>
                                                    <TableBody>
                                                        {collectionItemsData?.resources?.datasets?.map((dataset: any) => (
                                                            <TableRow key={dataset.id}>
                                                                <TableCell className="font-medium">{dataset.name}</TableCell>
                                                                <TableCell className="text-muted-foreground text-sm">{dataset.description || 'No description'}</TableCell>
                                                                <TableCell className="text-right">
                                                                    <Link href={`/knowledge/datasets?dataset=${dataset.id}`}>
                                                                        <Button variant="ghost" size="sm">View</Button>
                                                                    </Link>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </CardContent>
                                        </Card>
                                    )}

                                    {/* Knowledge Topics */}
                                    {(collectionItemsData?.resources?.knowledgeTopics?.length || 0) > 0 && (
                                        <Card>
                                            <CardHeader className="pb-3">
                                                <CardTitle className="text-sm flex items-center gap-2">
                                                    <FileText className="w-4 h-4 text-amber-500" />
                                                    Knowledge Topics
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="p-0">
                                                <Table>
                                                    <TableBody>
                                                        {collectionItemsData?.resources?.knowledgeTopics?.map((topic: any) => (
                                                            <TableRow key={topic.id}>
                                                                <TableCell className="font-medium">{topic.name}</TableCell>
                                                                <TableCell className="text-muted-foreground text-sm">{topic.description || 'No description'}</TableCell>
                                                                <TableCell className="text-right">
                                                                    <Link href={`/knowledge/${topic.id}`}>
                                                                        <Button variant="ghost" size="sm">View</Button>
                                                                    </Link>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </CardContent>
                                        </Card>
                                    )}

                                    {/* Governor Policies */}
                                    {(collectionItemsData?.resources?.governorPolicies?.length || 0) > 0 && (
                                        <Card>
                                            <CardHeader className="pb-3">
                                                <CardTitle className="text-sm flex items-center gap-2">
                                                    <Shield className="w-4 h-4 text-emerald-500" />
                                                    Governor Policies
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="p-0">
                                                <Table>
                                                    <TableBody>
                                                        {collectionItemsData?.resources?.governorPolicies?.map((policy: any) => (
                                                            <TableRow key={policy.id}>
                                                                <TableCell className="font-medium">{policy.name}</TableCell>
                                                                <TableCell className="text-muted-foreground text-sm">{policy.description || 'No description'}</TableCell>
                                                                <TableCell className="text-right">
                                                                    <Link href={`/governor/policies/${policy.id}`}>
                                                                        <Button variant="ghost" size="sm">View</Button>
                                                                    </Link>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </CardContent>
                                        </Card>
                                    )}

                                    {/* Tools */}
                                    {(collectionItemsData?.resources?.tools?.length || 0) > 0 && (
                                        <Card>
                                            <CardHeader className="pb-3">
                                                <CardTitle className="text-sm flex items-center gap-2">
                                                    <Cpu className="w-4 h-4 text-purple-500" />
                                                    Tools Used
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                <div className="flex flex-wrap gap-2">
                                                    {collectionItemsData?.resources?.tools?.map((tool: string) => (
                                                        <Badge key={tool} variant="secondary">{tool}</Badge>
                                                    ))}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    )}

                                    {!collectionItemsData?.resources?.datasets?.length && 
                                     !collectionItemsData?.resources?.knowledgeTopics?.length && 
                                     !collectionItemsData?.resources?.governorPolicies?.length && 
                                     !collectionItemsData?.resources?.tools?.length && (
                                        <CardContent className="p-12">
                                            <EmptyState
                                                icon={Layers}
                                                title="No Resources"
                                                description="The agents in this collection don't have any associated resources."
                                            />
                                        </CardContent>
                                    )}
                                </TabsContent>
                            </Tabs>
                        </div>
                    ) : (
                        // Regular All Agents View
                        <Card>
                            {isLoading ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
                                    {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                                        <Card key={i} className="animate-pulse h-48 bg-muted/20 rounded-xl" />
                                    ))}
                                </div>
                            ) : filteredJobs.length === 0 ? (
                                <CardContent className="p-12">
                                    <EmptyState
                                        icon={Briefcase}
                                        title="No Agents Found"
                                        description={searchQuery ? `No results matching "${searchQuery}"` : "Initialize your first standalone agent configuration to begin."}
                                    />
                                </CardContent>
                            ) : (
                                <CardContent className="p-6">
                                    <div className="mb-4 flex justify-end">{AgentViewToggle}</div>
                                    <AgentList
                                        jobs={filteredJobs}
                                        viewMode={agentViewMode}
                                        onRun={(job) => runMutation.mutate(job.id)}
                                        onDelete={(job) => deleteMutation.mutate(job.id)}
                                    />
                                </CardContent>
                            )}
                        </Card>
                    )}
                </TabsContent>

                <TabsContent value="collections" className="mt-0 space-y-6">
                    {isLoadingCollections ? (
                        <Card>
                            <CardContent className="p-12">
                                <div className="animate-pulse space-y-4">
                                    {[1, 2, 3, 4, 5].map(i => (
                                        <div key={i} className="h-16 bg-muted/20 rounded-lg" />
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    ) : !collections || collections.length === 0 ? (
                        <Card>
                            <CardContent className="p-12">
                                <EmptyState
                                    icon={Grid}
                                    title="No Collections Found"
                                    description="Create collections to organize and batch test your agents."
                                />
                            </CardContent>
                        </Card>
                    ) : (
                        Object.entries(groupedCollections).map(([cycleName, missionsMap]) => (
                            <Card key={cycleName} className="border border-indigo-500/20 bg-card/60 backdrop-blur-sm overflow-hidden">
                                <CardHeader className="bg-indigo-950/20 border-b border-indigo-500/10 py-3 px-6 flex flex-row items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <RefreshCw className="h-5 w-5 text-indigo-400 animate-pulse" />
                                        <div>
                                            <CardTitle className="text-base font-semibold tracking-wide text-indigo-200 flex items-center gap-2">
                                                <span>Operational Cycle:</span>
                                                <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30">{cycleName}</Badge>
                                            </CardTitle>
                                        </div>
                                    </div>
                                    <Badge variant="outline" className="text-xs font-mono">
                                        {Object.values(missionsMap).reduce((acc, cols) => acc + cols.length, 0)} Collections
                                    </Badge>
                                </CardHeader>
                                <CardContent className="p-6 space-y-6">
                                    {Object.entries(missionsMap).map(([missionName, collectionList]) => (
                                        <div key={missionName} className="space-y-3">
                                            <div className="flex items-center gap-2 text-sm font-medium text-emerald-300 pb-2 border-b border-border/40">
                                                <Target className="h-4 w-4 text-emerald-400" />
                                                <span>Mission:</span>
                                                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/20">
                                                    {missionName}
                                                </Badge>
                                            </div>
                                            <div className="rounded-md border border-border/50 overflow-hidden">
                                                <Table>
                                                    <TableHeader className="bg-muted/40">
                                                        <TableRow>
                                                            <TableHead>Collection Name</TableHead>
                                                            <TableHead>Type</TableHead>
                                                            <TableHead>Items / Agents</TableHead>
                                                            <TableHead>Created</TableHead>
                                                            <TableHead className="text-right">Actions</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {collectionList.map((collection: any) => (
                                                            <TableRow key={collection.id} className="hover:bg-muted/20">
                                                                <TableCell className="font-medium">
                                                                    <div className="flex flex-col">
                                                                        <span className="text-sm font-semibold">{collection.name}</span>
                                                                        {collection.description && (
                                                                            <span className="text-xs text-muted-foreground line-clamp-1">{collection.description}</span>
                                                                        )}
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell>
                                                                    <Badge variant="outline" className="text-xs">
                                                                        {collection.type || (collection.isSmart ? 'Smart Rules' : 'Manual')}
                                                                    </Badge>
                                                                </TableCell>
                                                                <TableCell>
                                                                    <div className="flex items-center gap-2">
                                                                        <Badge className="bg-primary/20 text-primary border-primary/30">
                                                                            {collection.jobCount || collection.itemCount || 0} Agents
                                                                        </Badge>
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="text-xs text-muted-foreground">
                                                                    {formatDistanceToNow(new Date(collection.createdAt), { addSuffix: true })}
                                                                </TableCell>
                                                                <TableCell className="text-right">
                                                                    <DropdownMenu>
                                                                        <DropdownMenuTrigger asChild>
                                                                            <Button variant="ghost" size="icon" className="h-8 w-8">
                                                                                <MoreVertical className="h-4 w-4" />
                                                                            </Button>
                                                                        </DropdownMenuTrigger>
                                                                        <DropdownMenuContent align="end">
                                                                            <DropdownMenuItem onClick={() => setLocation(`/operations/agents?collection=${collection.id}`)}>
                                                                                View Items
                                                                            </DropdownMenuItem>
                                                                            <DropdownMenuItem onClick={() => testAllMutation.mutate(collection.id)}>
                                                                                Run All Tests
                                                                            </DropdownMenuItem>
                                                                            <DropdownMenuItem onClick={() => securityReportMutation.mutate(collection.id)}>
                                                                                Security Report
                                                                            </DropdownMenuItem>
                                                                            <DropdownMenuSeparator />
                                                                            <DropdownMenuItem 
                                                                                className="text-red-500"
                                                                                onClick={() => {
                                                                                    if (confirm('Delete this collection?')) {
                                                                                        deleteCollectionMutation.mutate(collection.id);
                                                                                    }
                                                                                }}
                                                                            >
                                                                                Delete
                                                                            </DropdownMenuItem>
                                                                        </DropdownMenuContent>
                                                                    </DropdownMenu>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        ))
                    )}
                </TabsContent>
            </Tabs>

            {/* Security Report Dialog */}
            <Dialog open={isSecurityReportDialogOpen} onOpenChange={setIsSecurityReportDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-indigo-500" />
                            Security Report: {securityReportCollection?.name}
                        </DialogTitle>
                        <DialogDescription>
                            Analysis of safety risks and potential malicious patterns
                        </DialogDescription>
                    </DialogHeader>

                    {securityReportCollection?.securityReport ? (
                        <div className="space-y-4 py-2">
                            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                                <span className="text-sm font-medium">Risk Level</span>
                                <Badge
                                    variant={securityReportCollection.securityReport.riskLevel === 'high' ? 'destructive' : 'default'}
                                    className={
                                        securityReportCollection.securityReport.riskLevel === 'medium' ? 'bg-yellow-100 text-yellow-800' : 
                                        securityReportCollection.securityReport.riskLevel === 'low' ? 'bg-green-100 text-green-800' : ''
                                    }
                                >
                                    {securityReportCollection.securityReport.riskLevel?.toUpperCase() || 'UNKNOWN'}
                                </Badge>
                            </div>

                            <div className="space-y-2">
                                <h4 className="text-sm font-semibold flex items-center gap-2">
                                    <Info className="h-4 w-4" />
                                    Key Findings
                                </h4>
                                <div className="bg-muted p-4 rounded-md text-sm whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto border">
                                    {securityReportCollection.securityReport.analysis || "No analysis details provided."}
                                </div>
                            </div>

                            {securityReportCollection.securityReport.suspiciousPatterns?.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-sm font-semibold text-destructive flex items-center gap-2">
                                        <ShieldAlert className="h-4 w-4" />
                                        Flagged Patterns
                                    </h4>
                                    <ul className="list-disc list-inside text-xs space-y-1 text-muted-foreground bg-destructive/5 p-3 rounded-md border border-destructive/10">
                                        {securityReportCollection.securityReport.suspiciousPatterns.map((p: string, i: number) => (
                                            <li key={i}>{p}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="py-8 text-center text-muted-foreground">
                            No security report available for this collection.
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsSecurityReportDialogOpen(false)}>
                            Close
                        </Button>
                        <Button
                            className="bg-indigo-600 hover:bg-indigo-700"
                            onClick={() => {
                                setIsSecurityReportDialogOpen(false);
                                setLocation(`/operations/agents?collection=${securityReportCollection.id}`);
                            }}
                        >
                            Review Items
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Template Dialog */}
            <Dialog open={isTemplateDialogOpen} onOpenChange={setIsTemplateDialogOpen}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <LayoutTemplate className="h-5 w-5 text-purple-500" />
                            Create from Template
                        </DialogTitle>
                        <DialogDescription>
                            Choose a pre-built template to jumpstart your collection
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4 max-h-[500px] overflow-y-auto">
                        {templatesData?.templates?.map((template: any) => (
                            <Card key={template.id} className="cursor-pointer hover:border-purple-300 transition-colors" onClick={() => {
                                // Create collection from template
                                fetch("/api/collections/from-template", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    credentials: "include",
                                    body: JSON.stringify({ templateId: template.id, createAgents: true }),
                                })
                                .then(res => res.json())
                                .then(() => {
                                    setIsTemplateDialogOpen(false);
                                    toast({ title: "Collection created from template" });
                                    queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
                                });
                            }}>
                                <CardHeader className="pb-2">
                                    <div className="flex items-center gap-2">
                                        <div className="p-2 bg-purple-100 rounded-lg">
                                            <LayoutTemplate className="w-4 h-4 text-purple-600" />
                                        </div>
                                        <div>
                                            <CardTitle className="text-sm">{template.name}</CardTitle>
                                            <p className="text-xs text-muted-foreground">{template.category}</p>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground mb-2">{template.description}</p>
                                    <div className="flex flex-wrap gap-1">
                                        {template.defaultAgents?.map((agent: any, i: number) => (
                                            <Badge key={i} variant="secondary" className="text-xs">{agent.name}</Badge>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Smart Collection Dialog */}
            <Dialog open={isSmartCollectionDialogOpen} onOpenChange={setIsSmartCollectionDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-amber-500" />
                            Create Smart Collection
                        </DialogTitle>
                        <DialogDescription>
                            Auto-populating collections that stay in sync with your agents
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4 max-h-[400px] overflow-y-auto">
                        {smartPresets?.map((preset: any) => (
                            <Card key={preset.id} className="cursor-pointer hover:border-amber-300 transition-colors" onClick={() => {
                                fetch("/api/collections/smart", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    credentials: "include",
                                    body: JSON.stringify({
                                        name: preset.name,
                                        description: preset.description,
                                        presetId: preset.id,
                                    }),
                                })
                                .then(res => res.json())
                                .then(() => {
                                    setIsSmartCollectionDialogOpen(false);
                                    toast({ title: "Smart collection created" });
                                    queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
                                });
                            }}>
                                <CardHeader className="pb-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Wand2 className="w-4 h-4 text-amber-500" />
                                            <CardTitle className="text-sm">{preset.name}</CardTitle>
                                        </div>
                                        <Badge variant="outline" className="text-xs">Auto-sync</Badge>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground">{preset.description}</p>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Stats Dialog */}
            <Dialog open={isStatsDialogOpen} onOpenChange={setIsStatsDialogOpen}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <BarChart3 className="h-5 w-5 text-blue-500" />
                            Collection Analytics: {collectionStats?.collection?.name}
                        </DialogTitle>
                    </DialogHeader>
                    {collectionStats && (
                        <div className="space-y-6 py-4">
                            {/* Stats Cards */}
                            <div className="grid grid-cols-4 gap-4">
                                <Card>
                                    <CardContent className="p-4 text-center">
                                        <p className="text-2xl font-bold">{collectionStats.agents.total}</p>
                                        <p className="text-xs text-muted-foreground">Total Agents</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="p-4 text-center">
                                        <p className="text-2xl font-bold text-emerald-600">{collectionStats.agents.active}</p>
                                        <p className="text-xs text-muted-foreground">Active</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="p-4 text-center">
                                        <p className="text-2xl font-bold">{collectionStats.resources.datasets}</p>
                                        <p className="text-xs text-muted-foreground">Datasets</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="p-4 text-center">
                                        <p className="text-2xl font-bold">{collectionStats.resources.knowledgeTopics}</p>
                                        <p className="text-xs text-muted-foreground">Knowledge Topics</p>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Tools Used */}
                            {collectionStats.resources.tools?.length > 0 && (
                                <div>
                                    <h4 className="text-sm font-semibold mb-2">Tools Used</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {collectionStats.resources.tools.map((tool: string) => (
                                            <Badge key={tool} variant="secondary">{tool}</Badge>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Dependency Graph Dialog */}
            <Dialog open={isDependencyGraphOpen} onOpenChange={setIsDependencyGraphOpen}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <GitGraph className="h-5 w-5 text-indigo-500" />
                            Dependency Graph: {selectedCollectionForView?.name}
                        </DialogTitle>
                    </DialogHeader>
                    {dependencyGraph && (
                        <div className="py-4">
                            <div className="flex gap-4 mb-4 text-sm">
                                <span><strong>{dependencyGraph.metadata.totalAgents}</strong> Agents</span>
                                <span><strong>{dependencyGraph.metadata.totalResources}</strong> Resources</span>
                                <span><strong>{dependencyGraph.metadata.totalConnections}</strong> Connections</span>
                            </div>
                            <div className="border rounded-lg p-4 bg-muted/30 min-h-[300px] max-h-[500px] overflow-auto">
                                {/* Simple visualization of nodes and edges */}
                                <div className="space-y-2">
                                    {dependencyGraph.nodes?.filter((n: any) => n.type === 'agent').map((node: any) => (
                                        <div key={node.id} className="flex items-center gap-2 p-2 bg-background rounded border">
                                            <Briefcase className="w-4 h-4 text-blue-500" />
                                            <span className="font-medium">{node.label}</span>
                                            <span className="text-xs text-muted-foreground">(ID: {node.data.id})</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
        </ErrorBoundary>
    );
}

const safeDateDisplay = (date: string | Date | null | undefined) => {
    try {
        if (!date) return 'Never Synced';
        const d = new Date(date);
        if (isNaN(d.getTime())) return 'Invalid Date';
        return formatDistanceToNow(d, { addSuffix: true });
    } catch (e) {
        return 'Date Error';
    }
};

function agentStatusMeta(job: Job) {
    if (job.lastTestStatus === "success") {
        return {
            label: "Healthy",
            className: "border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            icon: CheckCircle2,
        };
    }
    if (job.lastTestStatus === "failure") {
        return {
            label: "Needs attention",
            className: "border-red-400/30 bg-red-500/10 text-red-700 dark:text-red-300",
            icon: XCircle,
        };
    }
    return {
        label: "Standby",
        className: "border-border/20 bg-muted/10 text-foreground",
        icon: Activity,
    };
}

function AgentList({
    jobs,
    viewMode,
    onRun,
    onDelete,
}: {
    jobs: Job[];
    viewMode: "grid" | "table";
    onRun: (job: Job) => void;
    onDelete: (job: Job) => void;
}) {
    if (viewMode === "grid") {
        return (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {jobs.map(job => (
                    <AgentCard
                        key={job.id}
                        job={job}
                        onRun={() => onRun(job)}
                        onDelete={() => onDelete(job)}
                    />
                ))}
            </div>
        );
    }

    return (
        <div className="overflow-x-auto rounded-xl border border-border/60">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="min-w-[260px]">Agent</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Last synced</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {jobs.map(job => {
                        const status = agentStatusMeta(job);
                        const StatusIcon = status.icon;
                        return (
                            <TableRow key={job.id}>
                                <TableCell>
                                    <div className="font-semibold">{job.name}</div>
                                    <div className="mt-1 line-clamp-2 max-w-xl text-xs text-muted-foreground">
                                        {job.description || "Core agent directive initialized and pending deployment."}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" className={cn("gap-1.5 text-[10px] font-bold uppercase", status.className)}>
                                        <StatusIcon className="h-3 w-3" />
                                        {status.label}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-xs font-medium text-muted-foreground">
                                    {typeof job.type === "string" ? job.type.replace(/_/g, " ") : "General agent"}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                    {safeDateDisplay(job.lastTestedAt)}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-2">
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            className="h-8 text-[10px] font-bold uppercase"
                                            onClick={() => onRun(job)}
                                        >
                                            <Play className="mr-1.5 h-3 w-3 fill-current" />
                                            Deploy
                                        </Button>
                                        <Link href={`/operations/agents/${job.id}`}>
                                            <Button size="sm" variant="outline" className="h-8 text-[10px] font-bold uppercase">
                                                View
                                            </Button>
                                        </Link>
                                    </div>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}

function AgentCard({ job, onRun, onDelete }: { job: Job; onRun: () => void; onDelete: () => void }) {
    return (
        <Card className="group relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 border-border/40 bg-card/60 backdrop-blur-sm rounded-xl">
            <CardHeader className="pb-3 pt-5">
                <div className="flex items-start justify-between">
                    <Badge variant="outline" className="text-[9px] font-black uppercase tracking-widest border-primary/20 text-primary bg-primary/5 px-2 py-0.5">
                        {typeof job.type === 'string' ? job.type.replace(/_/g, " ") : "GENERAL AGENT"}
                    </Badge>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1 -mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest font-bold">Options</DropdownMenuLabel>
                            <DropdownMenuItem asChild>
                                <Link href={`/operations/agents/${job.id}`}>
                                    <div className="flex items-center gap-2 cursor-pointer w-full text-xs font-medium">
                                        <Settings2 className="h-3.5 w-3.5" /> Edit Configuration
                                    </div>
                                </Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                                className="text-red-500 hover:text-red-600 focus:text-red-600 focus:bg-red-50 text-xs font-medium"
                                onClick={onDelete}
                            >
                                <Trash2 className="h-3.5 w-3.5 mr-2" /> Decommission Agent
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                <CardTitle className="mt-4 text-[16px] font-bold tracking-tight text-foreground group-hover:text-primary transition-colors truncate">
                    {job.name}
                </CardTitle>
                <CardDescription className="line-clamp-2 text-[11px] text-muted-foreground mt-1.5 min-h-[2.4rem] leading-relaxed font-medium">
                    {job.description || "Core agent directive initialized and pending deployment."}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pb-6">
                <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 border-t border-border/20 pt-4">
                    <div className="flex items-center gap-1.5">
                        {job.lastTestStatus === 'success' ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-500/80" />
                        ) : job.lastTestStatus === 'failure' ? (
                            <XCircle className="w-3 h-3 text-red-500/80" />
                        ) : (
                            <Activity className="w-3 h-3 opacity-30" />
                        )}
                        <span>{job.lastTestStatus || 'Standby'}</span>
                    </div>
                    <span>{safeDateDisplay(job.lastTestedAt)}</span>
                </div>
                
                <div className="flex gap-2">
                    <Button 
                        size="sm" 
                        variant="secondary" 
                        className="flex-1 text-[10px] font-black uppercase tracking-widest h-8 shadow-sm"
                        onClick={onRun}
                    >
                        <Play className="w-3 h-3 mr-1.5 fill-current" /> Deploy
                    </Button>
                    <Link href={`/operations/agents/${job.id}`} className="flex-1">
                        <Button 
                            size="sm" 
                            variant="outline" 
                            className="w-full text-[10px] font-black uppercase tracking-widest h-8 bg-background/50 hover:bg-background transition-colors"
                        >
                            <ExternalLink className="w-3 h-3 mr-1.5" /> View
                        </Button>
                    </Link>
                </div>
            </CardContent>
            {/* Hover Indicator Line */}
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-primary transform translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
        </Card>
    );
}

