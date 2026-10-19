import React, { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@domain-ui/core/ui/components/ui/card";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Slider } from "@domain-ui/core/ui/components/ui/slider";
import { MultiSelect } from "@domain-ui/core/ui/components/ui/multi-select";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import {
    Globe, Lock, ShieldCheck, Copy, Check, Palette, ExternalLink,
    Upload, Brain, Zap, Database, BookOpen, Settings2, Shield,
    MessageSquare, FileType, Cpu, ChevronDown, ChevronUp, Link, Wrench
} from "lucide-react";
import { SOUL_ARCHETYPES, OCEAN_LABELS } from "@domain-ui/ai/ui/modules/agent-ai";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import AgentKnowledgeConfig from './AgentKnowledgeConfig.js';
import AgentToolsSelector from './AgentToolsSelector.js';
import "./jobs-components.css";

interface AgentPublishTabProps {
    jobId: number;
}

export function AgentPublishTab({ jobId }: AgentPublishTabProps) {
    const { toast } = useToast();
    const [copied, setCopied] = useState(false);
    const [showEmbed, setShowEmbed] = useState(false);
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const presetButtonsRef = useRef<Map<string, HTMLButtonElement>>(new Map());

    const setOcean = (key: 'o' | 'c' | 'e' | 'a' | 'n', val: number) => {
        setForm(f => ({
            ...f,
            oceanTraits: { ...f.oceanTraits, [key]: val }
        }));
    };

    const setEmbed = (key: string, val: any) => {
        setForm(f => ({
            ...f,
            embedConfig: { ...f.embedConfig, [key]: val }
        }));
    };

    const setBranding = (key: string, val: any) => {
        setForm(f => ({
            ...f,
            brandingConfig: { ...f.brandingConfig, [key]: val }
        }));
    };

    const { data: deployment, isLoading } = useQuery<any>({
        queryKey: [`/api/agents/deployments/${jobId}`],
        queryFn: async () => {
            const res = await fetch(`/api/agents/deployments/${jobId}`, { credentials: "include" });
            if (!res.ok) return null;
            return res.json();
        },
    });

    const { data: topics = [] } = useQuery<any[]>({
        queryKey: ["/api/rag/rag-assets"],
        queryFn: async () => {
            const res = await fetch("/api/rag/rag-assets", { credentials: "include" });
            if (!res.ok) return [];
            const d = await res.json();
            return d.assets || [];
        },
    });

    const { data: datasets = [] } = useQuery<any[]>({
        queryKey: ["/api/datasets"],
        queryFn: async () => {
            const res = await fetch("/api/datasets", { credentials: "include" });
            if (!res.ok) return [];
            return res.json();
        },
    });

    const { data: pipelines = [] } = useQuery<any[]>({
        queryKey: ["/api/pipelines"],
        queryFn: async () => {
            const res = await fetch("/api/pipelines", { credentials: "include" });
            if (!res.ok) return [];
            return res.json();
        },
    });

    const { data: machineTools = [] } = useQuery<any[]>({
        queryKey: ["/api/missions/tools"],
        queryFn: async () => {
            const res = await fetch("/api/missions/tools", { credentials: "include" });
            if (!res.ok) return [];
            const d = await res.json();
            return d.tools || [];
        },
    });

    const defaultForm = {
        jobId,
        slug: `agent-${jobId}`,
        title: "",
        description: "",
        welcomeMessage: "",
        isActive: false,
        accessPolicy: "public",
        password: "",
        brandingConfig: { logoUrl: "", avatarUrl: "", primaryColor: "#6366f1", theme: "dark" },
        allowedTopicIds: [] as number[],
        allowedDatasetIds: [] as number[],
        allowedPipelineIds: [] as number[],
        allowedTools: [] as string[],
        allowedFileTypes: [] as string[],
        maxFileSizeMb: 10,
        oceanTraits: { o: 50, c: 50, e: 50, a: 50, n: 50 },
        soulArchetype: "Lead Directive",
        embedConfig: {
            profileApiUrl: "",
            profileApiMethod: "GET",
            profileApiTimeoutMs: 5000,
            profileCacheTtlSeconds: 120,
            allowedEmbedOrigins: [] as string[],
            enableHttpRequest: false,
        },
    };

    const [form, setForm] = useState(defaultForm);

    React.useEffect(() => {
        if (deployment) {
            setForm({
                ...defaultForm,
                jobId,
                slug: deployment.slug || `agent-${jobId}`,
                title: deployment.title || "",
                description: deployment.description || "",
                welcomeMessage: deployment.welcomeMessage || "",
                isActive: deployment.isActive ?? false,
                accessPolicy: deployment.accessPolicy || "public",
                password: "",
                brandingConfig: deployment.brandingConfig || defaultForm.brandingConfig,
                allowedTopicIds: deployment.allowedTopicIds || [],
                allowedDatasetIds: deployment.allowedDatasetIds || [],
                allowedPipelineIds: deployment.allowedPipelineIds || [],
                allowedTools: deployment.allowedTools || [],
                allowedFileTypes: deployment.allowedFileTypes || [],
                maxFileSizeMb: deployment.maxFileSizeMb || 10,
                oceanTraits: deployment.oceanTraits || defaultForm.oceanTraits,
                soulArchetype: deployment.soulArchetype || "Lead Directive",
                embedConfig: deployment.embedConfig || defaultForm.embedConfig,
            });
        }
    }, [deployment, jobId]);

    // Apply primary color variable to container without inline style
    React.useEffect(() => {
        if (containerRef.current) {
            containerRef.current.style.setProperty('--brand-primary', form.brandingConfig?.primaryColor || '#6366f1');
        }
    }, [form.brandingConfig?.primaryColor]);

    // Apply preset colors to buttons
    React.useEffect(() => {
        presetButtonsRef.current.forEach((btn, color) => {
            if (btn) btn.style.setProperty('--preset-color', color);
        });
    }, []);

    const saveMutation = useMutation({
        mutationFn: async (data: typeof form) => {
            const payload: any = { ...data };
            if (!payload.password) delete payload.password;
            const res = await apiRequest("POST", "/api/agents/deploy", payload);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || "Failed to save deployment");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/agents/deployments/${jobId}`] });
            toast({ title: "Agent Deployed", description: "Publish settings synchronized." });
        },
        onError: (err: any) => {
            toast({ title: "Save Failed", description: err.message, variant: "destructive" });
        },
    });

    const avatarMutation = useMutation({
        mutationFn: async (file: File) => {
            const fd = new FormData();
            fd.append("avatar", file);
            const res = await fetch(`/api/agents/deployments/${jobId}/avatar`, {
                method: "POST",
                body: fd,
                credentials: "include",
            });
            if (!res.ok) throw new Error("Avatar upload failed");
            return res.json();
        },
        onSuccess: (data) => {
            setForm(f => ({ ...f, brandingConfig: { ...f.brandingConfig, avatarUrl: data.avatarUrl } }));
            toast({ title: "Avatar Updated" });
        },
    });

    const publicUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/a/${form.slug}`;

    const copyUrl = () => {
        navigator.clipboard.writeText(publicUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (isLoading) return (
        <div className="p-12 text-center text-[11px] uppercase font-black tracking-widest text-muted-foreground animate-pulse">
            Loading configuration...
        </div>
    );


    return (
        <div 
            ref={containerRef}
            className="space-y-6"
        >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* ── Left: main config ──────────────────────────────────── */}
                <div className="lg:col-span-2 space-y-6">

                    {/* Deployment Identity */}
                    <Card className="border-border shadow-md">
                        <CardHeader className="bg-muted/30 border-b py-4">
                            <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                <Globe className="w-3.5 h-3.5 text-primary" /> Public Identity
                            </CardTitle>
                            <CardDescription className="text-[10px]">Configure how this agent appears on its public landing page.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Public Slug</Label>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px] text-muted-foreground bg-muted px-2 py-2 rounded-md font-mono">/a/</span>
                                        <Input
                                            value={form.slug}
                                            onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))}
                                            placeholder="my-agent"
                                            className="font-mono text-sm"
                                            title="Deployment Slug"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Display Title</Label>
                                    <Input
                                        value={form.title}
                                        onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                                        placeholder="My Intelligent Agent"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Public Description</Label>
                                <Textarea
                                    value={form.description}
                                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                                    placeholder="Briefly describe what this agent does..."
                                    className="resize-none text-xs min-h-[72px]"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest opacity-60 flex items-center gap-1.5">
                                    <MessageSquare className="w-3 h-3" /> Welcome Message
                                </Label>
                                <Input
                                    value={form.welcomeMessage}
                                    onChange={e => setForm(f => ({ ...f, welcomeMessage: e.target.value }))}
                                    placeholder="Hi! How can I help you today?"
                                />
                                <p className="text-[10px] text-muted-foreground">Shown to the user before they send their first message.</p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Knowledge Scoping */}
                    <Card className="border-border shadow-md">
                        <CardHeader className="bg-muted/30 border-b py-4">
                            <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                <ShieldCheck className="w-3.5 h-3.5 text-primary" /> Knowledge & Tool Scoping
                            </CardTitle>
                            <CardDescription className="text-[10px]">Restrict what knowledge and pipelines this public deployment can access.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-6 space-y-4">
                            <div className="space-y-8">
                                <AgentKnowledgeConfig
                                    config={form}
                                    updateConfig={(key, val) => setForm(f => ({ ...f, [key]: val }))}
                                    isEditing={true}
                                    fieldMapping={{
                                        topicIds: 'allowedTopicIds',
                                        datasetIds: 'allowedDatasetIds',
                                        pipelineIds: 'allowedPipelineIds'
                                    }}
                                />

                                <Separator className="opacity-20" />

                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Wrench className="w-4 h-4 text-primary" />
                                        <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">System Tool Access Policy</Label>
                                    </div>
                                    <div className="p-6 rounded-2xl border bg-muted/20 backdrop-blur-sm">
                                        <AgentToolsSelector 
                                            config={form}
                                            updateConfig={(key, val) => setForm(f => ({ ...f, [key]: val }))}
                                            isEditing={true}
                                        />
                                    </div>
                                    <p className="text-[10px] text-muted-foreground italic px-2">
                                        Restricts which system tools this public deployment can invoke. Leave empty to allow all tools permitted by the foundational job config.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* File Restrictions */}
                    <Card className="border-border shadow-md">
                        <CardHeader className="bg-muted/30 border-b py-4">
                            <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                <FileType className="w-3.5 h-3.5 text-primary" /> File Upload Restrictions
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Allowed File Types</Label>
                                    <Input
                                        value={form.allowedFileTypes.join(", ")}
                                        onChange={e => setForm(f => ({
                                            ...f,
                                            allowedFileTypes: e.target.value.split(",").map(s => s.trim()).filter(Boolean)
                                        }))}
                                        placeholder="image/*, .pdf, .csv"
                                        className="font-mono text-xs"
                                    />
                                    <p className="text-[10px] text-muted-foreground">Comma-separated MIME types or extensions. Leave empty to allow all.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Max File Size (MB)</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={100}
                                        value={form.maxFileSizeMb}
                                        onChange={e => setForm(f => ({ ...f, maxFileSizeMb: parseInt(e.target.value) || 10 }))}
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Agent Personality (OCEAN) */}
                    <Card className="border-border shadow-xl bg-gradient-to-br from-background to-muted/10 overflow-hidden group">
                        <CardHeader className="bg-muted/30 border-b py-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-sm font-black uppercase tracking-[0.2em] flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                                            <Brain className="w-4 h-4 text-primary" />
                                        </div>
                                        Cognitive Architecture
                                    </CardTitle>
                                    <CardDescription className="text-[10px] uppercase font-bold tracking-widest opacity-40 mt-1">Behavioral Modelling & Soul Archetype</CardDescription>
                                </div>
                                <Badge variant="secondary" className="px-3 py-1 text-[10px] font-black uppercase tracking-widest border-primary/20">{form.soulArchetype}</Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-8 space-y-8">
                            <div className="space-y-4">
                                <Label className="text-[10px] font-black uppercase tracking-widest opacity-60 flex items-center gap-2">
                                    <Zap className="w-3 h-3 text-amber-500" /> Soul Archetype Template
                                </Label>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    {SOUL_ARCHETYPES.slice(0, 6).map(a => (
                                        <div
                                            key={a}
                                            className={cn(
                                                "p-3 rounded-xl border text-[10px] font-black uppercase tracking-widest cursor-pointer transition-all flex items-center justify-center text-center",
                                                form.soulArchetype === a 
                                                    ? "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/20" 
                                                    : "bg-muted/30 border-border hover:bg-muted/50"
                                            )}
                                            onClick={() => setForm(f => ({ ...f, soulArchetype: a }))}
                                        >
                                            {a}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <Separator className="opacity-10" />

                            <div className="space-y-6">
                                <Label className="text-[10px] font-black uppercase tracking-widest opacity-60 flex items-center gap-2">
                                    <Settings2 className="w-3 h-3 text-primary" /> Behavioral Trait Profile (OCEAN)
                                </Label>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                                    {(["o", "c", "e", "a", "n"] as const).map(key => {
                                        const info = OCEAN_LABELS[key];
                                        const val = (form.oceanTraits as any)[key] ?? 50;
                                        return (
                                            <div key={key} className="space-y-3 p-4 rounded-2xl bg-muted/20 border border-transparent hover:border-primary/20 transition-colors">
                                                <div className="flex items-center justify-between">
                                                    <div className="space-y-0.5">
                                                        <span className="text-[10px] font-black uppercase tracking-widest leading-none">{info.label}</span>
                                                        <p className="text-[9px] text-muted-foreground italic">Impacts {key === 'o' ? 'creativity' : key === 'c' ? 'precision' : key === 'e' ? 'engagement' : key === 'a' ? 'helpfulness' : 'sensitivity'}</p>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <Badge variant="outline" className="h-5 px-2 text-[10px] font-mono border-primary/30 bg-primary/5 text-primary">{val}%</Badge>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-[8px] font-bold opacity-30 uppercase">{info.low}</span>
                                                    <Slider
                                                        min={0}
                                                        max={100}
                                                        step={1}
                                                        value={[val]}
                                                        onValueChange={([v]) => setOcean(key, v)}
                                                        className="flex-1"
                                                    />
                                                    <span className="text-[8px] font-bold opacity-30 uppercase">{info.high}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </CardContent>
                        <div className="bg-primary/5 p-4 border-t border-primary/10 flex items-center justify-center">
                             <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-primary/60 italic text-center">
                                Neural weights reconfiguring in real-time based on profile
                             </p>
                        </div>
                    </Card>

                    {/* Embed API Config (advanced / collapsible) */}
                    <Card className="border-border shadow-md">
                        <CardHeader
                            className="bg-muted/30 border-b py-4 cursor-pointer select-none"
                            onClick={() => setShowEmbed(v => !v)}
                        >
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                    <Settings2 className="w-3.5 h-3.5 text-primary" /> Embed API Configuration
                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 ml-1">Advanced</Badge>
                                </CardTitle>
                                {showEmbed ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                            </div>
                            <CardDescription className="text-[10px]">Profile pre-fetch API, allowed embed origins, and http request tool access.</CardDescription>
                        </CardHeader>
                        {showEmbed && (
                            <CardContent className="p-6 space-y-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-60 flex items-center gap-1.5">
                                        <Link className="w-3 h-3" /> Profile API URL
                                    </Label>
                                    <Input
                                        value={form.embedConfig.profileApiUrl}
                                        onChange={e => setEmbed("profileApiUrl", e.target.value)}
                                        placeholder="https://your-api.com/profile"
                                        className="font-mono text-xs"
                                    />
                                    <p className="text-[10px] text-muted-foreground">Called at session start to fetch user context for personalisation.</p>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Method</Label>
                                        <Select value={form.embedConfig.profileApiMethod || "GET"} onValueChange={v => setEmbed("profileApiMethod", v)}>
                                            <SelectTrigger className="text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="GET">GET</SelectItem>
                                                <SelectItem value="POST">POST</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Timeout (ms)</Label>
                                        <Input
                                            type="number"
                                            value={form.embedConfig.profileApiTimeoutMs}
                                            onChange={e => setEmbed("profileApiTimeoutMs", parseInt(e.target.value) || 5000)}
                                            className="text-xs"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Cache TTL (s)</Label>
                                        <Input
                                            type="number"
                                            min={0}
                                            max={300}
                                            value={form.embedConfig.profileCacheTtlSeconds}
                                            onChange={e => setEmbed("profileCacheTtlSeconds", parseInt(e.target.value) || 0)}
                                            className="text-xs"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Allowed Embed Origins</Label>
                                    <Input
                                        value={(form.embedConfig.allowedEmbedOrigins || []).join(", ")}
                                        onChange={e => setEmbed("allowedEmbedOrigins", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                                        placeholder="https://yoursite.com, https://app.yoursite.com"
                                        className="font-mono text-xs"
                                    />
                                    <p className="text-[10px] text-muted-foreground">Origins permitted to send postMessage credentials to the embed.</p>
                                </div>
                                <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                                    <div className="space-y-0.5">
                                        <Label className="text-[10px] font-black uppercase tracking-widest">Enable http request Tool</Label>
                                        <p className="text-[10px] text-muted-foreground">Allow agent to make outbound HTTP calls (subject to org allowlist).</p>
                                    </div>
                                    <Switch
                                        checked={form.embedConfig.enableHttpRequest}
                                        onCheckedChange={v => setEmbed("enableHttpRequest", v)}
                                    />
                                </div>
                            </CardContent>
                        )}
                    </Card>

                    {/* Branding */}
                    <Card className="border-border shadow-md">
                        <CardHeader className="bg-muted/30 border-b py-4">
                            <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                <Palette className="w-3.5 h-3.5 text-primary" /> Branding
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Brand Primary (HEX)</Label>
                                    <div className="flex gap-2">
                                        <div className="w-10 h-10 rounded-xl border border-border flex-shrink-0 shadow-inner group relative overflow-hidden bg-[var(--brand-primary)]" 
                                             title="Brand Primary Color Preview">
                                            <input 
                                                type="color" 
                                                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                                value={form.brandingConfig?.primaryColor || '#6366f1'}
                                                onChange={e => setBranding('primaryColor', e.target.value)}
                                                title="Select Brand Color"
                                            />
                                        </div>
                                        <Input 
                                            value={form.brandingConfig?.primaryColor || '#6366f1'}
                                            onChange={e => setBranding('primaryColor', e.target.value)}
                                            placeholder="#6366f1"
                                            className="font-mono text-xs h-10"
                                            title="Brand Color Hex Code"
                                        />
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                        {['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6'].map(color => (
                                            <button
                                                key={color}
                                                ref={el => {
                                                    if (el) presetButtonsRef.current.set(color, el);
                                                }}
                                                type="button"
                                                title={`Select ${color} theme`}
                                                className={cn(
                                                    "w-5 h-5 rounded-full border border-foreground/20 transition-transform hover:scale-110 bg-[var(--preset-color)]",
                                                    form.brandingConfig?.primaryColor === color && "ring-2 ring-primary ring-offset-1"
                                                )}
                                                onClick={() => setBranding('primaryColor', color)}
                                            />
                                        ))}
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Interface Theme</Label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {['dark', 'light'].map(t => (
                                            <button
                                                key={t}
                                                className={cn(
                                                    "p-2 rounded-xl border text-[10px] uppercase font-bold tracking-widest transition-all",
                                                    form.brandingConfig?.theme === t 
                                                        ? "bg-primary text-primary-foreground border-primary" 
                                                        : "bg-muted/30 border-border hover:bg-muted/50"
                                                )}
                                                onClick={() => setForm(f => ({ 
                                                    ...f, 
                                                    brandingConfig: { ...f.brandingConfig, theme: t } 
                                                }))}
                                            >
                                                {t} Mode
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Avatar */}
                            <Separator className="opacity-20" />
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Agent Avatar & Identity</Label>
                                <div className="flex items-center gap-4 p-4 rounded-2xl bg-muted/20 border border-dashed border-border/50">
                                    <div className="w-16 h-16 rounded-full border-2 border-primary/20 overflow-hidden bg-muted flex items-center justify-center shadow-lg group relative">
                                        {form.brandingConfig?.avatarUrl ? (
                                            <img src={form.brandingConfig.avatarUrl} className="w-full h-full object-cover" alt="avatar" />
                                        ) : (
                                            <Cpu className="w-8 h-8 text-muted-foreground/40" />
                                        )}
                                        <div 
                                            className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer"
                                            onClick={() => avatarInputRef.current?.click()}
                                        >
                                            <Upload className="w-4 h-4 text-foreground" />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5 flex-1">
                                        <h4 className="text-xs font-bold uppercase tracking-tight">{form.title || 'Untitled Agent'}</h4>
                                        <p className="text-[9px] text-muted-foreground leading-relaxed italic">{form.description || 'No public description set'}</p>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-[9px] font-black uppercase tracking-widest h-6 px-0 hover:bg-transparent hover:text-primary"
                                            onClick={() => avatarInputRef.current?.click()}
                                            disabled={avatarMutation.isPending}
                                        >
                                            Change Manifestation
                                        </Button>
                                    </div>
                                    <input
                                        ref={avatarInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        title="Avatar Image Upload"
                                        onChange={e => {
                                            const file = e.target.files?.[0];
                                            if (file) avatarMutation.mutate(file);
                                        }}
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* ── Right: status sidebar ──────────────────────────────── */}
                <div className="space-y-6">

                    {/* Appearance Mockup (Live Preview) */}
                    <Card className="border-border shadow-2xl overflow-hidden bg-background text-foreground">
                        <div className="h-24 bg-gradient-to-br from-primary/20 via-transparent to-transparent relative p-4 border-b border-foreground/5">
                            <div className="absolute top-4 right-4 flex gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-red-500/30" />
                                <div className="w-2 h-2 rounded-full bg-amber-500/30" />
                                <div className="w-2 h-2 rounded-full bg-emerald-500/30" />
                            </div>
                            <div className="flex items-center gap-3 mt-4">
                                <div className="w-10 h-10 rounded-full bg-muted/20 border border-foreground/10 flex items-center justify-center overflow-hidden">
                                     {form.brandingConfig?.avatarUrl ? (
                                        <img src={form.brandingConfig.avatarUrl} className="w-full h-full object-cover" alt="Agent Preview Avatar" />
                                    ) : <Cpu className="w-5 h-5 text-foreground/20" />}
                                </div>
                                <div className="space-y-0.5">
                                    <p className="text-[10px] font-black uppercase tracking-widest leading-none text-[var(--brand-primary)]">{form.title || 'Agent Name'}</p>
                                    <p className="text-[8px] opacity-40 uppercase font-bold tracking-tighter">Operational Profile</p>
                                </div>
                            </div>
                        </div>
                        <CardContent className="p-4 space-y-3">
                            <div className="p-3 rounded-xl bg-foreground/5 border border-foreground/5 space-y-1">
                                <p className="text-[8px] text-foreground/40 uppercase font-black tracking-widest">Description</p>
                                <p className="text-[10px] leading-relaxed opacity-80 line-clamp-2">{form.description || 'Public description will appear here...'}</p>
                            </div>
                            <div className="space-y-1.5">
                                <div className="w-full h-8 rounded-lg bg-foreground/5 border border-foreground/5 flex items-center px-3 justify-between">
                                    <span className="text-[9px] opacity-30 italic">Ask anything...</span>
                                    <div className="w-4 h-4 rounded bg-[var(--brand-primary)] opacity-20" title="Brand Accent Preview" />
                                </div>
                            </div>
                            <div className="pt-2 flex justify-center">
                                <Badge variant="outline" className="text-[7px] border-foreground/10 opacity-30 h-4 uppercase font-bold">Powered by Titan Oddjob</Badge>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Status & Save */}
                    <Card className="border-primary/20 bg-primary/5 shadow-[0_0_20px_rgba(var(--primary),0.05)]">
                        <CardHeader className="py-4">
                            <CardTitle className="text-xs font-black uppercase tracking-widest">Publish Status</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="text-[10px] font-black uppercase tracking-widest">Live</Label>
                                    <p className="text-[10px] text-muted-foreground">Activate the public endpoint.</p>
                                </div>
                                <Switch
                                    checked={form.isActive}
                                    onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
                                />
                            </div>
                            {form.isActive && (
                                <div className="space-y-2 pt-2 border-t">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Public URL</Label>
                                    <div className="flex items-center gap-2">
                                        <Input readOnly value={publicUrl} className="text-xs font-mono h-8" />
                                        <Button size="icon" variant="outline" onClick={copyUrl} className="shrink-0 h-8 w-8">
                                            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                                        </Button>
                                    </div>
                                    <Button variant="link" size="sm" className="p-0 h-auto text-[10px] text-primary" asChild>
                                        <a href={publicUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-black uppercase tracking-widest">
                                            Visit <ExternalLink className="w-3 h-3" />
                                        </a>
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                        <CardFooter>
                            <Button
                                className="w-full font-black uppercase tracking-widest text-[10px] h-10 shadow-[0_5px_15px_-5px_rgba(var(--primary),0.4)]"
                                onClick={() => saveMutation.mutate(form)}
                                disabled={saveMutation.isPending}
                            >
                                {saveMutation.isPending ? (
                                    <span className="flex items-center gap-2">
                                        <Zap className="w-3 h-3 animate-pulse" /> Synchronizing...
                                    </span>
                                ) : "Save Deployment"}
                            </Button>
                        </CardFooter>
                    </Card>

                    {/* Access Control */}
                    <Card className="border-border shadow-md">
                        <CardHeader className="py-4">
                            <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                <Shield className="w-3.5 h-3.5 text-primary" /> Access Control
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2.5">
                            {[
                                { value: "public", icon: Globe, color: "text-blue-500", label: "Public", desc: "Open link access." },
                                { value: "password", icon: Lock, color: "text-amber-500", label: "Protected", desc: "Passphrase required." },
                                { value: "internal_only", icon: ShieldCheck, color: "text-emerald-500", label: "Internal", desc: "Logged-in users only." },
                            ].map(({ value, icon: Icon, color, label, desc }) => (
                                <div
                                    key={value}
                                    className={cn(
                                        "p-2.5 border rounded-xl cursor-pointer transition-all",
                                        form.accessPolicy === value ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "hover:bg-muted/50"
                                    )}
                                    onClick={() => setForm(f => ({ ...f, accessPolicy: value }))}
                                >
                                    <div className="flex items-center gap-2">
                                        <Icon className={cn("w-3 h-3", color)} />
                                        <span className="text-[10px] font-black uppercase tracking-tight">{label}</span>
                                    </div>
                                    <p className="text-[9px] text-muted-foreground mt-0.5 ml-5 leading-tight">{desc}</p>
                                </div>
                            ))}
                            {form.accessPolicy === "password" && (
                                <div className="space-y-2 pt-2 animate-in slide-in-from-top-2 duration-300">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Access Password</Label>
                                    <Input
                                        type="password"
                                        placeholder="Enter passphrase..."
                                        value={form.password}
                                        onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                                        className="h-9 text-xs"
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
