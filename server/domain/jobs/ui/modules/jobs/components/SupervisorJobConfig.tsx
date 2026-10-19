import { useState, useMemo } from 'react';
import { Card, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { 
    UserCog, 
    Sparkles, 
    Brain, 
    Hammer, 
    Info, 
    Key, 
    ShieldCheck, 
    Network, 
    Cpu, 
    Settings2, 
    Layers, 
    Zap, 
    Activity, 
    ChevronRight,
    GripVertical,
    Target,
    Fingerprint,
    Boxes,
    Search
} from 'lucide-react';
import type { SupervisorJobConfig, Credential } from '@shared/schema/index.js';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Slider } from '@domain-ui/core/ui/components/ui/slider';
import FileStorageConfig from './FileStorageConfig.js';
import { cn } from '@/lib/utils';
import "./jobs-components.css";

interface SupervisorJobConfigProps {
    config: SupervisorJobConfig;
    onChange: (config: SupervisorJobConfig) => void;
    pipelines?: { id: number; name: string }[];
    disabled?: boolean;
}

export default function SupervisorJobConfig({
    config,
    onChange,
    pipelines = [],
    disabled
}: SupervisorJobConfigProps) {
    const [activeTab, setActiveTab] = useState("strategy");

    const updateConfig = (updates: Partial<SupervisorJobConfig>) => {
        onChange({
            ...config,
            ...updates,
        });
    };

    const { data: credentials = [] } = useQuery<Credential[]>({
        queryKey: ['/api/credentials'],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/credentials");
            return res.json();
        }
    });

    const aiCredentials = credentials.filter(c => c.type === 'ai_provider');

    const { data: capabilities, isLoading: loadingCapabilities } = useQuery<any[]>({
        queryKey: ['/api/pipelines/capabilities', Array.isArray(config.allowedPipelines) ? config.allowedPipelines.join(',') : ''],
        queryFn: async () => {
            if (!Array.isArray(config.allowedPipelines) || config.allowedPipelines.length === 0) return [];
            const res = await apiRequest('GET', `/api/pipelines/capabilities?ids=${config.allowedPipelines.join(',')}`);
            return res.json();
        },
        enabled: Array.isArray(config.allowedPipelines) && config.allowedPipelines.length > 0,
    });

    // Aggregate unique specialized traits across all pipelines
    const aggregatedCapabilities = useMemo(() => {
        if (!capabilities) return { tools: [], knowledge: [], specialties: [] };
        const tools = new Set();
        const knowledge = new Set();
        const specialties = new Set();
        
        capabilities.forEach(cap => {
            cap.tools?.forEach((t: any) => tools.add(t.name));
            cap.knowledgeTopics?.forEach((k: string) => knowledge.add(k));
            cap.specialties?.forEach((s: string) => specialties.add(s));
        });

        return {
            tools: Array.from(tools),
            knowledge: Array.from(knowledge),
            specialties: Array.from(specialties)
        };
    }, [capabilities]);

    return (
        <div className="flex bg-background/40 backdrop-blur-2xl h-full min-h-[750px] rounded-2xl overflow-hidden border border-foreground/5 divide-x divide-white/5 animate-in fade-in zoom-in duration-700">
            {/* Left Column: Command & Control Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
                <div className="p-4 border-b border-foreground/5 bg-foreground/5 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-amber-500" />
                        <span className="text-xs font-black uppercase tracking-[0.2em] text-foreground/80">Command Authority Interface</span>
                    </div>
                    <div className="flex gap-2">
                        <Badge variant="outline" className="h-6 text-[9px] font-black uppercase tracking-widest bg-amber-500/10 text-amber-500 border-amber-500/20 shadow-[0_0_15px_-5px_rgba(245,158,11,0.3)]">
                            Multi-Agent Active
                        </Badge>
                    </div>
                </div>

                <div className="flex-1">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-full flex flex-col">
                        <div className="px-6 pt-6">
                            <TabsList className="bg-background/40 border border-foreground/5 h-11 p-1 flex gap-1 rounded-xl">
                                <TabsTrigger value="strategy" className="flex-1 flex items-center gap-2 text-[10px] uppercase font-black tracking-widest data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-500 transition-all duration-300 rounded-lg">
                                    <Target className="w-3.5 h-3.5" /> Strategy
                                </TabsTrigger>
                                <TabsTrigger value="delegation" className="flex-1 flex items-center gap-2 text-[10px] uppercase font-black tracking-widest data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-500 transition-all duration-300 rounded-lg">
                                    <Network className="w-3.5 h-3.5" /> Delegation
                                </TabsTrigger>
                                <TabsTrigger value="governance" className="flex-1 flex items-center gap-2 text-[10px] uppercase font-black tracking-widest data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-500 transition-all duration-300 rounded-lg">
                                    <ShieldCheck className="w-3.5 h-3.5" /> Governance
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-8">
                            <TabsContent value="strategy" className="m-0 space-y-8 focus-visible:ring-0">
                                <section className="space-y-4">
                                    <div className="flex items-center gap-2 px-1">
                                        <Zap className="w-4 h-4 text-amber-500" />
                                        <Label className="text-[11px] font-black uppercase tracking-widest">Primary Objective (Intent)</Label>
                                    </div>
                                    <div className="relative group">
                                        <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-500/20 to-transparent rounded-2xl blur opacity-30 group-hover:opacity-100 transition duration-1000 group-hover:duration-200" />
                                        <Textarea
                                            value={config.intent || ''}
                                            onChange={(e) => updateConfig({ intent: e.target.value })}
                                            placeholder="Define the high-level mission goal..."
                                            className="relative min-h-[120px] bg-background/40 border-foreground/5 rounded-2xl text-[13px] leading-relaxed focus:border-amber-500/50 resize-none"
                                            disabled={disabled}
                                        />
                                    </div>
                                </section>

                                <div className="grid grid-cols-2 gap-6">
                                    <section className="space-y-3">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2 px-1">
                                            <Key className="w-3 h-3" /> AI Provider
                                        </Label>
                                        <Select
                                            value={config.credentialId?.toString()}
                                            onValueChange={(val) => updateConfig({ credentialId: parseInt(val) })}
                                            disabled={disabled}
                                        >
                                            <SelectTrigger className="h-10 bg-background/40 border-foreground/5 text-xs font-bold rounded-xl">
                                                <SelectValue placeholder="Select Provider" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-background/90 border-foreground/10">
                                                {aiCredentials.map((c) => (
                                                    <SelectItem key={c.id} value={c.id.toString()}>
                                                        <span className="text-[11px]">{c.name}</span>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </section>

                                    <section className="space-y-3">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2 px-1">
                                            <Cpu className="w-3 h-3" /> Core Model
                                        </Label>
                                        <Input
                                            value={config.model || 'gpt-4-turbo'}
                                            onChange={(e) => updateConfig({ model: e.target.value })}
                                            placeholder="gpt-4-turbo"
                                            disabled={disabled}
                                            className="h-10 bg-background/40 border-foreground/5 text-xs font-mono font-bold rounded-xl"
                                        />
                                    </section>
                                </div>

                                <section className="space-y-4">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2 px-1">
                                        <Fingerprint className="w-3 h-3" /> Authority Persona (System Prompt)
                                    </Label>
                                    <Textarea
                                        value={config.systemPrompt || ''}
                                        onChange={(e) => updateConfig({ systemPrompt: e.target.value })}
                                        placeholder="Guide the supervisor's reasoning constraints or personality..."
                                        className="min-h-[100px] bg-background/20 border-foreground/5 rounded-2xl text-[12px] italic text-muted-foreground/80 focus:border-amber-500/30"
                                        disabled={disabled}
                                    />
                                </section>
                            </TabsContent>

                            <TabsContent value="delegation" className="m-0 space-y-8 animate-in slide-in-from-right-4">
                                <section className="space-y-4">
                                    <div className="flex items-center justify-between px-1">
                                        <Label className="text-[11px] font-black uppercase tracking-widest">Delegated Agent Council</Label>
                                        <Badge variant="outline" className="text-[9px] bg-amber-500/5 text-amber-500 border-amber-500/20">
                                            {(config.allowedPipelines || []).length} Agents Authorized
                                        </Badge>
                                    </div>
                                    <div className="grid grid-cols-1 gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                        {pipelines.map(p => {
                                            const isSelected = Array.isArray(config.allowedPipelines) && config.allowedPipelines.includes(p.id);
                                            return (
                                                <div 
                                                    key={p.id} 
                                                    onClick={() => {
                                                        if (disabled) return;
                                                        const current = Array.isArray(config.allowedPipelines) ? config.allowedPipelines : [];
                                                        if (isSelected) {
                                                            updateConfig({ allowedPipelines: current.filter(id => id !== p.id) });
                                                        } else {
                                                            updateConfig({ allowedPipelines: [...current, p.id] });
                                                        }
                                                    }}
                                                    className={cn(
                                                        "flex items-center gap-4 p-4 rounded-2xl border transition-all cursor-pointer group",
                                                        isSelected 
                                                            ? "bg-amber-500/10 border-amber-500/30 shadow-[0_0_20px_-10px_rgba(245,158,11,0.2)]" 
                                                            : "bg-foreground/[0.02] border-foreground/5 hover:bg-foreground/[0.05] opacity-60 hover:opacity-100"
                                                    )}
                                                >
                                                    <div className={cn(
                                                        "w-10 h-10 rounded-xl border flex items-center justify-center transition-all",
                                                        isSelected ? "bg-amber-500/20 border-amber-500/40 text-amber-500" : "bg-foreground/5 border-foreground/10 text-muted-foreground group-hover:text-amber-500/60"
                                                    )}>
                                                        <UserCog className="w-5 h-5" />
                                                    </div>
                                                    <div className="flex-1 space-y-1">
                                                        <p className="text-[11px] font-black uppercase tracking-widest">{p.name}</p>
                                                        <p className="text-[9px] text-muted-foreground/60 italic">Automated Mission Specialist</p>
                                                    </div>
                                                    <div className={cn(
                                                        "w-5 h-5 rounded-full border flex items-center justify-center transition-all",
                                                        isSelected ? "bg-amber-500 border-amber-500 text-background" : "border-foreground/20"
                                                    )}>
                                                        {isSelected && <Zap className="w-3 h-3 fill-current" />}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </section>

                                {loadingCapabilities ? (
                                    <div className="p-8 border border-foreground/5 rounded-3xl bg-background/20 flex flex-col items-center justify-center gap-4 animate-pulse">
                                        <Activity className="w-8 h-8 text-amber-500/40" />
                                        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-muted-foreground/40">Synchronizing Capability Matrix...</p>
                                    </div>
                                ) : aggregatedCapabilities.tools.length > 0 && (
                                    <section className="p-6 rounded-3xl border border-amber-500/10 bg-amber-500/[0.02] space-y-4 animate-in fade-in zoom-in duration-700">
                                        <div className="flex items-center gap-2 px-1">
                                            <Sparkles className="w-4 h-4 text-amber-500" />
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-amber-700/80">Inherited Authority Silos</Label>
                                        </div>
                                        <div className="grid gap-4">
                                            <div className="flex flex-wrap gap-2">
                                                {(aggregatedCapabilities.specialties as string[]).map(s => (
                                                    <Badge key={s} variant="outline" className="text-[8px] bg-amber-500/5 text-amber-600 border-amber-500/20 px-2 h-5">
                                                        {s}
                                                    </Badge>
                                                ))}
                                                {(aggregatedCapabilities.knowledge as string[]).map(k => (
                                                    <Badge key={k} variant="outline" className="text-[8px] bg-blue-500/5 text-blue-400 border-blue-500/20 px-2 h-5">
                                                        <Brain className="w-2.5 h-2.5 mr-1" /> {k}
                                                    </Badge>
                                                ))}
                                                {(aggregatedCapabilities.tools as string[]).map(t => (
                                                    <Badge key={t} variant="outline" className="text-[8px] bg-emerald-500/5 text-emerald-400 border-emerald-500/20 px-2 h-5">
                                                        <Hammer className="w-2.5 h-2.5 mr-1" /> {t}
                                                    </Badge>
                                                ))}
                                            </div>
                                            <p className="text-[9px] text-muted-foreground leading-relaxed italic border-t border-foreground/5 pt-3">
                                                <Info className="w-3 h-3 inline mr-2 text-amber-500/60" />
                                                These traits represent the sovereign power collective of your authorized agent council.
                                            </p>
                                        </div>
                                    </section>
                                )}
                            </TabsContent>

                            <TabsContent value="governance" className="m-0 space-y-8 animate-in slide-in-from-bottom-4">
                                <div className="p-6 rounded-3xl border border-foreground/5 bg-background/20 space-y-8">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-1">
                                            <Label className="text-[11px] font-black uppercase tracking-widest">Plan Approval Protocol</Label>
                                            <p className="text-[9px] text-muted-foreground italic">Enforce human verification of mission strategy before execution.</p>
                                        </div>
                                        <Switch
                                            checked={config.requirePlanApproval ?? false}
                                            onCheckedChange={(v) => updateConfig({ requirePlanApproval: v })}
                                            disabled={disabled}
                                            className="data-[state=checked]:bg-amber-500"
                                        />
                                    </div>

                                    <div className="space-y-4 pt-4 border-t border-foreground/5">
                                        <div className="flex justify-between items-center px-1">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/80">Command Latitude (Max Steps)</Label>
                                            <span className="text-xs font-black text-amber-500 font-mono bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">
                                                {config.maxSteps || 10} ITER
                                            </span>
                                        </div>
                                        <Slider 
                                            min={1} max={50} step={1}
                                            value={[config.maxSteps || 10]}
                                            onValueChange={([v]) => updateConfig({ maxSteps: v })}
                                            disabled={disabled}
                                        />
                                        <p className="text-[9px] text-muted-foreground/40 text-center italic">Limits recursion depth to prevent autonomous loop cycles.</p>
                                    </div>
                                </div>

                                <section className="p-6 rounded-3xl border border-foreground/5 bg-foreground/[0.02]">
                                    <FileStorageConfig
                                        saveOutputToFile={config.saveOutputToFile || false}
                                        screenshotDirectory={config.screenshotDirectory}
                                        onSaveOutputChange={(v) => updateConfig({ saveOutputToFile: v })}
                                        onDirectoryChange={(v) => updateConfig({ screenshotDirectory: v })}
                                    />
                                </section>
                            </TabsContent>
                        </div>
                    </Tabs>
                </div>
            </div>

            {/* Right Column: Authority Manifestation */}
            <div className="w-[38%] bg-background/60 flex flex-col h-full sticky top-0 relative">
                <div className="p-4 border-b border-foreground/5 bg-foreground/5 flex items-center justify-between backdrop-blur-md">
                    <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-amber-500" />
                        <span className="text-xs font-black uppercase tracking-[0.2em] text-foreground/80">Authority Manifestation</span>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar relative p-8">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(245,158,11,0.03),transparent)] pointer-events-none" />
                    
                    <div className="relative z-10 flex flex-col items-center gap-8 py-10">
                        {/* Supervisor Node */}
                        <div className="relative group">
                            <div className="absolute -inset-4 bg-amber-500/20 rounded-full blur-xl opacity-20 animate-pulse" />
                            <div className="w-20 h-20 rounded-3xl bg-background border-2 border-amber-500/40 flex items-center justify-center shadow-[0_0_30px_-5px_rgba(245,158,11,0.3)] relative z-10 transition-transform duration-700 hover:scale-110">
                                <UserCog className="w-10 h-10 text-amber-500" />
                            </div>
                            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-amber-500 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md shadow-lg">
                                Master
                            </div>
                        </div>

                        {/* Connection Bridge */}
                        <div className="w-px h-12 bg-gradient-to-b from-amber-500/40 via-amber-500/10 to-transparent" />

                        {/* Delegated Workers */}
                        <div className="w-full space-y-4">
                            {(config.allowedPipelines || []).length === 0 ? (
                                <div className="text-center space-y-2 opacity-20 py-10 grayscale">
                                    <Network className="w-12 h-12 mx-auto mb-2 text-muted-foreground" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">No Authorized Workers</p>
                                </div>
                            ) : (
                                <>
                                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-center text-muted-foreground/40 mb-6 italic">Active Authority Network</p>
                                    <div className="space-y-3 stagger-list">
                                        {(config.allowedPipelines || []).map((pid, idx) => {
                                            const p = pipelines.find(x => x.id === pid);
                                            return (
                                                <div key={pid} className="group flex items-center gap-4 p-4 rounded-2xl bg-foreground/[0.03] border border-foreground/5 hover:border-amber-500/30 hover:bg-foreground/[0.06] transition-all duration-500 animate-in slide-in-from-bottom-2">
                                                    <div className="w-8 h-8 rounded-lg bg-background border border-foreground/10 flex items-center justify-center shadow-lg group-hover:border-amber-500/40 group-hover:text-amber-500 transition-all">
                                                        <Cpu className="w-4 h-4 opacity-70 group-hover:opacity-100" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[10px] font-black uppercase tracking-widest truncate">{p?.name || 'Authorized Proxy'}</p>
                                                        <div className="flex gap-1 mt-1">
                                                            <div className="w-12 h-1 bg-amber-500/20 rounded-full overflow-hidden">
                                                                <div className="w-full h-full bg-amber-500 shadow-[0_0_5px_rgba(245,158,11,0.5)]" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <ChevronRight className="w-3 h-3 text-muted-foreground/20 group-hover:text-amber-500 group-hover:translate-x-1 transition-all" />
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Aggregated Power Node */}
                                    <div className="mt-8 p-6 rounded-3xl border border-amber-500/10 bg-amber-500/[0.03] relative overflow-hidden group">
                                        <div className="absolute inset-x-0 h-0.5 top-0 bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
                                        <div className="flex items-center justify-between mb-4">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-amber-700/80">Sovereign Power Index</span>
                                            <Boxes className="w-4 h-4 text-amber-500 opacity-40 animate-spin-slow" />
                                        </div>
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[9px] text-muted-foreground/60 uppercase">Specialties</span>
                                                <span className="text-[10px] font-black text-amber-500">{aggregatedCapabilities.specialties.length}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-[9px] text-muted-foreground/60 uppercase">Mental Models</span>
                                                <span className="text-[10px] font-black text-blue-400">{aggregatedCapabilities.knowledge.length}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-[9px] text-muted-foreground/60 uppercase">Tool Kits</span>
                                                <span className="text-[10px] font-black text-emerald-400">{aggregatedCapabilities.tools.length}</span>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer Status Bar */}
                <div className="mt-auto p-4 border-t border-foreground/5 bg-background/40 flex items-center justify-between text-[8px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1.5 text-amber-500 opacity-60">
                            <Settings2 className="w-3 h-3" /> Delegation Active
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-amber-500" /> State: Authority Matrix Synchronized</span>
                    </div>
                </div>
            </div>

        </div>
    );
}
