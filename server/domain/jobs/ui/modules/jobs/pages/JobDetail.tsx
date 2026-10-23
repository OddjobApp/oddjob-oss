import React, { useState } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@domain-ui/core/ui/components/shared/ErrorBoundary";

import { 
    ArrowLeft,
    Save,
    Play,
    History,
    Shield,
    Activity,
    Copy,
    Trash2,
    Zap,
    Database,
    Zap as Lightning,
    BarChart3,
    Globe,
    TrendingUp,
    LayoutGrid,
    Binary,
    Monitor,
    Gauge
} from "lucide-react";

import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { 
    Tabs, 
    TabsList, 
    TabsTrigger, 
    TabsContent 
} from "@domain-ui/core/ui/components/ui/tabs";
import { 
    Card, 
    CardHeader, 
    CardTitle, 
    CardDescription, 
    CardContent 
} from "@domain-ui/core/ui/components/ui/card";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";

// Local Components
import { JobReactiveTab } from '../components/JobReactiveTab';
import UniversalJobEditor from '../components/UniversalJobEditor';
import { AgentSchemasTab } from '../components/AgentSchemasTab';
import { ImpactAnalysisPanel } from '../components/ImpactAnalysisPanel';
import JobRunHistory from '../components/JobRunHistory';
import { AgentPublishTab } from '../components/AgentPublishTab';
import AgentAnalyticsDashboard from '../components/AgentAnalyticsDashboard';
import AgentTraceViewer from '../components/AgentTraceViewer';
import JobTestDialog from '../components/JobTestDialog';
import JobInsightsPanel from '../components/JobInsightsPanel';
import { SeleniumVisualizer } from '../components/selenium/SeleniumVisualizer';

// ... (ImpactAnalysisPanel omitted for brevity or I'll just include it)

export default function JobDetail() {
    const [, legacyParams] = useRoute("/agents/:id");
    const [, operationsParams] = useRoute("/operations/agents/:id");
    const params = operationsParams?.id ? operationsParams : legacyParams;
    const [, setLocation] = useLocation();
    const searchString = useSearch();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const id = params?.id;

    const { data: job, isLoading } = useQuery<any>({
        queryKey: [`/api/jobs/${id}`],
        enabled: !!id,
    });

    const { data: executions } = useQuery<any[]>({
        queryKey: [`/api/jobs/${id}/executions`],
        enabled: !!id,
        refetchInterval: 5000,
    });

    const latestTraceId = executions?.[0]?.traceId;

    const [formData, setFormData] = useState<any>(null);
    const [testDialogOpen, setTestDialogOpen] = useState(false);

    // Sync formData when job is loaded
    React.useEffect(() => {
        if (job) {
            setFormData({
                name: job.name,
                description: job.description || "",
                config: job.config || {},
                diffConfig: job.diffConfig || { enabled: false, mode: 'latest', ignorePaths: [] }
            });
        }
    }, [job]);

    const updateMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await apiRequest("PUT", `/api/jobs/${id}`, data);
            if (!res.ok) throw new Error("Failed to update module");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/jobs/${id}`] });
            queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
            toast({ title: "Module Synchronized", description: "Blueprints updated in the operational matrix." });
        }
    });

    const runMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/jobs/${id}/run`, {});
            if (!res.ok) throw new Error("Deployment failed");
            return res.json();
        },
        onSuccess: (data) => {
            toast({ title: "Activation Sequence Initiated", description: `Module execution started. Trace: ${data.runId}` });
        }
    });

    if (isLoading) return (
        <div className="flex items-center justify-center min-h-screen bg-background">
            <div className="text-[12px] font-black uppercase tracking-[0.5em] text-primary/40 animate-pulse italic">
                Scanning Neural Matrix...
            </div>
        </div>
    );
    
    if (!job || !formData) return (
        <div className="flex items-center justify-center min-h-screen bg-background">
            <div className="text-[12px] font-black uppercase tracking-[0.2em] text-red-500/60 italic border-2 border-red-500/20 px-8 py-4 rounded-3xl bg-red-500/5">
                ERROR: MODULE DISCONNECTED FROM GRID
            </div>
        </div>
    );

    const isAgent = ['ai_agent', 'form_agent', 'ai agent', 'agent ai'].includes(job.type);
    const requestedTab = new URLSearchParams(searchString).get("tab");
    const availableTabs = new Set(["matrix", "schemas", "reactive", "impact", "history"]);
    if (job.type === "selenium") availableTabs.add("live");
    if (isAgent) {
        availableTabs.add("publish");
        availableTabs.add("performance");
        availableTabs.add("trace");
    }
    const defaultTab = requestedTab && availableTabs.has(requestedTab) ? requestedTab : "matrix";

    return (
        <ErrorBoundary name="Job Detail">
        <JobTestDialog
            open={testDialogOpen}
            onOpenChange={setTestDialogOpen}
            jobId={parseInt(id || '0')}
        />
        <div className="p-6 md:p-12 space-y-12 w-full max-w-full animate-in fade-in duration-1000">
            {/* Header / Breadcrumb */}
            <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-8 border-b border-foreground/5 pb-12">
                <div className="flex items-start gap-6">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => setLocation("/operations/agents")} 
                        className="rounded-2xl h-14 w-14 bg-foreground/[0.03] hover:bg-foreground/[0.08] border border-foreground/5 shadow-inner transition-all mt-1"
                    >
                        <ArrowLeft className="w-6 h-6 text-foreground/40" />
                    </Button>
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 uppercase tracking-[0.3em] text-[10px] font-black h-6 px-3 italic rounded-lg">
                                {job.type ?? 'GENERIC_JOB'}
                            </Badge>
                            <span className="text-foreground/20 text-[10px] font-black uppercase tracking-[0.4em] italic">MOD_{job.id}</span>
                        </div>
                        <h1 className="text-5xl md:text-7xl font-black tracking-tighter uppercase italic leading-none bg-gradient-to-r from-white via-white to-white/40 bg-clip-text text-transparent">
                            {formData.name}
                        </h1>
                    </div>
                </div>
                
                <div className="flex items-center gap-3 flex-wrap">
                    <Button
                        variant="outline"
                        className="font-black uppercase tracking-[0.2em] text-[10px] h-14 px-8 gap-3 border-foreground/5 bg-foreground/[0.02] hover:bg-foreground/[0.06] rounded-2xl italic transition-all active:scale-95"
                        onClick={() => setTestDialogOpen(true)}
                    >
                        <Binary className="w-4 h-4 text-primary" /> Test Run
                    </Button>
                    <Button
                        variant="secondary"
                        className="font-black uppercase tracking-[0.2em] text-[10px] h-14 px-8 gap-3 shadow-2xl rounded-2xl italic transition-all active:scale-95 bg-foreground text-background hover:bg-foreground/90"
                        onClick={() => runMutation.mutate()}
                        disabled={runMutation.isPending}
                    >
                        <Play className="w-4 h-4 fill-current" /> {runMutation.isPending ? "ACTIVATING..." : "INIT_SEQUENCE"}
                    </Button>
                    <Button 
                        className="font-black uppercase tracking-[0.2em] text-[10px] h-14 px-10 gap-3 shadow-[0_0_30px_hsl(var(--primary)/0.3)] rounded-2xl italic transition-all active:scale-95"
                        onClick={() => updateMutation.mutate(formData)}
                        disabled={updateMutation.isPending}
                    >
                        <Save className="w-4 h-4" /> {updateMutation.isPending ? "SYNCING..." : "COMMIT_CHANGES"}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
                {/* Left Column: Config Panel */}
                <div className="lg:col-span-8 space-y-8">
                    <Tabs defaultValue={defaultTab} className="w-full">
                        <TabsList className="bg-foreground/[0.02] border-foreground/5 p-1 mb-8 flex-wrap h-auto rounded-2xl">
                            <TabsTrigger value="matrix" className="text-[10px] uppercase font-black tracking-[0.2em] h-10 px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground italic rounded-xl transition-all">
                                <LayoutGrid className="w-3.5 h-3.5 mr-2" /> Matrix
                            </TabsTrigger>
                            <TabsTrigger value="schemas" className="text-[10px] uppercase font-black tracking-[0.2em] h-10 px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground italic rounded-xl transition-all">
                                <Database className="w-3.5 h-3.5 mr-2" /> Schemas
                            </TabsTrigger>
                            <TabsTrigger value="reactive" className="text-[10px] uppercase font-black tracking-[0.2em] h-10 px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground italic rounded-xl transition-all">
                                <Lightning className="w-3.5 h-3.5 mr-2" /> Reactive
                            </TabsTrigger>
                            <TabsTrigger value="impact" className="text-[10px] uppercase font-black tracking-[0.2em] h-10 px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground italic rounded-xl transition-all">
                                <BarChart3 className="w-3.5 h-3.5 mr-2" /> Impact
                            </TabsTrigger>
                            <TabsTrigger value="history" className="text-[10px] uppercase font-black tracking-[0.2em] h-10 px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground italic rounded-xl transition-all">
                                <History className="w-3.5 h-3.5 mr-2" /> Telemetry
                            </TabsTrigger>
                            <TabsTrigger value="insights" className="text-[10px] uppercase font-black tracking-[0.2em] h-10 px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground italic rounded-xl transition-all">
                                <Gauge className="w-3.5 h-3.5 mr-2" /> Insights
                            </TabsTrigger>
                            
                            {job.type === 'selenium' && (
                                <TabsTrigger value="live" className="text-[10px] uppercase font-black tracking-[0.2em] h-10 px-6 data-[state=active]:bg-blue-500 data-[state=active]:text-foreground italic rounded-xl transition-all">
                                    <Monitor className="w-3.5 h-3.5 mr-2" /> Live View
                                </TabsTrigger>
                            )}

                            {isAgent && (
                                <>
                                    <TabsTrigger value="publish" className="text-[10px] uppercase font-black tracking-[0.2em] h-10 px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground italic rounded-xl transition-all">
                                        <Globe className="w-3.5 h-3.5 mr-2" /> Deploy
                                    </TabsTrigger>
                                    <TabsTrigger value="performance" className="text-[10px] uppercase font-black tracking-[0.2em] h-10 px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground italic rounded-xl transition-all">
                                        <TrendingUp className="w-3.5 h-3.5 mr-2" /> Analytics
                                    </TabsTrigger>
                                    <TabsTrigger value="trace" className="text-[10px] uppercase font-black tracking-[0.2em] h-10 px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground italic rounded-xl transition-all">
                                        <Activity className="w-3.5 h-3.5 mr-2" /> Trace
                                    </TabsTrigger>
                                </>
                            )}
                        </TabsList>

                        <div className="mt-4">
                            <TabsContent value="matrix" className="mt-0 focus-visible:outline-none">
                                <Card className="glass-panel-deep border-foreground/5 shadow-2xl overflow-hidden rounded-[2.5rem]">
                                    <CardHeader className="bg-foreground/[0.01] border-b border-foreground/5 px-8 py-6">
                                        <div className="flex items-center justify-between">
                                            <CardTitle className="text-xs font-black uppercase tracking-[0.3em] italic">Initialization Matrix</CardTitle>
                                            <Badge variant="outline" className="text-[9px] font-black uppercase tracking-widest border-emerald-500/30 text-emerald-400 bg-emerald-500/5 px-3 py-1 italic rounded-lg">OPERATIONAL STABLE</Badge>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="p-0">
                                        <UniversalJobEditor 
                                            type={job.type}
                                            config={formData.config}
                                            onChange={(config: any) => setFormData((prev: any) => ({ ...prev, config }))}
                                        />
                                    </CardContent>
                                </Card>
                            </TabsContent>

                            <TabsContent value="schemas" className="mt-0 focus-visible:outline-none">
                                <AgentSchemasTab jobId={parseInt(id || '0')} />
                            </TabsContent>

                            <TabsContent value="reactive" className="mt-0 focus-visible:outline-none">
                                <JobReactiveTab jobId={parseInt(id || '0')} />
                            </TabsContent>

                            <TabsContent value="impact" className="mt-0 focus-visible:outline-none">
                                <ImpactAnalysisPanel jobId={parseInt(id || '0')} />
                            </TabsContent>

                            <TabsContent value="history" className="mt-0 focus-visible:outline-none">
                                <Card className="glass-panel-deep border-foreground/5 shadow-2xl rounded-[2.5rem] overflow-hidden">
                                    <CardHeader className="border-b border-foreground/5 bg-foreground/[0.01] px-8 py-6">
                                        <CardTitle className="text-xs font-black uppercase tracking-[0.3em] italic">Deployment History</CardTitle>
                                        <CardDescription className="text-[10px] font-bold text-foreground/20 uppercase tracking-widest mt-1 italic">Visual log of past module activations and state transitions.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="p-8">
                                        <JobRunHistory jobId={parseInt(id || '0')} />
                                    </CardContent>
                                </Card>
                            </TabsContent>

                            {/* Health, spend and request history: services that have been
                                mounted under /api/jobs all along with nothing reading them. */}
                            <TabsContent value="insights" className="mt-0 focus-visible:outline-none">
                                <Card className="glass-panel-deep border-foreground/5 shadow-2xl rounded-[2.5rem] overflow-hidden">
                                    <CardHeader className="border-b border-foreground/5 bg-foreground/[0.01] px-8 py-6">
                                        <CardTitle className="text-xs font-black uppercase tracking-[0.3em] italic">Operational Insights</CardTitle>
                                        <CardDescription className="text-[10px] font-bold text-foreground/20 uppercase tracking-widest mt-1 italic">Health score, spend and request history for this module.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="p-8">
                                        <JobInsightsPanel jobId={parseInt(id || '0')} />
                                    </CardContent>
                                </Card>
                            </TabsContent>

                            {job.type === 'selenium' && (
                                <TabsContent value="live" className="mt-0 focus-visible:outline-none">
                                    <Card className="glass-panel-deep border-foreground/5 shadow-2xl rounded-[2.5rem] overflow-hidden">
                                        <CardHeader className="border-b border-foreground/5 bg-foreground/[0.01] px-8 py-6">
                                            <CardTitle className="text-xs font-black uppercase tracking-[0.3em] italic">Selenium Auto Pilot Stream</CardTitle>
                                            <CardDescription className="text-[10px] font-bold text-foreground/20 uppercase tracking-widest mt-1 italic">Live bitstream from the autonomous browser agent.</CardDescription>
                                        </CardHeader>
                                        <CardContent className="p-8">
                                            <SeleniumVisualizer 
                                                jobId={id || '0'} 
                                                isActive={executions?.some(e => e.status === 'running') ?? false} 
                                            />
                                        </CardContent>
                                    </Card>
                                </TabsContent>
                            )}

                            {isAgent && (
                                <>
                                    <TabsContent value="publish" className="mt-0">
                                        <AgentPublishTab jobId={parseInt(id || '0')} />
                                    </TabsContent>
                                    <TabsContent value="performance" className="mt-0">
                                        <AgentAnalyticsDashboard jobId={parseInt(id || '0')} />
                                    </TabsContent>
                                    <TabsContent value="trace" className="mt-0">
                                        <Card className="glass-panel-deep border-foreground/5 shadow-2xl overflow-hidden rounded-[2.5rem] min-h-[700px]">
                                            <CardHeader className="bg-foreground/[0.01] border-b border-foreground/5 px-8 py-6">
                                                <CardTitle className="text-xs font-black uppercase tracking-[0.3em] flex items-center gap-3 italic">
                                                    <Activity className="w-4 h-4 text-primary" /> Reasoning Introspection Stream
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="p-0 h-[700px]">
                                                <AgentTraceViewer traceId={latestTraceId} />
                                            </CardContent>
                                        </Card>
                                    </TabsContent>
                                </>
                            )}
                        </div>
                    </Tabs>
                </div>

                {/* Right Column: Status & Identity */}
                <div className="lg:col-span-4 space-y-8">
                    <Card className="glass-panel-heavy border-foreground/5 shadow-2xl overflow-hidden rounded-[2.5rem]">
                        <CardHeader className="bg-foreground/[0.01] border-b border-foreground/5 py-6 px-8">
                            <CardTitle className="text-xs font-black uppercase tracking-[0.3em] flex items-center gap-3 text-primary italic">
                                <Shield className="w-4 h-4" /> Blueprint Identity
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-8 space-y-6">
                            <div className="space-y-3">
                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/30 italic ml-1">DESIGNATION</Label>
                                <Input 
                                    className="bg-foreground/[0.03] border-foreground/5 font-bold tracking-tight h-12 rounded-xl text-lg italic"
                                    value={formData.name}
                                    onChange={e => setFormData((prev: any) => ({ ...prev, name: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-3">
                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/30 italic ml-1">OPERATIONAL DIRECTIVE</Label>
                                <Textarea 
                                    className="bg-foreground/[0.03] border-foreground/5 text-[11px] min-h-[160px] leading-relaxed resize-none rounded-xl italic font-medium p-4"
                                    value={formData.description}
                                    onChange={e => setFormData((prev: any) => ({ ...prev, description: e.target.value }))}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="glass-panel-deep border-foreground/5 shadow-2xl overflow-hidden rounded-[2.5rem] bg-foreground/[0.01]">
                        <CardHeader className="bg-blue-500/[0.02] border-b border-foreground/5 py-6 px-8">
                            <CardTitle className="text-xs font-black uppercase tracking-[0.3em] flex items-center gap-3 text-blue-400 italic">
                                <Shield className="w-4 h-4" /> Operational Boundaries
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-8 space-y-8">
                            <div className="space-y-4">
                                <div className="flex justify-between items-center px-1">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/30 italic">AUTHORIZED PROTOCOL SET</span>
                                    <Badge variant="outline" className="text-[9px] h-5 font-mono bg-foreground/5 border-foreground/10 italic">{(formData.config?.allowedTools || []).length}</Badge>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {(formData.config?.allowedTools || []).slice(0, 4).map((t: string) => (
                                        <Badge key={t} variant="secondary" className="text-[9px] bg-primary/10 text-primary border-primary/20 h-5 px-2 italic font-black uppercase tracking-widest">{t}</Badge>
                                    ))}
                                    {(formData.config?.allowedTools || []).length > 4 && (
                                        <Badge variant="outline" className="text-[9px] h-5 italic font-black text-foreground/20">+{ (formData.config?.allowedTools || []).length - 4 }_MORE</Badge>
                                    )}
                                    {(formData.config?.allowedTools || []).length === 0 && <span className="text-[10px] text-foreground/10 italic uppercase font-black tracking-widest pl-1">RESTRICTED ACCESS</span>}
                                </div>
                            </div>
                            
                            <div className="space-y-4 pt-4 border-t border-foreground/5">
                                <div className="flex justify-between items-center px-1">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/30 italic">KNOWLEDGE DOMAIN SCOPE</span>
                                    <Badge variant="outline" className="text-[9px] h-5 font-mono bg-foreground/5 border-foreground/10 italic">
                                        {((formData.config?.topicIds || []).length + (formData.config?.datasetIds || []).length)}
                                    </Badge>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {(formData.config?.topicIds || []).length > 0 && <Badge className="text-[9px] bg-blue-500/10 text-blue-400 border-blue-500/20 h-5 px-2 italic font-black uppercase tracking-widest">{formData.config.topicIds.length}_TOPICS</Badge>}
                                    {(formData.config?.datasetIds || []).length > 0 && <Badge className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20 h-5 px-2 italic font-black uppercase tracking-widest">{formData.config.datasetIds.length}_DATASETS</Badge>}
                                    {((formData.config?.topicIds || []).length === 0 && (formData.config?.datasetIds || []).length === 0) && (
                                        <Badge className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/20 h-5 px-2 italic font-black uppercase tracking-widest">GLOBAL OMNISCIENCE</Badge>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="glass-panel-deep border-foreground/5 shadow-2xl rounded-[2.5rem] overflow-hidden">
                        <CardHeader className="py-6 px-8 bg-foreground/[0.01] border-b border-foreground/5">
                            <CardTitle className="text-xs font-black uppercase tracking-[0.3em] flex items-center gap-3 text-emerald-400 italic">
                                <Activity className="w-4 h-4" /> Vital Signs
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-8 space-y-8">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/30 italic">SYNC STATUS</span>
                                <Badge className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/20 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] italic rounded-lg shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                                    STABLE
                                </Badge>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/30 italic">LAST TERMINATION</span>
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground italic">
                                    {job.lastTestedAt ? formatDistanceToNow(new Date(job.lastTestedAt), { addSuffix: true }) : 'NO_TELEMETRY'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/30 italic">RELIABILITY INDEX</span>
                                <div className="flex items-center gap-3">
                                    <div className="flex gap-1">
                                        {[1, 2, 3, 4, 5].map(i => (
                                            <div key={i} className={cn("w-1.5 h-1.5 rounded-full", i <= 4 ? "bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.8)]" : "bg-foreground/10")} />
                                        ))}
                                    </div>
                                    <span className="text-[10px] font-black text-primary italic">80%</span>
                                </div>
                            </div>
                            
                            <div className="pt-8 border-t border-foreground/5 space-y-3">
                                <Button variant="outline" size="sm" className="w-full text-[10px] font-black uppercase tracking-[0.2em] h-12 gap-3 italic rounded-xl border-foreground/5 bg-foreground/[0.02] hover:bg-foreground/[0.08] transition-all">
                                    <Copy className="w-4 h-4" /> DUPLICATE BLUEPRINT
                                </Button>
                                <Button variant="ghost" size="sm" className="w-full text-[10px] font-black uppercase tracking-[0.2em] h-12 gap-3 text-red-500/60 hover:text-red-500 hover:bg-red-500/5 italic rounded-xl transition-all">
                                    <Trash2 className="w-4 h-4" /> PURGE MODULE BLUEPRINT
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
        </ErrorBoundary>
    );
}

