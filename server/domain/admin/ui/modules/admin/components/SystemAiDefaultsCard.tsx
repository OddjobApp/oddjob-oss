
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Bot, Zap, Bug, Plus, Trash2, ChevronDown, ChevronRight, Shield } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { useQuery } from '@tanstack/react-query';

interface SystemAiDefaultsProps {
    defaults: any;
    onUpdate: (newDefaults: any) => void;
}

const SERVICES = [
    { key: 'concierge', label: 'Concierge Agent', icon: Bot, description: 'Handles general user inquiries and task routing.' },
    { key: 'copilot', label: 'Oddjob Assistant', icon: Zap, description: 'Assists with complex workflows and code generation.' },
    { key: 'architect', label: 'Architect / Strategy', icon: Zap, description: 'Handles big-picture mission orientation and complex strategy.' },
    { key: 'governor', label: 'Governor (OODA / Drift)', icon: Shield, description: 'Validates safety, drift, and post-mission synthesis (JSON Mode).' },
    { key: 'extraction', label: 'Knowledge Extraction', icon: Bot, description: 'Extracts entities and relationships for the Knowledge Graph (JSON Mode).' },
    { key: 'ragEmbeddings', label: 'RAG & Embeddings', icon: Zap, description: 'Powers vector search and graph structural analysis (local Python support).' },
    { key: 'faultAnalysis', label: 'Fault Analysis', icon: Bug, description: 'Analyzes errors and suggests fixes for failed jobs.' },
    { key: 'codegen', label: 'Industrial Codegen', icon: Zap, description: 'Specialized model for the App Forge (High-fidelity code generation).' },
    { key: 'ollama', label: 'Autonomous Failover', icon: Shield, description: 'The local model used as an emergency safety net when cloud budgets are exhausted.' },
] as const;

const PROVIDERS = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'ollama', label: 'Ollama (Local)' },
    { value: 'python', label: 'Python (Sidecar)' },
    { value: 'google', label: 'Google Gemini' },
    { value: 'midjourney', label: 'Midjourney' }, // Unlikely for text, but in list
] as const;

const PROVIDERS_FOR_FALLBACK = PROVIDERS.filter(p => p.value !== 'midjourney');

export default function SystemAiDefaultsCard({ defaults, onUpdate }: SystemAiDefaultsProps) {
    const [expandedFallback, setExpandedFallback] = useState<Record<string, boolean>>({});
    // defaults is passed directly now

    // Fetch Ollama models when needed
    const { data: ollamaModelsData, refetch: refetchOllama } = useQuery({
        queryKey: ['/api/ollama/tags'],
        queryFn: async () => {
            const res = await fetch('/api/ollama/tags');
            if (!res.ok) return { models: [] };
            return res.json();
        },
        enabled: false, // Lazy fetch
    });

    useEffect(() => {
        // Prefetch if any service uses Ollama
        const usesOllama = Object.values(defaults).some((d: any) => d?.provider === 'ollama');
        if (usesOllama) {
            refetchOllama();
        }
    }, [defaults]);

    const handleUpdate = (serviceKey: string, field: string, value: string | number) => {
        const currentServiceConfig = defaults[serviceKey] || { 
            provider: serviceKey === 'ollama' ? 'ollama' : 'openai', 
            model: serviceKey === 'ollama' ? 'deepseek-r1:latest' : 'gpt-4o' 
        };
        const newServiceConfig = { ...currentServiceConfig, [field]: value };

        // Reset model if provider changes to something else
        if (field === 'provider' && value !== currentServiceConfig.provider) {
            if (value === 'ollama') {
                newServiceConfig.model = ''; // Reset to force selection
                refetchOllama();
            } else if (value === 'openai') {
                newServiceConfig.model = 'gpt-4o';
            } else if (value === 'anthropic') {
                newServiceConfig.model = 'claude-3-5-sonnet-latest';
            } else if (value === 'python') {
                newServiceConfig.model = 'all-MiniLM-L6-v2';
            }
        }

        const newDefaults = {
            ...defaults,
            [serviceKey]: newServiceConfig
        };
        onUpdate(newDefaults);
    };

    const handleAddFallback = (serviceKey: string) => {
        const current = defaults[serviceKey] || {};
        const fallbacks = [...(current.fallbackModels || []), { provider: 'google', model: 'gemini-2.0-flash' }];
        onUpdate({ ...defaults, [serviceKey]: { ...current, fallbackModels: fallbacks } });
    };

    const handleRemoveFallback = (serviceKey: string, index: number) => {
        const current = defaults[serviceKey] || {};
        const fallbacks = (current.fallbackModels || []).filter((_: any, i: number) => i !== index);
        onUpdate({ ...defaults, [serviceKey]: { ...current, fallbackModels: fallbacks } });
    };

    const handleUpdateFallback = (serviceKey: string, index: number, field: 'provider' | 'model', value: string) => {
        const current = defaults[serviceKey] || {};
        const fallbacks = [...(current.fallbackModels || [])];
        if (!fallbacks[index]) fallbacks[index] = { provider: 'google', model: 'gemini-2.0-flash' };
        fallbacks[index] = { ...fallbacks[index], [field]: value };
        onUpdate({ ...defaults, [serviceKey]: { ...current, fallbackModels: fallbacks } });
    };

    const getOllamaModels = () => ollamaModelsData?.models?.map((m: any) => m.name) || [];

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Bot className="w-5 h-5 text-primary" />
                    System AI Defaults
                </CardTitle>
                <CardDescription>
                    Configure which AI models power internal system services.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {SERVICES.map((service) => {
                    const config = defaults[service.key] || { 
                        provider: service.key === 'ollama' ? 'ollama' : 'openai', 
                        model: service.key === 'ollama' ? 'deepseek-r1:latest' : '' 
                    };
                    const isOllama = config.provider === 'ollama';
                    const Icon = service.icon;

                    return (
                        <div key={service.key} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                            <div className="md:col-span-4 space-y-1">
                                <Label className="flex items-center gap-2">
                                    <Icon className="w-4 h-4 text-muted-foreground" />
                                    {service.label}
                                </Label>
                                <p className="text-xs text-muted-foreground">{service.description}</p>
                            </div>

                            <div className="md:col-span-3">
                                <Select
                                    value={config.provider}
                                    onValueChange={(val) => handleUpdate(service.key, 'provider', val)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Provider" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PROVIDERS.map(p => (
                                            <SelectItem key={p.value} value={p.value}>
                                                {p.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="md:col-span-5 space-y-2">
                                <div className="flex items-center gap-2">
                                    {isOllama ? (
                                        <Select
                                            value={config.model}
                                            onValueChange={(val) => handleUpdate(service.key, 'model', val)}
                                            onOpenChange={() => refetchOllama()}
                                        >
                                            <SelectTrigger className="w-full">
                                                <SelectValue placeholder="Select Model" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {getOllamaModels().length === 0 ? (
                                                    <SelectItem value="_none" disabled>No models found</SelectItem>
                                                ) : (
                                                    getOllamaModels().map((m: string) => (
                                                        <SelectItem key={m} value={m}>{m}</SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <Input
                                            placeholder="Model Name (e.g. gpt-4o)"
                                            value={config.model}
                                            onChange={(e) => handleUpdate(service.key, 'model', e.target.value)}
                                        />
                                    )}
                                </div>

                                {/* Max Iterations & Timeout for Oddjob Assistant */}
                                {service.key === 'copilot' && (
                                    <div className="space-y-2 pt-2">
                                        <div className="flex items-center gap-3">
                                            <Label className="text-xs text-muted-foreground whitespace-nowrap">
                                                Max Iterations:
                                            </Label>
                                            <Input
                                                type="number"
                                                min={1}
                                                max={50}
                                                value={config.maxIterations || 5}
                                                onChange={(e) => handleUpdate(service.key, 'maxIterations', parseInt(e.target.value) || 5)}
                                                className="w-20 h-8"
                                            />
                                            <span className="text-xs text-muted-foreground">
                                                (1-50, default: 5)
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Label className="text-xs text-muted-foreground whitespace-nowrap">
                                                Timeout (s):
                                            </Label>
                                            <Input
                                                type="number"
                                                min={1}
                                                value={(config.timeoutMs || 120000) / 1000}
                                                onChange={(e) => handleUpdate(service.key, 'timeoutMs', (parseInt(e.target.value) || 120) * 1000)}
                                                className="w-20 h-8"
                                            />
                                            <span className="text-xs text-muted-foreground">
                                                (default: 120s)
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* Fallback models (Multi-Model Fallback) */}
                                <div className="pt-3 mt-2 border-t border-border/50">
                                    <button
                                        type="button"
                                        onClick={() => setExpandedFallback(prev => ({ ...prev, [service.key]: !prev[service.key] }))}
                                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                    >
                                        {expandedFallback[service.key] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                        Fallback models (on 429/5xx/timeout)
                                        {(config.fallbackModels?.length || 0) > 0 && (
                                            <span className="ml-1 text-primary">({config.fallbackModels?.length})</span>
                                        )}
                                    </button>
                                    {expandedFallback[service.key] && (
                                        <div className="mt-2 space-y-2">
                                            {(config.fallbackModels || []).map((fb: { provider: string; model: string }, i: number) => (
                                                <div key={i} className="flex items-center gap-2">
                                                    <Select
                                                        value={fb.provider}
                                                        onValueChange={(v) => handleUpdateFallback(service.key, i, 'provider', v)}
                                                    >
                                                        <SelectTrigger className="h-8 w-28">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {PROVIDERS_FOR_FALLBACK.map(p => (
                                                                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <Input
                                                        placeholder="Model"
                                                        value={fb.model}
                                                        onChange={(e) => handleUpdateFallback(service.key, i, 'model', e.target.value)}
                                                        className="h-8 flex-1"
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 shrink-0"
                                                        onClick={() => handleRemoveFallback(service.key, i)}
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </Button>
                                                </div>
                                            ))}
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-8"
                                                onClick={() => handleAddFallback(service.key)}
                                            >
                                                <Plus className="w-3 h-3 mr-1" />
                                                Add fallback
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
}
