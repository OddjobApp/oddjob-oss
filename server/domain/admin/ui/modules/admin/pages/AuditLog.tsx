import React, { useState, useMemo } from "react";
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
import { Search, History, User, FileJson, ShieldCheck, Zap, Activity, Clock, Terminal, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@domain-ui/core/ui/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

const safeDateDisplay = (dateStr: string | number | undefined) => {
    if (!dateStr) return "N/A";
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return "Invalid Date";
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return "N/A";
    }
};

const safeFullDate = (dateStr: string | number | undefined) => {
    if (!dateStr) return "N/A";
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return "Invalid Date";
        return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
        return "N/A";
    }
};

export default function AuditLogPage() {
    const [page, setPage] = useState(1);
    const [entityType, setEntityType] = useState("");

    const { data, isLoading } = useQuery({
        queryKey: ["audit-logs", page, entityType],
        queryFn: async () => {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: "50"
            });
            if (entityType) params.append("entityType", entityType);

            const res = await fetch(`/api/audit?${params}`);
            if (!res.ok) throw new Error("Failed to fetch audit logs");
            return res.json();
        }
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
                            Operational Directives // Forensic Oversight
                        </span>
                    </div>
                    <div className="space-y-1">
                        <h1 className="text-6xl md:text-8xl font-black tracking-tighter uppercase italic leading-none">
                            Forensic_<span className="text-foreground/20">Audit</span><br />
                            Registry_
                        </h1>
                    </div>
                </div>

                <div className="flex flex-col items-end gap-6">
                    <div className="text-right space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-widest text-foreground/20 italic">Immutability Status</p>
                        <p className="text-2xl font-black italic tracking-tighter text-emerald-500 uppercase flex items-center gap-3">
                            <ShieldCheck className="w-6 h-6" /> Logs Verified
                        </p>
                    </div>
                </div>
            </header>

            <div className="flex flex-col lg:row gap-12 flex-1 min-h-0">
                {/* Main Content Area */}
                <div className="flex-1 space-y-8 min-h-0">
                    <Card className="glass-panel-deep border-foreground/10 rounded-[3rem] overflow-hidden flex flex-col h-full shadow-2xl">
                        <CardHeader className="p-10 pb-6 border-b border-foreground/5 space-y-6">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                                <div className="space-y-1">
                                    <CardTitle className="text-xl font-black uppercase tracking-tight italic">Activity History</CardTitle>
                                    <CardDescription className="text-[10px] font-bold uppercase tracking-widest text-foreground/30 italic">
                                        Synchronized Entry Queue // Latest 50 Cycles
                                    </CardDescription>
                                </div>
                                <div className="flex gap-4">
                                    <div className="relative group min-w-[300px]">
                                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/20 group-hover:text-primary transition-colors" />
                                        <Input
                                            placeholder="FILTER_BY_ENTITY_TYPE..."
                                            value={entityType}
                                            onChange={(e) => setEntityType(e.target.value)}
                                            className="w-full h-12 bg-foreground/[0.03] border-foreground/5 rounded-xl pl-12 pr-4 text-[11px] font-black tracking-widest uppercase italic focus:ring-primary/40 focus:border-primary/20"
                                        />
                                    </div>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0 flex-1 overflow-auto custom-scrollbar">
                            {isLoading ? (
                                <div className="p-10 space-y-4">
                                    {[1, 2, 3, 4, 5].map(i => (
                                        <Skeleton key={i} className="h-16 w-full rounded-2xl bg-foreground/[0.02]" />
                                    ))}
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader className="sticky top-0 bg-background/80 backdrop-blur-3xl z-20 border-b border-foreground/5">
                                        <TableRow className="hover:bg-transparent border-foreground/5">
                                            <TableHead className="h-14 px-10 text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Timestamp</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">System User</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Directive Action</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Entity Vector</TableHead>
                                            <TableHead className="text-right px-10 text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Telemetry</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        <AnimatePresence>
                                            {data?.data?.map((log: any, idx: number) => (
                                                <motion.tr 
                                                    key={log.id}
                                                    initial={{ opacity: 0, x: -10 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    transition={{ delay: idx * 0.01 }}
                                                    className="group border-b border-foreground/5 hover:bg-foreground/[0.02] transition-colors"
                                                >
                                                    <TableCell className="px-10 py-6">
                                                        <div className="flex flex-col">
                                                            <span className="text-xs font-black italic tracking-tighter text-foreground/80 group-hover:text-primary transition-colors">
                                                                {safeDateDisplay(log.createdAt)}
                                                            </span>
                                                            <span className="text-[9px] font-bold uppercase tracking-widest text-foreground/20 italic">
                                                                {safeFullDate(log.createdAt)}
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-lg bg-foreground/5 border border-foreground/10 flex items-center justify-center">
                                                                <User className="h-3.5 w-3.5 text-foreground/40 group-hover:text-primary transition-colors" />
                                                            </div>
                                                            <span className="text-[10px] font-black italic uppercase tracking-widest text-foreground/60">
                                                                {log.userId}
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge 
                                                            variant="outline"
                                                            className={cn(
                                                                "h-6 px-3 rounded-lg text-[9px] font-black uppercase tracking-widest italic border-none shadow-lg",
                                                                log.action === 'DELETE' ? 'bg-red-500/10 text-red-500 shadow-red-500/10' :
                                                                log.action === 'CREATE' ? 'bg-emerald-500/10 text-emerald-500 shadow-emerald-500/10' :
                                                                'bg-blue-500/10 text-blue-500 shadow-blue-500/10'
                                                            )}
                                                        >
                                                            {log.action}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-3 font-black text-[10px] tracking-widest italic">
                                                            <span className="text-primary/60">{log.entityType}</span>
                                                            {log.entityId && (
                                                                <>
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-foreground/10" />
                                                                    <span className="text-foreground/40 truncate max-w-[150px]">{log.entityId}</span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right px-10">
                                                        <Dialog>
                                                            <DialogTrigger asChild>
                                                                <Button 
                                                                    variant="ghost" 
                                                                    size="sm"
                                                                    className="h-10 px-4 rounded-xl border border-foreground/5 bg-foreground/5 hover:bg-primary hover:text-primary-foreground text-[9px] font-black uppercase tracking-widest italic transition-all group-hover:border-primary/30"
                                                                >
                                                                    <FileJson className="h-3.5 w-3.5 mr-2" />
                                                                    View Data
                                                                </Button>
                                                            </DialogTrigger>
                                                            <DialogContent className="max-w-3xl glass-panel-deep border-foreground/10 rounded-[3rem] p-0 overflow-hidden flex flex-col">
                                                                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
                                                                <DialogHeader className="p-10 pb-6 shrink-0">
                                                                    <div className="flex items-center gap-5">
                                                                        <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-glow">
                                                                            <Terminal className="w-8 h-8 text-primary shadow-[0_0_10px_rgba(var(--primary),0.5)]" />
                                                                        </div>
                                                                        <div className="space-y-1">
                                                                            <DialogTitle className="text-3xl font-black italic uppercase tracking-tighter text-foreground">Entry Telemetry: {log.id}</DialogTitle>
                                                                            <DialogDescription className="text-[10px] font-black uppercase tracking-[0.4em] text-foreground/20 italic">
                                                                                FORENSIC SNAPSHOT // PROTOCOL V1.0
                                                                            </DialogDescription>
                                                                        </div>
                                                                    </div>
                                                                </DialogHeader>
                                                                <div className="flex-1 min-h-0 px-10 pb-10 space-y-8 overflow-auto custom-scrollbar">
                                                                    <div className="grid grid-cols-2 gap-6 p-6 rounded-2xl bg-foreground/[0.02] border border-foreground/5">
                                                                        <div className="space-y-1">
                                                                            <p className="text-[9px] font-black uppercase text-foreground/10 tracking-widest italic">IP VECTOR</p>
                                                                            <p className="text-sm font-black italic tracking-tighter text-foreground/80">{log.ipAddress || 'TERMINAL_LOCAL'}</p>
                                                                        </div>
                                                                        <div className="space-y-1 border-l border-foreground/5 pl-6">
                                                                            <p className="text-[9px] font-black uppercase text-foreground/10 tracking-widest italic">USER AGENT TAG</p>
                                                                            <p className="text-sm font-black italic tracking-tighter text-foreground/80 truncate max-w-full" title={log.userAgent}>
                                                                                {log.userAgent || 'SECURE_DAEMON'}
                                                                            </p>
                                                                        </div>
                                                                        <div className="col-span-2 space-y-1 border-t border-foreground/5 pt-6">
                                                                            <p className="text-[9px] font-black uppercase text-foreground/10 tracking-widest italic">REQUEST PATH</p>
                                                                            <p className="text-sm font-black italic tracking-tighter text-primary">{log.metadata?.path || '/CORE_API'}</p>
                                                                        </div>
                                                                    </div>
                                                                    
                                                                    <div className="space-y-4">
                                                                        <div className="flex items-center gap-3">
                                                                            <Activity className="w-4 h-4 text-primary" />
                                                                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/60 italic">PAYLOAD DIFF SNAPSHOT</span>
                                                                        </div>
                                                                        <div className="bg-background/60 border border-foreground/10 rounded-[2rem] p-8 max-h-[400px] overflow-auto custom-scrollbar">
                                                                            <pre className="text-xs font-mono text-emerald-500/80 leading-relaxed font-bold">
                                                                                {JSON.stringify(log.changes || log.metadata, null, 2)}
                                                                            </pre>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </DialogContent>
                                                        </Dialog>
                                                    </TableCell>
                                                </motion.tr>
                                            ))}
                                        </AnimatePresence>
                                        {(!data?.data || data.data.length === 0) && (
                                            <TableRow>
                                                <TableCell colSpan={5} className="text-center py-24 glass-panel border-none">
                                                    <div className="flex flex-col items-center gap-6">
                                                        <History className="w-12 h-12 text-foreground/5" />
                                                        <span className="text-[12px] font-black uppercase tracking-[0.4rem] text-foreground/20 italic">NULL TRACE DETECTED</span>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                        <CardFooter className="p-8 border-t border-foreground/5 justify-end">
                            <div className="flex items-center gap-4">
                                <Button 
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1}
                                    variant="outline"
                                    className="h-10 px-6 rounded-xl border-foreground/10 text-[10px] font-black uppercase italic tracking-widest hover:bg-foreground/5 disabled:opacity-20 transition-all"
                                >
                                    Cycle Backward
                                </Button>
                                <div className="flex items-center gap-2 font-black italic text-sm">
                                    <span className="text-primary opacity-50">IDX_</span>
                                    <span>{page}</span>
                                </div>
                                <Button 
                                    onClick={() => setPage(p => p + 1)}
                                    disabled={!data?.data || data.data.length < 50}
                                    variant="outline"
                                    className="h-10 px-6 rounded-xl border-foreground/10 text-[10px] font-black uppercase italic tracking-widest hover:bg-foreground/5 disabled:opacity-20 transition-all"
                                >
                                    Cycle Forward
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
