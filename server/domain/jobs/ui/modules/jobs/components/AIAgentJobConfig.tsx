import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { 
    Label 
} from "@domain-ui/core/ui/components/ui/label";
import { 
    Input 
} from "@domain-ui/core/ui/components/ui/input";
import { 
    Textarea 
} from "@domain-ui/core/ui/components/ui/textarea";
import { 
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { 
    Slider 
} from "@domain-ui/core/ui/components/ui/slider";
import { 
    Switch 
} from "@domain-ui/core/ui/components/ui/switch";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import { 
    Tabs, 
    TabsContent, 
    TabsList, 
    TabsTrigger 
} from "@domain-ui/core/ui/components/ui/tabs";
import { 
    Shield, 
    Zap, 
    Brain, 
    Target,
    Settings2,
    BookOpen
} from "lucide-react";
import './jobs-components.css';
import AgentToolsSelector from './AgentToolsSelector.js';
import AgentKnowledgeConfig from './AgentKnowledgeConfig.js';

import type { Credential } from "@shared/schema/system";

interface AIAgentJobConfigProps {
    config: any;
    onChange: (config: any) => void;
}

const MODELS = [
    // Google Gemini (default)
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "Google" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "Google" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "Google" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", provider: "Google" },
    { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", provider: "Google" },
    // Anthropic
    { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet", provider: "Anthropic" },
    { id: "claude-3-opus-latest", label: "Claude 3 Opus", provider: "Anthropic" },
    // OpenAI
    { id: "gpt-4o", label: "GPT-4o", provider: "OpenAI" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "OpenAI" },
    // Local / Ollama
    { id: "llama3.2:latest", label: "Llama 3.2 (Local)", provider: "Ollama" },
    { id: "llama3.1:latest", label: "Llama 3.1 (Local)", provider: "Ollama" },
    { id: "phi3:latest", label: "Phi-3 (Local)", provider: "Ollama" },
    { id: "mistral:latest", label: "Mistral (Local)", provider: "Ollama" },
    { id: "qwen2.5:latest", label: "Qwen 2.5 (Local)", provider: "Ollama" },
    { id: "deepseek-r1:latest", label: "DeepSeek R1 (Local)", provider: "Ollama" },
];

export const isAiCredential = (credential: Pick<Credential, "type">) =>
    credential.type === 'api_key' ||
    credential.type === 'ai_provider' ||
    credential.type === 'openai' ||
    credential.type === 'anthropic' ||
    credential.type === 'gemini';

export default function AIAgentJobConfig({ config, onChange }: AIAgentJobConfigProps) {
    // Defensive check to prevent crashes on null config (legacy data)
    const safeConfig = config || {};
    
    // Fetch credentials to find AI API keys
    const { data: credentials = [] } = useQuery<Credential[]>({
        queryKey: ['/api/credentials'],
    });

    const aiCredentials = credentials.filter(isAiCredential);

    const updateField = (field: string, value: any) => {
        onChange({ ...safeConfig, [field]: value });
    };

    return (
        <div className="w-full">
            <Tabs defaultValue="intelligence" className="w-full">
                <div className="px-8 border-b bg-muted/10">
                    <TabsList className="bg-transparent h-12 border-none gap-8">
                        <TabsTrigger 
                            value="intelligence" 
                            className="text-[10px] uppercase font-black tracking-widest px-0 border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none transition-all"
                        >
                            <Brain className="w-3 h-3 mr-2" />
                            Intelligence
                        </TabsTrigger>
                        <TabsTrigger 
                            value="skills" 
                            className="text-[10px] uppercase font-black tracking-widest px-0 border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none transition-all"
                        >
                            <Settings2 className="w-3 h-3 mr-2" />
                            Skills & Tools
                        </TabsTrigger>
                        <TabsTrigger 
                            value="knowledge" 
                            className="text-[10px] uppercase font-black tracking-widest px-0 border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none transition-all"
                        >
                            <BookOpen className="w-3 h-3 mr-2" />
                            Knowledge
                        </TabsTrigger>
                        <TabsTrigger 
                            value="governance" 
                            className="text-[10px] uppercase font-black tracking-widest px-0 border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none transition-all"
                        >
                            <Shield className="w-3 h-3 mr-2" />
                            Governance
                        </TabsTrigger>
                    </TabsList>
                </div>

                <div className="p-8">
                    <TabsContent value="intelligence" className="mt-0 space-y-10 animate-in fade-in slide-in-from-left-4 duration-500">
                        {/* Model & Persona */}
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
                            <div className="md:col-span-4 space-y-6">
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Brain className="w-4 h-4 text-primary" />
                                        <h4 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Strategic Core</h4>
                                    </div>
                                    
                                    <div className="space-y-5 p-6 rounded-3xl border bg-muted/20 backdrop-blur-sm">
                                        <div className="space-y-2">
                                            <Label htmlFor="agent-model" className="text-[10px] uppercase font-bold tracking-widest opacity-70">Model</Label>
                                            <Select 
                                                value={safeConfig.model || "gemini-2.0-flash"}
                                                onValueChange={(v) => updateField("model", v)}
                                            >
                                                <SelectTrigger id="agent-model" className="h-11 bg-background border-border/50 shadow-sm rounded-xl">
                                                    <SelectValue placeholder="Select LLM" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {MODELS.map(m => (
                                                        <SelectItem key={m.id} value={m.id}>
                                                            <div className="flex items-center justify-between w-full gap-4">
                                                                <span className="font-bold">{m.label}</span>
                                                                <Badge variant="outline" className="text-[8px] uppercase tracking-tighter opacity-50 px-1">{m.provider}</Badge>
                                                            </div>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="agent-credential" className="text-[10px] uppercase font-bold tracking-widest opacity-70">AI Credential</Label>
                                            <Select 
                                                value={safeConfig.credentialId?.toString()}
                                                onValueChange={(v) => updateField("credentialId", parseInt(v))}
                                            >
                                                <SelectTrigger id="agent-credential" className="h-11 bg-background border-border/50 shadow-sm rounded-xl text-xs">
                                                    <SelectValue placeholder="Select a credential" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {aiCredentials.filter(c => c.id).map(c => (
                                                        <SelectItem key={c.id} value={c.id.toString()}>
                                                            {c.name}{(c.metadata as any)?.provider ? ` (${(c.metadata as any).provider})` : ''}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            {aiCredentials.length === 0 && (
                                                <p className="text-xs text-amber-500">Add an AI Provider credential before activation.</p>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4 p-6 rounded-3xl border bg-primary/5 border-primary/10">
                                    <div className="space-y-4">
                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center">
                                                <Label className="text-[10px] uppercase font-bold tracking-widest">Creativity</Label>
                                                <span className="text-[10px] font-black text-primary font-mono bg-primary/10 px-1.5 py-0.5 rounded">{safeConfig.temperature ?? 0.7}</span>
                                            </div>
                                            <Slider 
                                                min={0} max={1} step={0.1}
                                                value={[safeConfig.temperature ?? 0.7]}
                                                onValueChange={([v]) => updateField("temperature", v)}
                                            />
                                        </div>

                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center">
                                                <Label className="text-[10px] uppercase font-bold tracking-widest">Max Iterations</Label>
                                                <span className="text-[10px] font-black text-primary font-mono bg-primary/10 px-1.5 py-0.5 rounded">{safeConfig.maxIterations ?? 5}</span>
                                            </div>
                                            <Slider 
                                                min={1} max={20} step={1}
                                                value={[safeConfig.maxIterations ?? 5]}
                                                onValueChange={([v]) => updateField("maxIterations", v)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="md:col-span-8 space-y-6">
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Target className="w-4 h-4 text-primary" />
                                        <h4 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Directive & Identity</h4>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="agent-goal" className="text-[10px] uppercase font-bold tracking-widest opacity-70">Goal</Label>
                                        <Textarea
                                            id="agent-goal"
                                            placeholder="Define the specific outcome this agent must achieve..."
                                            className="min-h-[120px] bg-muted/5 border-border/50 text-sm leading-relaxed rounded-2xl p-4"
                                            value={safeConfig.goal || ""}
                                            onChange={(e) => updateField("goal", e.target.value)}
                                        />
                                        <p className="text-xs text-muted-foreground">Required. Describe a measurable runtime outcome, not the agent's personality.</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="agent-system-prompt" className="text-[10px] uppercase font-bold tracking-widest opacity-70">System instructions</Label>
                                        <Textarea 
                                            id="agent-system-prompt"
                                            placeholder="You are a meticulous sales analyst with experience in..."
                                            className="min-h-[240px] bg-muted/5 border-border/50 text-sm leading-relaxed rounded-3xl p-6 focus:ring-primary/20 transition-all shadow-inner"
                                            value={safeConfig.systemPrompt || ""}
                                            onChange={(e) => updateField("systemPrompt", e.target.value)}
                                        />
                                        <div className="flex justify-end pr-4">
                                            <span className="text-xs text-muted-foreground">Optional behavioral instructions and constraints</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="skills" className="mt-0 animate-in fade-in slide-in-from-right-4 duration-500">
                        <div className="space-y-6">
                            <div className="flex items-center gap-2 mb-4">
                                <Settings2 className="w-4 h-4 text-primary" />
                                <h4 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Skill Matrix & Toolsets</h4>
                            </div>
                            <div className="p-6 rounded-3xl border bg-muted/20 backdrop-blur-sm">
                                <AgentToolsSelector 
                                    config={safeConfig} 
                                    updateConfig={updateField}
                                    isEditing={true}
                                />
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="knowledge" className="mt-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="space-y-6">
                            <div className="flex items-center gap-2 mb-4">
                                <BookOpen className="w-4 h-4 text-primary" />
                                <h4 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Knowledge Restriction & Context</h4>
                            </div>
                            <div className="p-8 rounded-3xl border bg-muted/20 backdrop-blur-sm">
                                <AgentKnowledgeConfig 
                                    config={safeConfig}
                                    updateConfig={updateField}
                                    isEditing={true}
                                />
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="governance" className="mt-0 animate-in fade-in zoom-in-95 duration-500">
                        <div className="max-w-2xl space-y-8">
                            <div className="flex items-center gap-2 mb-4">
                                <Shield className="w-4 h-4 text-primary" />
                                <h4 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Authority & Sovereignty</h4>
                            </div>
                            
                            <div className="space-y-8">
                                <div className="space-y-3">
                                    <Label className="text-[11px] uppercase font-black tracking-widest opacity-70">Supervision Protocol</Label>
                                    <div className="grid grid-cols-3 gap-3">
                                        {[
                                            { id: 'none', label: 'Autonomous', desc: 'No approval required' },
                                            { id: 'advisory', label: 'Advisory', desc: 'Consult for tools' },
                                            { id: 'full', label: 'Governed', desc: 'Step-by-step approval' }
                                        ].map(mode => (
                                            <button
                                                key={mode.id}
                                                onClick={() => updateField("supervision", mode.id)}
                                                className={cn(
                                                    "flex flex-col items-center gap-2 p-4 rounded-2xl border text-center transition-all group",
                                                    safeConfig.supervision === mode.id 
                                                        ? "bg-primary text-primary-foreground border-primary shadow-xl scale-105"
                                                        : "bg-background text-muted-foreground border-border/50 hover:border-primary/40 hover:bg-primary/5"
                                                )}
                                            >
                                                <span className="text-[10px] font-black uppercase tracking-widest">{mode.label}</span>
                                                <span className="text-[8px] opacity-60 uppercase tracking-tighter leading-tight">{mode.desc}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <Separator className="opacity-30" />

                                <div className="space-y-4">
                                    <Label className="text-[11px] font-black uppercase tracking-widest opacity-70 flex items-center gap-2">
                                        <Shield className="w-3.5 h-3.5" /> 
                                        Boundary Matrix (Sovereignty)
                                    </Label>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-4 rounded-2xl border bg-primary/5 border-primary/20 space-y-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-primary/60">Active Capabilities</span>
                                                <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-primary/30">{(safeConfig.allowedTools || []).length} ARMED</Badge>
                                            </div>
                                            <div className="flex flex-wrap gap-1">
                                                {(safeConfig.allowedTools || []).slice(0, 5).map((t: string) => (
                                                    <Badge key={t} variant="outline" className="text-[8px] bg-primary/10 border-primary/10 h-4 px-1">{t}</Badge>
                                                ))}
                                                {(safeConfig.allowedTools || []).length > 5 && (
                                                    <Badge variant="outline" className="text-[8px] h-4 px-1">+{ (safeConfig.allowedTools || []).length - 5 } MORE</Badge>
                                                )}
                                                {(safeConfig.allowedTools || []).length === 0 && <span className="text-[9px] text-muted-foreground italic">No tools armed</span>}
                                            </div>
                                        </div>
                                        <div className="p-4 rounded-2xl border bg-blue-500/5 border-blue-500/20 space-y-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-blue-500/60">Knowledge Scoping</span>
                                                <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-blue-500/30">
                                                    {((safeConfig.topicIds || []).length + (safeConfig.datasetIds || []).length)} ACTIVE
                                                </Badge>
                                            </div>
                                            <div className="flex flex-wrap gap-1">
                                                {/* Summary labels */}
                                                {(safeConfig.topicIds || []).length > 0 && <Badge className="text-[8px] bg-blue-500/20 text-blue-700 hover:bg-blue-500/20 border-blue-500/20 h-4">{safeConfig.topicIds.length} TOPICS</Badge>}
                                                {(safeConfig.datasetIds || []).length > 0 && <Badge className="text-[8px] bg-emerald-500/20 text-emerald-700 hover:bg-emerald-500/20 border-emerald-500/20 h-4">{safeConfig.datasetIds.length} DATASETS</Badge>}
                                                {((safeConfig.topicIds || []).length === 0 && (safeConfig.datasetIds || []).length === 0) && (
                                                    <span className="text-[9px] text-muted-foreground italic">Global Access (Unrestricted)</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <p className="text-[9px] text-muted-foreground/60 leading-relaxed px-1">
                                        The Boundary Matrix defines the hard limits of the agent's operational sovereignty. Changes here override skill-based tool requests.
                                    </p>
                                </div>

                                <Separator className="opacity-30" />

                                <div className="flex items-center justify-between p-6 rounded-2xl bg-primary/5 border border-primary/10">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <Zap className="w-3.5 h-3.5 text-primary" />
                                            <Label className="text-[10px] uppercase font-black tracking-widest">Self-Correction Engine</Label>
                                        </div>
                                        <p className="text-[10px] text-muted-foreground">Allow agent to re-reason and retry failures without human intervention.</p>
                                    </div>
                                    <Switch 
                                        checked={safeConfig.allowSelfCorrection ?? true}
                                        onCheckedChange={(v) => updateField("allowSelfCorrection", v)}
                                    />
                                </div>
                            </div>
                        </div>
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
}

function cn(...classes: any[]) {
    return classes.filter(Boolean).join(" ");
}

function Badge({ children, variant = "default", className }: { children: React.ReactNode, variant?: "default" | "outline", className?: string }) {
    const base = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";
    const variants = {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        outline: "text-foreground",
    };
    return <div className={variants[variant] + " " + base + " " + className}>{children}</div>;
}
