import React, { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useLocation } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { Loader2, Download, ExternalLink, Settings, Bot, LayoutTemplate, Search, SortAsc, Hammer, Sparkles, Filter, MoreVertical, PlayCircle, PauseCircle, Star, MessageSquare, Code, RefreshCw, ChevronDown, ChevronRight, ShieldCheck, Clock3, PackageCheck, Boxes, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from "@/lib/utils";
import { useEffect } from 'react';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@domain-ui/core/ui/components/ui/dropdown-menu';
import {
    Sheet,
    SheetContent,
    SheetTrigger,
} from '@domain-ui/core/ui/components/ui/sheet';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@domain-ui/core/ui/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from '@domain-ui/core/ui/components/ui/dialog';
import { AppIcon } from '../components/AppIcon.js';
import { AppReviewsDialog, type ReviewSummary } from '../components/AppReviewsDialog.js';
import { useOrgContext } from '@domain-ui/core/ui/hooks/use-org-context';

interface App {
    id: number;
    name: string;
    slug: string;
    description: string;
    version: string;
    isPublic: boolean;
    icon?: string;
    status?: string;
    /** Live from /api/apps/market; absent on installed-app records. */
    reviewSummary?: ReviewSummary;
    config?: {
        cycleApp?: CycleAppMetadata;
    };
    metadata?: {
        cycleApp?: CycleAppMetadata;
    };
    runtimeMetadata?: {
        stage?: string;
        jobId?: string;
        startedAt?: string;
        oddjobMissionId?: number;
        cycleApp?: CycleAppMetadata;
    };
}

interface CycleAppMetadata {
    source?: string;
    sourceCycleSlug?: string;
    sourceCycleName?: string;
    sourceAppId?: string;
    sourceAppName?: string;
    editableInAppBuilder?: boolean;
    dependentMissionIds?: string[];
    requiredRoles?: string[];
    blueprint?: string | null;
    interactionModel?: string;
    blueprintBaselineVersion?: string;
}

function displayText(value: unknown, fallback = ""): string {
    if (typeof value === "string") return value;
    if (value == null) return fallback;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.map((item) => displayText(item)).filter(Boolean).join(", ");
    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        return displayText(record.description ?? record.summary ?? record.name ?? record.title ?? record.label, fallback);
    }
    return fallback;
}

interface AppDeployment {
    id: number;
    appId: number;
    status: string;
    isPublished: boolean;
    publicSlug: string | null;
    url?: string | null;
}

interface InstalledAppRecord {
    deployment: AppDeployment;
    app: App;
}

interface AgentFleetDeployment {
    id: number;
    jobId: number;
    slug: string;
    title: string;
    description?: string | null;
    brandingConfig?: {
        avatarUrl?: string;
        logoUrl?: string;
        primaryColor?: string;
        theme?: string;
    } | null;
    allowedPipelineIds?: number[] | null;
    pipelineNames?: string[];
    stats?: {
        averageRating: string | null;
        totalInteractions: number;
    };
    isActive?: boolean;
}

type AppFleetItem = {
    source: "app";
    id: string;
    title: string;
    description?: string | null;
    status: "live" | "forging" | "inactive" | "building" | "error";
    publicPath?: string | null;
    configurePath: string;
    editPath?: string;
    cycleApp?: CycleAppMetadata | null;
    parentCycle?: ParentCycle | null;
    updatedAt?: string | null;
    app: App;
    deployment: AppDeployment;
};

type AgentFleetItem = {
    source: "agent_ai";
    id: string;
    title: string;
    description?: string | null;
    status: "live";
    publicPath: string;
    configurePath: string;
    parentCycle?: ParentCycle | null;
    updatedAt?: string | null;
    agentDeployment: AgentFleetDeployment;
};

// Parent-cycle tag the server stamps on every fleet item (null for org-native
// assets). The Arsenal groups by `slug`; `name` is the section heading.
type ParentCycle = { slug: string; name: string };

type FleetItem = AppFleetItem | AgentFleetItem;

type SortOption = "newest" | "name-az" | "most-used";
type AppFilter = "all" | "installed" | "available" | "codegen" | "training" | "ops";

const appFilters: { value: AppFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "installed", label: "Installed" },
    { value: "available", label: "Available" },
    { value: "codegen", label: "Codegen" },
    { value: "training", label: "Training" },
    { value: "ops", label: "Ops" },
];

function appSearchText(app: App): string {
    return `${app.name} ${app.slug} ${displayText(app.description)} ${app.status ?? ""}`.toLowerCase();
}

function fleetSearchText(item: FleetItem): string {
    if (item.source === "app") {
        return `${item.title} ${item.app.slug} ${displayText(item.description)} ${displayText(item.app.description)} ${item.app.version} ${item.status} ${item.parentCycle?.name ?? ""}`.toLowerCase();
    }
    return `${item.title} ${displayText(item.description)} ${item.agentDeployment.pipelineNames?.join(" ") ?? ""} agent ai ${item.status}`.toLowerCase();
}

function appTags(app: App): string[] {
    const text = appSearchText(app);
    const tags = new Set<string>();
    if (/code|repo|sdlc|pipeline|generation|developer/.test(text)) tags.add("Codegen");
    if (/train|eval|quality|performance|governance|corpus/.test(text)) tags.add("Training");
    if (/ops|incident|sre|dispatch|service|monitor|health|asset/.test(text)) tags.add("Ops");
    if (/research|rfc|knowledge|analysis/.test(text)) tags.add("Research");
    if (tags.size === 0) tags.add("Automation");
    return Array.from(tags).slice(0, 3);
}

function fleetTags(item: FleetItem): string[] {
    if (item.source === "agent_ai") return ["Agent AI", ...(item.agentDeployment.pipelineNames ?? []).slice(0, 2)];
    return appTags(item.app);
}

function matchesFilter(text: string, filter: AppFilter): boolean {
    if (filter === "all" || filter === "installed" || filter === "available") return true;
    if (filter === "codegen") return /code|repo|sdlc|pipeline|generation|developer/.test(text);
    if (filter === "training") return /train|eval|quality|performance|governance|corpus/.test(text);
    if (filter === "ops") return /ops|incident|sre|dispatch|service|monitor|health|asset/.test(text);
    return true;
}

function formatDate(value?: string | null): string {
    if (!value) return "Not reported";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not reported";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function AppMarketplace() {
    const [location, setLocation] = useLocation();
    const { toast } = useToast();
    const { isAdmin } = useOrgContext();
    const urlParams = new URLSearchParams(location.split('?')[1] || '');
    const initialSearch = urlParams.get('search') || "";
    const defaultTab = urlParams.get('tab') === 'fleet' || initialSearch ? 'installed' : 'market';
    const [activeTab, setActiveTab] = useState(defaultTab);
    const [search, setSearch] = useState(initialSearch);
    const [sort, setSort] = useState<SortOption>("newest");
    const [activeFilter, setActiveFilter] = useState<AppFilter>("all");
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    const { data: marketApps, isLoading: loadingMarket } = useQuery<App[]>({
        queryKey: ['/api/apps/market'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/apps/market');
            return res.json();
        }
    });

    const { data: fleetItems, isLoading: loadingFleet } = useQuery<FleetItem[]>({
        queryKey: ['/api/apps/fleet'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/apps/fleet');
            return res.json();
        }
    });

    // Installation truth comes directly from app_deployments. The unified fleet
    // is a presentation model and can lag or omit inactive/cycle-linked rows.
    const { data: installedApps, isLoading: loadingInstalled } = useQuery<InstalledAppRecord[]>({
        queryKey: ['/api/apps/installed'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/apps/installed');
            return res.json();
        },
        enabled: isAdmin,
    });

    const installMutation = useMutation({
        mutationFn: async (appId: number) => {
            const res = await apiRequest('POST', '/api/apps/install', { appId });
            return await res.json();
        },
        onSuccess: (data: any, appId: number) => {
            queryClient.invalidateQueries({ queryKey: ['/api/apps/installed'] });
            queryClient.invalidateQueries({ queryKey: ['/api/apps/fleet'] });
            
            const targetApp = marketApps?.find(a => a.id === appId);
            const isBlueprint = targetApp && (targetApp.slug.includes('sdlc') || targetApp.name.toLowerCase().includes('sdlc') || targetApp.name.toLowerCase().includes('cycle') || !!(targetApp as any).blueprintSlug);
            
            toast({ 
                title: isBlueprint ? "Blueprint Acquired" : "App Installed", 
                description: isBlueprint 
                    ? "The blueprint has been added to your workspace templates." 
                    : "The application has been added to your fleet." 
            });
            setActiveTab("installed");
        },
        onError: (error: any) => {
            toast({ title: "Install Failed", description: error.message, variant: "destructive" });
        }
    });

    const togglePauseMutation = useMutation({
        mutationFn: async ({ id, isActive }: { id: number, isActive: boolean }) => {
            const res = await apiRequest('PATCH', `/api/agents/deployments/${id}`, { isActive });
            if (!res.ok) throw new Error("Failed to update status");
            return await res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/apps/fleet'] });
            toast({ title: "Status Updated", description: "Agent visibility has been changed." });
        },
        onError: (error: any) => {
            toast({ title: "Update Failed", description: error.message, variant: "destructive" });
        }
    });

    const isInstalled = (appId: number) =>
        installedApps?.some(item => item.app.id === appId) === true ||
        fleetItems?.some(item => item.source === "app" && item.app.id === appId) === true;

    // Group the flat fleet by parent cycle so a blueprint's many apps collapse
    // under one section instead of flooding the grid. Org-native assets (no
    // parentCycle) sit in their own group at the top; blueprint cycles follow
    // alphabetically. Server-side ordering is preserved within each group.
    const ORG_GROUP_KEY = "__org__";
    const filteredFleetItems = useMemo(() => {
        let list = fleetItems ?? [];
        if (search) {
            const q = search.toLowerCase();
            list = list.filter(item => fleetSearchText(item).includes(q));
        }
        list = list.filter(item => matchesFilter(fleetSearchText(item), activeFilter));
        if (sort === "name-az") {
            list = [...list].sort((a, b) => a.title.localeCompare(b.title));
        }
        if (sort === "most-used") {
            list = [...list].sort((a, b) => {
                const aUses = a.source === "agent_ai" ? a.agentDeployment.stats?.totalInteractions ?? 0 : 0;
                const bUses = b.source === "agent_ai" ? b.agentDeployment.stats?.totalInteractions ?? 0 : 0;
                return bUses - aUses;
            });
        }
        return list;
    }, [fleetItems, search, activeFilter, sort]);

    const fleetGroups = useMemo(() => {
        const groups = new Map<string, { key: string; name: string; items: FleetItem[] }>();
        for (const item of filteredFleetItems) {
            const key = item.parentCycle?.slug ?? ORG_GROUP_KEY;
            const name = item.parentCycle?.name ?? "Org Apps";
            if (!groups.has(key)) groups.set(key, { key, name, items: [] });
            groups.get(key)!.items.push(item);
        }
        return Array.from(groups.values()).sort((a, b) => {
            if (a.key === ORG_GROUP_KEY) return -1;
            if (b.key === ORG_GROUP_KEY) return 1;
            return a.name.localeCompare(b.name);
        });
    }, [filteredFleetItems]);

    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const toggleGroup = (key: string) => setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));

    const openApp = async (item: AppFleetItem) => {
        if (item.app.config && (item.app.config as any).tokenizedUI) {
            setLocation(`/armory/apps/${item.app.id}`);
            return;
        }
        const target = item.publicPath || (item.deployment.url ? `${item.deployment.url}/ui` : null);
        if (!target) return;

        const popup = window.open(target, "_blank");
        if (!popup) {
            toast({
                title: "Popup Blocked",
                description: "Allow popups for Oddjob, then try View App again.",
                variant: "destructive",
            });
            return;
        }

        if (item.deployment.publicSlug) {
            void apiRequest("POST", `/api/public/apps/${item.deployment.publicSlug}/start`, {})
                .then((res) => {
                    if (!res.ok) throw new Error("App failed to start");
                })
                .catch((error: any) => {
                    toast({
                        title: "App Is Waking Up",
                        description: error.message || "The app tab opened. If it does not load, rebuild or restart it from App Builder.",
                    });
                });
        }
    };

    const filteredMarketApps = useMemo(() => {
        let list = marketApps || [];
        if (search) {
            const q = search.toLowerCase();
            list = list.filter(a => appSearchText(a).includes(q));
        }
        if (activeFilter === "installed") list = list.filter(a => !!isInstalled(a.id));
        if (activeFilter === "available") list = list.filter(a => !isInstalled(a.id));
        list = list.filter(a => matchesFilter(appSearchText(a), activeFilter));
        if (sort === "name-az") {
            list = [...list].sort((a, b) => a.name.localeCompare(b.name));
        }
        if (sort === "most-used") {
            list = [...list].sort((a, b) => Number(isInstalled(b.id)) - Number(isInstalled(a.id)));
        }
        return list;
    }, [marketApps, search, sort, activeFilter, fleetItems]);

    const installedCount = fleetItems?.length ?? 0;
    const marketCount = marketApps?.length ?? 0;
    const availableCount = (marketApps ?? []).filter(app => !isInstalled(app.id)).length;
    const activeFilterLabel = appFilters.find(filter => filter.value === activeFilter)?.label ?? "All";

    return (
        <div className="p-6 md:p-10 space-y-7 w-full max-w-full animate-page-in">
            <div className="relative p-6 rounded-xl overflow-hidden glass-panel border-white/20 shadow-xl">
                <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                    <LayoutTemplate className="w-48 h-48 rotate-12" />
                </div>
                <div className="relative z-10 flex flex-col xl:flex-row xl:items-center justify-between gap-6">
                    <div className="flex items-center gap-5 min-w-0">
                        <div className="p-3 bg-primary rounded-xl shadow-lg shadow-primary/25 shrink-0">
                            <Hammer className="w-8 h-8 text-foreground" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-3xl font-black tracking-tight leading-none">App Arsenal</h1>
                            <p className="text-muted-foreground mt-2 max-w-2xl font-medium">Discover, deploy, and govern purpose-built autonomous apps for industrial orchestration.</p>
                            <div className="flex flex-wrap gap-2 mt-4">
                                <Badge variant="secondary" className="gap-1.5 border-white/10 font-black uppercase tracking-widest text-[10px]"><PackageCheck className="w-3 h-3" /> {installedCount} Installed</Badge>
                                <Badge variant="secondary" className="gap-1.5 border-white/10 font-black uppercase tracking-widest text-[10px]"><Boxes className="w-3 h-3" /> {availableCount} Available</Badge>
                                <Badge variant="secondary" className="gap-1.5 border-white/10 font-black uppercase tracking-widest text-[10px]"><ShieldCheck className="w-3 h-3" /> Governed</Badge>
                            </div>
                        </div>
                    </div>
                    <Button 
                        size="lg"
                        className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xl shadow-primary/20 h-12 px-6 font-black uppercase tracking-widest text-[11px]" 
                        onClick={() => setLocation('/armory/forge')}
                    >
                        <Sparkles className="w-5 h-5" /> Ignite Forge
                    </Button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-5 mb-6">
                    <TabsList className="w-full max-w-lg grid grid-cols-2 p-1 bg-white/40 dark:bg-card/40 backdrop-blur-sm border border-white/10 rounded-xl">
                        <TabsTrigger value="installed" className="rounded-lg data-[state=active]:glass-panel data-[state=active]:shadow-md font-bold uppercase tracking-widest text-[10px]">Installed <span className="ml-2 opacity-60">{installedCount}</span></TabsTrigger>
                        <TabsTrigger value="market" className="rounded-lg data-[state=active]:glass-panel data-[state=active]:shadow-md font-bold uppercase tracking-widest text-[10px]">Marketplace <span className="ml-2 opacity-60">{marketCount}</span></TabsTrigger>
                    </TabsList>
                    <div className="flex flex-col md:flex-row gap-3 md:items-center">
                        <div className="relative w-full md:w-[360px] group">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                            <Input
                                className="pl-11 h-11 glass-panel border-white/20 shadow-sm font-bold placeholder:font-medium placeholder:text-muted-foreground/50 transition-all focus:ring-primary/20"
                                placeholder="Search apps by name, tag, or capability"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                        <div className="flex items-center gap-2 p-1.5 glass-panel border-white/10 rounded-lg bg-white/20 dark:bg-card/20">
                            <SortAsc className="w-4 h-4 ml-2 text-muted-foreground" />
                            <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
                                <SelectTrigger aria-label="Sort apps" className="w-40 border-none bg-transparent shadow-none h-8 font-black uppercase tracking-widest text-[9px] focus:ring-0">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="glass-panel border-white/20 shadow-2xl">
                                    <SelectItem value="newest" className="text-[10px] font-bold uppercase tracking-widest">Newest</SelectItem>
                                    <SelectItem value="name-az" className="text-[10px] font-bold uppercase tracking-widest">Name A-Z</SelectItem>
                                    <SelectItem value="most-used" className="text-[10px] font-bold uppercase tracking-widest">Most Used</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-8">
                    <Filter className="w-4 h-4 text-muted-foreground mr-1" />
                    {appFilters.map(filter => (
                        <Button
                            key={filter.value}
                            type="button"
                            variant={activeFilter === filter.value ? "default" : "outline"}
                            size="sm"
                            className="h-8 rounded-full px-4 font-black uppercase tracking-widest text-[10px]"
                            onClick={() => setActiveFilter(filter.value)}
                        >
                            {filter.label}
                        </Button>
                    ))}
                    {(search || activeFilter !== "all") && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-3 font-bold text-xs text-muted-foreground"
                            onClick={() => {
                                setSearch("");
                                setActiveFilter("all");
                            }}
                        >
                            Clear
                        </Button>
                    )}
                </div>

                <TabsContent value="installed" className="space-y-8 outline-none mt-4">
                    <AnimatePresence mode="wait">
                        {loadingFleet ? (
                            <motion.div
                                key="loading"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                            >
                                {[1, 2, 3].map(i => (
                                    <Card key={i} className="flex flex-col h-[200px]">
                                        <Skeleton className="h-full w-full" />
                                    </Card>
                                ))}
                            </motion.div>
                        ) : (!fleetItems || fleetItems.length === 0) ? (
                            <motion.div
                                key="empty"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                            >
                                <Card className="text-center py-16 border-dashed">
                                    <CardContent>
                                        <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-50" />
                                        <h3 className="text-lg font-bold mb-2">No Fleet Assets</h3>
                                        <p className="text-muted-foreground mb-6">Install apps or publish Agent AIs to build out your fleet.</p>
                                        <Button onClick={() => setActiveTab('market')}>Browse Marketplace</Button>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        ) : (filteredFleetItems.length === 0) ? (
                            <motion.div key="empty-filtered" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <Card className="text-center py-16 border-dashed">
                                    <CardContent>
                                        <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-50" />
                                        <h3 className="text-lg font-bold mb-2">No Installed Apps Match</h3>
                                        <p className="text-muted-foreground mb-6">No installed assets match {activeFilterLabel.toLowerCase()} {search ? `and "${search}"` : "filters"}.</p>
                                        <Button variant="outline" onClick={() => { setSearch(""); setActiveFilter("all"); }}>Reset Filters</Button>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="installed-list"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="space-y-8"
                            >
                                {fleetGroups.map((group) => {
                                    const isCollapsed = collapsedGroups[group.key] ?? false;
                                    return (
                                    <section key={group.key} className="space-y-4">
                                        <button
                                            type="button"
                                            onClick={() => toggleGroup(group.key)}
                                            className="flex items-center gap-2 w-full text-left"
                                        >
                                            {isCollapsed
                                                ? <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                                : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                                            <span className="text-xs font-black uppercase tracking-widest">{group.name}</span>
                                            <Badge variant="secondary" className="text-[9px] font-black tracking-widest border-white/10">{group.items.length}</Badge>
                                            <span className="flex-1 h-px bg-foreground/10 ml-2" />
                                        </button>
                                        {!isCollapsed && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                            {group.items.map((item) => item.source === "app" ? (
                                    <Card key={item.id} className="group flex flex-col app-glass-card hover:border-primary/50 transition-all hover:shadow-2xl hover:shadow-primary/5">
                                        <div className="relative h-2 bg-primary/10 overflow-hidden">
                                            <div className={cn(
                                                "absolute inset-y-0 left-0 transition-all duration-1000",
                                                item.status === "live" ? "bg-emerald-500 w-full shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-primary w-1/3 opacity-30"
                                            )} />
                                        </div>
                                        <CardHeader className="pb-4">
                                            <div className="flex justify-between items-start">
                                                <div className="flex items-center gap-4">
                                                    <AppIcon 
                                                        icon={item.app.icon} 
                                                        className="w-12 h-12 rounded-xl border-2 border-white/20 shadow-md group-hover:scale-110 transition-transform"
                                                        innerClassName="w-6 h-6 text-primary"
                                                    />
                                                    <div>
                                                        <CardTitle className="text-lg font-black tracking-tight leading-tight mb-1">{item.app.name}</CardTitle>
                                                        <CardDescription className="text-[10px] font-black uppercase tracking-widest opacity-60">Version {item.app.version}</CardDescription>
                                                    </div>
                                                </div>
                                                {(() => {
                                                    const ageMs = item.updatedAt ? now - new Date(item.updatedAt).getTime() : Infinity;
                                                    const isHydrating = item.status === "live" && ageMs < 10000;

                                                    if (isHydrating) {
                                                        return (
                                                            <div className="flex items-center gap-1.5">
                                                                <RefreshCw className="w-3 h-3 text-sky-500 animate-spin" />
                                                                <Badge variant="secondary" className="bg-sky-500/10 text-sky-500 border-sky-500/20 text-[9px] font-black uppercase tracking-widest">Hydrating</Badge>
                                                            </div>
                                                        );
                                                    }

                                                    if (item.status === "live") {
                                                        return (
                                                            <div className="flex items-center gap-1.5">
                                                                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-glow" />
                                                                <Badge variant="default" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[9px] font-black uppercase tracking-widest">Live</Badge>
                                                            </div>
                                                        );
                                                    }

                                                    if (item.app.status === 'draft') {
                                                        return (
                                                            <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[9px] font-black uppercase tracking-widest animate-pulse">Forging</Badge>
                                                        );
                                                    }

                                                    return (
                                                        <Badge variant="secondary" className="bg-muted dark:bg-muted text-[9px] font-black uppercase tracking-widest border-white/10">Inactive</Badge>
                                                    );
                                                })()}
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-4 line-clamp-2 font-medium leading-relaxed">{displayText(item.app.description, "Purpose-built operational workbench.")}</p>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {fleetTags(item).map(tag => (
                                                    <Badge key={tag} variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-[9px] font-black uppercase tracking-widest">
                                                        {tag}
                                                    </Badge>
                                                ))}
                                                {item.cycleApp && (
                                                    <>
                                                    <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-[9px] font-black uppercase tracking-widest">
                                                        {item.cycleApp.sourceCycleName || "Cycle App"}
                                                    </Badge>
                                                    {item.cycleApp.dependentMissionIds?.slice(0, 2).map((missionId) => (
                                                        <Badge key={missionId} variant="outline" className="text-[9px] font-black uppercase tracking-widest border-white/15">
                                                            {missionId.replace(/^mission-/, "M-")}
                                                        </Badge>
                                                    ))}
                                                    </>
                                                )}
                                            </div>
                                        </CardHeader>
                                        <CardContent className="flex-1">
                                            <div className="grid grid-cols-2 gap-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                                <div className="flex items-center gap-2"><Clock3 className="w-3.5 h-3.5 text-primary" /> {formatDate(item.updatedAt)}</div>
                                            </div>
                                        </CardContent>
                                        <CardFooter className="pt-4 border-t border-white/10 flex justify-between bg-white/40 dark:bg-background/40 backdrop-blur-sm">
                                            {item.app.status === 'draft' ? (
                                                <Button 
                                                    className="w-full h-10 bg-amber-500 hover:bg-amber-600 text-foreground font-black uppercase tracking-widest text-[10px] shadow-lg shadow-amber-500/20 transition-all gap-2"
                                                    onClick={() => {
                                                        const jobId = item.app.runtimeMetadata?.jobId;
                                                        const missionId = item.app.runtimeMetadata?.oddjobMissionId;
                                                        if (jobId) {
                                                            // Re-open the forge progress view directly
                                                            setLocation(`/armory/forge?resume=${jobId}`);
                                                        } else if (missionId) {
                                                            setLocation(`/missions/${missionId}`);
                                                        } else {
                                                            setLocation('/armory/forge');
                                                        }
                                                    }}
                                                >
                                                    <Hammer className="w-3.5 h-3.5" /> Resume Forge
                                                </Button>
                                            ) : (
                                                <>
                                                    <Button 
                                                        variant="ghost" 
                                                        size="sm" 
                                                        className="h-9 px-4 font-black uppercase tracking-widest text-[10px] hover:bg-primary/10 hover:text-primary transition-all"
                                                        onClick={() => setLocation(item.configurePath)}
                                                    >
                                                        <Settings className="w-3.5 h-3.5 mr-2" /> Configure
                                                    </Button>
                                                    {item.cycleApp?.editableInAppBuilder && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-9 px-4 font-black uppercase tracking-widest text-[10px] hover:bg-primary/10 hover:text-primary transition-all"
                                                            onClick={() => setLocation(item.editPath || `${item.configurePath}?tab=preview`)}
                                                        >
                                                            <Code className="w-3.5 h-3.5 mr-2" /> Edit
                                                        </Button>
                                                    )}
                                                    {(item.publicPath || item.deployment.url) && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-9 px-4 font-black uppercase tracking-widest text-[10px] hover:bg-primary/10 hover:text-primary transition-all"
                                                            disabled={item.updatedAt ? now - new Date(item.updatedAt).getTime() < 10000 : false}
                                                            onClick={() => {
                                                                if (item.updatedAt && now - new Date(item.updatedAt).getTime() < 10000) return;
                                                                void openApp(item);
                                                            }}
                                                        >
                                                            {item.updatedAt && now - new Date(item.updatedAt).getTime() < 10000 ? (
                                                                <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> Starting...</>
                                                            ) : (
                                                                <><ExternalLink className="w-3.5 h-3.5 mr-2" /> View App</>
                                                            )}
                                                        </Button>
                                                    )}
                                                </>
                                            )}
                                        </CardFooter>
                                    </Card>
                                ) : (
                                    <Card key={item.id} className="group flex flex-col app-glass-card hover:border-primary/50 transition-all hover:shadow-2xl hover:shadow-primary/5">
                                        <div className="relative h-2 bg-emerald-500/10 overflow-hidden">
                                            <div className="absolute inset-y-0 left-0 bg-emerald-500 w-full shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                        </div>
                                        <CardHeader className="pb-4">
                                            <div className="flex justify-between items-start">
                                                <div className="flex items-center gap-4">
                                                    {item.agentDeployment.brandingConfig?.avatarUrl ? (
                                                        <img src={item.agentDeployment.brandingConfig.avatarUrl} className="w-12 h-12 rounded-xl object-cover border-2 border-white/20 shadow-md group-hover:scale-110 transition-transform" alt="" />
                                                    ) : (
                                                        <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center border-2 border-white/20 shadow-md group-hover:scale-110 transition-transform">
                                                            <Bot className="w-6 h-6 text-emerald-500" />
                                                        </div>
                                                    )}
                                                    <div>
                                                        <CardTitle className="text-lg font-black tracking-tight leading-tight mb-1">{item.title}</CardTitle>
                                                        <CardDescription className="text-[10px] font-black uppercase tracking-widest opacity-60">Agent AI / Job {item.agentDeployment.jobId}</CardDescription>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-glow" />
                                                    <Badge variant="default" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[9px] font-black uppercase tracking-widest">Live</Badge>
                                                </div>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-4 line-clamp-2 font-medium leading-relaxed">{item.description || "Published Agent AI ready for public interaction."}</p>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {fleetTags(item).map(tag => (
                                                    <Badge key={tag} variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-[9px] font-black uppercase tracking-widest">
                                                        {tag}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </CardHeader>
                                        <CardContent className="flex-1 space-y-4">
                                            {item.agentDeployment.pipelineNames && item.agentDeployment.pipelineNames.length > 0 && (
                                                <div className="flex flex-wrap gap-2">
                                                    {item.agentDeployment.pipelineNames.map((name, i) => (
                                                        <Badge key={i} variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-[9px] font-black uppercase tracking-widest gap-1">
                                                            <Code className="w-3 h-3" /> {name}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            )}
                                            {item.agentDeployment.stats && (
                                                <div className="flex items-center gap-4 pt-2 border-t border-white/5">
                                                    <div className="flex items-center gap-1.5 text-xs font-mono font-bold">
                                                        <Star className={cn("w-3.5 h-3.5", item.agentDeployment.stats.averageRating ? "text-amber-500 fill-amber-500" : "text-muted-foreground")} />
                                                        <span>{item.agentDeployment.stats.averageRating || "No Ratings"}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-muted-foreground">
                                                        <MessageSquare className="w-3.5 h-3.5" />
                                                        <span>{item.agentDeployment.stats.totalInteractions} Uses</span>
                                                    </div>
                                                </div>
                                            )}
                                        </CardContent>
                                        <CardFooter className="pt-4 border-t border-white/10 flex justify-between bg-white/40 dark:bg-background/40 backdrop-blur-sm gap-2">
                                            <Sheet>
                                                <SheetTrigger asChild>
                                                    <Button
                                                        variant="default"
                                                        size="sm"
                                                        className="flex-1 h-9 font-black uppercase tracking-widest text-[10px] transition-all bg-emerald-500 hover:bg-emerald-600 text-foreground"
                                                    >
                                                        <PlayCircle className="w-3.5 h-3.5 mr-2" /> Test Drive
                                                    </Button>
                                                </SheetTrigger>
                                                <SheetContent side="right" className="w-[400px] sm:w-[540px] p-0 border-l border-border/50 shadow-2xl flex flex-col">
                                                    <div className="p-4 border-b border-border bg-muted/30 flex items-center gap-3">
                                                        {item.agentDeployment.brandingConfig?.avatarUrl ? (
                                                            <img src={item.agentDeployment.brandingConfig.avatarUrl} className="w-8 h-8 rounded-lg" alt="" />
                                                        ) : (
                                                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                                                                <Bot className="w-4 h-4 text-emerald-500" />
                                                            </div>
                                                        )}
                                                        <div>
                                                            <h3 className="font-black text-sm uppercase tracking-widest">{item.title}</h3>
                                                            <p className="text-[10px] text-muted-foreground uppercase font-mono">Sandbox Environment</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex-1 relative bg-black">
                                                        <iframe src={`${item.publicPath}?embed=1`} title={`Preview of ${item.title}`} className="absolute inset-0 w-full h-full border-0" />
                                                    </div>
                                                </SheetContent>
                                            </Sheet>
                                            
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="outline" size="sm" className="h-9 w-9 p-0 border-white/20">
                                                        <MoreVertical className="w-4 h-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-48 glass-panel border-white/20 shadow-2xl">
                                                    <DropdownMenuItem className="font-bold text-xs uppercase cursor-pointer" onClick={() => setLocation(item.configurePath)}>
                                                        <Settings className="w-4 h-4 mr-2" /> Configure
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem 
                                                        className="font-bold text-xs uppercase cursor-pointer text-amber-500"
                                                        onClick={() => togglePauseMutation.mutate({ id: item.agentDeployment.id, isActive: false })}
                                                    >
                                                        <PauseCircle className="w-4 h-4 mr-2" /> Pause Access
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem className="font-bold text-xs uppercase cursor-pointer" onClick={() => window.open(item.publicPath, '_blank')}>
                                                        <ExternalLink className="w-4 h-4 mr-2" /> Open Public Route
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </CardFooter>
                                    </Card>
                                            ))}
                                        </div>
                                        )}
                                    </section>
                                    );
                                })}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </TabsContent>

                <TabsContent value="market" className="space-y-6">
                    {loadingMarket ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {[1, 2, 3].map(i => (
                                <Card key={i} className="flex flex-col h-[200px]">
                                    <Skeleton className="h-full w-full" />
                                </Card>
                            ))}
                        </div>
                    ) : filteredMarketApps.length === 0 ? (
                        <Card className="text-center py-16 border-dashed">
                            <CardContent>
                                <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-50" />
                                <h3 className="text-lg font-bold mb-2">No Marketplace Apps Match</h3>
                                <p className="text-muted-foreground mb-6">{search ? `No apps match "${search}" with the ${activeFilterLabel.toLowerCase()} filter.` : "No apps are available for this filter."}</p>
                                <Button variant="outline" onClick={() => { setSearch(""); setActiveFilter("all"); }}>Reset Filters</Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
                        >
                            {filteredMarketApps.map((app, idx) => {
                                const installed = isInstalled(app.id);
                                return (
                                    <motion.div
                                        key={app.id}
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ delay: idx * 0.05 }}
                                    >
                                        <Card className="group flex flex-col app-glass-card hover:border-primary/50 transition-all hover:shadow-2xl hover:shadow-primary/5 overflow-hidden">
                                            <div className="h-28 bg-muted dark:bg-muted/50 flex items-center justify-between px-7 border-b border-white/10 group-hover:bg-primary/5 transition-colors">
                                                <AppIcon 
                                                    icon={app.icon} 
                                                    className="w-14 h-14 rounded-xl border-2 border-white/20 shadow-md bg-background group-hover:scale-105 transition-transform"
                                                    innerClassName="w-7 h-7 text-primary"
                                                />
                                                <Badge variant={installed ? "default" : "secondary"} className={cn("text-[9px] font-black uppercase tracking-widest border-white/10", installed ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "")}>
                                                    {installed ? "Installed" : "Available"}
                                                </Badge>
                                            </div>
                                            <CardHeader className="pb-4">
                                                <div className="flex justify-between items-start">
                                                    <div className="min-w-0">
                                                        <CardTitle className="text-lg font-black tracking-tight leading-tight mb-1">{app.name}</CardTitle>
                                                        <CardDescription className="text-[10px] font-black tracking-widest uppercase opacity-60">Version {app.version}</CardDescription>
                                                    </div>
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-4 line-clamp-2 font-medium leading-relaxed">{app.description}</p>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    {appTags(app).map(tag => (
                                                        <Badge key={tag} variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-[9px] font-black uppercase tracking-widest">
                                                            {tag}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </CardHeader>
                                            <CardContent className="flex-1">
                                                <div className="grid grid-cols-2 gap-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                                    <AppReviewsDialog appId={app.id} appName={app.name} summary={app.reviewSummary} />
                                                    <div className="flex items-center gap-2"><Boxes className="w-3.5 h-3.5 text-primary" /> Org scope</div>
                                                </div>
                                            </CardContent>
                                            <CardFooter className="pt-4 border-t border-white/10 bg-white/40 dark:bg-background/40 backdrop-blur-sm gap-2">
                                                {installed ? (
                                                    <>
                                                        <Button 
                                                            variant="default" 
                                                            className="flex-1 h-10 font-black uppercase tracking-widest text-[10px] transition-all"
                                                            onClick={() => setLocation(`/armory/apps/${app.id}`)}
                                                        >
                                                            <Settings className="w-3.5 h-3.5 mr-2" /> Configure
                                                        </Button>
                                                        <Button 
                                                            variant="outline" 
                                                            size="icon"
                                                            className="h-10 w-10"
                                                            aria-label={`View details for ${app.name}`}
                                                            onClick={() => setLocation(`/armory/apps/${app.id}`)}
                                                        >
                                                            <Eye className="w-4 h-4" />
                                                        </Button>
                                                    </>
                                                ) : (
                                                    <Button
                                                        className="w-full h-10 bg-primary hover:bg-primary/90 text-primary-foreground font-black uppercase tracking-widest text-[10px] shadow-lg shadow-primary/20 transition-all"
                                                        onClick={() => installMutation.mutate(app.id)}
                                                        disabled={installMutation.isPending || loadingInstalled || !isAdmin}
                                                        title={!isAdmin ? 'Organization administrator access is required to install marketplace apps.' : undefined}
                                                    >
                                                        {installMutation.isPending || loadingInstalled ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : !isAdmin ? <ShieldCheck className="w-3.5 h-3.5 mr-2" /> : <Download className="w-3.5 h-3.5 mr-2" />}
                                                        {loadingInstalled
                                                            ? 'Checking installation'
                                                            : !isAdmin
                                                            ? 'Organization admin required'
                                                            : (app.slug.includes('sdlc') || app.name.toLowerCase().includes('sdlc') || app.name.toLowerCase().includes('cycle') || !!(app as any).blueprintSlug)
                                                                ? 'Acquire Blueprint'
                                                                : 'Install App'}
                                                    </Button>
                                                )}
                                            </CardFooter>
                                        </Card>
                                    </motion.div>
                                );
                            })}
                        </motion.div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}
