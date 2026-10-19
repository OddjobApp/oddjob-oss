import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@domain-ui/core/ui/components/ui/card';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { ExternalLink, Globe, Lock, ShieldCheck, Copy, Check, Palette, Image as ImageIcon, Cpu, BrainCircuit, Hash, LinkIcon, Code, Wand2, BookMarked, Monitor, Settings2, Shield, UserCheck, Zap } from 'lucide-react';
import { MultiSelect } from "@domain-ui/core/ui/components/ui/multi-select";
import type { AppDeployment } from "@shared/schema/apps";
import type { Pipeline } from "@shared/schema/pipelines/pipeline-core";
import type { OceanTraits } from "@shared/schema/agent-deployments";
import { SoulConfigPanel, SoulArchetypeSelector } from "@domain-ui/ai/ui/modules/agent-ai";
import { Sparkles } from 'lucide-react';

interface AppPublishTabProps {
    appId: number;
    appSlug?: string;
    onPublished?: (deployment: AppDeployment) => void;
}

export function AppPublishTab({ appId, appSlug, onPublished }: AppPublishTabProps) {
    const { toast } = useToast();
    const [copied, setCopied] = useState(false);
    const [designStyleId, setDesignStyleId] = useState("");
    const [embellishment, setEmbellishment] = useState("");
    const [themePlan, setThemePlan] = useState<any>(null);

    // Fetch deployment settings
    const { data: deployment, isLoading: isLoadingDeployment, isError: isDeploymentError } = useQuery<AppDeployment | null>({
        queryKey: [`/api/apps/${appId}/deploy`],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/deploy`);
            if (res.status === 404) return null; // No deployment record yet — form shows defaults
            if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
            return res.json();
        }
    });

    const { data: readiness, isFetching: isCheckingReadiness } = useQuery<any>({
        queryKey: [`/api/apps/${appId}/readiness`, { probe: true }],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/readiness?probe=true`);
            if (!res.ok) throw new Error(`Failed to check readiness (${res.status})`);
            return res.json();
        },
        retry: false,
    });

    const { data: designStyles = [] } = useQuery<any[]>({
        queryKey: ['/api/apps/forge/design-catalog'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/apps/forge/design-catalog');
            if (!res.ok) return [];
            return res.json();
        },
        staleTime: 60 * 60 * 1000,
    });

    // Fetch pipelines for chaining
    const { data: pipelines = [] } = useQuery<Pipeline[]>({
        queryKey: ['/api/pipelines'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/pipelines');
            if (!res.ok) return [];
            return res.json();
        }
    });
    
    // Fetch agents for expertise linkage
    const { data: agents = [] } = useQuery<any[]>({
        queryKey: ['/api/jobs', { type: 'ai_agent' }],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/jobs?type=ai_agent');
            if (!res.ok) return [];
            const data = await res.json();
            return data.items || [];
        }
    });

    // Fetch Concepts for Intelligence Categories
    const { data: concepts = [] } = useQuery<any[]>({
        queryKey: ['/api/rag/concepts'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/rag/concepts');
            if (!res.ok) return [];
            return res.json();
        }
    });

    // Fetch Machine Tools for Scoping
    const { data: machineTools = [] } = useQuery<any[]>({
        queryKey: ['/api/missions/tools'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/missions/tools');
            if (!res.ok) return [];
            const data = await res.json();
            return data.tools || [];
        }
    });

    // Fetch Knowledge Topics
    const { data: topicsResult } = useQuery<any>({
        queryKey: ['/api/rag/rag-assets'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/rag/rag-assets');
            if (!res.ok) return { assets: [] };
            return res.json();
        }
    });
    const topics = topicsResult?.assets || [];

    // Fetch Datasets
    const { data: datasets = [] } = useQuery<any[]>({
        queryKey: ['/api/datasets'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/datasets');
            if (!res.ok) return [];
            return res.json();
        }
    });

    // Fetch prospecting properties if this is the prospecting app
    const { data: properties = [] } = useQuery<any[]>({
        queryKey: ["/api/prospecting/properties"],
        enabled: appSlug === 'prospecting',
        queryFn: async () => {
            const res = await apiRequest('GET', "/api/prospecting/properties");
            if (!res.ok) return [];
            return res.json();
        }
    });

    const mutation = useMutation({
        mutationFn: async (data: Partial<AppDeployment> & { password?: string }) => {
            try {
                const res = await apiRequest("POST", `/api/apps/${appId}/deploy`, data);
                return res.json();
            } catch (err) {
                throw err;
            }
        },
        onSuccess: (updated: AppDeployment) => {
            queryClient.invalidateQueries({ queryKey: [`/api/apps/${appId}/deploy`] });
            queryClient.invalidateQueries({ queryKey: [`/api/apps/${appId}/readiness`] });
            toast({
                title: updated.isPublished ? "App deployed and published" : "Deployment settings saved",
                description: updated.isPublished
                    ? "The runtime passed its readiness checks and the link is live."
                    : "The public link is disabled.",
            });
            if (updated.isPublished) onPublished?.(updated);
        },
        onError: (error: any) => {
            toast({
                title: "Error",
                description: error.message || "Failed to update deployment settings.",
                variant: "destructive"
            });
        }
    });

    const themePlanMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest('POST', `/api/apps/${appId}/theme-plan`, { styleId: designStyleId, embellishment });
            return res.json();
        },
        onSuccess: setThemePlan,
        onError: (error: any) => toast({ title: "Theme preview failed", description: error.message, variant: "destructive" }),
    });

    const applyThemeMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest('POST', `/api/apps/${appId}/apply-theme`, { styleId: designStyleId, embellishment }, 120000);
            return res.json();
        },
        onSuccess: (result: any) => {
            setThemePlan(null);
            queryClient.invalidateQueries({ queryKey: [`/api/apps/${appId}/readiness`] });
            toast({
                title: `${result.style?.name || "Theme"} applied`,
                description: "The app was rebuilt with its features preserved. You can revert the last AI change in App Builder.",
            });
        },
        onError: (error: any) => toast({ title: "Theme application failed", description: error.message, variant: "destructive" }),
    });

    const [form, setForm] = useState<Partial<AppDeployment> & { password?: string }>({});

    // Sync form with data when loaded
    React.useEffect(() => {
        if (deployment) {
            setForm({
                publicSlug: deployment.publicSlug || "",
                title: deployment.title || "",
                description: deployment.description || "",
                isPublished: deployment.isPublished ?? false,
                accessPolicy: deployment.accessPolicy || "public",
                brandingConfig: deployment.brandingConfig || {},
                budgetLimitUsd: deployment.budgetLimitUsd || "",
                userBudgetLimit: deployment.userBudgetLimit || "",
                defaultModel: deployment.defaultModel || "gpt-4o",
                systemPrompt: deployment.systemPrompt || "",
                appMemoryEnabled: deployment.appMemoryEnabled ?? false,
                webhookUrl: deployment.webhookUrl || "",
                webhookType: (deployment as any).webhookType || "generic",
                webhookSecret: (deployment as any).webhookSecret || "",
                nextPipelineId: (deployment as any).nextPipelineId || null,
                hilEnabled: deployment.hilEnabled ?? false,
                oceanTraits: (deployment as any).oceanTraits || { o: 50, c: 50, e: 50, a: 50, n: 50 },
                soulArchetype: (deployment as any).soulArchetype || "Lead Directive",
                expertiseJobId: deployment.expertiseJobId || null,
                allowedTopicIds: deployment.allowedTopicIds || [],
                allowedDatasetIds: deployment.allowedDatasetIds || [],
                allowedPipelineIds: deployment.allowedPipelineIds || [],
                allowedTools: deployment.allowedTools || [],
                reasoningProtocol: (deployment as any).reasoningProtocol || "json_manifest",
                intelligenceCategory: (deployment as any).intelligenceCategory || "",
                deploymentMode: (deployment as any).deploymentMode || "chat",
                browserStartUrl: (deployment as any).browserStartUrl || "",
                browserGoal: (deployment as any).browserGoal || "",
                browserConfig: (deployment as any).browserConfig || {},
                navigationalMemoryShared: (deployment as any).navigationalMemoryShared ?? true,
            });
        } else {
            // Default values for new deployment settings
            setForm({
                publicSlug: `app-${appId}`,
                isPublished: false,
                accessPolicy: "public",
                brandingConfig: { primaryColor: '#000000', theme: 'light' },
                budgetLimitUsd: "",
                userBudgetLimit: "",
                defaultModel: "gpt-4o",
                systemPrompt: "",
                appMemoryEnabled: false,
                webhookUrl: "",
                webhookType: "generic",
                webhookSecret: "",
                nextPipelineId: null,
                oceanTraits: { o: 50, c: 50, e: 50, a: 50, n: 50 },
                soulArchetype: "Lead Directive",
                expertiseJobId: null,
                allowedTopicIds: [],
                allowedDatasetIds: [],
                allowedPipelineIds: [],
            });
        }
    }, [deployment, appId]);

    const handleSave = () => {
        // Validation: if publishing, slug is required and must be valid
        if (form.isPublished && (!form.publicSlug || form.publicSlug.length < 3)) {
            toast({
                title: "Validation Error",
                description: "A public slug (at least 3 characters) is required to publish the app.",
                variant: "destructive"
            });
            return;
        }

        const payload = { ...form };
        // Convert empty strings to null for backend
        if (payload.publicSlug === "") payload.publicSlug = null;
        if (payload.title === "") payload.title = null;
        if (payload.description === "") payload.description = null;

        mutation.mutate(payload);
    };

    const publicUrl = `${window.location.origin}/app/${form.publicSlug}`;

    const copyToClipboard = () => {
        navigator.clipboard.writeText(publicUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (isLoadingDeployment) return <div className="p-8 text-center">Loading settings...</div>;
    if (isDeploymentError) return <div className="p-8 text-center text-destructive">Failed to load deployment settings. Please refresh and try again.</div>;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Deployment Configuration</CardTitle>
                            <CardDescription>
                                Configure how this app appears on its standalone landing page.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
                                <div>
                                    <Label className="flex items-center gap-2"><Wand2 className="h-4 w-4" /> App Forge Theme</Label>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Preview a visual-only AI pass. Features, content, calculations, routes, and data connections are preserved.
                                    </p>
                                </div>
                                <Select value={designStyleId} onValueChange={(value) => { setDesignStyleId(value); setThemePlan(null); }}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={designStyles.length ? "Choose an App Forge theme" : "No catalog themes available"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {designStyles.map((style: any) => (
                                            <SelectItem key={style.id} value={style.id}>{style.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <div className="space-y-2">
                                    <Label htmlFor="themeEmbellishment">AI embellishment (optional)</Label>
                                    <Textarea
                                        id="themeEmbellishment"
                                        value={embellishment}
                                        onChange={(event) => { setEmbellishment(event.target.value); setThemePlan(null); }}
                                        placeholder="e.g. Restrained motion, warmer hospitality details, and stronger mobile hierarchy."
                                        rows={3}
                                    />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={!designStyleId || themePlanMutation.isPending || applyThemeMutation.isPending}
                                        onClick={() => themePlanMutation.mutate()}
                                    >
                                        {themePlanMutation.isPending ? "Planning…" : "Preview changes"}
                                    </Button>
                                    {themePlan && (
                                        <Button
                                            type="button"
                                            disabled={applyThemeMutation.isPending}
                                            onClick={() => applyThemeMutation.mutate()}
                                        >
                                            {applyThemeMutation.isPending ? "Applying and rebuilding…" : `Apply ${themePlan.style?.name || "theme"}`}
                                        </Button>
                                    )}
                                </div>
                                {themePlan && (
                                    <div className="rounded-md border bg-background p-3 text-xs">
                                        <p className="font-medium">Reversible design plan · risk: {themePlan.risk || "low"}</p>
                                        <p className="mt-1 text-muted-foreground">
                                            Likely files: {(themePlan.likelyFiles || []).join(', ') || 'App presentation files selected by the builder'}
                                        </p>
                                    </div>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="slug">Public Slug</Label>
                                    <div className="flex items-center space-x-2">
                                        <div className="bg-muted px-3 py-2 rounded-md text-sm text-muted-foreground">/app/</div>
                                        <Input
                                            id="slug"
                                            value={form.publicSlug || ""}
                                            onChange={(e) => setForm({ ...form, publicSlug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                                            placeholder="my-app"
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">Unique URL identifier for this app.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="title">Page Title</Label>
                                    <Input
                                        id="title"
                                        value={form.title || ""}
                                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                                        placeholder="Social Co-pilot"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="description">Public Description</Label>
                                <Textarea
                                    id="description"
                                    value={form.description || ""}
                                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                                    placeholder="Briefly describe what this app does."
                                />
                            </div>

                            <div className="pt-4 border-t space-y-4">
                                <div className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-primary">
                                    <BrainCircuit className="h-4 w-4" /> Expertise Hub
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Backing Agent / Brain</Label>
                                        <Select 
                                            value={form.expertiseJobId?.toString() || "none"} 
                                            onValueChange={(val) => setForm({ ...form, expertiseJobId: val === "none" ? null : parseInt(val) })}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select an expert agent..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">Standalone (No expertise)</SelectItem>
                                                {agents.map((agent) => (
                                                    <SelectItem key={agent.id} value={agent.id.toString()}>{agent.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-[10px] text-muted-foreground">App will inherit instructions and training from this agent.</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="flex items-center gap-2">
                                            Session Learning (Run Memory)
                                        </Label>
                                        <div className="flex items-center justify-between p-2 border rounded-md bg-muted/30">
                                            <span className="text-xs font-medium">Capture interactions as expertise</span>
                                            <Switch
                                                checked={!!form.appMemoryEnabled}
                                                onCheckedChange={(val) => setForm({ ...form, appMemoryEnabled: val })}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 border-t space-y-4">
                                <div className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-primary">
                                    <Cpu className="h-4 w-4" /> Deployment Engine
                                </div>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Engine Mode</Label>
                                        <Select 
                                            value={form.deploymentMode || 'chat'} 
                                            onValueChange={(val) => setForm({ ...form, deploymentMode: val })}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Choose engine style" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="chat">Conversational Chat (Default)</SelectItem>
                                                <SelectItem value="browser_autopilot">Autonomous Browser (Playwright Auto-Pilot)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <p className="text-[10px] text-muted-foreground italic">
                                            {form.deploymentMode === 'chat' 
                                                ? "Optimized for LLM-led conversations and tool usage."
                                                : "Activates a background browser session to perform autonomous web research."
                                            }
                                        </p>
                                    </div>

                                    {form.deploymentMode === 'browser_autopilot' && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-lg bg-indigo-50/5 border border-indigo-500/20">
                                            <div className="space-y-2">
                                                <Label className="flex items-center gap-2">
                                                    <Globe className="h-3 w-3 text-indigo-500" /> Start URL
                                                </Label>
                                                <Input 
                                                    placeholder="https://google.com..." 
                                                    value={form.browserStartUrl || ''} 
                                                    onChange={(e) => setForm({ ...form, browserStartUrl: e.target.value })}
                                                    className="bg-background/50"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="flex items-center gap-2">
                                                    <BrainCircuit className="h-3 w-3 text-indigo-500" /> Default Browser Goal
                                                </Label>
                                                <Input 
                                                    placeholder="Extract latest news about..." 
                                                    value={form.browserGoal || ''} 
                                                    onChange={(e) => setForm({ ...form, browserGoal: e.target.value })}
                                                    className="bg-background/50"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {form.deploymentMode === 'browser_autopilot' && (
                                        <div className="pt-2 space-y-4">
                                            <div className="flex items-center gap-2 text-[11px] font-bold text-muted-foreground uppercase tracking-tighter">
                                                <Settings2 className="h-3 w-3" /> Titan Engine Advanced Configuration
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                <div className="space-y-2">
                                                    <Label className="text-[10px]">Viewport Width</Label>
                                                    <Input 
                                                        type="number"
                                                        value={(form.browserConfig as any)?.viewport?.width || 1280} 
                                                        onChange={(e) => setForm({ 
                                                            ...form, 
                                                            browserConfig: { 
                                                                ...(form.browserConfig as any), 
                                                                viewport: { ...((form.browserConfig as any)?.viewport || {}), width: parseInt(e.target.value) } 
                                                            } 
                                                        })}
                                                        className="h-8 text-xs"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-[10px]">Headless Mode</Label>
                                                    <div className="flex items-center h-8">
                                                        <Switch 
                                                            checked={(form.browserConfig as any)?.headless !== false}
                                                            onCheckedChange={(val) => setForm({ 
                                                                ...form, 
                                                                browserConfig: { ...(form.browserConfig as any), headless: val } 
                                                            })}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-[10px]">Collective Memory</Label>
                                                    <div className="flex items-center h-8 gap-2">
                                                        <Switch 
                                                            checked={form.navigationalMemoryShared}
                                                            onCheckedChange={(val) => setForm({ ...form, navigationalMemoryShared: val })}
                                                        />
                                                        <span className="text-[9px] text-muted-foreground italic">Auto-share navigation guides</span>
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-[10px] flex items-center gap-1">
                                                        <Shield className="h-2 w-2 text-emerald-500" /> Stealth Mode
                                                    </Label>
                                                    <div className="flex items-center h-8 gap-2">
                                                        <Switch 
                                                            checked={(form.browserConfig as any)?.stealthMode !== false}
                                                            onCheckedChange={(val) => setForm({ 
                                                                ...form, 
                                                                browserConfig: { ...(form.browserConfig as any), stealthMode: val } 
                                                            })}
                                                        />
                                                        <span className="text-[9px] text-muted-foreground italic">Titanium Cloaking</span>
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-[10px] flex items-center gap-1">
                                                        <UserCheck className="h-2 w-2 text-amber-500" /> HIL Captcha
                                                    </Label>
                                                    <div className="flex items-center h-8 gap-2">
                                                        <Switch 
                                                            checked={(form.browserConfig as any)?.hilOnImpediment === true}
                                                            onCheckedChange={(val) => setForm({ 
                                                                ...form, 
                                                                browserConfig: { ...(form.browserConfig as any), hilOnImpediment: val } 
                                                            })}
                                                        />
                                                        <span className="text-[9px] text-muted-foreground italic">Relay to Human</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="pt-4 border-t space-y-4">
                                <div className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-primary">
                                    <ShieldCheck className="h-4 w-4" /> Knowledge & Tool Scoping
                                </div>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Visible Knowledge Topics</Label>
                                        <MultiSelect 
                                            options={topics.map((t: any) => ({ label: t.name, value: t.id }))}
                                            selected={form.allowedTopicIds || []}
                                            onChange={(vals) => setForm({ ...form, allowedTopicIds: vals as number[] })}
                                            placeholder="Select topics the app can talk about..."
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>Structured Datasets</Label>
                                            <MultiSelect 
                                                options={datasets.map(d => ({ label: d.name, value: d.id }))}
                                                selected={form.allowedDatasetIds || []}
                                                onChange={(vals) => setForm({ ...form, allowedDatasetIds: vals as number[] })}
                                                placeholder="Exposed data..."
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Pipelines This App Can Trigger</Label>
                                            <MultiSelect 
                                                options={pipelines.map(p => ({ label: p.name, value: p.id }))}
                                                selected={form.allowedPipelineIds || []}
                                                onChange={(vals) => setForm({ ...form, allowedPipelineIds: vals as number[] })}
                                                placeholder="Pipeline triggers permitted..."
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>System Tool Permissions (Inherited/Scoped)</Label>
                                        <MultiSelect 
                                            options={machineTools.map(t => ({ label: t.name, value: t.name }))}
                                            selected={(form as any).allowedTools || []}
                                            onChange={(vals) => setForm({ ...form, allowedTools: vals as string[] } as any)}
                                            placeholder="Merge & restrict tools..."
                                        />
                                        <p className="text-[10px] text-muted-foreground">Inherited from backing agent. Leave empty to allow all brain tools.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 border-t space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-primary">
                                        <BookMarked className="h-4 w-4" /> Agent Memory Wiki
                                    </div>
                                    <Button variant="outline" size="sm" className="h-7 text-[10px]" asChild>
                                        <a href="/rag/explorer" target="_blank">Open Knowledge Explorer</a>
                                    </Button>
                                </div>
                                <div className="p-4 rounded-lg border bg-emerald-50/10 border-emerald-500/20 space-y-2">
                                    <div className="text-xs font-bold text-emerald-600 flex items-center gap-2">
                                        <Sparkles className="h-3 w-3" /> Autonomous Expertise Capture
                                    </div>
                                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                                        When this app is backed by an expert brain, successfully completed missions are automatically distilled into formal Wiki Articles. These findings populate your organization's <strong>Agency Intelligence</strong> topic, creating a permanent, searchable memory of operational truth.
                                    </p>
                                    <div className="pt-2 flex flex-wrap gap-2">
                                        <div className="px-2 py-1 rounded bg-emerald-100/50 text-[9px] font-bold text-emerald-700 border border-emerald-200 uppercase tracking-tighter">
                                            Self-Correcting
                                        </div>
                                        <div className="px-2 py-1 rounded bg-emerald-100/50 text-[9px] font-bold text-emerald-700 border border-emerald-200 uppercase tracking-tighter">
                                            Cross-Agent Searchable
                                        </div>
                                        <div className="px-2 py-1 rounded bg-emerald-100/50 text-[9px] font-bold text-emerald-700 border border-emerald-200 uppercase tracking-tighter">
                                            Exportable Artifacts
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {appSlug === 'prospecting' && (
                        <Card className="border-indigo-500/20 bg-indigo-50/10">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-indigo-600">
                                    <Code className="h-5 w-5" /> External System Integration
                                </CardTitle>
                                <CardDescription>
                                    Copy this snippet to your external website's head tag to enable enterprise de-anonymization.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="relative group">
                                    <pre className="bg-background text-emerald-400 p-4 rounded-lg overflow-x-auto text-[11px] font-mono border border-border">
                                        <code>{`<script src="${window.location.origin}/oddjob-prospector.js" data-property-uid="${properties[0]?.uid || 'PENDING_SETUP'}"></script>`}</code>
                                    </pre>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        className="absolute top-2 right-2 h-8 gap-2"
                                        onClick={() => {
                                            const uid = properties[0]?.uid || 'PENDING_SETUP';
                                            navigator.clipboard.writeText(`<script src="${window.location.origin}/oddjob-prospector.js" data-property-uid="${uid}"></script>`);
                                            toast({ title: "Snippet Copied" });
                                        }}
                                    >
                                        <Copy className="h-3 w-3" /> Copy
                                    </Button>
                                </div>
                                <div className="p-3 bg-indigo-50 dark:bg-indigo-950/30 rounded border border-indigo-100 dark:border-indigo-800 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                                    <strong>Co-pilot Identity Bridge:</strong> This snippet connects your external traffic directly to Oddjob's S.C.O.R.E. engine for real-time lead resolution and identity merging.
                                    {!properties[0] && <p className="mt-2 text-amber-600">Note: No prospecting property found. Please create one in the Prospecting Dashboard first.</p>}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Palette className="h-5 w-5" /> Branding & Aesthetics
                            </CardTitle>
                            <CardDescription>Customize the look and feel of your app's public page.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="primaryColor">Primary Branding Color</Label>
                                    <div className="flex items-center space-x-2">
                                        <Input
                                            id="primaryColor"
                                            type="color"
                                            className="w-12 h-10 p-1"
                                            value={(form.brandingConfig as any)?.primaryColor || "#000000"}
                                            onChange={(e) => setForm({
                                                ...form,
                                                brandingConfig: { ...(form.brandingConfig as any), primaryColor: e.target.value }
                                            })}
                                        />
                                        <Input
                                            value={(form.brandingConfig as any)?.primaryColor || "#000000"}
                                            onChange={(e) => setForm({
                                                ...form,
                                                brandingConfig: { ...(form.brandingConfig as any), primaryColor: e.target.value }
                                            })}
                                            className="font-mono text-sm"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="logoUrl">Custom Logo (URL)</Label>
                                    <div className="flex items-center space-x-2">
                                        <div className="p-2 bg-muted rounded">
                                            <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                        <Input
                                            id="logoUrl"
                                            placeholder="https://..."
                                            value={(form.brandingConfig as any)?.logoUrl || ""}
                                            onChange={(e) => setForm({
                                                ...form,
                                                brandingConfig: { ...(form.brandingConfig as any), logoUrl: e.target.value }
                                            })}
                                        />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-6">
                    <Card className="border-primary/20 bg-primary/5">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-bold flex items-center gap-2">
                                <Palette className="h-4 w-4" /> Branding Playground
                            </CardTitle>
                            <CardDescription className="text-[10px]">Real-time mobile preview</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="w-full border-4 border-border rounded-[2rem] aspect-[9/16] bg-background shadow-2xl relative overflow-hidden transform scale-[0.85] origin-top">
                                <div className="absolute top-0 inset-x-0 h-4 bg-muted rounded-b-xl flex justify-center items-center">
                                    <div className="w-12 h-1 bg-foreground/20 rounded-full" />
                                </div>

                                <div className="p-4 pt-8 space-y-4 h-full overflow-y-auto">
                                    <style dangerouslySetInnerHTML={{
                                        __html: `
                                        .playground-primary-text { color: ${(form.brandingConfig as any)?.primaryColor || '#000'}; }
                                        .playground-primary-bg { background-color: ${(form.brandingConfig as any)?.primaryColor || '#000'}; }
                                    `}} />
                                    <div className="flex items-center gap-2">
                                        {(form.brandingConfig as any)?.logoUrl ? (
                                            <img src={(form.brandingConfig as any).logoUrl} className="w-6 h-6 object-contain" alt="Logo" />
                                        ) : (
                                            <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center">
                                                <Globe className="w-4 h-4 playground-primary-text" />
                                            </div>
                                        )}
                                        <div className="h-3 w-20 bg-muted rounded" />
                                    </div>

                                    <div className="space-y-2 pt-4">
                                        <div className="h-6 w-3/4 rounded font-bold text-sm playground-primary-text">
                                            {form.title || "Untitled App"}
                                        </div>
                                        <div className="space-y-1">
                                            <div className="h-2 w-full bg-muted rounded" />
                                            <div className="h-2 w-5/6 bg-muted rounded" />
                                        </div>
                                    </div>

                                    <div className="pt-8 space-y-3">
                                        <div className="h-10 w-full rounded-lg shadow-sm playground-primary-bg" />
                                        <div className="h-10 w-full bg-muted rounded-lg" />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Status</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className={cn(
                                "rounded-md border p-3 text-sm",
                                readiness?.ready ? "border-green-500/30 bg-green-500/5" : "border-amber-500/30 bg-amber-500/5",
                            )}>
                                <div className="flex items-center justify-between gap-3">
                                    <span className="font-medium">Runtime readiness</span>
                                    <span className={cn("text-xs", readiness?.ready ? "text-green-600" : "text-amber-600")}>
                                        {isCheckingReadiness ? "Checking…" : readiness?.ready ? "Ready" : "Needs deployment"}
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Publishing prepares the app, starts its runtime, and verifies an HTTP response before enabling the link.
                                </p>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label>Publish after readiness check</Label>
                                    <p className="text-xs text-muted-foreground">Enable the configured access policy only after deployment succeeds.</p>
                                </div>
                                <Switch
                                    checked={!!form.isPublished}
                                    onCheckedChange={(val: boolean) => setForm({ ...form, isPublished: val })}
                                />
                            </div>

                            {deployment?.isPublished && (
                                <div className="pt-4 space-y-2">
                                    <Label>Public Link</Label>
                                    <div className="flex items-center space-x-2">
                                        <Input readOnly value={publicUrl} className="text-xs" />
                                        <Button size="icon" variant="outline" onClick={copyToClipboard}>
                                            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                                        </Button>
                                    </div>
                                    <Button variant="link" className="p-0 h-auto text-xs" asChild disabled={!form.publicSlug}>
                                        <a href={publicUrl} target="_blank" rel="noreferrer" className={cn("flex items-center", !form.publicSlug && "pointer-events-none opacity-50")}>
                                            Visit Page <ExternalLink className="ml-1 h-3 w-3" />
                                        </a>
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                        <CardFooter>
                            <Button className="w-full" onClick={handleSave} disabled={mutation.isPending}>
                                {mutation.isPending
                                    ? (form.isPublished ? "Deploying and verifying…" : "Saving…")
                                    : form.isPublished
                                        ? "Deploy, Verify & Publish"
                                        : deployment?.isPublished ? "Unpublish & Save" : "Save Draft"}
                            </Button>
                        </CardFooter>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Access Control</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-4">
                                <div className={`p-3 border rounded-md cursor-pointer transition-colors ${form.accessPolicy === 'public' ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}
                                    onClick={() => setForm({ ...form, accessPolicy: 'public' })}>
                                    <div className="flex items-center space-x-2">
                                        <Globe className="h-4 w-4 text-blue-500" />
                                        <span className="font-medium text-sm">Public</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">Anyone with the link can access.</p>
                                </div>

                                <div className={`p-3 border rounded-md cursor-pointer transition-colors ${form.accessPolicy === 'password' ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}
                                    onClick={() => setForm({ ...form, accessPolicy: 'password' })}>
                                    <div className="flex items-center space-x-2">
                                        <Lock className="h-4 w-4 text-amber-500" />
                                        <span className="font-medium text-sm">Password Protected</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">Require a password to access.</p>
                                </div>

                                <div className={`p-3 border rounded-md cursor-pointer transition-colors ${form.accessPolicy === 'internal_only' ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}
                                    onClick={() => setForm({ ...form, accessPolicy: 'internal_only' })}>
                                    <div className="flex items-center space-x-2">
                                        <ShieldCheck className="h-4 w-4 text-green-500" />
                                        <span className="font-medium text-sm">Internal Only</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">Requires user to be logged in to your org.</p>
                                </div>
                            </div>

                            {form.accessPolicy === 'password' && (
                                <div className="pt-2">
                                    <Label htmlFor="password">Access Password</Label>
                                    <Input
                                        id="password"
                                        type="password"
                                        placeholder="Leave blank to keep current"
                                        value={(form as any).password || ""}
                                        onChange={(e) => setForm({ ...form, password: e.target.value } as any)}
                                    />
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
