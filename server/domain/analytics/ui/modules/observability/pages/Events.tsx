import React, { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@domain-ui/core/ui/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@domain-ui/core/ui/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useEventStream } from "@domain-ui/core/ui/hooks/use-event-stream";
import { 
    Loader2, Plus, Zap, Activity, Webhook, History, Play,
    Trash2, CheckCircle, XCircle, Clock, RefreshCw,
    Wifi, WifiOff, Terminal, Eye, ChevronRight, ChevronDown,
    Database, Cpu, Share2, AlertTriangle, Info, Search, Filter, Settings
} from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// --- Types ---

interface EventPayload {
    eventId: string;
    eventType: string;
    source: string;
    timestamp: string | number;
    payload: any;
    context?: any;
}

interface WebhookSubscription {
    id: number;
    name: string;
    description?: string;
    eventTypePattern: string;
    webhookUrl: string;
    httpMethod: string;
    isActive: boolean;
    retryCount: number;
    retryDelayMs: number;
    timeoutMs: number;
    lastTriggeredAt?: string;
    lastSuccess?: boolean;
    lastError?: string;
    successCount: number;
    failureCount: number;
}

interface DeliveryLog {
    id: number;
    subscriptionId: number;
    eventId: string;
    eventType: string;
    attemptNumber: number;
    status: string;
    httpStatus?: number;
    responseBody?: string;
    error?: string;
    requestDurationMs?: number;
    sentAt: string;
    completedAt?: string;
}

interface TriggerOutcome {
    log: {
        id: number;
        pipelineId: number;
        triggerId: number;
        evaluationResult: boolean;
        outcome: 'executed' | 'filtered' | 'debouncing' | 'error' | 'skipped';
        executionId?: number;
        errorMessage?: string;
        createdAt: string;
    };
    pipelineName: string;
}

// --- Components ---

const GlitchText = ({ children, className = "" }: { children: string, className?: string }) => {
    return (
        <div className={`relative group ${className}`}>
            <span className="relative z-10">{children}</span>
            <span className="absolute top-0 left-0 -z-10 text-cyan-400 opacity-0 group-hover:opacity-70 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all duration-75">
                {children}
            </span>
            <span className="absolute top-0 left-0 -z-10 text-magenta-400 opacity-0 group-hover:opacity-70 group-hover:-translate-x-1 group-hover:translate-y-1 transition-all duration-75">
                {children}
            </span>
        </div>
    );
};

const EventIcon = ({ type }: { type: string }) => {
    if (type.startsWith('job.')) return <Cpu className="w-4 h-4 text-cyan-400" />;
    if (type.startsWith('mission.')) return <Zap className="w-4 h-4 text-yellow-400" />;
    if (type.startsWith('knowledge.')) return <Database className="w-4 h-4 text-purple-400" />;
    if (type.startsWith('node.')) return <Share2 className="w-4 h-4 text-blue-400" />;
    if (type.includes('error') || type.includes('fail')) return <AlertTriangle className="w-4 h-4 text-red-400" />;
    return <Info className="w-4 h-4 text-muted-foreground" />;
};

const BrutalistBadge = ({ children, variant = "cyan" }: { children: React.ReactNode, variant?: "cyan" | "magenta" | "yellow" | "red" | "slate" }) => {
    const colors = {
        cyan: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
        magenta: "bg-magenta-500/10 text-magenta-400 border-magenta-500/30",
        yellow: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
        red: "bg-red-500/10 text-red-400 border-red-500/30",
        slate: "bg-muted/10 text-muted-foreground border-border/30",
    };

    return (
        <Badge variant="outline" className={`font-mono border px-2 py-0.5 rounded-none uppercase tracking-widest text-[10px] ${colors[variant]}`}>
            {children}
        </Badge>
    );
};

const TriggerOutcomes = ({ eventId }: { eventId: string }) => {
    const { data: outcomes = [], isLoading } = useQuery<TriggerOutcome[]>({
        queryKey: ["/api/events", eventId, "outcomes"],
        enabled: !!eventId,
    });

    if (isLoading) return <div className="animate-pulse text-[10px] text-muted-foreground py-2 uppercase">Tracing triggers...</div>;
    if (outcomes.length === 0) return null;

    return (
        <div className="mt-4 space-y-2 border-t border-border/50 pt-4">
            <div className="text-[10px] uppercase font-black text-magenta-400 tracking-widest flex items-center gap-2">
                <Zap className="w-3 h-3" /> Trigger Activation Outcomes
            </div>
            <div className="grid grid-cols-1 gap-2">
                {outcomes.filter(o => o?.log).map((o) => (
                    <div key={o.log.id} className="bg-background/30 border border-border p-2 flex items-center justify-between group hover:border-magenta-500/50 transition-colors">
                        <div className="flex items-center gap-3">
                            <div className={`w-1.5 h-1.5 rounded-full ${
                                o.log.outcome === 'executed' ? 'bg-green-500' : 
                                o.log.outcome === 'filtered' ? 'bg-yellow-500' : 'bg-red-500'
                            }`} />
                            <div className="space-y-0.5">
                                <div className="text-[11px] font-bold text-foreground uppercase tracking-tight">{o.pipelineName}</div>
                                <div className="text-[9px] text-muted-foreground uppercase font-bold tracking-widest">
                                    {o.log.outcome?.toUpperCase()} {o.log.executionId && `• RUN #${o.log.executionId}`}
                                </div>
                            </div>
                        </div>
                        {o.log.errorMessage && (
                            <div className="text-[9px] text-red-400 max-w-[200px] truncate italic" title={o.log.errorMessage}>
                                {o.log.errorMessage}
                            </div>
                        )}
                        {o.log.executionId && (
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => window.location.href = `/missions/activity?executionId=${o.log.executionId}`}
                                className="h-6 text-[9px] rounded-none hover:bg-magenta-500/10 text-magenta-400 hover:text-magenta-300 font-black tracking-widest uppercase"
                            >
                                TRACE <ChevronRight className="w-3 h-3 ml-1" />
                            </Button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- Page ---

export default function EventsPage() {
    const [activeTab, setActiveTab] = useState("events");
    const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
    const [isEmitOpen, setIsEmitOpen] = useState(false);
    const [isCreateWebhookOpen, setIsCreateWebhookOpen] = useState(false);
    const [selectedSubscription, setSelectedSubscription] = useState<WebhookSubscription | null>(null);
    const [deliveryDialogOpen, setDeliveryDialogOpen] = useState(false);
    
    // Search & Filter State
    const [searchQuery, setSearchQuery] = useState("");
    const [typeFilter, setTypeFilter] = useState("all");
    const [sourceFilter, setSourceFilter] = useState("all");

    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Fetch Metadata
    const { data: eventTypes = [] } = useQuery<string[]>({ queryKey: ["/api/events/types"] });
    const { data: eventSources = [] } = useQuery<string[]>({ queryKey: ["/api/events/sources"] });
    const { data: subscriptions = [], isLoading: subsLoading } = useQuery<WebhookSubscription[]>({ queryKey: ["/api/events/subscriptions"] });

    // Fetch Historical Events
    const { data: initialEvents, isLoading: historicalLoading } = useQuery<EventPayload[]>({
        queryKey: ["/api/events", typeFilter, sourceFilter],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (typeFilter !== "all") params.append("type", typeFilter);
            if (sourceFilter !== "all") params.append("source", sourceFilter);
            params.append("limit", "100");
            const res = await apiRequest("GET", `/api/events?${params.toString()}`);
            return res.json();
        },
        enabled: activeTab === "events",
    });

    // Real-time Event Stream
    const { events: liveEvents, isConnected } = useEventStream({
        maxBuffer: 100,
        autoConnect: activeTab === "events"
    });

    // Merged & Filtered view
    const events = useMemo(() => {
        const all = [...(liveEvents as any[]), ...(initialEvents || [])].filter((v, i, a) => 
            a.findIndex(t => t.eventId === v.eventId) === i
        );

        return all.filter(e => {
            const matchesSearch = searchQuery === "" || 
                e.eventType.toLowerCase().includes(searchQuery.toLowerCase()) ||
                JSON.stringify(e.payload).toLowerCase().includes(searchQuery.toLowerCase());
            
            const matchesType = typeFilter === "all" || e.eventType === typeFilter;
            const matchesSource = sourceFilter === "all" || e.source === sourceFilter;

            return matchesSearch && matchesType && matchesSource;
        }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }, [liveEvents, initialEvents, searchQuery, typeFilter, sourceFilter]);

    const eventsLoading = historicalLoading && events.length === 0;

    // Webhook Deliveries
    const { data: deliveries = [] } = useQuery<DeliveryLog[]>({
        queryKey: ["/api/events/subscriptions", selectedSubscription?.id, "deliveries"],
        queryFn: async () => {
            if (!selectedSubscription) return [];
            const res = await fetch(`/api/events/subscriptions/${selectedSubscription.id}/history`, {
                credentials: "include"
            });
            return res.json();
        },
        enabled: !!selectedSubscription && deliveryDialogOpen,
    });

    // --- Mutations ---

    const emitMutation = useMutation({
        mutationFn: async (data: { eventType: string; payload: string }) => {
            let parsedPayload = {};
            try {
                parsedPayload = JSON.parse(data.payload);
            } catch (e) {
                throw new Error("Payload must be valid JSON");
            }

            const res = await fetch("/api/events/emit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    type: data.eventType,
                    payload: parsedPayload,
                    source: "console"
                }),
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
        onSuccess: () => {
            setIsEmitOpen(false);
            toast({ title: "EVENT EMITTED", description: "Signal propagated to all observers." });
        },
        onError: (err: any) => {
            toast({ title: "TRANSMISSION FAILED", description: err.message, variant: "destructive" });
        },
    });

    const createWebhookMutation = useMutation({
        mutationFn: async (data: any) => apiRequest("POST", "/api/events/subscriptions", data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/events/subscriptions"] });
            setIsCreateWebhookOpen(false);
            toast({ title: "LINK ESTABLISHED", description: "Remote observer active." });
        },
    });

    // --- Helpers ---

    const formatTime = (ts: string | number) => {
        const d = new Date(ts);
        return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
    };

    if (eventsLoading) {
        return (
            <div className="flex bg-background items-center justify-center h-screen font-mono text-cyan-400">
                <div className="text-center space-y-4">
                    <Loader2 className="h-12 w-12 animate-spin mx-auto text-magenta-400" />
                    <div className="animate-pulse tracking-[0.2em]">INITIALIZING SENSORS...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground overflow-x-hidden">

            {/* Header */}
            <div className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">Events</h1>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        {isConnected ? 'Live feed active' : 'Connection lost'}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <Button
                        variant="outline"
                        onClick={() => setIsEmitOpen(true)}
                        className="gap-2"
                    >
                        <Terminal className="w-4 h-4" />
                        Inject Event
                    </Button>
                </div>
            </div>

            <div className="p-6 space-y-6">
                {/* Stats Row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                        { label: "Throughput", value: `${events.length} MSG`, icon: Activity },
                        { label: "Taxonomy", value: `${eventTypes.length} CLS`, icon: Database },
                        { label: "Observers", value: `${subscriptions.length} WEB`, icon: Webhook },
                        { label: "Status", value: isConnected ? "ONLINE" : "OFFLINE", icon: Wifi, status: isConnected ? 'ok' : 'err' },
                    ].map((stat, i) => (
                        <div key={i} className="bg-card border border-border rounded-xl p-4">
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</p>
                                <stat.icon className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <p className={`text-xl font-bold ${stat.status === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : stat.status === 'err' ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>{stat.value}</p>
                        </div>
                    ))}
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <div className="flex justify-between items-center mb-4 border-b border-border pb-3">
                        <TabsList className="bg-transparent h-auto p-0 gap-6">
                            <TabsTrigger value="events" className="rounded-none bg-transparent border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-muted-foreground data-[state=active]:text-foreground font-semibold text-sm px-0 py-2">
                                Event Logs
                            </TabsTrigger>
                            <TabsTrigger value="webhooks" className="rounded-none bg-transparent border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-muted-foreground data-[state=active]:text-foreground font-semibold text-sm px-0 py-2">
                                Webhook Observers
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    {/* Events Tab */}
                    <TabsContent value="events" className="mt-0 focus-visible:outline-none space-y-4">
                        {/* Filters Row */}
                        <div className="flex flex-col md:flex-row gap-4">
                            <div className="relative flex-1 group">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input 
                                    placeholder="Search events..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="pl-9 h-9"
                                />
                            </div>
                            <div className="flex gap-2">
                                <Select value={typeFilter} onValueChange={setTypeFilter}>
                                    <SelectTrigger className="w-[160px] h-9 text-sm">
                                        <div className="flex items-center gap-2">
                                            <Filter className="w-3 h-3 text-muted-foreground" />
                                            <SelectValue placeholder="All Types" />
                                        </div>
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Types</SelectItem>
                                        {eventTypes.map(t => (
                                            <SelectItem key={t} value={t} className="text-xs uppercase font-bold tracking-widest">{t}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                                    <SelectTrigger className="w-[180px] rounded-none border-border bg-card/50 text-xs font-bold uppercase tracking-widest h-10">
                                        <div className="flex items-center gap-2">
                                            <Share2 className="w-3 h-3 text-magenta-400" />
                                            <SelectValue placeholder="SOURCE" />
                                        </div>
                                    </SelectTrigger>
                                    <SelectContent className="bg-background border-border rounded-none">
                                        <SelectItem value="all" className="text-xs uppercase font-bold tracking-widest">ALL SOURCES</SelectItem>
                                        {eventSources.map(s => (
                                            <SelectItem key={s} value={s} className="text-xs uppercase font-bold tracking-widest">{s}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button 
                                    variant="outline" 
                                    size="icon" 
                                    className="h-10 w-10 rounded-none border-border bg-card/50 hover:bg-muted"
                                    onClick={() => {
                                        setSearchQuery("");
                                        setTypeFilter("all");
                                        setSourceFilter("all");
                                    }}
                                >
                                    <RefreshCw className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="border border-border bg-background relative overflow-hidden">
                            {/* Scanning Line Effect */}
                            <motion.div 
                                animate={{ top: ["0%", "100%", "0%"] }}
                                transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                                className="absolute left-0 right-0 h-[1px] bg-cyan-500/20 z-10 pointer-events-none"
                            />

                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader className="bg-card/80 backdrop-blur">
                                        <TableRow className="border-border hover:bg-transparent">
                                            <TableHead className="w-[120px] text-[10px] uppercase font-black text-muted-foreground tracking-widest">Time</TableHead>
                                            <TableHead className="w-[200px] text-[10px] uppercase font-black text-muted-foreground tracking-widest">Identity</TableHead>
                                            <TableHead className="text-[10px] uppercase font-black text-muted-foreground tracking-widest">Signal Payload</TableHead>
                                            <TableHead className="w-[120px] text-[10px] uppercase font-black text-muted-foreground tracking-widest text-right">Origin</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {events.length === 0 ? (
                                            <TableRow className="hover:bg-transparent">
                                                <TableCell colSpan={4} className="h-64 text-center">
                                                    <div className="flex flex-col items-center justify-center space-y-4 opacity-20">
                                                        <Activity className="w-16 h-16 animate-pulse" />
                                                        <div className="tracking-[0.5em] text-xs uppercase">No signals detected</div>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            events.map((event) => (
                                                <React.Fragment key={event.eventId}>
                                                    <TableRow 
                                                        className={`border-border/50 cursor-pointer transition-colors ${expandedEvent === event.eventId ? 'bg-cyan-500/5 hover:bg-cyan-500/10' : 'hover:bg-foreground/5'}`}
                                                        onClick={() => setExpandedEvent(expandedEvent === event.eventId ? null : event.eventId)}
                                                    >
                                                        <TableCell className="font-mono text-[11px] text-muted-foreground py-3">
                                                            {formatTime(event.timestamp)}
                                                        </TableCell>
                                                        <TableCell className="py-3">
                                                            <div className="flex items-center gap-2">
                                                                <EventIcon type={event.eventType} />
                                                                <GlitchText className="text-[11px] font-bold text-foreground uppercase tracking-tight">
                                                                    {event.eventType}
                                                                </GlitchText>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="py-3">
                                                            <div className="flex items-center gap-3">
                                                                <code className="text-[10px] text-muted-foreground truncate max-w-[400px]">
                                                                    {JSON.stringify(event.payload)}
                                                                </code>
                                                                {expandedEvent === event.eventId ? <ChevronDown className="w-3 h-3 text-cyan-400" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right py-3">
                                                            <BrutalistBadge variant={event.source === 'system' ? 'slate' : 'cyan'}>
                                                                {event.source}
                                                            </BrutalistBadge>
                                                        </TableCell>
                                                    </TableRow>
                                                    
                                                    {/* Expanded Detail */}
                                                    <AnimatePresence>
                                                        {expandedEvent === event.eventId && (
                                                            <TableRow className="border-border bg-background hover:bg-background">
                                                                <TableCell colSpan={4} className="p-0">
                                                                    <motion.div 
                                                                        initial={{ height: 0, opacity: 0 }}
                                                                        animate={{ height: "auto", opacity: 1 }}
                                                                        exit={{ height: 0, opacity: 0 }}
                                                                        className="overflow-hidden"
                                                                    >
                                                                        <div className="p-6 border-l-2 border-cyan-400 bg-cyan-400/5 m-4">
                                                                            <div className="flex justify-between items-start mb-4">
                                                                                <div className="space-y-1">
                                                                                    <div className="text-[10px] uppercase font-black text-cyan-400 tracking-widest">Metadata Context</div>
                                                                                    <div className="flex gap-4 text-[11px] text-muted-foreground">
                                                                                        <span>EVENT ID: {event.eventId}</span>
                                                                                        {event.context?.subject && <span>SUBJECT: {event.context.subject}</span>}
                                                                                    </div>
                                                                                </div>
                                                                                <div className="flex gap-2">
                                                                                    <Button variant="outline" size="sm" className="h-7 text-[10px] rounded-none bg-card border-border hover:bg-muted">
                                                                                        <Share2 className="w-3 h-3 mr-1" /> REPLAY
                                                                                    </Button>
                                                                                    <Button variant="outline" size="sm" className="h-7 text-[10px] rounded-none bg-card border-border hover:bg-muted">
                                                                                        <Eye className="w-3 h-3 mr-1" /> SNAPSHOT
                                                                                    </Button>
                                                                                </div>
                                                                            </div>
                                                                            
                                                                            <div className="rounded border border-border overflow-hidden">
                                                                                <SyntaxHighlighter 
                                                                                    language="json" 
                                                                                    style={atomDark} 
                                                                                    customStyle={{ margin: 0, padding: '1.5rem', fontSize: '11px', background: '#080808' }}
                                                                                >
                                                                                    {JSON.stringify(event.payload, null, 2)}
                                                                                </SyntaxHighlighter>
                                                                            </div>
                                                                            <TriggerOutcomes eventId={event.eventId} />
                                                                        </div>
                                                                    </motion.div>
                                                                </TableCell>
                                                            </TableRow>
                                                        )}
                                                    </AnimatePresence>
                                                </React.Fragment>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </TabsContent>

                    {/* Webhooks Tab */}
                    <TabsContent value="webhooks" className="mt-0 focus-visible:outline-none">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold uppercase tracking-tighter italic">Remote Observers</h3>
                            <Button 
                                onClick={() => setIsCreateWebhookOpen(true)}
                                className="rounded-none bg-magenta-500 hover:bg-magenta-600 text-foreground font-black tracking-widest uppercase text-xs h-9"
                            >
                                <Plus className="w-4 h-4 mr-2" /> New Link
                            </Button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {subscriptions.length === 0 ? (
                                <div className="col-span-full h-48 border border-border flex items-center justify-center opacity-20 italic tracking-widest">
                                    No remote observers established.
                                </div>
                            ) : (
                                subscriptions.map((sub) => (
                                    <div key={sub.id} className="bg-card/50 border border-border p-6 relative group transition-all hover:border-magenta-500/50">
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <GlitchText className="text-lg font-black italic uppercase text-foreground tracking-tighter">
                                                        {sub.name}
                                                    </GlitchText>
                                                    <BrutalistBadge variant={sub.isActive ? "magenta" : "slate"}>
                                                        {sub.isActive ? "ACTIVE" : "STANDBY"}
                                                    </BrutalistBadge>
                                                </div>
                                                <p className="text-[11px] text-muted-foreground font-bold uppercase">{sub.webhookUrl}</p>
                                            </div>
                                            <div className="flex gap-1">
                                                <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-magenta-500/20 text-muted-foreground hover:text-magenta-400 rounded-none">
                                                    <Settings className="w-4 h-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-red-500/20 text-muted-foreground hover:text-red-400 rounded-none">
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-3 gap-2 mb-6">
                                            <div className="bg-background/40 p-2 border border-border/50">
                                                <div className="text-[8px] text-muted-foreground uppercase font-bold tracking-widest mb-1">Pattern</div>
                                                <div className="text-[10px] font-mono text-foreground truncate">{sub.eventTypePattern}</div>
                                            </div>
                                            <div className="bg-background/40 p-2 border border-border/50">
                                                <div className="text-[8px] text-muted-foreground uppercase font-bold tracking-widest mb-1">Sent</div>
                                                <div className="text-[10px] font-mono text-cyan-400">{sub.successCount}</div>
                                            </div>
                                            <div className="bg-background/40 p-2 border border-border/50">
                                                <div className="text-[8px] text-muted-foreground uppercase font-bold tracking-widest mb-1">Fails</div>
                                                <div className="text-[10px] font-mono text-red-400">{sub.failureCount}</div>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                {sub.lastTriggeredAt && (
                                                    <div className={`w-2 h-2 rounded-full ${sub.lastSuccess ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`} />
                                                )}
                                                <span className="text-[9px] text-muted-foreground uppercase font-bold">
                                                    {sub.lastTriggeredAt ? `Last Sync: ${new Date(sub.lastTriggeredAt).toLocaleString()}` : 'Never Propagated'}
                                                </span>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    className="h-7 text-[10px] rounded-none border-border bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground font-black tracking-widest uppercase"
                                                    onClick={() => {
                                                        setSelectedSubscription(sub);
                                                        setDeliveryDialogOpen(true);
                                                    }}
                                                >
                                                    <History className="w-3 h-3 mr-1" /> History
                                                </Button>
                                                <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    className="h-7 text-[10px] rounded-none border-magenta-500/30 bg-transparent hover:bg-magenta-500 hover:text-foreground text-magenta-400 font-black tracking-widest uppercase"
                                                >
                                                    <Play className="w-3 h-3 mr-1" /> Test Link
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </TabsContent>
                </Tabs>
            </div>

            {/* Ingestion Terminal (Emit Dialog) */}
            <Dialog open={isEmitOpen} onOpenChange={setIsEmitOpen}>
                <DialogContent className="bg-background border-border rounded-none max-w-2xl font-mono text-foreground">
                    <DialogHeader className="border-b border-border pb-4">
                        <DialogTitle className="text-2xl font-black italic uppercase text-cyan-400 tracking-tighter flex items-center gap-2">
                            <Terminal className="w-6 h-6" /> Signal Injection
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground uppercase tracking-widest text-[10px] font-bold">
                            Direct transmission into the oddjob event stream
                        </DialogDescription>
                    </DialogHeader>
                    
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            const formData = new FormData(e.currentTarget);
                            emitMutation.mutate({
                                eventType: formData.get("eventType") as string,
                                payload: formData.get("payload") as string,
                            });
                        }}
                        className="space-y-6 py-6"
                    >
                        <div className="space-y-2">
                            <Label htmlFor="eventType" className="text-[10px] uppercase font-black text-muted-foreground tracking-widest">Event Type (Protocol)</Label>
                            <Input
                                id="eventType"
                                name="eventType"
                                required
                                placeholder="e.g. MISSION_INITIATED"
                                className="bg-background border-border rounded-none focus:border-cyan-400 focus:ring-0 text-cyan-400 placeholder:text-foreground font-black uppercase tracking-widest"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="payload" className="text-[10px] uppercase font-black text-muted-foreground tracking-widest">Payload Data (JSON Matrix)</Label>
                            <div className="relative">
                                <Textarea
                                    id="payload"
                                    name="payload"
                                    required
                                    placeholder='{ "key": "value" }'
                                    rows={8}
                                    className="bg-background border-border rounded-none focus:border-magenta-400 focus:ring-0 text-magenta-400 placeholder:text-foreground font-mono text-xs p-4"
                                    defaultValue='{\n  "source": "terminal",\n  "importance": "high",\n  "data": {}\n}'
                                />
                                <div className="absolute top-2 right-2 text-[8px] text-muted-foreground font-black">JSON SCHEMA V1</div>
                            </div>
                        </div>
                        <DialogFooter className="border-t border-border pt-6">
                            <Button 
                                type="button" 
                                variant="outline" 
                                onClick={() => setIsEmitOpen(false)}
                                className="rounded-none border-border bg-transparent hover:bg-muted text-muted-foreground tracking-widest uppercase text-xs"
                            >
                                Abort
                            </Button>
                            <Button 
                                type="submit" 
                                disabled={emitMutation.isPending}
                                className="rounded-none bg-cyan-500 hover:bg-cyan-600 text-background font-black tracking-widest uppercase text-xs px-8"
                            >
                                {emitMutation.isPending ? "TRANSMITTING..." : "EXECUTE INJECTION"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Link Establishment (Create Webhook Dialog) */}
            <Dialog open={isCreateWebhookOpen} onOpenChange={setIsCreateWebhookOpen}>
                <DialogContent className="bg-background border-border rounded-none max-w-xl font-mono text-foreground">
                    <DialogHeader className="border-b border-border pb-4">
                        <DialogTitle className="text-2xl font-black italic uppercase text-magenta-400 tracking-tighter flex items-center gap-2">
                            <Webhook className="w-6 h-6" /> Observer Registry
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground uppercase tracking-widest text-[10px] font-bold">
                            Establish a remote link for signal propagation
                        </DialogDescription>
                    </DialogHeader>
                    
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            const formData = new FormData(e.currentTarget);
                            createWebhookMutation.mutate({
                                name: formData.get("name"),
                                eventTypePattern: formData.get("eventTypePattern"),
                                webhookUrl: formData.get("webhookUrl"),
                                httpMethod: formData.get("httpMethod") || "POST",
                                retryCount: parseInt(formData.get("retryCount") as string) || 3,
                            });
                        }}
                        className="space-y-4 py-6"
                    >
                        <div className="space-y-1">
                            <Label htmlFor="name" className="text-[10px] uppercase font-black text-muted-foreground tracking-widest">Identity Alias</Label>
                            <Input id="name" name="name" required placeholder="OBSERVER_ALPHA" className="bg-background border-border rounded-none focus:border-magenta-400 focus:ring-0 uppercase tracking-widest text-xs" />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="eventTypePattern" className="text-[10px] uppercase font-black text-muted-foreground tracking-widest">Filter Matrix (Pattern)</Label>
                            <Input id="eventTypePattern" name="eventTypePattern" required placeholder="job.*" className="bg-background border-border rounded-none focus:border-magenta-400 focus:ring-0 text-xs" />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="webhookUrl" className="text-[10px] uppercase font-black text-muted-foreground tracking-widest">Remote Endpoint (URL)</Label>
                            <Input id="webhookUrl" name="webhookUrl" type="url" required placeholder="https://api.external.com/signal" className="bg-background border-border rounded-none focus:border-magenta-400 focus:ring-0 text-xs" />
                        </div>
                        <DialogFooter className="pt-6">
                            <Button type="submit" disabled={createWebhookMutation.isPending} className="w-full rounded-none bg-magenta-500 hover:bg-magenta-600 text-foreground font-black tracking-widest uppercase text-xs h-12">
                                {createWebhookMutation.isPending ? "REGISTERING..." : "ESTABLISH LINK"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* History Table in Brutalist Style */}
            <Dialog open={deliveryDialogOpen} onOpenChange={setDeliveryDialogOpen}>
                <DialogContent className="bg-background border-border rounded-none max-w-4xl font-mono text-foreground">
                    <DialogHeader className="border-b border-border pb-4">
                        <DialogTitle className="text-2xl font-black italic uppercase text-foreground tracking-tighter flex items-center gap-2">
                            <History className="w-6 h-6 text-yellow-400" /> Propagation Logs
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground uppercase tracking-widest text-[10px] font-bold">
                            History for observer: {selectedSubscription?.name}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="max-h-[500px] overflow-y-auto mt-4 border border-border">
                        <Table>
                            <TableHeader className="bg-card sticky top-0 z-10">
                                <TableRow className="border-border">
                                    <TableHead className="text-[9px] uppercase font-bold text-muted-foreground">Status</TableHead>
                                    <TableHead className="text-[9px] uppercase font-bold text-muted-foreground">Signal</TableHead>
                                    <TableHead className="text-[9px] uppercase font-bold text-muted-foreground">HTTP</TableHead>
                                    <TableHead className="text-[9px] uppercase font-bold text-muted-foreground">Latency</TableHead>
                                    <TableHead className="text-[9px] uppercase font-bold text-muted-foreground text-right">Timestamp</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {deliveries.length === 0 ? (
                                    <TableRow><TableCell colSpan={5} className="h-32 text-center opacity-30 uppercase tracking-[0.2em] text-xs">No logs found</TableCell></TableRow>
                                ) : (
                                    deliveries.map((d) => (
                                        <TableRow key={d.id} className="border-border/50 hover:bg-foreground/5">
                                            <TableCell>
                                                <div className={`w-2 h-2 rounded-full ${d.status === 'success' ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
                                            </TableCell>
                                            <TableCell className="text-[10px] font-bold">{d.eventType}</TableCell>
                                            <TableCell>
                                                <span className={`text-[10px] ${d.httpStatus && d.httpStatus < 400 ? 'text-green-400' : 'text-red-400'}`}>
                                                    {d.httpStatus || 'ERR'}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-[10px] text-muted-foreground">{d.requestDurationMs}ms</TableCell>
                                            <TableCell className="text-right text-[10px] text-muted-foreground">{new Date(d.sentAt).toLocaleString()}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
