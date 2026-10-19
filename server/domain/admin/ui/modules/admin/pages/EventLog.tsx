import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@domain-ui/core/ui/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
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
} from '@domain-ui/core/ui/components/ui/dialog';
import {
    Search,
    RefreshCw,
    Activity,
    Zap,
    AlertCircle,
    Info,
    CheckCircle2,
    Filter,
    Terminal,
    Clock,
    User,
    ShieldAlert,
    ChevronRight,
    ArrowUpRight,
    FileJson,
    BarChart3
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { apiRequest } from '@/lib/queryClient';
import { format } from 'date-fns';

interface EventLogEntry {
    id: number;
    eventId: string;
    type: string;
    source: string;
    subject: string | null;
    payload: any;
    organizationId: number | null;
    emittedAt: string;
}

const severityConfig = (type: string) => {
    if (type.includes('error') || type.includes('fail')) return {
        icon: ShieldAlert,
        color: "text-rose-400",
        bg: "bg-rose-400/10",
        border: "border-rose-400/20",
        glow: "shadow-rose-400/20",
        label: "CRITICAL"
    };
    if (type.includes('warning')) return {
        icon: AlertCircle,
        color: "text-amber-400",
        bg: "bg-amber-400/10",
        border: "border-amber-400/20",
        glow: "shadow-amber-400/20",
        label: "WARNING"
    };
    return {
        icon: Info,
        color: "text-blue-400",
        bg: "bg-blue-400/10",
        border: "border-blue-400/20",
        glow: "shadow-blue-400/20",
        label: "INFO"
    };
};

export default function EventLogPage() {
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(1);
    const limit = 50;

    // Fetch distinct event types
    const { data: eventTypes = [] } = useQuery<string[]>({
        queryKey: ['eventTypes'],
        queryFn: async () => {
            const response = await apiRequest('GET', '/api/events/types');
            return response.json();
        },
    });

    // Fetch events
    const { data: events = [], isLoading, refetch, isRefetching } = useQuery<EventLogEntry[]>({
        queryKey: ['events', typeFilter, searchQuery, page],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (typeFilter !== 'all') {
                params.append('type', typeFilter);
            }
            if (searchQuery) {
                params.append('search', searchQuery);
            }
            params.append('limit', limit.toString());
            params.append('offset', ((page - 1) * limit).toString());

            const response = await apiRequest('GET', `/api/events?${params.toString()}`);
            return response.json();
        },
        refetchInterval: 30000,
    });

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 relative overflow-hidden flex flex-col">
            {/* Cinematic Backdrop */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(var(--primary),0.05)_0%,transparent_50%)]" />
                <div className="absolute inset-0 cinematic-grid opacity-20" />
                <div className="absolute inset-0 bg-noise opacity-[0.03] animate-pulse" />
                <div className="scanline-overlay absolute inset-0 opacity-[0.02]" />
            </div>

            <main className="flex-1 relative z-10 flex flex-col p-4 md:p-6 gap-6 max-w-full mx-auto w-full">
                {/* Operational Header */}
                <header className="flex flex-col md:flex-row md:items-end justify-between gap-8 pb-12 border-b border-foreground/5">
                    <div className="space-y-4">
                        <div className="flex items-center gap-4">
                            <div className="h-4 w-1 bg-primary shadow-glow" />
                            <span className="text-[10px] font-black uppercase tracking-[0.5em] text-primary animate-pulse italic">
                                System Telemetry // Reactive Monitor
                            </span>
                        </div>
                        <div className="space-y-1">
                            <h1 className="text-6xl md:text-8xl font-black tracking-tighter uppercase italic leading-none">
                                Event_<span className="text-foreground/20">Log</span><br />
                                Stream_
                            </h1>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <Button
                            onClick={() => refetch()}
                            disabled={isRefetching}
                            variant="outline"
                            className="h-14 px-8 rounded-xl border-foreground/10 bg-foreground/5 hover:bg-primary hover:text-primary-foreground text-[10px] font-black uppercase italic tracking-widest transition-all shadow-xl group"
                        >
                            <RefreshCw className={cn("w-4 h-4 mr-3 transition-transform duration-500", isRefetching && "animate-spin")} />
                            Synchronize Feed
                        </Button>
                    </div>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-12 flex-1 min-h-0">
                    {/* Control Sidebar */}
                    <aside className="lg:col-span-1 space-y-8">
                        <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden shadow-2xl">
                            <CardHeader className="p-8 pb-4">
                                <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-foreground/40 italic flex items-center gap-2">
                                    <Filter size={14} className="text-primary" />
                                    Stream Control
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-8 pt-0 space-y-6">
                                <div className="space-y-2">
                                    <label className="text-[9px] font-black uppercase tracking-[0.2em] text-foreground/20 italic ml-2">Search Query</label>
                                    <div className="relative group">
                                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/20 group-hover:text-primary transition-colors" />
                                        <Input
                                            placeholder="KEYWORDS..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="w-full h-12 bg-foreground/[0.03] border-foreground/5 rounded-xl pl-12 pr-4 text-[10px] font-black tracking-widest uppercase italic focus:ring-primary/40 focus:border-primary/20"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[9px] font-black uppercase tracking-[0.2em] text-foreground/20 italic ml-2">Type Isolation</label>
                                    <Select value={typeFilter} onValueChange={setTypeFilter}>
                                        <SelectTrigger className="h-12 bg-foreground/[0.03] border-foreground/5 rounded-xl px-4 text-[10px] font-black tracking-widest uppercase italic focus:ring-primary/40">
                                            <SelectValue placeholder="All Types" />
                                        </SelectTrigger>
                                        <SelectContent className="glass-panel-deep border-foreground/10 rounded-xl">
                                            <SelectItem value="all" className="text-[10px] font-black uppercase italic tracking-widest">All Types</SelectItem>
                                            {eventTypes.map((type) => (
                                                <SelectItem key={type} value={type} className="text-[10px] font-black uppercase italic tracking-widest">
                                                    {type}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="pt-6 border-t border-foreground/5 space-y-4">
                                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest italic text-foreground/40">
                                        <span>Active Node</span>
                                        <Badge variant="outline" className="border-emerald-500/20 text-emerald-500 bg-emerald-500/5 text-[8px] font-black tracking-widest italic animate-pulse">Primary</Badge>
                                    </div>
                                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest italic text-foreground/40">
                                        <span>Total Events</span>
                                        <span className="text-primary font-mono tracking-tighter">{events.length}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="p-8 bg-primary/5 rounded-[2.5rem] border border-primary/10 flex items-center gap-5 group cursor-help transition-all hover:bg-primary/10">
                            <div className="p-4 bg-primary/20 rounded-2xl group-hover:rotate-12 transition-transform shadow-glow">
                                <BarChart3 className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-widest text-primary mb-1">Pulse Telemetry</p>
                                <p className="text-[9px] text-foreground/40 leading-relaxed font-bold italic uppercase tracking-tighter">
                                    Interactive Stream // Forensic Mirror
                                </p>
                            </div>
                        </div>
                    </aside>

                    {/* Infinite Event List */}
                    <div className="lg:col-span-3 min-h-0 flex flex-col">
                        <Card className="glass-panel-deep border-foreground/10 rounded-[3rem] overflow-hidden flex flex-col h-full shadow-2xl">
                            <CardContent className="p-0 flex-1 overflow-auto custom-scrollbar">
                                {isLoading ? (
                                    <div className="p-10 space-y-4">
                                        {[1, 2, 3, 4, 5].map(i => (
                                            <Skeleton key={i} className="h-20 w-full rounded-2xl bg-foreground/[0.02]" />
                                        ))}
                                    </div>
                                ) : (
                                    <Table>
                                        <TableHeader className="sticky top-0 bg-background/80 backdrop-blur-3xl z-20 border-b border-foreground/5">
                                            <TableRow className="hover:bg-transparent border-foreground/5">
                                                <TableHead className="h-16 px-10 text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Timestamp</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Severity Vector</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Identity Type</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Origin Source</TableHead>
                                                <TableHead className="text-right px-10 text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Details</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            <AnimatePresence>
                                                {events.map((event, idx) => {
                                                    const cfg = severityConfig(event.type);
                                                    const Icon = cfg.icon;
                                                    return (
                                                        <motion.tr
                                                            key={event.id}
                                                            initial={{ opacity: 0, x: -20 }}
                                                            animate={{ opacity: 1, x: 0 }}
                                                            transition={{ delay: idx * 0.01 }}
                                                            className="group border-b border-foreground/5 hover:bg-foreground/[0.02] transition-all cursor-pointer"
                                                        >
                                                            <TableCell className="px-10 py-8">
                                                                <div className="flex flex-col">
                                                                    <span className="text-xs font-black italic tracking-tighter text-foreground/80 group-hover:text-primary transition-colors">
                                                                        {format(new Date(event.emittedAt), 'HH:mm:ss')}
                                                                    </span>
                                                                    <span className="text-[9px] font-bold uppercase tracking-widest text-foreground/20 italic">
                                                                        {format(new Date(event.emittedAt), 'MMM d, yyyy')}
                                                                    </span>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                <Badge className={cn(
                                                                    "h-7 px-4 rounded-xl border-none font-black text-[9px] tracking-[0.1em] uppercase italic shadow-lg",
                                                                    cfg.bg, cfg.color, cfg.glow
                                                                )}>
                                                                    <Icon size={12} className="mr-2" />
                                                                    {cfg.label}
                                                                </Badge>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex flex-col gap-1">
                                                                    <span className="text-[11px] font-black italic uppercase tracking-tighter text-foreground">
                                                                        {event.type}
                                                                    </span>
                                                                    <span className="text-[9px] font-bold text-foreground/20 font-mono italic truncate max-w-[200px]">
                                                                        {event.eventId}
                                                                    </span>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex items-center gap-3">
                                                                    <div className="p-2 rounded-lg bg-foreground/5 border border-foreground/10 group-hover:border-primary/30 transition-colors">
                                                                        <Terminal className="w-3.5 h-3.5 text-foreground/40" />
                                                                    </div>
                                                                    <span className="text-[10px] font-black italic uppercase tracking-widest text-foreground/40">
                                                                        {event.source}
                                                                    </span>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="px-10 text-right">
                                                                <Dialog>
                                                                    <DialogTrigger asChild>
                                                                        <Button variant="ghost" size="sm" className="h-10 px-4 rounded-xl border border-foreground/5 bg-foreground/5 hover:bg-primary hover:text-primary-foreground text-[9px] font-black uppercase tracking-widest italic transition-all group-hover:border-primary/30">
                                                                            <FileJson className="h-3.5 w-3.5 mr-2" />
                                                                            Inspect
                                                                        </Button>
                                                                    </DialogTrigger>
                                                                    <DialogContent className="max-w-3xl glass-panel-deep border-foreground/10 rounded-[3rem] p-0 overflow-hidden flex flex-col">
                                                                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
                                                                        <DialogHeader className="p-10 pb-6 shrink-0">
                                                                            <div className="flex items-center gap-5">
                                                                                <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-glow">
                                                                                    <Zap className="w-8 h-8 text-primary shadow-[0_0_10px_rgba(var(--primary),0.5)]" />
                                                                                </div>
                                                                                <div className="space-y-1">
                                                                                    <DialogTitle className="text-3xl font-black italic uppercase tracking-tighter text-foreground">Event Telemetry: {event.id}</DialogTitle>
                                                                                    <DialogDescription className="text-[10px] font-black uppercase tracking-[0.4em] text-foreground/20 italic">
                                                                                        SYSTEM SNAPSHOT // EMITTED BY_{event.source}
                                                                                    </DialogDescription>
                                                                                </div>
                                                                            </div>
                                                                        </DialogHeader>
                                                                        <div className="flex-1 min-h-0 px-10 pb-10 space-y-8 overflow-auto custom-scrollbar">
                                                                            <div className="grid grid-cols-2 gap-6 p-6 rounded-2xl bg-foreground/[0.02] border border-foreground/5">
                                                                                <div className="space-y-1">
                                                                                    <p className="text-[9px] font-black uppercase text-foreground/10 tracking-widest italic">ENTITY SUBJECT</p>
                                                                                    <p className="text-sm font-black italic tracking-tighter text-foreground/80">{event.subject || 'INTERNAL_DOMAIN'}</p>
                                                                                </div>
                                                                                <div className="space-y-1 border-l border-foreground/5 pl-6">
                                                                                    <p className="text-[9px] font-black uppercase text-foreground/10 tracking-widest italic">TEMPORAL MARK</p>
                                                                                    <p className="text-sm font-black italic tracking-tighter text-foreground/80">
                                                                                        {format(new Date(event.emittedAt), 'PPpp')}
                                                                                    </p>
                                                                                </div>
                                                                            </div>
                                                                            
                                                                            <div className="space-y-4">
                                                                                <div className="flex items-center gap-3">
                                                                                    <Activity className="w-4 h-4 text-primary" />
                                                                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/60 italic">PAYLOAD JSON MIRROR</span>
                                                                                </div>
                                                                                <div className="bg-background/60 border border-foreground/10 rounded-[2rem] p-8 max-h-[400px] overflow-auto custom-scrollbar">
                                                                                    <pre className="text-xs font-mono text-emerald-500/80 leading-relaxed font-bold">
                                                                                        {JSON.stringify(event.payload, null, 2)}
                                                                                    </pre>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </DialogContent>
                                                                </Dialog>
                                                            </TableCell>
                                                        </motion.tr>
                                                    );
                                                })}
                                            </AnimatePresence>
                                            {events.length === 0 && (
                                                <TableRow>
                                                    <TableCell colSpan={5} className="text-center py-32">
                                                        <Activity className="w-16 h-16 text-foreground/5 mx-auto mb-6" />
                                                        <p className="text-[14px] font-black uppercase tracking-[0.5em] text-foreground/20 italic">Queue Silent</p>
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                )}
                            </CardContent>
                            <CardFooter className="p-10 border-t border-foreground/5 justify-between items-center bg-background/20">
                                <p className="text-[10px] font-black uppercase tracking-widest text-foreground/10 italic">Page Vector: {page}</p>
                                <div className="flex items-center gap-4">
                                    <Button
                                        onClick={() => setPage(p => Math.max(1, p - 1))}
                                        disabled={page === 1}
                                        variant="outline"
                                        className="h-11 px-8 rounded-xl border-foreground/10 text-[10px] font-black uppercase italic tracking-widest hover:bg-foreground/5 disabled:opacity-20 transition-all"
                                    >
                                        Prev Cycle
                                    </Button>
                                    <Button
                                        onClick={() => setPage(p => p + 1)}
                                        disabled={events.length < limit}
                                        variant="outline"
                                        className="h-11 px-8 rounded-xl border-foreground/10 text-[10px] font-black uppercase italic tracking-widest hover:bg-foreground/5 disabled:opacity-20 transition-all"
                                    >
                                        Next Cycle
                                    </Button>
                                </div>
                            </CardFooter>
                        </Card>
                    </div>
                </div>
            </main>
        </div>
    );
}
