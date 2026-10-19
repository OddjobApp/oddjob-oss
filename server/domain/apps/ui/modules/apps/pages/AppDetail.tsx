import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useLocation, useRoute } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ArrowLeft, Settings, LayoutTemplate, Activity, Trash2, Bot, Terminal, PlaySquare, Link as LinkIcon, Globe, Code2, Layers, Cpu, Blocks, CheckCircle2, Workflow, Play } from 'lucide-react';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@domain-ui/core/ui/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { ErrorBoundary } from '@domain-ui/core/ui/components/shared/ErrorBoundary';
import { AppHookupsTab } from '../components/tabs/AppHookupsTab.js';
import { AppAnalyticsTab } from '../components/tabs/AppAnalyticsTab.js';
import { AppDeveloperTab } from '../components/tabs/AppDeveloperTab.js';
import { AppInteractiveBuilderTab } from '../components/tabs/AppInteractiveBuilderTab.js';
import { AppControlPanel } from '../components/AppControlPanel.js';
import { AppPublishTab } from '../components/tabs/AppPublishTab.js';
import { AppIntelligenceTab } from '../components/tabs/AppIntelligenceTab.js';
import { AppIntegrationsTab } from '../components/tabs/AppIntegrationsTab.js';
import { AppQATab } from '../components/tabs/AppQATab.js';
import { AppIcon } from '../components/AppIcon.js';
import { lazyWithRetry } from '@/lib/lazy-retry';
const XrayCompositionExplorer = lazyWithRetry(() => import('@domain-ui/xray/ui/XrayCompositionExplorer'));
import { cn } from "@/lib/utils";
import { apiRequest } from '@/lib/queryClient';
import { useOrgContext } from '@domain-ui/core/ui/hooks/use-org-context';
import { useAuth } from '@domain-ui/auth/ui/modules/auth/hooks/use-auth';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import type { App, AppDeployment } from "@shared/schema/apps";
import { DynamicUIRenderer } from '@/components/dynamic-ui/DynamicUIRenderer';
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

function AppLogsPanel({ appId }: { appId: number }) {
    const [lines, setLines] = useState<string[]>([]);
    const [connected, setConnected] = useState(false);
    const preRef = useRef<HTMLPreElement>(null);

    useEffect(() => {
        let orgIdParam = "";
        try {
            const stored = sessionStorage.getItem('selectedOrganizationId');
            if (stored) orgIdParam = `?orgId=${stored}`;
        } catch {}
        const es = new EventSource(`/api/apps/${appId}/logs${orgIdParam}`);
        setConnected(true);
        es.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.line) setLines(prev => [...prev, data.line]);
            } catch {}
        };
        es.onerror = () => { setConnected(false); es.close(); };
        return () => es.close();
    }, [appId]);

    useEffect(() => {
        if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
    }, [lines]);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Terminal className="w-4 h-4" /> Container Logs
                    <span className={`ml-2 w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-muted'}`} />
                </CardTitle>
                <CardDescription>Live log stream from the app container.</CardDescription>
            </CardHeader>
            <CardContent>
                <pre
                    ref={preRef}
                    className="bg-background text-green-400 text-xs rounded-lg p-4 h-[400px] overflow-y-auto font-mono whitespace-pre-wrap"
                >
                    {lines.length === 0 ? (connected ? "Waiting for logs..." : "No logs available.") : lines.join("\n")}
                </pre>
            </CardContent>
        </Card>
    );
}

export default function AppDetail() {
    const [, params] = useRoute('/armory/apps/:id');
    const [, setLocation] = useLocation();
    const appId = parseInt(params?.id || '0', 10);
    const [activeTab, setActiveTab] = useState("overview");
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { user, adminRole } = useAuth();
    const { selectedOrgId, isSuperAdmin, isOrgAdmin, isAdmin } = useOrgContext();
    const [addToPipelineOpen, setAddToPipelineOpen] = useState(false);
    const [selectedPipelineId, setSelectedPipelineId] = useState('');
    const cycleBuilderContext = new URLSearchParams(window.location.search);
    const cycleBuilderReturnTo = cycleBuilderContext.get('source') === 'cycle-builder'
        ? cycleBuilderContext.get('returnTo')
        : null;
    const cycleBuilderDraftId = cycleBuilderContext.get('draftId');
    const cycleBuilderPhaseId = cycleBuilderContext.get('phaseId');

    const { data: versions } = useQuery<{ versions: string[] }>({
        queryKey: ['/api/apps', appId, 'versions'],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/versions`);
            return res.json();
        },
        enabled: !!appId
    });

    const { data: installedDeployments, isLoading, isError: isInstalledError } = useQuery<{ deployment: AppDeployment, app: App }[]>({
        queryKey: ['/api/apps/installed'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/apps/installed');
            return res.json();
        },
        refetchInterval: activeTab === "preview" ? 5000 : false
    });

    const appData = installedDeployments?.find(d => d.app.id === appId);

    useEffect(() => {
        (window as any).__oddjobSwitchTab = (tab: string) => setActiveTab(tab);
        return () => { delete (window as any).__oddjobSwitchTab; };
    }, []);

    useEffect(() => {
        const tab = new URLSearchParams(window.location.search).get("tab");
        if (tab) {
            setActiveTab(tab);
        } else if (appData?.app?.config && (appData.app.config as any).tokenizedUI) {
            setActiveTab("launch");
        }
    }, [appId, appData]);

    const { data: pipelines = [] } = useQuery<any[]>({
        queryKey: ['/api/pipelines'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/pipelines');
            return res.json();
        },
        enabled: addToPipelineOpen,
    });

    const uninstallMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("DELETE", `/api/apps/${appId}/deploy`);
            return res.json();
        },
        onSuccess: () => {
            toast({ title: "App uninstalled successfully", description: "All associated app data has been wiped from your organization." });
            queryClient.invalidateQueries({ queryKey: ['/api/apps/installed'] });
            queryClient.invalidateQueries({ queryKey: ['/api/apps/fleet'] });
            setLocation('/armory/apps');
        },
        onError: (err: any) => {
            toast({
                title: "Failed to uninstall app",
                description: err.message,
                variant: "destructive"
            });
        }
    });

    const addToPipelineMutation = useMutation({
        mutationFn: async () => {
            if (!appData) throw new Error("App deployment is not loaded");
            if (!selectedPipelineId) throw new Error("Select a pipeline first");
            const res = await apiRequest("POST", `/api/pipelines/${selectedPipelineId}/app-steps`, {
                deploymentId: appData.deployment.id,
            });
            return res.json();
        },
        onSuccess: (data: any) => {
            const pipelineId = Number(selectedPipelineId);
            toast({
                title: "App added to pipeline",
                description: `${appData?.app.name || "App"} was added as step ${(data.step?.order ?? 0) + 1}.`,
            });
            queryClient.invalidateQueries({ queryKey: ['/api/pipelines'] });
            if (pipelineId) queryClient.invalidateQueries({ queryKey: ['/api/pipelines', pipelineId] });
            queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
            setAddToPipelineOpen(false);
            setSelectedPipelineId('');
        },
        onError: (err: any) => {
            toast({
                title: "Failed to add app",
                description: err.message || "Could not add this app to the selected pipeline.",
                variant: "destructive",
            });
        }
    });

    if (isLoading) {
        return (
            <div className="container mx-auto py-8 lg:py-12 px-4 max-w-5xl space-y-8">
                <div className="flex items-center gap-4">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <div className="space-y-2">
                        <Skeleton className="h-8 w-48" />
                        <Skeleton className="h-4 w-96" />
                    </div>
                </div>
                <div className="space-y-6">
                    <Skeleton className="h-10 w-full max-w-lg" />
                    <div className="grid gap-4 md:grid-cols-3">
                        <Skeleton className="h-32 w-full" />
                        <Skeleton className="h-32 w-full" />
                        <Skeleton className="h-32 w-full" />
                    </div>
                </div>
            </div>
        );
    }

    if (isInstalledError) {
        return (
            <div className="container mx-auto py-12 px-4 text-center">
                <h2 className="text-2xl font-bold mb-4 text-destructive">Failed to Load App</h2>
                <p className="text-muted-foreground mb-4">Could not fetch installed apps. Please refresh and try again.</p>
                <Button variant="outline" onClick={() => window.location.reload()}>Refresh</Button>
            </div>
        );
    }

    if (!appData) {
        return (
            <div className="container mx-auto py-12 px-4 text-center">
                <h2 className="text-2xl font-bold mb-4">App Not Found</h2>
                <p className="text-muted-foreground mb-6">This app is not installed in your workspace.</p>
                <Button onClick={() => setLocation('/armory/apps')}>Back to App Arsenal</Button>
            </div>
        );
    }

    const { app, deployment } = appData;
    const isSuperAdminEffective = isSuperAdmin || adminRole?.isSuperAdmin === true || user?.username === 'admin' || user?.username === 'administrator';
    const isOrgAdminEffective = isOrgAdmin || adminRole?.isOrgAdmin === true || isAdmin;
    const isDeveloper = isSuperAdminEffective || ((app.developerOrgId === selectedOrgId || app.organizationId === selectedOrgId) && isOrgAdminEffective);
    const isBuilderTab = activeTab === "preview";
    const isFullScreenTab = activeTab === "preview" || activeTab === "launch";
    const isPipelineRunnable = deployment.publicSlug === 'dispatcher' || app.slug === 'service-dispatch';

    return (
        <div className={cn("bg-transparent flex flex-col flex-1 min-h-0", isFullScreenTab ? "h-full w-full overflow-hidden" : "container mx-auto px-4 py-6 max-w-7xl min-h-screen")}>
            <div className={cn("flex flex-col space-y-6 mb-8", isFullScreenTab && "hidden")}>
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <button onClick={() => setLocation('/armory/apps')} className="hover:text-foreground transition-colors">Applications</button>
                    <span>/</span>
                    <span className="text-foreground">{app.name}</span>
                </div>

                <div className="flex flex-col md:flex-row items-start justify-between gap-6">
                    <div className="flex items-start gap-4">
                        <div className="flex-shrink-0">
                            <AppIcon 
                                icon={app.icon} 
                                className="w-16 h-16 rounded-xl border border-border bg-card shadow-sm flex items-center justify-center"
                                innerClassName="w-8 h-8 text-primary"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-3">
                                <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
                                    {app.name}
                                </h1>
                                <div className="flex items-center gap-2">
                                    <Badge variant="secondary" className="text-xs font-medium px-2 py-0.5">
                                        v{app.version || "1.0.0"}
                                    </Badge>
                                    <Badge variant="outline" className="text-xs font-mono text-muted-foreground px-2 py-0.5">
                                        {app.slug}
                                    </Badge>
                                </div>
                            </div>
                            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
                                {app.description || "Production application service designed for mission execution and automated routing."}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5 self-end md:self-auto">
                        {app.slug === 'prospecting' && (
                            <Button
                                size="sm"
                                className="h-9 font-medium text-xs"
                                onClick={() => setLocation('/armory/identity-bridge')}
                            >
                                <Activity className="w-4 h-4 mr-2" />
                                Launch Dashboard
                            </Button>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-9 text-xs font-medium"
                            disabled={!isPipelineRunnable}
                            title={isPipelineRunnable ? undefined : "Pipeline steps are available for apps with a supported executor."}
                            onClick={() => setAddToPipelineOpen(true)}
                        >
                            <Workflow className="w-3.5 h-3.5 mr-2" />
                            Add to Pipeline
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 text-xs font-medium text-muted-foreground hover:text-foreground"
                            onClick={() => setLocation('/armory/apps')}
                        >
                            <ArrowLeft className="w-3.5 h-3.5 mr-2" />
                            Back to Apps
                        </Button>
                    </div>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className={cn("w-full flex-1 flex flex-col min-h-0", isFullScreenTab && "h-full")}>
                <TabsList className={cn(
                    "mb-6 flex flex-wrap w-full bg-muted/50 border border-border p-1 rounded-xl h-auto gap-1 shadow-none",
                    isFullScreenTab && "hidden"
                )}>
                    {app.config && (app.config as any).tokenizedUI && (
                        <TabsTrigger value="launch" className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
                            <Play className="w-3.5 h-3.5" /> <span>Launch App</span>
                        </TabsTrigger>
                    )}
                    <TabsTrigger value="overview" className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
                        <Activity className="w-3.5 h-3.5" /> <span>Overview</span>
                    </TabsTrigger>
                    <TabsTrigger value="qa" className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
                        <CheckCircle2 className="w-3.5 h-3.5" /> <span>QA & Tests</span>
                    </TabsTrigger>
                    <TabsTrigger value="publish" className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
                        <Globe className="w-3.5 h-3.5" /> <span>Publishing</span>
                    </TabsTrigger>
                    <TabsTrigger value="hookups" className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
                        <LinkIcon className="w-3.5 h-3.5" /> <span>Connectors</span>
                    </TabsTrigger>
                    {isDeveloper && (
                        <TabsTrigger value="preview" className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
                            <Layers className="w-3.5 h-3.5" /> <span>App Builder</span>
                        </TabsTrigger>
                    )}
                    <TabsTrigger value="logs" className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
                        <Terminal className="w-3.5 h-3.5" /> <span>Logs</span>
                    </TabsTrigger>
                    {isDeveloper && (
                        <TabsTrigger value="intelligence" className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
                            <Cpu className="w-3.5 h-3.5" /> <span>Configure</span>
                        </TabsTrigger>
                    )}
                    {isDeveloper && (
                        <TabsTrigger value="developer" className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
                            <Code2 className="w-3.5 h-3.5" /> <span>Manifest</span>
                        </TabsTrigger>
                    )}
                    <TabsTrigger value="integrations" className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
                        <Blocks className="w-3.5 h-3.5" /> <span>Integrations</span>
                    </TabsTrigger>
                    <TabsTrigger value="xray" className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
                        <Cpu className="w-3.5 h-3.5" /> <span>X-Ray</span>
                    </TabsTrigger>
                    <TabsTrigger value="settings" className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
                        <Settings className="w-3.5 h-3.5" /> <span>Settings</span>
                    </TabsTrigger>
                </TabsList>

                {app.config && (app.config as any).tokenizedUI && (
                    <TabsContent value="launch" className="flex-1 min-h-0 border-none p-0 m-0 overflow-hidden h-full flex flex-col">
                        <DynamicUIRenderer schema={(app.config as any).tokenizedUI} />
                    </TabsContent>
                )}

                <TabsContent value="overview" className="space-y-6">
                    <AppControlPanel appId={app.id} currentVersion={app.version || "1.0"} versions={versions?.versions} />
                    <AppAnalyticsTab appId={app.id} app={app as any} deployment={deployment as any} />
                </TabsContent>

                <TabsContent value="qa">
                    <AppQATab appId={app.id} />
                </TabsContent>

                <TabsContent value="publish">
                    <AppPublishTab appId={app.id} appSlug={app.slug} onPublished={cycleBuilderReturnTo && cycleBuilderDraftId && cycleBuilderPhaseId ? (published) => {
                        localStorage.setItem('oddjob.cycle-builder.app-return-result', JSON.stringify({
                            draftId: cycleBuilderDraftId,
                            phaseId: cycleBuilderPhaseId,
                            app: {
                                slug: app.slug,
                                title: published.title || app.name,
                                description: published.description || app.description,
                                availability: 'installed',
                                source: 'app',
                                href: published.publicSlug ? `/app/${published.publicSlug}` : `/armory/apps/${app.id}`,
                                appId: app.id,
                                deploymentId: published.id,
                                isPublished: true,
                                releaseRef: `deployment:${published.id}@${new Date(published.updatedAt).toISOString()}`,
                            },
                        }));
                        setLocation(`${cycleBuilderReturnTo}?appReturn=published`);
                    } : undefined} />
                </TabsContent>

                <TabsContent value="hookups">
                    <AppHookupsTab appId={app.id} appSlug={app.slug} />
                </TabsContent>

                <TabsContent value="integrations">
                    <AppIntegrationsTab appId={app.id} deployment={deployment as any} />
                </TabsContent>

                {isDeveloper && (
                    <TabsContent value="preview" className="flex-1 min-h-0 border-none p-0 m-0 overflow-hidden h-full flex flex-col">
                        <AppInteractiveBuilderTab 
                            appId={app.id} 
                            app={app as any} 
                            onAppUpdated={() => { queryClient.invalidateQueries({ queryKey: ['/api/apps/installed'] }); queryClient.invalidateQueries({ queryKey: ['/api/apps/fleet'] }); }}
                        />
                    </TabsContent>
                )}

                <TabsContent value="logs">
                    <ErrorBoundary name="App Logs">
                        <AppLogsPanel appId={app.id} />
                    </ErrorBoundary>
                </TabsContent>

                {isDeveloper && (
                    <TabsContent value="intelligence">
                        <AppIntelligenceTab appId={app.id} appSlug={app.slug} />
                    </TabsContent>
                )}

                {isDeveloper && (
                    <TabsContent value="developer">
                        <AppDeveloperTab appId={app.id} app={app as any} />
                    </TabsContent>
                )}

                <TabsContent value="xray" className="flex-1 min-h-0 p-0 border-none">
                    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
                        <XrayCompositionExplorer fixedScope={app.slug} embedded />
                    </Suspense>
                </TabsContent>

                <TabsContent value="settings">
                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-destructive flex items-center gap-2">
                                    <Trash2 className="w-5 h-5" />
                                    Danger Zone
                                </CardTitle>
                                <CardDescription>
                                    Uninstalling this app will permanently delete all associated data and mission history for your organization.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive">Uninstall App</Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This action cannot be undone. This will permanently delete the app installation and all associated mission data from your organization.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={() => uninstallMutation.mutate()}
                                                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground focus:ring-destructive"
                                            >
                                                {uninstallMutation.isPending ? "Uninstalling..." : "Confirm Uninstall"}
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>

            <Dialog open={addToPipelineOpen} onOpenChange={setAddToPipelineOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add App to Pipeline</DialogTitle>
                        <DialogDescription>
                            Choose the pipeline that should run this app as its next step.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-2">
                        <Select value={selectedPipelineId} onValueChange={setSelectedPipelineId}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select a pipeline" />
                            </SelectTrigger>
                            <SelectContent>
                                {pipelines.map((pipeline: any) => (
                                    <SelectItem key={pipeline.id} value={String(pipeline.id)}>
                                        {pipeline.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAddToPipelineOpen(false)}>Cancel</Button>
                        <Button
                            onClick={() => addToPipelineMutation.mutate()}
                            disabled={!selectedPipelineId || addToPipelineMutation.isPending}
                        >
                            {addToPipelineMutation.isPending ? "Adding..." : "Add App"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
