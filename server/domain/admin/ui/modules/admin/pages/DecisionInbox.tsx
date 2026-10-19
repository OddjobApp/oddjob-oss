import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@domain-ui/core/ui/components/ui/table";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ApprovalDetailDialog } from "@domain-ui/apps/ui/components/approvals/ApprovalDetailDialog";
import { TriageCenter, type RecoveryOption } from "@domain-ui/rescue/ui/modules/rescue/components/TriageCenter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { 
    ArrowRight, 
    CheckCircle2, 
    Inbox, 
    Activity, 
    Zap, 
    Briefcase,
    Code,
    Loader2,
    ChevronLeft,
    Clock,
    Shield,
    Swords
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface ApprovalRequest {
    id: number;
    pipelineName: string;
    stepName: string;
    createdAt: string;
    contextSnapshot: any;
    pipelineExecutionId: number;
    // Resolved server-side off mission_runs.cycle_id. Null for approvals that
    // belong to no operational cycle, which is most of them.
    cycleId: number | null;
}

interface RescueSession {
    id: number;
    missionRunId: number;
    status: string;
    serviceType: string;
    triageSummary?: string;
    recoveryOptions: RecoveryOption[];
    createdAt: string;
}

export interface DecisionInboxProps {
    /**
     * Render without the page chrome (back button, page title, full-height
     * background) so the inbox can sit inside a workbench tab.
     */
    embedded?: boolean;
    /**
     * When set, the queue shows only approvals belonging to this operational
     * cycle. The rest are counted, not hidden — `/api/approvals` is org-wide and
     * pretending otherwise would lose work.
     */
    cycleId?: number | null;
}

export function DecisionInbox({ embedded = false, cycleId = null }: DecisionInboxProps = {}) {
    const [, setLocation] = useLocation();
    const [selectedApproval, setSelectedApproval] = useState<ApprovalRequest | null>(null);
    const [selectedRescue, setSelectedRescue] = useState<RescueSession | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const { toast } = useToast();

    const [viewMode, setViewMode] = useState<"business" | "developer">(() => {
        const saved = localStorage.getItem("oddjob_view_mode");
        return saved === "developer" ? "developer" : "business";
    });

    const toggleViewMode = () => {
        setViewMode(prev => {
            const next = prev === "business" ? "developer" : "business";
            localStorage.setItem("oddjob_view_mode", next);
            return next;
        });
    };

    const { data: approvals, isLoading: loadingApprovals, refetch: refetchApprovals } = useQuery<ApprovalRequest[]>({
        queryKey: ['/api/approvals'],
    });

    const { data: rescueSessions, isLoading: loadingRescue, refetch: refetchRescue } = useQuery<RescueSession[]>({
        queryKey: ['/api/rescue/sessions'],
    });

    // Org-wide queue split against the cycle in the URL. With no cycle to scope
    // to, everything is in scope and nothing is "elsewhere".
    const { visibleApprovals, elsewhereCount } = useMemo(() => {
        const all = approvals ?? [];
        if (cycleId == null) {
            return { visibleApprovals: all, elsewhereCount: 0 };
        }
        const inScope = all.filter((a) => a.cycleId === cycleId);
        return { visibleApprovals: inScope, elsewhereCount: all.length - inScope.length };
    }, [approvals, cycleId]);

    const handleReview = (approval: ApprovalRequest) => {
        setSelectedApproval(approval);
        setSelectedRescue(null);
        setDialogOpen(true);
    };

    const handleSelectRecovery = async (rescue: RescueSession, option: RecoveryOption) => {
        // Session-based endpoint: it carries the session id (so there's no null
        // mission-run id at the route) and resolves the run server-side. On failure
        // the server pauses the linked mission and dismisses the HIL request atomically.
        try {
            await apiRequest('POST', `/api/rescue/sessions/${rescue.id}/recovery/${encodeURIComponent(option.id)}`, {});

            toast({
                title: "RECOVERY INITIATED",
                description: `Executing ${option.label} strategy...`,
            });

            setTimeout(() => {
                refetchRescue();
                setSelectedRescue(null);
            }, 1000);
        } catch (err: any) {
            toast({
                title: "RECOVERY FAILED",
                description: `${err.message} — the mission was paused (if linked) and this request was dismissed.`,
                variant: "destructive"
            });
            refetchRescue();
            setSelectedRescue(null);
        }
    };

    const handleDismissTriage = async (rescue: RescueSession) => {
        try {
            await apiRequest('POST', `/api/rescue/sessions/${rescue.id}/cancel`, {
                reason: "User dismissed triage"
            });

            toast({
                title: "TRIAGE DISMISSED",
                description: "The triage request has been cancelled.",
            });

            refetchRescue();
        } catch (err: any) {
            toast({
                title: "DISMISS FAILED",
                description: err.message,
                variant: "destructive"
            });
        }
    };

    const isLoading = loadingApprovals || loadingRescue;

    if (isLoading) {
        return (
            <div className={cn(
                "flex flex-col items-center justify-center text-muted-foreground",
                embedded ? "py-16" : "min-h-screen bg-background"
            )}>
                <Loader2 className={cn("animate-spin text-primary mb-4", embedded ? "w-8 h-8" : "w-12 h-12")} />
                <p className="font-medium animate-pulse uppercase tracking-[0.2em] text-xs font-mono">Synchronizing Decision Inbox...</p>
            </div>
        );
    }

    return (
        <div className={cn(
            "space-y-6 relative overflow-hidden font-sans text-foreground",
            embedded ? "" : "p-4 min-h-screen bg-background"
        )}>
            {/* Background elements */}
            {!embedded && (
                <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-indigo-500/15 via-violet-500/5 to-transparent pointer-events-none z-0" />
            )}

            {/* Cinematic grid overlay for Developer Mode */}
            {viewMode === "developer" && (
                <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
                    <div className="absolute inset-0 cinematic-grid opacity-20" />
                    <div className="scanline-overlay absolute inset-0 opacity-[0.02]" />
                </div>
            )}

            {/* Header Section */}
            {!embedded && (
            <header className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-foreground/5">
                <div className="flex items-center gap-4">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => window.history.back()}
                        className="rounded-full hover:bg-foreground/10"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </Button>
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <h1 className={cn(
                                "text-2xl md:text-3xl font-black tracking-tighter text-foreground uppercase italic text-glow-bronze leading-none",
                                viewMode === "business" ? "font-heading" : "font-mono"
                            )}>
                                {viewMode === "business" ? "Decision Clearance" : "DECISION_INBOX"}
                            </h1>
                            <Badge variant="outline" className="bg-foreground/5 border-foreground/10 text-[10px] font-mono opacity-60">
                                {viewMode === "business" ? "SECURE" : "SYS_ACTIVE"}
                            </Badge>
                        </div>
                        <p className={cn(
                            "text-muted-foreground font-medium flex items-center gap-2 text-sm",
                            viewMode === "business" ? "" : "font-mono text-xs"
                        )}>
                            <Activity className="w-4 h-4 text-primary" />
                            {viewMode === "business" 
                                ? "Operational queue for human oversight, strategic triage, and job clearings." 
                                : "SYS_QUEUE_EXECUTION_LEVEL // SIG_AUTHORIZATION_REQUIRED"}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Button 
                        onClick={toggleViewMode} 
                        variant="outline" 
                        className="border-foreground/10 hover:bg-foreground/5 hover:text-foreground font-bold rounded-xl shadow-lg transition-all"
                    >
                        {viewMode === "business" ? (
                            <>
                                <Briefcase className="w-4 h-4 mr-2 text-amber-500" />
                                Business Mode
                            </>
                        ) : (
                            <>
                                <Code className="w-4 h-4 mr-2 text-blue-400" />
                                Developer Mode
                            </>
                        )}
                    </Button>
                </div>
            </header>
            )}

            {/* Content Body */}
            <div className="relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Approvals and Triage Queue */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Triage Center Sessions (if any) */}
                    <AnimatePresence>
                        {rescueSessions && rescueSessions.filter(s => s.status === 'REQUESTED' && s.recoveryOptions?.length > 0).map((rescue, idx) => (
                            <motion.div
                                key={rescue.id}
                                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                transition={{ delay: idx * 0.1 }}
                                className={cn(
                                    "cursor-pointer transition-all duration-500 rounded-[2rem] overflow-hidden",
                                    selectedRescue?.id === rescue.id ? 'ring-2 ring-primary shadow-2xl shadow-[#CD7F32]/20' : ''
                                )}
                                onClick={() => { setSelectedRescue(rescue); setSelectedApproval(null); }}
                            >
                                <TriageCenter
                                    summary={rescue.triageSummary || "Mission requires strategic intervention."}
                                    options={rescue.recoveryOptions}
                                    onSelectOption={(opt) => handleSelectRecovery(rescue, opt)}
                                    onDismiss={() => handleDismissTriage(rescue)}
                                />
                            </motion.div>
                        ))}
                    </AnimatePresence>

                    {/* Pending Approvals Card */}
                    <Card className="glass-panel-deep bg-foreground/5 border-foreground/10 shadow-2xl rounded-[2rem] overflow-hidden">
                        <CardHeader className="p-6 md:p-8 pb-4">
                            <CardTitle className={cn(
                                "flex items-center gap-3 text-xl font-black uppercase tracking-tight text-foreground",
                                viewMode === "business" ? "font-heading" : "font-mono"
                            )}>
                                <div className="p-2 bg-foreground/5 rounded-xl border border-foreground/10">
                                    <Inbox className="h-5 w-5 text-primary" />
                                </div>
                                {viewMode === "business" ? "Pending Clearances" : "PENDING_APPROVALS"}
                                {visibleApprovals.length > 0 && (
                                    <Badge className="ml-3 bg-primary text-primary-foreground font-black text-[10px] tracking-widest px-2.5 rounded-lg border-none shadow-lg shadow-primary/30">
                                        {visibleApprovals.length}
                                    </Badge>
                                )}
                            </CardTitle>
                            <CardDescription className={cn(
                                "text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-12",
                                viewMode === "business" ? "font-sans" : "font-mono"
                            )}>
                                {viewMode === "business" 
                                    ? "Clearance gates requiring human validation for system continuity" 
                                    : "SYS_VALIDATION_QUEUE // DURABLE_WAIT_STATE"}
                            </CardDescription>
                            {elsewhereCount > 0 && (
                                <p
                                    data-testid="approvals-elsewhere-note"
                                    className="ml-12 mt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70"
                                >
                                    {elsewhereCount} more pending elsewhere in this organization
                                </p>
                            )}
                        </CardHeader>
                        <CardContent className="p-6 md:p-8 pt-6">
                            {visibleApprovals.length > 0 ? (
                                viewMode === "business" ? (
                                    /* BUSINESS PERSONA LIST */
                                    <div className="space-y-4">
                                        {visibleApprovals.map((approval, idx) => (
                                            <motion.div
                                                key={approval.id}
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: 0.1 + idx * 0.05 }}
                                                className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border border-foreground/5 bg-foreground/[0.02] hover:bg-foreground/5 transition-all duration-300 cursor-pointer"
                                                onClick={() => handleReview(approval)}
                                            >
                                                <div className="flex-1 space-y-1">
                                                    <div className="flex items-center gap-2.5">
                                                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                                                        <h3 className="font-heading font-black text-foreground text-base tracking-tight group-hover:text-primary transition-colors uppercase italic">
                                                            {approval.pipelineName}
                                                        </h3>
                                                    </div>
                                                    <p className="text-sm text-muted-foreground pl-5">
                                                        Origin Gate: <span className="font-semibold text-foreground">{approval.stepName}</span>
                                                    </p>
                                                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground pl-5">
                                                        <Clock className="w-3.5 h-3.5" />
                                                        <span>Requested: {new Date(approval.createdAt).toLocaleTimeString()} // {new Date(approval.createdAt).toLocaleDateString()}</span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-end sm:pl-4">
                                                    <Button
                                                        size="sm"
                                                        onClick={(e) => { e.stopPropagation(); handleReview(approval); }}
                                                        className="h-10 px-5 rounded-xl bg-[#CD7F32] hover:bg-[#8C735B] text-foreground font-heading font-black uppercase tracking-widest text-[10px] shadow-lg shadow-[#CD7F32]/10 transition-all duration-300 group-hover:scale-[1.02]"
                                                    >
                                                        Review Clearance
                                                        <ArrowRight className="w-4 h-4 ml-2" />
                                                    </Button>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                ) : (
                                    /* DEVELOPER PERSONA TABLE */
                                    <div className="font-mono">
                                        <div className="space-y-3 md:hidden">
                                            {visibleApprovals.map((approval, idx) => (
                                                <motion.div
                                                    key={approval.id}
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: 0.2 + (idx * 0.05) }}
                                                    className="rounded-2xl border border-foreground/5 bg-background/20 p-4"
                                                    onClick={() => handleReview(approval)}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-xs font-bold uppercase text-foreground">
                                                                {approval.pipelineName}
                                                            </p>
                                                            <p className="mt-1 truncate text-[10px] uppercase tracking-widest text-muted-foreground">
                                                                {approval.stepName}
                                                            </p>
                                                        </div>
                                                        <Badge variant="outline" className="shrink-0 border-amber-500/30 bg-amber-500/10 text-[9px] font-black text-amber-400">
                                                            AWAITING SIG
                                                        </Badge>
                                                    </div>
                                                    <p className="mt-3 break-all text-[10px] text-muted-foreground">
                                                        {new Date(approval.createdAt).toISOString()}
                                                    </p>
                                                    <Button
                                                        size="sm"
                                                        onClick={(e) => { e.stopPropagation(); handleReview(approval); }}
                                                        className="mt-4 h-10 w-full rounded-lg bg-primary hover:bg-primary/95 text-primary-foreground font-bold uppercase tracking-widest text-[9px] shadow-lg shadow-primary/20"
                                                    >
                                                        Authorize
                                                        <ArrowRight className="w-3.5 h-3.5 ml-2" />
                                                    </Button>
                                                </motion.div>
                                            ))}
                                        </div>

                                        <div className="hidden overflow-hidden rounded-[1.5rem] border border-foreground/5 bg-background/20 md:block">
                                        <Table>
                                            <TableHeader className="bg-foreground/5 uppercase tracking-[0.2em] text-[10px] font-black text-muted-foreground">
                                                <TableRow className="hover:bg-transparent border-foreground/5">
                                                    <TableHead className="px-6 h-12">pipeline id</TableHead>
                                                    <TableHead className="h-12">step origin</TableHead>
                                                    <TableHead className="h-12">telemetry ts</TableHead>
                                                    <TableHead className="text-right px-6 h-12">action gateway</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {visibleApprovals.map((approval, idx) => (
                                                    <motion.tr 
                                                        key={approval.id}
                                                        initial={{ opacity: 0, x: -10 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        transition={{ delay: 0.2 + (idx * 0.05) }}
                                                        className="group hover:bg-foreground/5 border-foreground/5 transition-colors cursor-pointer text-xs"
                                                        onClick={() => handleReview(approval)}
                                                    >
                                                        <TableCell className="font-bold text-foreground px-6 py-5">
                                                            {approval.pipelineName}
                                                        </TableCell>
                                                        <TableCell className="text-muted-foreground">{approval.stepName}</TableCell>
                                                        <TableCell className="text-[10px] text-muted-foreground">
                                                            {new Date(approval.createdAt).toISOString()}
                                                        </TableCell>
                                                        <TableCell className="text-right px-6 py-5">
                                                            <div className="flex items-center justify-end gap-2">
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        // Route in place: a full reload here would discard the
                                                                        // inbox's loaded state to reach a route this router owns.
                                                                        setLocation(`/workspace/chat/deliberation-${approval.id}`);
                                                                    }}
                                                                    className="h-9 px-3 rounded-lg border-indigo-500/30 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 font-bold uppercase tracking-widest text-[9px] translate-x-4 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-300"
                                                                    title="Open Agora Deliberation Room"
                                                                >
                                                                    <Swords className="w-3.5 h-3.5 mr-1" />
                                                                    Deliberate
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    onClick={(e) => { e.stopPropagation(); handleReview(approval); }}
                                                                    className="h-9 px-4 rounded-lg bg-primary hover:bg-primary/95 text-primary-foreground font-bold uppercase tracking-widest text-[9px] shadow-lg shadow-primary/20 translate-x-4 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-300"
                                                                >
                                                                    Authorize
                                                                    <ArrowRight className="w-3.5 h-3.5 ml-2" />
                                                                </Button>
                                                            </div>
                                                            <div className="group-hover:hidden transition-all text-xs font-bold text-amber-500 italic uppercase tracking-tighter opacity-70">
                                                                AWAITING SIG
                                                            </div>
                                                        </TableCell>
                                                    </motion.tr>
                                                ))}
                                            </TableBody>
                                        </Table>
                                        </div>
                                    </div>
                                )
                            ) : (
                                /* EMPTY QUEUE STATE */
                                <motion.div 
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="flex flex-col items-center justify-center py-20 text-center"
                                >
                                    <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center mb-6 border border-emerald-500/20 shadow-2xl shadow-emerald-500/10">
                                        <CheckCircle2 className="h-10 w-10 text-emerald-400 animate-pulse" />
                                    </div>
                                    <h3 className={cn(
                                        "text-2xl font-black italic tracking-tighter uppercase mb-2 text-foreground",
                                        viewMode === "business" ? "font-heading" : "font-mono"
                                    )}>
                                        {viewMode === "business" ? "Clearance Nominal" : "QUEUE_EXHAUSTED"}
                                    </h3>
                                    <p className={cn(
                                        "text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground max-w-[240px]",
                                        viewMode === "business" ? "font-sans" : "font-mono"
                                    )}>
                                        {viewMode === "business" 
                                            ? "All autonomous systems are currently cleared for downstream execution." 
                                            : "SYS_STATE_RESOLVED // NO_PENDING_INTERVENTIONS"}
                                    </p>
                                </motion.div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Sidebar Column */}
                <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 }}
                    className="space-y-6"
                >
                    {/* Operational Telemetry Panel */}
                    <Card className="bg-foreground/5 border border-foreground/10 rounded-[2rem] overflow-hidden shadow-2xl">
                        <div className="h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
                        <CardHeader className="p-6">
                            <CardTitle className={cn(
                                "text-[10px] font-black uppercase tracking-[0.4em] text-primary flex items-center gap-3",
                                viewMode === "business" ? "font-heading" : "font-mono"
                            )}>
                                <Activity size={14} className="animate-pulse" />
                                {viewMode === "business" ? "Operational Oversight" : "OPERATIONAL_TELEMETRY"}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="px-6 pb-8 space-y-6">
                            {viewMode === "business" ? (
                                /* Business Telemetry */
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center p-3 rounded-2xl bg-foreground/[0.02] border border-foreground/5 hover:bg-foreground/5 transition-all">
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-black text-muted-foreground uppercase tracking-[0.3em] mb-1 italic">Rescue Core</span>
                                            <span className="text-[11px] font-bold text-foreground">Oversight Core</span>
                                        </div>
                                        <Badge className="bg-rose-500/15 text-rose-400 border border-rose-500/20 font-black text-[9px] tracking-widest px-2.5 py-1 rounded-lg">
                                            ATTN REQUIRED
                                        </Badge>
                                    </div>
                                    <div className="flex justify-between items-center p-3 rounded-2xl bg-foreground/[0.02] border border-foreground/5 hover:bg-foreground/5 transition-all">
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-black text-muted-foreground uppercase tracking-[0.3em] mb-1 italic">Cognitive Engine</span>
                                            <span className="text-[11px] font-bold text-foreground">Agent Pipelines</span>
                                        </div>
                                        <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-black text-[9px] tracking-widest px-2.5 py-1 rounded-lg">
                                            NOMINAL RUN
                                        </Badge>
                                    </div>
                                    <div className="pt-4 border-t border-foreground/5 flex justify-between items-center">
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-black text-muted-foreground uppercase tracking-[0.2em] mb-1">Clearance Queue</span>
                                            <span className="text-[11px] font-bold text-foreground">Active Requests</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 font-bold text-sm text-primary">
                                            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                                            {visibleApprovals.length} pending
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                /* Developer Telemetry */
                                <div className="space-y-4 font-mono text-xs">
                                    <div className="flex justify-between items-center p-3 rounded-2xl bg-foreground/[0.02] border border-foreground/5">
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-black text-foreground/20 uppercase tracking-[0.3em] mb-1 italic">Rescue Protocol</span>
                                            <span className="text-[11px] font-bold text-foreground">Mission Oversight</span>
                                        </div>
                                        <Badge className="bg-rose-500/20 text-rose-500 border border-rose-500/30 font-black text-[9px] tracking-widest px-2.5 py-1 rounded-lg shadow-[0_0_15px_rgba(244,63,94,0.2)]">
                                            DURABLE FAILURE
                                        </Badge>
                                    </div>
                                    <div className="flex justify-between items-center p-3 rounded-2xl bg-foreground/[0.02] border border-foreground/5">
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-black text-foreground/20 uppercase tracking-[0.3em] mb-1 italic">Cognitive Core</span>
                                            <span className="text-[11px] font-bold text-foreground">Agency Intelligence</span>
                                        </div>
                                        <Badge className="bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 font-black text-[9px] tracking-widest px-2.5 py-1 rounded-lg animate-pulse shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                                            ACTIVE LOAD
                                        </Badge>
                                    </div>
                                    <div className="pt-4 border-t border-foreground/5 flex justify-between items-center">
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-black text-muted-foreground uppercase tracking-widest mb-1">Authorization Requests</span>
                                            <span className="text-[11px] font-bold text-foreground">Priority Intervention</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 font-mono text-xs font-black text-primary">
                                            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                                            {rescueSessions?.filter(s => s.serviceType === 'tool discovery' && s.status === 'REQUESTED').length || 0}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Strategic Buffer Progress Panel */}
                            <div className="p-4 bg-foreground/[0.02] rounded-2xl border border-foreground/5 space-y-3">
                                <div className="flex items-center gap-2 mb-1">
                                    <Zap size={12} className="text-amber-500" />
                                    <span className={cn(
                                        "text-[9px] font-black uppercase tracking-widest text-muted-foreground",
                                        viewMode === "business" ? "font-sans" : "font-mono"
                                    )}>
                                        {viewMode === "business" ? "Cognitive Margin Capacity" : "Strategic Buffer"}
                                    </span>
                                </div>
                                <div className="h-2 w-full bg-foreground/5 rounded-full overflow-hidden relative border border-foreground/5">
                                    <motion.div 
                                        initial={{ width: 0 }}
                                        animate={{ width: "74%" }}
                                        className="h-full bg-gradient-to-r from-bronze-600 via-bronze-400 to-bronze-200 shadow-[0_0_20px_rgba(205,127,50,0.4)] relative" 
                                    >
                                        <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.2)_50%,transparent_100%)] animate-shimmer" />
                                    </motion.div>
                                </div>
                                <div className={cn(
                                    "flex justify-between text-[8px] font-black uppercase tracking-[0.2em] italic",
                                    viewMode === "business" ? "text-muted-foreground font-sans" : "text-foreground/20 font-mono"
                                )}>
                                    <span>{viewMode === "business" ? "Active Pressure" : "Cognitive_Pressure"}</span>
                                    <span className="text-primary italic font-black">74% Nominal</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Governance Standards Footer Card */}
                    <div className="p-6 bg-foreground/5 rounded-[2rem] border border-foreground/10 flex items-center gap-4 group cursor-help transition-all hover:bg-foreground/[0.08]">
                        <div className="p-3 bg-primary/10 rounded-2xl group-hover:rotate-12 transition-transform border border-primary/20">
                            <Shield className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                            <p className={cn(
                                "text-[10px] font-black uppercase tracking-widest text-primary mb-1",
                                viewMode === "business" ? "font-heading" : "font-mono"
                            )}>
                                {viewMode === "business" ? "Governance Cleared" : "GOVERNANCE_STANDARD"}
                            </p>
                            <p className={cn(
                                "text-[9px] leading-relaxed font-bold italic uppercase tracking-tighter text-muted-foreground",
                                viewMode === "business" ? "font-sans" : "font-mono"
                            )}>
                                {viewMode === "business"
                                    ? "All approval decisions are securely archived to meet institutional compliance audits."
                                    : "All overrides are forensically logged and attributed to operator verification signature."}
                            </p>
                        </div>
                    </div>
                </motion.div>
            </div>

            <ApprovalDetailDialog
                approval={selectedApproval}
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                onDecision={() => refetchApprovals()}
            />

            <style>{`
                .cinematic-grid {
                    background-image: 
                        linear-gradient(to right, rgba(255,255,255,0.02) 1px, transparent 1px),
                        linear-gradient(to bottom, rgba(255,255,255,0.02) 1px, transparent 1px);
                    background-size: 32px 32px;
                }
                .scanline-overlay {
                    background: linear-gradient(
                        to bottom,
                        transparent 50%,
                        rgba(0, 0, 0, 0.4) 50%
                    );
                    background-size: 100% 4px;
                }
            `}</style>
        </div>
    );
}

export default DecisionInbox;
