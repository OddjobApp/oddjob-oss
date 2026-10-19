import React, { useEffect, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { 
    RefreshCw, 
    Brain, 
    Settings2, 
    Zap, 
    Terminal, 
    FileJson, 
    Sparkles, 
    Ghost, 
    Monitor, 
    Database, 
    Cpu,
    Target,
    Fingerprint,
    MessagesSquare
} from 'lucide-react';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Slider } from '@domain-ui/core/ui/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Card, CardContent } from '@domain-ui/core/ui/components/ui/card';
import type { AIApiCallConfig, Credential } from '@shared/schema/index.js';
import VariablePicker from '@domain-ui/core/ui/components/shared/VariablePicker';
import FileStorageConfig from './FileStorageConfig.js';
import { cn } from '@/lib/utils';
import './jobs-components.css';

interface AiApiCallJobConfigProps {
    config: Partial<AIApiCallConfig>;
    onChange: (config: Partial<AIApiCallConfig>) => void;
    availableVariables?: string[];
}

export default function AiApiCallJobConfig({ config, onChange, availableVariables = [] }: AiApiCallJobConfigProps) {
    const [ollamaModels, setOllamaModels] = useState<string[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [activeTab, setActiveTab] = useState("intelligence");

    // Fetch credentials to find AI API keys
    const { data: credentials = [] } = useQuery<Credential[]>({
        queryKey: ['/api/credentials'],
    });

    const aiProviders = credentials.filter(c =>
        c.type === 'ai_provider' || c.type === 'openai' || c.type === 'anthropic' || c.type === 'gemini'
    );

    const selectedCred = credentials.find(c => c.id === config.credentialId);
    const isOllama = selectedCred &&
        selectedCred.type === 'ai_provider' &&
        (selectedCred.metadata as any)?.provider === 'ollama';

    useEffect(() => {
        if (isOllama) {
            fetchOllamaModels();
        }
    }, [isOllama, config.credentialId]);

    const fetchOllamaModels = async () => {
        setIsLoadingModels(true);
        try {
            const res = await fetch('/api/ollama/tags');
            if (res.ok) {
                const data = await res.json();
                setOllamaModels(data.models?.map((m: any) => m.name) || []);
            }
        } catch (e) {
            console.error("Failed to fetch Ollama models", e);
        } finally {
            setIsLoadingModels(false);
        }
    };

    const updateField = (field: string, value: any) => {
        onChange({ ...config, [field]: value });
    };

    // Helper to highlight variables in the manifestation preview
    const renderPromptPreview = (text: string) => {
        if (!text) return <span className="opacity-20 italic">No instructions provided...</span>;
        
        const parts = text.split(/(\{\{[^}]+\}\})/g);
        return parts.map((part, i) => {
            if (part.startsWith('{{') && part.endsWith('}}')) {
                return (
                    <span key={i} className="bg-primary/20 text-primary border border-primary/20 rounded px-1 font-bold animate-pulse">
                        {part}
                    </span>
                );
            }
            return <span key={i}>{part}</span>;
        });
    };

    return (
        <div className="flex bg-background/40 backdrop-blur-2xl h-full min-h-[700px] rounded-2xl overflow-hidden border border-foreground/5 divide-x divide-white/5 animate-in fade-in zoom-in duration-700">
            {/* Left Column: Designer */}
            <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
                <div className="p-4 border-b border-foreground/5 bg-foreground/5 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary" />
                        <span className="text-xs font-black uppercase tracking-[0.2em] text-foreground/80">LLM Prompt Designer</span>
                    </div>
                </div>

                <div className="flex-1">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-full flex flex-col">
                        <div className="px-6 pt-6">
                            <TabsList className="bg-background/40 border border-foreground/5 h-11 p-1 flex gap-1 rounded-xl">
                                <TabsTrigger value="intelligence" className="flex-1 flex items-center gap-2 text-[10px] uppercase font-black tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all duration-300 rounded-lg">
                                    <Brain className="w-3.5 h-3.5" /> Intelligence
                                </TabsTrigger>
                                <TabsTrigger value="parameters" className="flex-1 flex items-center gap-2 text-[10px] uppercase font-black tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all duration-300 rounded-lg">
                                    <Terminal className="w-3.5 h-3.5" /> Parameters
                                </TabsTrigger>
                                <TabsTrigger value="settings" className="flex-1 flex items-center gap-2 text-[10px] uppercase font-black tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all duration-300 rounded-lg">
                                    <Settings2 className="w-3.5 h-3.5" /> Settings
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-8">
                            <TabsContent value="intelligence" className="m-0 space-y-8 focus-visible:ring-0">
                                {/* Provider & Model Selection */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-3">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2 px-1">
                                            <Fingerprint className="w-3 h-3" /> AI Provider
                                        </Label>
                                        <Select
                                            value={config.credentialId?.toString()}
                                            onValueChange={(value) => updateField("credentialId", parseInt(value))}
                                        >
                                            <SelectTrigger className="h-10 bg-background/40 border-foreground/5 text-xs font-bold transition-all hover:bg-background/60">
                                                <SelectValue placeholder="Select provider" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-background/90 backdrop-blur-xl border-foreground/10">
                                                {aiProviders.map((cred) => (
                                                    <SelectItem key={cred.id} value={cred.id.toString()} className="text-xs font-bold uppercase tracking-wider">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-2 h-2 rounded-full bg-primary/40" />
                                                            {cred.name}
                                                            <Badge variant="outline" className="text-[8px] bg-foreground/5 border-none opacity-40 ml-auto">
                                                                {(cred.metadata as any)?.provider || cred.type}
                                                            </Badge>
                                                        </div>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-3">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center justify-between px-1">
                                            <div className="flex items-center gap-2">
                                                <Cpu className="w-3 h-3" /> Cognitive Model
                                            </div>
                                            {isOllama && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-4 w-4 p-0 opacity-40 hover:opacity-100 transition-opacity"
                                                    onClick={fetchOllamaModels}
                                                >
                                                    <RefreshCw className={cn("h-2.5 w-2.5", isLoadingModels && "animate-spin")} />
                                                </Button>
                                            )}
                                        </Label>
                                        {isOllama ? (
                                            <Select
                                                value={config.model}
                                                onValueChange={(value) => updateField("model", value)}
                                            >
                                                <SelectTrigger className="h-10 bg-background/40 border-foreground/5 text-xs font-bold">
                                                    <SelectValue placeholder={isLoadingModels ? "Syncing..." : "Select Model"} />
                                                </SelectTrigger>
                                                <SelectContent className="bg-background/90 backdrop-blur-xl border-foreground/10">
                                                    {ollamaModels.map(model => (
                                                        <SelectItem key={model} value={model} className="text-xs font-bold">{model}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <Input
                                                value={config.model || ''}
                                                onChange={(e) => updateField("model", e.target.value)}
                                                placeholder="e.g. gpt-4o"
                                                className="h-10 bg-background/40 border-foreground/5 text-xs font-bold focus:ring-primary/20"
                                            />
                                        )}
                                    </div>
                                </div>

                                <Separator className="bg-foreground/5" />

                                {/* System Prompt */}
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center px-1">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                            <Target className="w-3.5 h-3.5" /> System Identity
                                        </Label>
                                        <VariablePicker
                                            variables={availableVariables}
                                            onSelect={(v) => updateField("systemPrompt", (config.systemPrompt || '') + `{{${v}}}`)}
                                        />
                                    </div>
                                    <div className="relative group">
                                        <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/20 to-purple-500/20 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
                                        <Textarea
                                            value={config.systemPrompt || ''}
                                            onChange={(e) => updateField("systemPrompt", e.target.value)}
                                            placeholder="You are a high-level strategic intelligence agent..."
                                            className="relative min-h-[140px] bg-background/40 border-foreground/5 rounded-2xl text-[13px] leading-relaxed font-serif italic p-6 focus:ring-primary/30 transition-all custom-scrollbar"
                                        />
                                    </div>
                                </div>

                                {/* User Instructions */}
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center px-1">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                            <MessagesSquare className="w-3.5 h-3.5" /> Execution Directive
                                        </Label>
                                        <VariablePicker
                                            variables={availableVariables}
                                            onSelect={(v) => updateField("userPrompt", (config.userPrompt || '') + `{{${v}}}`)}
                                        />
                                    </div>
                                    <div className="relative group">
                                        <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500/20 to-primary/20 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
                                        <Textarea
                                            value={config.userPrompt || ''}
                                            onChange={(e) => updateField("userPrompt", e.target.value)}
                                            placeholder="Analyze the following payload and extract key strategic insights..."
                                            className="relative min-h-[220px] bg-background/40 border-foreground/5 rounded-2xl text-[13px] leading-relaxed font-mono p-6 focus:ring-primary/30 transition-all custom-scrollbar"
                                        />
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="parameters" className="m-0 space-y-8 animate-in slide-in-from-right-4 duration-500">
                                <div className="space-y-10 py-4">
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center px-1">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/80">Creativity (Temperature)</Label>
                                            <span className="text-xs font-black text-primary font-mono bg-primary/10 px-2 py-0.5 rounded-lg border border-primary/20 shadow-[0_0_8px_rgba(var(--primary),0.2)]">
                                                {config.temperature ?? 0.7}
                                            </span>
                                        </div>
                                        <Slider 
                                            min={0} max={1} step={0.05}
                                            value={[config.temperature ?? 0.7]}
                                            onValueChange={([v]) => updateField("temperature", v)}
                                            className="py-2"
                                        />
                                        <p className="text-[9px] text-muted-foreground/40 uppercase font-black tracking-widest italic text-center">Lower = Precise & Deterministic | Higher = Creative & Random</p>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center px-1">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/80">Response Horizon (Max Tokens)</Label>
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    type="number"
                                                    value={config.maxTokens ?? 2048}
                                                    onChange={e => updateField("maxTokens", parseInt(e.target.value) || 2048)}
                                                    className="w-20 h-7 bg-background/40 border-foreground/5 text-[10px] font-black text-center"
                                                />
                                            </div>
                                        </div>
                                        <Slider 
                                            min={64} max={8192} step={128}
                                            value={[config.maxTokens ?? 2048]}
                                            onValueChange={([v]) => updateField("maxTokens", v)}
                                        />
                                        <p className="text-[9px] text-muted-foreground/40 uppercase font-black tracking-widest italic text-center">Limit the length of the generated manifestation.</p>
                                    </div>

                                    <Separator className="bg-foreground/5" />

                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between p-4 rounded-2xl border border-foreground/5 bg-foreground/5 hover:bg-foreground/[0.08] transition-colors group">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <FileJson className="w-4 h-4 text-emerald-400" />
                                                    <Label className="text-[11px] font-black uppercase tracking-widest">Structured JSON Mode</Label>
                                                </div>
                                                <p className="text-[9px] text-muted-foreground italic">Enforce schema-strict JSON responses.</p>
                                            </div>
                                            <Switch 
                                                checked={config.requestType === 'json'}
                                                onCheckedChange={checked => updateField("requestType", checked ? 'json' : 'text')}
                                                className="data-[state=checked]:bg-emerald-500"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="settings" className="m-0 space-y-8 animate-in zoom-in-95 duration-500">
                                <div className="p-2 space-y-6">
                                    <div className="p-6 rounded-3xl border border-foreground/5 bg-background/20">
                                        <FileStorageConfig
                                            saveOutputToFile={config.saveOutputToFile || false}
                                            screenshotDirectory={config.screenshotDirectory}
                                            onSaveOutputChange={(v) => updateField("saveOutputToFile", v)}
                                            onDirectoryChange={(v) => updateField("screenshotDirectory", v)}
                                        />
                                    </div>

                                    <div className="p-6 rounded-3xl border border-foreground/5 bg-background/20 space-y-4">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2 px-1">
                                            <Database className="w-3.5 h-3.5" /> Intelligence Retention
                                        </Label>
                                        <div className="flex items-center gap-2">
                                            <div className="h-8 flex-1 rounded-lg border border-foreground/5 border-dashed flex items-center justify-center">
                                                <span className="text-[9px] uppercase font-black tracking-widest text-muted-foreground/40 italic">Ephemeral Memory Policy Active</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </TabsContent>
                        </div>
                    </Tabs>
                </div>
            </div>

            {/* Right Column: Prompt Manifestation */}
            <div className="w-[42%] bg-background/60 flex flex-col h-full sticky top-0 relative">
                <div className="p-4 border-b border-foreground/5 bg-foreground/5 flex items-center justify-between backdrop-blur-md">
                    <div className="flex items-center gap-2">
                        <Monitor className="w-4 h-4 text-primary" />
                        <span className="text-xs font-black uppercase tracking-[0.2em] text-foreground/80">Prompt Manifestation</span>
                    </div>
                    <Badge variant="outline" className="text-[8px] font-black uppercase tracking-widest border-primary/20 text-primary bg-primary/5 px-2 py-0.5 shadow-[0_0_10px_rgba(var(--primary),0.1)]">
                        Synthesizing
                    </Badge>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-0 relative">
                    {/* Ghost Cursor Overlay Background */}
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(var(--primary),0.03),transparent)] pointer-events-none" />

                    <div className="p-8 space-y-12 relative z-10 animate-in fade-in duration-1000">
                        {/* Manifested Persona Section */}
                        <div className="space-y-4 relative">
                            <div className="flex items-center gap-4">
                                <div className="w-8 h-[1px] bg-primary/30" />
                                <span className="text-[9px] font-black uppercase tracking-[0.3em] text-primary whitespace-nowrap">Persona Definition</span>
                                <div className="flex-1 h-[1px] bg-primary/10" />
                            </div>
                            <div className="pl-4 py-2 border-l-2 border-primary/20 bg-foreground/[0.02] rounded-r-2xl pr-4">
                                <div className="text-[11px] leading-relaxed text-foreground/70 min-h-[100px] whitespace-pre-wrap selection:bg-primary/30">
                                    {renderPromptPreview(config.systemPrompt || '')}
                                </div>
                            </div>
                        </div>

                        {/* Manifested Instruction Section */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-4">
                                <div className="w-8 h-[1px] bg-emerald-500/30" />
                                <span className="text-[9px] font-black uppercase tracking-[0.3em] text-emerald-400 whitespace-nowrap">Input Directive</span>
                                <div className="flex-1 h-[1px] bg-emerald-500/10" />
                            </div>
                            <Card className="border-emerald-500/10 bg-emerald-500/[0.02] overflow-hidden shadow-2xl relative group">
                                <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-30 transition-opacity">
                                    <Ghost className="w-6 h-6 text-emerald-400" />
                                </div>
                                <CardContent className="p-6">
                                    <div className="text-[11px] leading-relaxed text-foreground/80 font-mono whitespace-pre-wrap min-h-[300px]">
                                        {renderPromptPreview(config.userPrompt || '')}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Telemetry Mock */}
                        <div className="pt-4 flex flex-wrap gap-4 opacity-40 grayscale hover:grayscale-0 hover:opacity-100 transition-all duration-700">
                            <div className="flex items-center gap-2">
                                <Zap className="w-3 h-3 text-yellow-400" />
                                <span className="text-[8px] font-black uppercase tracking-widest">Est. Latency: 420ms</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-3 h-3 text-blue-400" />
                                <span className="text-[8px] font-black uppercase tracking-widest">Confidence: 98.4%</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Status Bar in Manifestation */}
                <div className="mt-auto p-4 border-t border-foreground/5 bg-background/40 flex items-center justify-between text-[8px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">
                    <div className="flex items-center gap-4">
                        <span>Manifestation Ready</span>
                        <span>Context: Localized</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Secure Bridge</span>
                    </div>
                </div>
            </div>

        </div>
    );
}
