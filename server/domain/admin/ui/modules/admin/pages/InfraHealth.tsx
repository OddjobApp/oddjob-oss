/**
 * InfraHealth
 *
 * Admin page providing visibility into:
 *  - Dead Letter Queue: failed jobs with retry / purge / bulk-retry / purge-all
 *  - Circuit Breakers: current states with manual reset
 *
 * Auto-refreshes every 15s. Super-admin only (enforced server-side).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@domain-ui/core/ui/components/ui/table";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@domain-ui/core/ui/components/ui/alert-dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@domain-ui/core/ui/components/ui/dropdown-menu";
import {
    RefreshCw,
    MoreHorizontal,
    RotateCcw,
    Trash2,
    AlertTriangle,
    CheckCircle2,
    Activity,
    Loader2,
    ShieldAlert,
    Zap,
    ShieldCheck,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DLQEntry {
    originalQueue: string;
    originalJobId: string;
    jobName: string;
    data: any;
    failedAt: string;
    error: string;
    attemptsMade: number;
    stacktrace?: string[];
}

interface DLQJob {
    id: string;
    name: string;
    data: DLQEntry;
    timestamp: number;
    attemptsMade: number;
}

interface DLQStats {
    waiting: number;
    total: number;
}

interface CircuitBreaker {
    name: string;
    state: "CLOSED" | "OPEN" | "HALF_OPEN";
    failures: number;
    successes: number;
    lastFailure: string | null;
    halfOpenAttempts: number;
}

// ─── Circuit state badge ──────────────────────────────────────────────────────

function CircuitStateBadge({ state }: { state: CircuitBreaker["state"] }) {
    return (
        <Badge
            variant="outline"
            className={cn(
                "text-[9px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-md border shadow-sm transition-all",
                state === "CLOSED" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 shadow-emerald-500/20",
                state === "OPEN" && "border-red-500/40 bg-red-500/10 text-red-400 shadow-red-500/20",
                state === "HALF_OPEN" && "border-amber-500/40 bg-amber-500/10 text-amber-400 animate-pulse shadow-amber-500/20",
            )}
        >
            <div className="flex items-center gap-1.5">
                {state === "CLOSED" && <CheckCircle2 className="w-2.5 h-2.5" />}
                {state === "OPEN" && <ShieldAlert className="w-2.5 h-2.5" />}
                {state === "HALF_OPEN" && <Activity className="w-2.5 h-2.5 animate-pulse" />}
                {state}
            </div>
        </Badge>
    );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InfraHealth() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const [confirmDialog, setConfirmDialog] = useState<{
        open: boolean;
        title: string;
        description: string;
        onConfirm: () => void;
    }>({ open: false, title: "", description: "", onConfirm: () => {} });

    // ── Data ──────────────────────────────────────────────────────────────────

    const {
        data: dlqData,
        isLoading: dlqLoading,
        refetch: refetchDlq,
        isFetching: dlqFetching,
    } = useQuery<{ jobs: DLQJob[]; stats: DLQStats }>({
        queryKey: ["/api/admin/dlq"],
        refetchInterval: 15000,
    });

    const {
        data: breakers,
        isLoading: breakersLoading,
        refetch: refetchBreakers,
        isFetching: breakersFetching,
    } = useQuery<CircuitBreaker[]>({
        queryKey: ["/api/admin/circuit-breakers"],
        refetchInterval: 15000,
    });

    const isFetching = dlqFetching || breakersFetching;

    function refetchAll() {
        refetchDlq();
        refetchBreakers();
    }

    // ── Mutations ─────────────────────────────────────────────────────────────

    const retryJobMutation = useMutation({
        mutationFn: (jobId: string) => apiRequest("POST", `/api/admin/dlq/${encodeURIComponent(jobId)}/retry`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/dlq"] });
            toast({ title: "Job requeued" });
        },
        onError: (e: any) => toast({ title: "Retry failed", description: e.message, variant: "destructive" }),
    });

    const purgeJobMutation = useMutation({
        mutationFn: (jobId: string) => apiRequest("DELETE", `/api/admin/dlq/${encodeURIComponent(jobId)}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/dlq"] });
            toast({ title: "Job purged" });
        },
        onError: (e: any) => toast({ title: "Purge failed", description: e.message, variant: "destructive" }),
    });

    const retryAllMutation = useMutation({
        mutationFn: () => apiRequest("POST", "/api/admin/dlq/retry-all"),
        onSuccess: (data: any) => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/dlq"] });
            toast({ title: `Requeued ${data.retried} job(s)` });
        },
        onError: (e: any) => toast({ title: "Bulk retry failed", description: e.message, variant: "destructive" }),
    });

    const purgeAllMutation = useMutation({
        mutationFn: () => apiRequest("DELETE", "/api/admin/dlq"),
        onSuccess: (data: any) => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/dlq"] });
            toast({ title: `Purged ${data.purged} job(s)` });
        },
        onError: (e: any) => toast({ title: "Purge all failed", description: e.message, variant: "destructive" }),
    });

    const resetBreakerMutation = useMutation({
        mutationFn: (name: string) => apiRequest("POST", `/api/admin/circuit-breakers/${encodeURIComponent(name)}/reset`),
        onSuccess: (_data: any, name: string) => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/circuit-breakers"] });
            toast({ title: `Circuit '${name}' reset to CLOSED` });
        },
        onError: (e: any) => toast({ title: "Reset failed", description: e.message, variant: "destructive" }),
    });

    // ── Confirm helper ────────────────────────────────────────────────────────

    function confirm(title: string, description: string, onConfirm: () => void) {
        setConfirmDialog({ open: true, title, description, onConfirm });
    }

    const jobs = dlqData?.jobs ?? [];
    const stats = dlqData?.stats;

    return (
        <div className="min-h-screen bg-background text-foreground relative overflow-hidden font-sans selection:bg-primary/30">
            {/* Cinematic Background */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute inset-0 cinematic-grid opacity-20" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full animate-pulse" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full" />
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-overlay" />
            </div>

            <main className="container mx-auto py-6 px-4 space-y-8 max-w-full relative z-10">
                {/* Header */}
                <motion.div 
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6"
                >
                    <div className="space-y-2">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-2xl bg-primary/10 border border-primary/20 shadow-lg shadow-primary/10">
                                <Zap className="w-6 h-6 text-primary shadow-[0_0_15px_rgba(var(--primary),0.5)]" />
                            </div>
                            <h1 className="text-4xl font-black italic tracking-tighter uppercase text-foreground">
                                Infra Health
                            </h1>
                        </div>
                        <p className="text-muted-foreground text-xs font-bold uppercase tracking-[0.3em] pl-1.5 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                            Core Monitoring Station // Internal Protocol v3.2
                        </p>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        <div className="hidden lg:flex flex-col items-end px-4 border-r border-foreground/10">
                            <span className="text-[10px] font-black uppercase tracking-widest text-primary italic">Live Sync</span>
                            <span className="text-[10px] font-mono text-foreground/40 uppercase">Refreshes every 15s</span>
                        </div>
                        <Button 
                            variant="outline" 
                            className="h-12 px-6 rounded-2xl glass-panel border-foreground/10 bg-foreground/[0.02] text-[10px] font-black uppercase tracking-widest hover:bg-foreground/10 transition-all active:scale-95 text-foreground" 
                            onClick={refetchAll} 
                            disabled={isFetching}
                        >
                            {isFetching
                                ? <Loader2 className="w-4 h-4 mr-3 animate-spin text-primary" />
                                : <RefreshCw className="w-4 h-4 mr-3 text-primary" />
                            }
                            Resync Matrix
                        </Button>
                    </div>
                </motion.div>

                {/* ── Dead Letter Queue ──────────────────────────────────────────── */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden shadow-2xl relative">
                        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/[0.03] via-transparent to-transparent pointer-events-none" />
                        <CardHeader className="p-8 pb-4 border-b border-foreground/5 bg-foreground/[0.02]">
                            <div className="flex items-center justify-between flex-wrap gap-4">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-3">
                                        <AlertTriangle className="w-5 h-5 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
                                        <CardTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground leading-none">
                                            Dead Letter Queue
                                        </CardTitle>
                                    </div>
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-8">
                                        Failed jobs synchronization cache
                                        {stats && (
                                            <span className="ml-3 font-black text-amber-500 italic">
                                                {stats.total} PENDING FAILURE{stats.total !== 1 ? "S" : ""}
                                            </span>
                                        )}
                                    </p>
                                </div>
                                {jobs.length > 0 && (
                                    <div className="flex gap-3">
                                        <Button
                                            variant="outline"
                                            className="h-10 px-5 rounded-xl border-foreground/10 bg-foreground/[0.02] text-[9px] font-black uppercase tracking-widest hover:bg-foreground/10 text-foreground/60 transition-all"
                                            onClick={() => confirm(
                                                "Retry all DLQ jobs",
                                                `Requeue all ${jobs.length} failed job(s) for re-execution?`,
                                                () => retryAllMutation.mutate()
                                            )}
                                            disabled={retryAllMutation.isPending}
                                        >
                                            <RotateCcw className="w-3.5 h-3.5 mr-2 text-primary" />
                                            Requeue all
                                        </Button>
                                        <Button
                                            variant="outline"
                                            className="h-10 px-5 rounded-xl border-red-500/20 bg-red-500/5 text-red-500 text-[9px] font-black uppercase tracking-widest hover:bg-red-500/10 transition-all"
                                            onClick={() => confirm(
                                                "Purge all DLQ jobs",
                                                `Permanently delete all ${jobs.length} failed job(s)? This cannot be undone.`,
                                                () => purgeAllMutation.mutate()
                                            )}
                                            disabled={purgeAllMutation.isPending}
                                        >
                                            <Trash2 className="w-3.5 h-3.5 mr-2" />
                                            Purge Matrix
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            {dlqLoading ? (
                                <div className="flex flex-col items-center justify-center py-24 space-y-4">
                                    <Loader2 className="w-10 h-10 animate-spin text-primary" />
                                    <p className="text-[10px] font-black uppercase tracking-[0.4em] text-foreground/20">Accessing Data Streams</p>
                                </div>
                            ) : jobs.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-6">
                                    <div className="p-6 rounded-full bg-emerald-500/5 relative">
                                        <CheckCircle2 className="w-12 h-12 text-emerald-500/40" />
                                        <div className="absolute inset-0 bg-emerald-500/20 blur-2xl rounded-full" />
                                    </div>
                                    <div className="text-center space-y-1">
                                        <p className="text-lg font-black italic uppercase tracking-tighter text-foreground/40">Zero Faults Detected</p>
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/20">Dead letter queue is currently clear</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader className="bg-foreground/[0.01]">
                                            <TableRow className="border-foreground/5 hover:bg-transparent px-8">
                                                <TableHead className="py-6 px-8 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/40 italic">Job Identifier</TableHead>
                                                <TableHead className="py-6 px-8 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/40 italic text-center">Protocol</TableHead>
                                                <TableHead className="py-6 px-8 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/40 italic">Failure Vector</TableHead>
                                                <TableHead className="py-6 px-8 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/40 italic">Timestamp</TableHead>
                                                <TableHead className="py-6 px-8 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/40 italic text-center">Retries</TableHead>
                                                <TableHead className="w-20 px-8" />
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody className="relative z-0">
                                            <AnimatePresence mode="popLayout">
                                                {jobs.map((job, idx) => {
                                                    const entry: DLQEntry = job.data;
                                                    return (
                                                        <motion.tr 
                                                            key={job.id}
                                                            initial={{ opacity: 0, x: -10 }}
                                                            animate={{ opacity: 1, x: 0 }}
                                                            exit={{ opacity: 0, x: 10 }}
                                                            transition={{ delay: idx * 0.05 }}
                                                            className="border-foreground/5 hover:bg-foreground/[0.02] transition-colors group"
                                                        >
                                                            <TableCell className="py-6 px-8">
                                                                <div className="flex flex-col gap-1">
                                                                    <span className="text-sm font-black italic uppercase tracking-tight text-foreground group-hover:text-primary transition-colors leading-none">{entry.jobName}</span>
                                                                    <span className="text-[10px] text-foreground/20 font-mono tracking-tighter uppercase whitespace-nowrap">
                                                                        ID_{job.id.slice(0, 16)}...
                                                                    </span>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="py-6 px-8 text-center">
                                                                <Badge variant="outline" className="text-[8px] font-black uppercase tracking-[0.2em] border-primary/20 bg-primary/5 text-primary rounded-md px-2 py-0.5">
                                                                    {entry.originalQueue}
                                                                </Badge>
                                                            </TableCell>
                                                            <TableCell className="py-6 px-8 max-w-xs">
                                                                <p className="text-[11px] font-black uppercase tracking-tight text-red-400 group-hover:text-red-700 dark:text-red-300 transition-colors truncate italic" title={entry.error}>
                                                                    {entry.error}
                                                                </p>
                                                            </TableCell>
                                                            <TableCell className="py-6 px-8 text-[11px] font-black uppercase tracking-tight text-foreground/40 whitespace-nowrap italic">
                                                                {entry.failedAt
                                                                    ? formatDistanceToNow(new Date(entry.failedAt), { addSuffix: true })
                                                                    : "—"}
                                                            </TableCell>
                                                            <TableCell className="py-6 px-8">
                                                                <div className="flex flex-col items-center">
                                                                    <span className="text-sm font-black text-foreground leading-none">{entry.attemptsMade}</span>
                                                                    <span className="text-[8px] font-black uppercase tracking-tight text-foreground/20 mt-1">Finalized</span>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="py-6 px-8 text-right">
                                                                <DropdownMenu>
                                                                    <DropdownMenuTrigger asChild>
                                                                        <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl hover:bg-foreground/5 text-foreground/40 hover:text-foreground">
                                                                            <MoreHorizontal className="w-5 h-5" />
                                                                        </Button>
                                                                    </DropdownMenuTrigger>
                                                                    <DropdownMenuContent align="end" className="glass-panel border-foreground/10 bg-background/90 p-2 min-w-[160px] rounded-xl overflow-hidden">
                                                                        <div className="absolute inset-0 bg-primary/5 pointer-events-none" />
                                                                        <DropdownMenuItem
                                                                            onClick={() => retryJobMutation.mutate(job.id)}
                                                                            disabled={retryJobMutation.isPending}
                                                                            className="rounded-lg h-10 text-[10px] font-black uppercase tracking-widest gap-3 focus:bg-primary/20 focus:text-primary transition-colors cursor-pointer"
                                                                        >
                                                                            <RotateCcw className="w-4 h-4" />
                                                                            Retry Protocol
                                                                        </DropdownMenuItem>
                                                                        <DropdownMenuSeparator className="bg-foreground/5 my-1" />
                                                                        <DropdownMenuItem
                                                                            className="rounded-lg h-10 text-[10px] font-black uppercase tracking-widest gap-3 focus:bg-red-500/20 text-red-500/60 focus:text-red-500 transition-colors cursor-pointer"
                                                                            onClick={() => confirm(
                                                                                "Purge job",
                                                                                `Permanently delete job "${entry.jobName}" (${job.id})?`,
                                                                                () => purgeJobMutation.mutate(job.id)
                                                                            )}
                                                                        >
                                                                            <Trash2 className="w-4 h-4" />
                                                                            Purge entry
                                                                        </DropdownMenuItem>
                                                                    </DropdownMenuContent>
                                                                </DropdownMenu>
                                                            </TableCell>
                                                        </motion.tr>
                                                    );
                                                })}
                                            </AnimatePresence>
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>

                {/* ── Circuit Breakers ───────────────────────────────────────────── */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                >
                    <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden shadow-2xl relative">
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] via-transparent to-transparent pointer-events-none" />
                        <CardHeader className="p-8 pb-4 border-b border-foreground/5 bg-foreground/[0.02]">
                            <div className="space-y-1">
                                <div className="flex items-center gap-3">
                                    <ShieldCheck className="w-5 h-5 text-primary drop-shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
                                    <CardTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground leading-none">
                                        Circuit Breakers
                                    </CardTitle>
                                </div>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-8">
                                    Adaptive fail-safe protocols state monitor
                                </p>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            {breakersLoading ? (
                                <div className="flex flex-col items-center justify-center py-24 space-y-4">
                                    <Loader2 className="w-10 h-10 animate-spin text-primary" />
                                    <p className="text-[10px] font-black uppercase tracking-[0.4em] text-foreground/20">Polling Subsystems</p>
                                </div>
                            ) : !breakers || breakers.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-6">
                                    <Activity className="w-12 h-12 opacity-10" />
                                    <p className="text-[10px] font-black uppercase tracking-[0.4em] text-foreground/20">No active circuit monitors detected</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader className="bg-foreground/[0.01]">
                                            <TableRow className="border-foreground/5 hover:bg-transparent px-8 text-left">
                                                <TableHead className="py-6 px-8 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/40 italic">System Node</TableHead>
                                                <TableHead className="py-6 px-8 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/40 italic text-center">Status State</TableHead>
                                                <TableHead className="py-6 px-8 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/40 italic text-center">Fault Log</TableHead>
                                                <TableHead className="py-6 px-8 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/40 italic text-center">Sync Log</TableHead>
                                                <TableHead className="py-6 px-8 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/40 italic">Last Incident</TableHead>
                                                <TableHead className="w-32 px-8" />
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            <AnimatePresence mode="popLayout">
                                                {breakers.map((cb, idx) => (
                                                    <motion.tr 
                                                        key={cb.name}
                                                        initial={{ opacity: 0, x: -10 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        transition={{ delay: 0.2 + (idx * 0.05) }}
                                                        className="border-foreground/5 hover:bg-foreground/[0.02] transition-colors group"
                                                    >
                                                        <TableCell className="py-6 px-8">
                                                            <span className="text-sm font-black italic text-foreground uppercase tracking-tight group-hover:text-primary transition-colors font-mono">{cb.name}</span>
                                                        </TableCell>
                                                        <TableCell className="py-6 px-8 text-center">
                                                            <CircuitStateBadge state={cb.state} />
                                                        </TableCell>
                                                        <TableCell className="py-6 px-8 text-center">
                                                            <span className={cn(
                                                                "text-sm font-black italic tabular-nums leading-none",
                                                                cb.failures > 0 ? "text-amber-400 drop-shadow-[0_0_5px_rgba(251,191,36,0.3)]" : "text-foreground/20"
                                                            )}>
                                                                {cb.failures}
                                                            </span>
                                                        </TableCell>
                                                        <TableCell className="py-6 px-8 text-center text-sm font-black text-foreground/40 tabular-nums italic">
                                                            {cb.successes}
                                                        </TableCell>
                                                        <TableCell className="py-6 px-8 text-[11px] font-black uppercase tracking-tight text-foreground/40 whitespace-nowrap italic">
                                                            {cb.lastFailure
                                                                ? formatDistanceToNow(new Date(cb.lastFailure), { addSuffix: true })
                                                                : "—"}
                                                        </TableCell>
                                                        <TableCell className="py-6 px-8 text-right">
                                                            <AnimatePresence>
                                                                {cb.state !== "CLOSED" && (
                                                                    <motion.div
                                                                        initial={{ opacity: 0, scale: 0.9 }}
                                                                        animate={{ opacity: 1, scale: 1 }}
                                                                        exit={{ opacity: 0, scale: 0.9 }}
                                                                    >
                                                                        <Button
                                                                            variant="outline"
                                                                            className="h-9 px-4 rounded-xl border-primary/40 bg-primary/5 text-primary text-[9px] font-black uppercase tracking-widest hover:bg-primary/20 transition-all shadow-lg shadow-primary/10 active:scale-95"
                                                                            onClick={() => confirm(
                                                                                `Reset circuit '${cb.name}'`,
                                                                                `Force the '${cb.name}' circuit back to CLOSED? New requests will be allowed through immediately.`,
                                                                                () => resetBreakerMutation.mutate(cb.name)
                                                                            )}
                                                                            disabled={resetBreakerMutation.isPending}
                                                                        >
                                                                            <RotateCcw className="w-3.5 h-3.5 mr-2" />
                                                                            Re-Link
                                                                        </Button>
                                                                    </motion.div>
                                                                )}
                                                            </AnimatePresence>
                                                        </TableCell>
                                                    </motion.tr>
                                                ))}
                                            </AnimatePresence>
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>
            </main>

            {/* Confirm dialog */}
            <AnimatePresence>
                {confirmDialog.open && (
                    <AlertDialog
                        open={confirmDialog.open}
                        onOpenChange={(open) => setConfirmDialog(d => ({ ...d, open }))}
                    >
                        <AlertDialogContent className="glass-panel-deep border-foreground/10 rounded-[2.5rem] bg-background/90 p-8 shadow-2xl">
                            <div className="absolute inset-0 bg-primary/[0.02] pointer-events-none" />
                            <AlertDialogHeader className="space-y-4">
                                <div className="flex items-center gap-4">
                                    <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                                        <ShieldAlert className="w-6 h-6 text-amber-500" />
                                    </div>
                                    <AlertDialogTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground leading-none">
                                        {confirmDialog.title}
                                    </AlertDialogTitle>
                                </div>
                                <AlertDialogDescription className="text-sm font-bold text-foreground/40 uppercase tracking-widest leading-relaxed">
                                    {confirmDialog.description}
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="mt-8 gap-4">
                                <AlertDialogCancel className="h-12 px-6 rounded-2xl border-foreground/5 bg-foreground/[0.02] text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 hover:bg-foreground/10 hover:text-foreground transition-all">Cancel Abort</AlertDialogCancel>
                                <AlertDialogAction
                                    className="h-12 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-primary/20 transition-all active:scale-95"
                                    onClick={() => {
                                        confirmDialog.onConfirm();
                                        setConfirmDialog(d => ({ ...d, open: false }));
                                    }}
                                >
                                    Confirm Protocol
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                )}
            </AnimatePresence>
        </div>
    );
}
