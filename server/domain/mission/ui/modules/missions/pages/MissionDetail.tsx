import { useState } from "react";
import { ResourceImpactPanel } from '@/components/resource-catalog/ResourceImpactPanel';
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import { ApprovalDetailDialog } from "@domain-ui/apps/ui/components/approvals/ApprovalDetailDialog";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { MissionReviewComponent } from '../components/MissionReviewComponent.js';
import { 
    ChevronRight, 
    Play, 
    Pause, 
    CheckCircle2, 
    AlertCircle, 
    Clock, 
    Rocket,
    Settings,
    MoreVertical,
    Trash2,
    Share2,
    Zap,
    MessageSquare,
    Search,
    LayoutGrid,
    Target,
    BrainCircuit,
    Activity,
    ShieldCheck,
    ArrowLeft,
    Webhook,
    ExternalLink,
    Download
} from "lucide-react";
import { ForgePreview } from '../components/ForgePreview.js';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@domain-ui/core/ui/components/ui/alert-dialog";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { LoadingSkeleton } from "@domain-ui/core/ui/components/ui/loading-skeleton";
import { StrategyHeroLayout, StrategyAwareTabs } from "@/modules/missions/components";
import { useMissionStrategy } from "@/modules/missions/hooks";
import { EditMissionDialog } from '../components/EditMissionDialog.js';
import { AddMemberDialog } from '../components/AddMemberDialog.js';
import { SaveBlueprintDialog } from '../components/SaveTemplateDialog.js';
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { missionRunPath } from "@/lib/paths";
import { MissionActivity } from '../components/MissionActivity.js';
import { WorkstreamGraph } from '../components/WorkstreamGraph.js';
import { MissionChat } from '../components/MissionChat.js';
import { MissionResources } from '../components/MissionResources.js';
import { BlackboardHistory } from '../components/BlackboardHistory.js';
import { BlackboardExplorer } from '../components/BlackboardExplorer.js';
import { MissionTracker } from '../components/MissionTracker.js';
import { DecisionTimeline } from '../components/DecisionTimeline.js';
import { MissionHealthCard } from '../components/MissionHealthCard.js';
import { DeliverablesView } from '../components/DeliverablesView.js';
import { ErrorBoundary } from "@domain-ui/core/ui/components/shared/ErrorBoundary";
import type { MissionRun, Mission } from "@shared/schema/missions";
import { 
    ResizablePanelGroup, 
    ResizablePanel, 
    ResizableHandle 
} from "@domain-ui/core/ui/components/ui/resizable";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@domain-ui/core/ui/components/ui/tabs";
import { ForgeTerminal } from '../components/ForgeTerminal.js';
import { WebhookConfigTab } from '../components/WebhookConfigTab.js';
import { EmailThreadPanel } from '../components/EmailThreadPanel.js';

export default function MissionDetail() {
    const params = useParams();
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const id = params.id ? parseInt(params.id) : undefined;
    const [showHistory, setShowHistory] = useState(false);
    const [selectedApproval, setSelectedApproval] = useState<any | null>(null);
    const [isApprovalDialogOpen, setIsApprovalDialogOpen] = useState(false);

    const { data: mission, isLoading } = useQuery<Mission & {
        members: any[],
        currentSpendUsd: string,
        scheduleName?: string,
        schedulePatternLabel?: string
    }>({
        queryKey: [`/api/missions/${id}`],
        enabled: !!id,
        refetchInterval: id ? 5000 : false, // Poll when monitoring mission
    });

    const missionsQuery = useQuery<MissionRun[]>({
        queryKey: [`/api/mission-runs?missionId=${id}`],
        enabled: !!id,
        refetchInterval: id ? 5000 : false, // Poll to pick up mission status changes
    });
    const missions = Array.isArray(missionsQuery.data) ? missionsQuery.data : [];
    const activeRun = missions.find((r: any) => 
        r?.status === 'active' || 
        r?.status === 'paused' || 
        r?.status === 'executing' ||
        String(r?.status || "").startsWith("waiting")
    );
    const primaryRunId = activeRun?.id ?? missions[0]?.id ?? null;

    // Fetch pending approvals for this mission
    const { data: approvals, refetch: refetchApprovals } = useQuery<any[]>({
        queryKey: ["/api/approvals"],
        refetchInterval: id ? 5000 : false, // Poll when monitoring
    });

    const approveMutation = useMutation({
        mutationFn: async ({ id, decision }: { id: number, decision: 'approved' | 'rejected' }) => {
            await apiRequest("POST", `/api/approvals/${id}/decision`, {
                decision,
                comments: "Approved via Mission Dashboard"
            });
        },
        onSuccess: () => {
            refetchApprovals();
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("DELETE", `/api/missions/${id}`);
            if (!res.ok) throw new Error("Failed to delete mission");
            return res.json();
        },
        onSuccess: () => {
            // Invalidate missions list and dashboard stats to ensure UI sync
            queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
            queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });

            toast({
                title: "Mission Terminated",
                description: "The mission and associated data have been purged.",
            });
            setLocation("/operations/missions");
        },
        onError: (err: any) => {
            // If the mission is already gone, just redirect anyway to be helpful
            if (err.message?.includes("not found")) {
                toast({
                    title: "Mission Already Terminated",
                    description: "The mission could not be found and has likely already been deleted.",
                });
                setLocation("/operations/missions");
                return;
            }

            toast({
                title: "Deletion Failed",
                description: err.message,
                variant: "destructive"
            });
        }
    });

    const launchMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/missions/${id}/launch-mission`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || "Failed to launch mission");
            }
            return res.json();
        },
        onSuccess: (data: { missionRunId?: number | null }) => {
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${id}`] });
            queryClient.invalidateQueries({ queryKey: [`/api/mission-runs?missionId=${id}`] });
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${id}/activity`] });
            queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
            toast({
                title: "Mission Launched",
                description: "The mission has been launched successfully.",
            });
            if (id && data?.missionRunId) {
                setLocation(missionRunPath(id, data.missionRunId));
            }
        },
        onError: (err: any) => {
            toast({
                title: "Launch Failed",
                description: err.message,
                variant: "destructive"
            });
        }
    });

    const pauseMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/missions/${id}/pause`);
            if (!res.ok) throw new Error("Failed to pause mission");
            const text = await res.text();
            return text ? JSON.parse(text) : {};
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${id}`] });
            queryClient.invalidateQueries({ queryKey: [`/api/mission-runs?missionId=${id}`] });
            toast({
                title: "Mission Paused",
                description: "The protocol has been suspended.",
            });
        },
        onError: (err: any) => {
            toast({ title: "Action Failed", description: err.message, variant: "destructive" });
        }
    });

    const resumeMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/missions/${id}/resume`);
            if (!res.ok) throw new Error("Failed to resume mission");
            const text = await res.text();
            return text ? JSON.parse(text) : {};
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${id}`] });
            queryClient.invalidateQueries({ queryKey: [`/api/mission-runs?missionId=${id}`] });
            toast({
                title: "Mission Resumed",
                description: "The protocol has been reactivated.",
            });
            if (id && activeRun?.id) {
                setLocation(missionRunPath(id, activeRun.id));
            }
        },
        onError: (err: any) => {
            toast({ title: "Action Failed", description: err.message, variant: "destructive" });
        }
    });

    // Strategy-aware configuration
    const primaryRun = missions[0];
    const { config, tabs, sidebarWidgets, features, strategyBadge, isActive } = useMissionStrategy({ 
        mission: mission || {}, 
        run: primaryRun 
    });

    if (isLoading) {
        return <div className="p-8 max-w-7xl mx-auto"><LoadingSkeleton type="card" rows={1} /></div>;
    }

    if (!mission) {
        return <div className="p-8">Mission not found</div>;
    }

    // Calculate budget percentage
    const budgetLimit = mission.budgetLimitUsd ? parseFloat(mission.budgetLimitUsd) : 0;
    const currentSpend = mission.currentSpendUsd ? parseFloat(mission.currentSpendUsd) : 0;
    const budgetPercent = budgetLimit > 0 ? (currentSpend / budgetLimit) * 100 : 0;

    const missionApprovals = (Array.isArray(approvals) ? approvals : []).filter(
        (a: any) => a.missionId === id
    );

    const previewSlug =
        (mission.blackboard as any)?.viaAppSlug ||
        (mission.blackboard as any)?.forge_app_slug ||
        (mission.blackboard as any)?.appSlug ||
        null;

    const hasPreview = !!previewSlug;
    const isForge =
        mission.type?.includes("Forge") ||
        (mission.blackboard as any)?.isForge ||
        hasPreview;
    const currentPhase = (missions[0] as any)?.missionContext?.phase || 'PLANNING';

    const auditBundleUrl = primaryRunId ? `/api/mission-runs/${primaryRunId}/audit-bundle` : null;

    // Helper for Pulse Progress
    const phases = [
        { id: 'PLANNING', label: 'Strategy', icon: BrainCircuit },
        { id: 'EXECUTING', label: 'Execution', icon: Activity },
        { id: 'CRITIQUING', label: 'Verification', icon: ShieldCheck },
        { id: 'WAITING_FOR_ORDERS', label: 'Awaiting Input', icon: Clock },
    ];

    return (
        <div className="p-4 md:p-6 space-y-8 w-full">
            {/* Header */}
            <div className="space-y-4">
                <Link href="/operations/missions" className="group flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
                    <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
                    <span className="text-[10px] font-black uppercase tracking-widest mt-0.5">Missions Center</span>
                </Link>

                <div className="flex items-start justify-between">
                    <div className="space-y-1">
                        <div className="flex items-center gap-3">
                            <h1 className="text-4xl font-black tracking-tighter text-primary uppercase italic">
                                {mission.name}
                            </h1>
                            <Badge variant="outline" className="text-xs uppercase tracking-widest border-primary/30 text-primary">
                                {mission.type}
                            </Badge>
                            {mission.executionStrategy === 'dynamic_autonomous' && (
                                <Badge variant="outline" className="text-xs uppercase tracking-widest border-purple-500/30 text-purple-400 bg-purple-500/10">
                                    <BrainCircuit className="w-3 h-3 mr-1" /> Dynamic
                                </Badge>
                            )}
                            {mission.executionStrategy === 'rolling_wave' && (
                                <Badge variant="outline" className="text-xs uppercase tracking-widest border-emerald-500/30 text-emerald-500 bg-emerald-500/10">
                                    <Activity className="w-3 h-3 mr-1" /> Rolling Wave
                                </Badge>
                            )}
                            {mission.reasoningProtocol === 'hermes_xml' && (
                                <Badge variant="outline" className="text-xs uppercase tracking-widest border-amber-500/30 text-amber-500 bg-amber-500/5">
                                    <BrainCircuit className="w-3 h-3 mr-1" /> Hermes
                                </Badge>
                            )}
                            {mission.isScheduled && mission.scheduleId && (
                                <Link href={`/operations/schedules/rules/${mission.scheduleId}`}>
                                    <Badge variant="outline" className="text-xs uppercase tracking-widest border-blue-500/30 text-blue-400 bg-blue-500/5 hover:bg-blue-500/10 transition-colors cursor-pointer flex items-center gap-1.5">
                                        <Clock className="w-3 h-3" />
                                        {mission.scheduleName || "Active Schedule"}
                                    </Badge>
                                </Link>
                            )}
                            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-emerald-500/80">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                {(missions[0] as any)?.phase || (missions[0] as any)?.missionContext?.phase || 'Live'}
                            </span>
                            {(missions[0] as any)?.missionContext?.phase === 'WAITING_FOR_ORDERS' && (
                                <Badge variant="outline" className="text-xs uppercase tracking-widest border-amber-500/30 text-amber-500 bg-amber-500/10 animate-pulse">
                                    <Clock className="w-3 h-3 mr-1" /> Awaiting Input
                                </Badge>
                            )}
                            {(mission.blackboard as any)?.threadTs && (
                                <Badge variant="outline" className="text-xs uppercase tracking-widest border-blue-400/30 text-blue-400 bg-blue-500/10 flex items-center gap-1.5 py-1 px-2 cursor-pointer hover:bg-blue-500/20 transition-colors">
                                    <svg className="w-3 h-3" viewBox="0 0 122.8 122.8"><path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.4 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#E01E5A"/><path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.4c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36C5F0"/><path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.4 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C77.6 5.8 83.4 0 90.5 0s12.9 5.8 12.9 12.9v32.3z" fill="#2EB67D"/><path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.4c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ECB22E"/></svg>
                                    Bridged to Slack
                                </Badge>
                            )}
                        </div>
                        <p className="text-xl text-muted-foreground max-w-3xl">
                            {mission.objective}
                        </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center gap-2">
                            {activeRun && activeRun.status !== 'completed' && activeRun.status !== 'failed' && (
                                <Button
                                    variant="outline"
                                    className={cn(
                                        "font-bold uppercase tracking-wider border-border shadow-sm",
                                        activeRun.status === 'paused' ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/30" : "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/30"
                                    )}
                                    onClick={() => activeRun.status === 'paused' ? resumeMutation.mutate() : pauseMutation.mutate()}
                                    disabled={pauseMutation.isPending || resumeMutation.isPending}
                                >
                                    {activeRun.status === 'paused' ? (
                                        <>
                                            <Play className="w-4 h-4 mr-2" />
                                            Resume Protocol
                                        </>
                                    ) : (
                                        <>
                                            <Pause className="w-4 h-4 mr-2" />
                                            Pause Protocol
                                        </>
                                    )}
                                </Button>
                            )}
                            {!activeRun && (
                                <Button
                                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-wider"
                                    onClick={() => launchMutation.mutate()}
                                    disabled={launchMutation.isPending}
                                >
                                    <Rocket className="w-4 h-4 mr-2" />
                                    {launchMutation.isPending ? "Starting..." : "Start Mission"}
                                </Button>
                            )}
                            <SaveBlueprintDialog mission={{ ...mission, objective: mission.objective || "" }} />
                            {auditBundleUrl && (
                                <Button
                                    variant="outline"
                                    className="font-bold uppercase tracking-wider border-border shadow-sm"
                                    onClick={() => window.open(auditBundleUrl, "_blank", "noopener,noreferrer")}
                                >
                                    <Download className="w-4 h-4 mr-2" />
                                    Audit Bundle
                                </Button>
                            )}
                            <EditMissionDialog mission={{ ...mission, objective: mission.objective || "" }} />
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors">
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent className="glass border-red-500/20">
                                    <AlertDialogHeader>
                                        <AlertDialogTitle className="text-red-500 font-bold tracking-tight">CRITICAL ACTION: PURGE MISSION</AlertDialogTitle>
                                        <AlertDialogDescription className="text-muted-foreground">
                                            This will permanently delete the <strong>{mission.name}</strong> mission,
                                            purging all Blackboard history, member assignments, and Knowledge Graph nodes.
                                            This action is irreversible.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel className="glass border-border/50">Abort</AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={() => deleteMutation.mutate()}
                                            className="bg-red-500 hover:bg-red-600 text-foreground font-bold"
                                        >
                                            Confirm Purge
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            {budgetLimit > 0 && (
                                <div className="flex flex-col items-end">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-[10px] uppercase font-bold tracking-widest ${currentSpend > budgetLimit ? 'text-red-500' : 'text-muted-foreground'}`}>Total Budget</span>
                                        <span className={`font-mono font-bold ${currentSpend > budgetLimit ? 'text-red-500' : 'text-primary'}`}>
                                            ${currentSpend.toFixed(2)}
                                        </span>
                                        <span className="text-muted-foreground">/ ${budgetLimit.toFixed(2)}</span>
                                    </div>
                                    <Progress
                                        value={Math.min(budgetPercent, 100)}
                                        className="h-1 bg-foreground/10 border border-border w-32"
                                        indicatorClassName={currentSpend > budgetLimit ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-primary shadow-[0_0_10px_rgba(217,119,6,0.5)]'}
                                    />
                                    {mission.executionStrategy === 'dynamic_autonomous' && mission.dynamicCycleBudgetLimitUsd && (
                                        <div className="mt-2 flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
                                            <ShieldCheck className="w-3 h-3 text-purple-400" />
                                            <span>Cycle Limit:</span>
                                            <span className="text-purple-400 font-mono">${parseFloat(mission.dynamicCycleBudgetLimitUsd).toFixed(2)}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="flex items-center gap-2">
                                <Activity className="w-4 h-4" />
                                <span suppressHydrationWarning>
                                    Created: {mission.createdAt ? (() => {
                                        const d = new Date(mission.createdAt);
                                        return isNaN(d.getTime()) ? 'Pending sync' : d.toLocaleDateString();
                                    })() : 'Pending deployment'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <MissionReviewComponent 
                    missionRunId={activeRun?.id || 0}
                    missionId={mission.id}
                    context={(activeRun as any)?.missionContext}
                />
            </div>


            {/* Approvals Section */}
            {
                missionApprovals.length > 0 && (
                    <Card className="bg-primary/10 border-primary/30 mb-8">
                        <CardHeader className="pb-2">
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="w-5 h-5 text-primary" />
                                <CardTitle className="text-lg font-bold tracking-tight">Pending Approvals</CardTitle>
                            </div>
                            <CardDescription>
                                Supervisor requires your approval to proceed with the following plans.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {missionApprovals.map((req: any) => (
                                <div key={req.id} className="bg-background/60 p-4 rounded-lg border border-primary/20 flex items-start justify-between gap-4">
                                    <div className="space-y-2 flex-1">
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline" className="bg-primary/20 text-primary border-transparent">
                                                Plan Approval
                                            </Badge>
                                            <span className="text-sm font-bold text-muted-foreground">
                                                {req.pipelineName} / {req.stepName}
                                            </span>
                                        </div>
                                        <div className="text-sm">
                                            {req.contextSnapshot?.dynamicAction ? (
                                                <div className="space-y-1">
                                                    <p className="font-semibold text-primary">Dynamic AI Tactic:</p>
                                                    <p className="text-muted-foreground text-xs italic">
                                                        "{req.contextSnapshot.dynamicAction.note || req.contextSnapshot.dynamicAction.intent}"
                                                    </p>
                                                    {req.contextSnapshot.dynamicAction.tasks && (
                                                        <ul className="list-disc list-inside text-muted-foreground text-[10px] pt-1">
                                                            {req.contextSnapshot.dynamicAction.tasks.map((t: any, idx: number) => (
                                                                <li key={idx}>{t.description || t.action}</li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </div>
                                            ) : req.contextSnapshot?.plan ? (
                                                <div className="space-y-1">
                                                    <p className="font-semibold">Proposed Tasks:</p>
                                                    <ul className="list-disc list-inside text-muted-foreground text-xs">
                                                        {Array.isArray(req.contextSnapshot.plan.tasks) && req.contextSnapshot.plan.tasks.map((t: any) => (
                                                            <li key={t.id}>{t.name}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            ) : (
                                                <p className="text-muted-foreground">Review requested for execution ID #{req.executionId}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            size="sm"
                                            className="bg-primary hover:bg-primary/90"
                                            onClick={() => {
                                                setSelectedApproval(req);
                                                setIsApprovalDialogOpen(true);
                                            }}
                                        >
                                            Review & Approve
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                )
            }

            {/* Strategy-Aware Mission Layout */}
            <div className="space-y-6">
                {/* Strategy Hero with Metrics */}
                <StrategyHeroLayout mission={mission} run={primaryRun} />

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* Left Column: Mission Chat (if active) or Strategy Tabs */}
                    <div className="lg:col-span-3 space-y-6">
                        {isActive && sidebarWidgets.some(w => w.id === 'mission-chat') && (
                            <div className="h-[600px] border border-border/50 rounded-2xl overflow-hidden bg-background/20 backdrop-blur-sm">
                                <ResizablePanelGroup direction="horizontal">
                                    <ResizablePanel defaultSize={35} minSize={25}>
                                        <div className="h-full flex flex-col p-4 space-y-4">
                                            <div className="flex items-center gap-2 px-2">
                                                <MessageSquare className="w-4 h-4 text-primary" />
                                                <h2 className="text-[10px] font-black uppercase tracking-widest text-primary">Mission Control</h2>
                                            </div>
                                            <div className="flex-1 min-h-0">
                                                <ErrorBoundary name="Mission Chat">
                                                    <MissionChat mission={mission} />
                                                </ErrorBoundary>
                                            </div>
                                        </div>
                                    </ResizablePanel>
                                    
                                    <ResizableHandle withHandle />
                                    
                                    <ResizablePanel defaultSize={65} minSize={40}>
                                        <div className="h-full p-4">
                                            <StrategyAwareTabs mission={mission} run={primaryRun} />
                                        </div>
                                    </ResizablePanel>
                                </ResizablePanelGroup>
                            </div>
                        )}
                        
                        {(!isActive || !sidebarWidgets.some(w => w.id === 'mission-chat')) && (
                            <StrategyAwareTabs mission={mission} run={primaryRun} />
                        )}
                    </div>

                    {/* Right Column: Sidebar Widgets */}
                    <div className="space-y-4">
                        {/* Phase 5 Feature Widgets */}
                        {features.predictivePlanning && sidebarWidgets.some(w => w.id === 'predictive-insights') && (
                            <Card className="bg-blue-500/5 border-blue-500/20">
                                <CardHeader className="pb-2">
                                    <div className="flex items-center gap-2">
                                        <BrainCircuit className="w-4 h-4 text-blue-500" />
                                        <CardTitle className="text-sm font-bold">AI Insights</CardTitle>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-xs text-muted-foreground">Predictive planning active</p>
                                </CardContent>
                            </Card>
                        )}

                        {features.selfHealing && sidebarWidgets.some(w => w.id === 'health-summary') && (
                            <Card className="bg-emerald-500/5 border-emerald-500/20">
                                <CardHeader className="pb-2">
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck className="w-4 h-4 text-emerald-500" />
                                        <CardTitle className="text-sm font-bold">Self-Healing</CardTitle>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-xs text-muted-foreground">Auto-recovery enabled</p>
                                </CardContent>
                            </Card>
                        )}

                        {/* Standard Widgets */}
                        <ResourceImpactPanel resourceKey={`mission:${mission.id}`} />
                        {sidebarWidgets.some(w => w.id === 'mission-tracker') && (
                            <MissionTracker missionId={mission.id} />
                        )}
                        
                        {sidebarWidgets.some(w => w.id === 'decision-timeline') && (
                            <DecisionTimeline missionRunId={primaryRunId} />
                        )}
                        
                        {sidebarWidgets.some(w => w.id === 'mission-health') && (
                            <MissionHealthCard missionId={mission.id} />
                        )}
                        
                        {/* Email Thread Panel - shows when emailThreadId exists in context */}
                        {(primaryRun?.missionContext as any)?.emailThreadId && (
                            <EmailThreadPanel 
                                missionRunId={primaryRun.id} 
                                missionContext={primaryRun?.missionContext as any}
                            />
                        )}
                        
                        {/* Webhook Configuration - for missions with webhook triggers enabled */}
                        <Card className="bg-blue-500/5 border-blue-500/20">
                            <CardHeader className="pb-2">
                                <div className="flex items-center gap-2">
                                    <Webhook className="w-4 h-4 text-blue-500" />
                                    <CardTitle className="text-sm font-bold">Webhook Trigger</CardTitle>
                                </div>
                                <CardDescription className="text-xs">
                                    Trigger this mission via external webhooks
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    className="w-full gap-2 text-xs"
                                    onClick={() => {
                                        // Open webhook config in a modal or navigate
                                        toast({
                                            title: "Webhook Config",
                                            description: `Webhook URL: ${window.location.origin}/api/webhook/trigger/mission/${mission.id}`,
                                        });
                                    }}
                                >
                                    <ExternalLink className="w-3 h-3" />
                                    Configure Webhook
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                </div>

                {/* Activity Feed */}
                <Card className="bg-background/40 backdrop-blur-md border-border">
                    <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                            <Activity className="w-5 h-5 text-muted-foreground" />
                            <CardTitle className="text-lg font-bold tracking-tight">Recent Activity</CardTitle>
                        </div>
                        <CardDescription>Real-time execution log.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <MissionActivity missionId={mission.id} />
                    </CardContent>
                </Card>
            </div>



            <ApprovalDetailDialog
                approval={selectedApproval}
                open={isApprovalDialogOpen}
                onOpenChange={setIsApprovalDialogOpen}
                onDecision={() => refetchApprovals()}
            />
        </div>
    );
}
