import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@domain-ui/core/ui/components/ui/card';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { ShieldCheck, Cpu, BrainCircuit, Hash, Link as LinkIcon, Sparkles, Activity, Blocks, Database, Bot, Workflow, Folder } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import type { AppDeployment } from "@shared/schema/apps";
import type { Pipeline } from "@shared/schema/pipelines/pipeline-core";
import type { OceanTraits } from "@shared/schema/agent-deployments";
import { SoulConfigPanel, SoulArchetypeSelector } from "@domain-ui/ai/ui/modules/agent-ai";
import { MultiSelectDatasetPicker, MultiSelectAgentPicker, MultiSelectPipelinePicker, TagInput } from "@domain-ui/apps/ui/components/pickers";

interface AppHookupsTabProps {
    appId: number;
    appSlug?: string;
}

export function AppHookupsTab({ appId, appSlug }: AppHookupsTabProps) {
    const { toast } = useToast();

    // Fetch deployment settings
    const { data: deployment, isLoading: isLoadingDeployment, isError: isDeploymentError } = useQuery<AppDeployment | null>({
        queryKey: [`/api/apps/${appId}/deploy`],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/deploy`);
            if (res.status === 404) return null; // No deployment record yet — form shows defaults
            if (!res.ok) throw new Error(`Failed to load configuration (${res.status})`);
            return res.json();
        }
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

    const mutation = useMutation({
        mutationFn: async (data: Partial<AppDeployment>) => {
            const res = await apiRequest("POST", `/api/apps/${appId}/deploy`, data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/apps/${appId}/deploy`] });
            toast({
                title: "Success",
                description: "App configuration updated.",
            });
        },
        onError: (error: any) => {
            toast({
                title: "Error",
                description: error.message || "Failed to update configuration.",
                variant: "destructive"
            });
        }
    });

    const [form, setForm] = useState<Partial<AppDeployment>>({});

    // Sync form with data when loaded
    React.useEffect(() => {
        if (deployment) {
            setForm({
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
                allowedDatasetIds: (deployment as any).allowedDatasetIds || [],
                allowedAgentIds: (deployment as any).allowedAgentIds || [],
                allowedPipelineIds: (deployment as any).allowedPipelineIds || [],
                defaultCollections: (deployment as any).defaultCollections || [],
            });
        }
    }, [deployment]);

    const handleSave = () => {
        mutation.mutate(form);
    };

    if (isLoadingDeployment) return <div className="p-8 text-center">Loading configuration...</div>;
    if (isDeploymentError) return <div className="p-8 text-center text-destructive">Failed to load configuration. Please refresh and try again.</div>;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-6 flex flex-col justify-between">
                    <Card className="flex-1 bg-card/40 border-foreground/10 backdrop-blur-xl">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <LinkIcon className="h-5 w-5 text-blue-500" /> Pipeline Chaining & Handoff
                            </CardTitle>
                            <CardDescription>Automatically trigger follow-up pipelines.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-3">
                                <Label htmlFor="nextPipelineId" className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-primary/70">
                                    <Cpu className="h-3.5 w-3.5" /> Trigger Next Pipeline
                                </Label>
                                <Select
                                    value={form.nextPipelineId?.toString() || "none"}
                                    onValueChange={(val) => setForm({ ...form, nextPipelineId: val === "none" ? null : parseInt(val) } as any)}
                                >
                                    <SelectTrigger id="nextPipelineId" className="bg-background/20 border-foreground/5 h-11 text-sm">
                                        <SelectValue placeholder="Select pipeline to chain" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Disabled (No Chaining)</SelectItem>
                                        {pipelines.map(p => (
                                            <SelectItem key={p.id} value={p.id.toString()}>
                                                {p.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-[10px] text-muted-foreground italic font-medium">Handoff result to this pipeline upon mission success.</p>
                            </div>

                            <div className="p-4 rounded-2xl bg-foreground/5 border border-foreground/5 space-y-3">
                                <div className="flex items-center gap-2">
                                    <Activity className="w-3.5 h-3.5 text-blue-500" />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Autonomous Continuity</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground leading-relaxed">
                                    Enabling chain-of-thought persistence across disparate pipeline runtimes for high-fidelity state tracking.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-6">
                    <Card className="bg-card/40 border-foreground/10 backdrop-blur-xl">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Hash className="h-5 w-5 text-emerald-500" /> Integrations & Webhooks
                            </CardTitle>
                            <CardDescription>Dispatch events to external triggers.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="webhookType" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Target Type</Label>
                                    <Select
                                        value={(form as any).webhookType || "generic"}
                                        onValueChange={(val) => setForm({ ...form, webhookType: val } as any)}
                                    >
                                        <SelectTrigger id="webhookType" className="bg-background/20 border-foreground/5 h-10">
                                            <SelectValue placeholder="Select type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="generic">Generic (Zapier/Make)</SelectItem>
                                            <SelectItem value="slack">Slack Incoming</SelectItem>
                                            <SelectItem value="discord">Discord Webhook</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="webhookUrl" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Webhook URL</Label>
                                    <Input
                                        id="webhookUrl"
                                        value={form.webhookUrl || ""}
                                        onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
                                        placeholder="https://..."
                                        className="bg-background/20 border-foreground/5 h-10"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="webhookSecret" className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                    HMAC Signing Secret
                                </Label>
                                <Input
                                    id="webhookSecret"
                                    type="password"
                                    value={(form as any).webhookSecret || ""}
                                    onChange={(e) => setForm({ ...form, webhookSecret: e.target.value } as any)}
                                    placeholder="Optional HMAC secret"
                                    className="bg-background/20 border-foreground/5 h-10"
                                />
                            </div>
                        </CardContent>
                        <CardFooter className="pt-6 border-t border-foreground/5">
                            <Button className="w-full h-11 shadow-lg shadow-primary/20 font-black uppercase tracking-widest italic text-xs" onClick={handleSave} disabled={mutation.isPending}>
                                {mutation.isPending ? "Syncing..." : "Save Service Hookups"}
                            </Button>
                        </CardFooter>
                    </Card>
                </div>
            </div>

            {/* ─── Platform Resource Access Section ───────────────────────────────── */}
            <Card className="bg-card/40 border-foreground/10 backdrop-blur-xl">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-primary/10 rounded-lg">
                            <Blocks className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <CardTitle>Platform Resource Access</CardTitle>
                            <CardDescription>
                                Configure which Oddjob platform resources this app can access. Used to populate platformContext during forge.
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Datasets */}
                        <div className="space-y-3">
                            <Label className="text-sm font-semibold flex items-center gap-2">
                                <Database className="w-4 h-4 text-blue-400" />
                                Allowed Datasets
                            </Label>
                            <MultiSelectDatasetPicker
                                selected={(form as any).allowedDatasetIds || []}
                                onChange={(ids) => setForm({ ...form, allowedDatasetIds: ids } as any)}
                                placeholder="Select datasets this app can access..."
                            />
                            <p className="text-xs text-muted-foreground">
                                These populate <code className="text-primary">platformContext.allowedDatasetIds</code> for the AI
                            </p>
                        </div>

                        {/* Agents */}
                        <div className="space-y-3">
                            <Label className="text-sm font-semibold flex items-center gap-2">
                                <Bot className="w-4 h-4 text-amber-400" />
                                Available Agents
                            </Label>
                            <MultiSelectAgentPicker
                                selected={(form as any).allowedAgentIds || []}
                                onChange={(ids) => setForm({ ...form, allowedAgentIds: ids } as any)}
                                placeholder="Select agents for chat blocks..."
                            />
                            <p className="text-xs text-muted-foreground">
                                Agents available for PlatformAgentChatBlock
                            </p>
                        </div>

                        {/* Pipelines */}
                        <div className="space-y-3">
                            <Label className="text-sm font-semibold flex items-center gap-2">
                                <Workflow className="w-4 h-4 text-emerald-400" />
                                Pipelines This App Can Trigger
                            </Label>
                            <MultiSelectPipelinePicker
                                selected={(form as any).allowedPipelineIds || []}
                                onChange={(ids) => setForm({ ...form, allowedPipelineIds: ids } as any)}
                                placeholder="Select pipelines this app can trigger..."
                            />
                            <p className="text-xs text-muted-foreground">
                                Runtime permission for app UI blocks that invoke existing pipelines
                            </p>
                        </div>

                        {/* Default Collections */}
                        <div className="space-y-3">
                            <Label className="text-sm font-semibold flex items-center gap-2">
                                <Folder className="w-4 h-4 text-purple-400" />
                                Default Dataset Collections
                            </Label>
                            <TagInput
                                value={(form as any).defaultCollections || []}
                                onChange={(tags) => setForm({ ...form, defaultCollections: tags } as any)}
                                placeholder="Type collection name and press Enter..."
                                suggestionSource="datasets"
                            />
                            <p className="text-xs text-muted-foreground">
                                These populate <code className="text-primary">platformContext.defaultCollections</code> for PlatformDatasetTableBlock
                            </p>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="pt-6 border-t border-foreground/5">
                    <Button 
                        className="w-full h-11 shadow-lg shadow-primary/20 font-black uppercase tracking-widest italic text-xs" 
                        onClick={handleSave} 
                        disabled={mutation.isPending}
                    >
                        {mutation.isPending ? "Saving..." : "Save Platform Access"}
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}

