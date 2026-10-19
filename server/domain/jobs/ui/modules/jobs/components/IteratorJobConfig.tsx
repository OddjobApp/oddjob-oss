
import React from 'react';
import { 
    Repeat, 
    Layers, 
    Zap, 
    Share2, 
    Settings2,
    Database,
    Binary,
    Activity
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Slider } from "@domain-ui/core/ui/components/ui/slider";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";

interface IteratorJobConfigProps {
    config: {
        mode: "job" | "pipeline";
        targetId: number;
        inputArray: string;
        itemVarName: string;
        concurrency: number;
        aggregateOutputs: boolean;
    };
    onChange: (config: any) => void;
    availableVariables?: any[];
    availableJobs?: any[];
    pipelines?: any[];
}

export default function IteratorJobConfig({ 
    config, 
    onChange, 
    availableVariables = [],
    availableJobs = [],
    pipelines = []
}: IteratorJobConfigProps) {
    // Ensure config is safe
    const safeConfig = {
        ...config,
        mode: config.mode || "job",
        targetId: config.targetId || 0,
        inputArray: config.inputArray || "",
        itemVarName: config.itemVarName || "item",
        concurrency: config.concurrency || 1,
        aggregateOutputs: config.aggregateOutputs !== false,
    };

    const updateConfig = (updates: Partial<typeof safeConfig>) => {
        onChange({ ...safeConfig, ...updates });
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="flex items-center gap-4">
                <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                    <Repeat className="w-6 h-6 text-emerald-500" />
                </div>
                <div>
                    <h3 className="text-sm font-black uppercase tracking-widest leading-none">Iterator Nexus</h3>
                    <p className="text-[10px] text-muted-foreground mt-1">Industrial-scale array processing with parallel execution windows.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Array Input Configuration */}
                <Card className="border-border/40 bg-muted/5">
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                            <Layers className="w-4 h-4 text-emerald-500" />
                            <CardTitle className="text-xs font-black uppercase tracking-widest">Input Stream</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-1.5">
                            <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Source Array (JSON Path)</Label>
                            <div className="relative">
                                <Input 
                                    className="h-9 text-xs font-mono bg-background" 
                                    placeholder="e.g. {{step.1.output.items}}"
                                    value={safeConfig.inputArray}
                                    onChange={(e) => updateConfig({ inputArray: e.target.value })}
                                />
                                <Database className="w-3.5 h-3.5 absolute right-3 top-3 text-muted-foreground/30" />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Item Reference Name</Label>
                            <Input 
                                className="h-9 text-xs font-mono bg-background" 
                                placeholder="e.g. item"
                                value={safeConfig.itemVarName}
                                onChange={(e) => updateConfig({ itemVarName: e.target.value })}
                            />
                            <p className="text-[9px] text-muted-foreground">Access current item as <code className="text-[10px] font-bold">{"{{"}{safeConfig.itemVarName}{"}}"}</code></p>
                        </div>
                    </CardContent>
                </Card>

                {/* Execution Target */}
                <Card className="border-border/40 bg-muted/5">
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                            <Zap className="w-4 h-4 text-emerald-500" />
                            <CardTitle className="text-xs font-black uppercase tracking-widest">Execution Target</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-1.5">
                            <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Operation Mode</Label>
                            <Select value={safeConfig.mode} onValueChange={(v: any) => updateConfig({ mode: v })}>
                                <SelectTrigger className="h-9 bg-background">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="job">Atomic Job Run</SelectItem>
                                    <SelectItem value="pipeline">Nested Pipeline Flow</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Target {safeConfig.mode === 'job' ? 'Job' : 'Pipeline'}</Label>
                            <Select 
                                value={String(safeConfig.targetId)} 
                                onValueChange={(v) => updateConfig({ targetId: parseInt(v) | 0 })}
                            >
                                <SelectTrigger className="h-9 bg-background">
                                    <SelectValue placeholder="Select Target..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {safeConfig.mode === 'job' ? (
                                        availableJobs.map(j => (
                                            <SelectItem key={j.id} value={String(j.id)}>{j.name}</SelectItem>
                                        ))
                                    ) : (
                                        pipelines.map(p => (
                                            <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Performance & Scaling */}
            <Card className="border-border/40 bg-muted/5">
                <CardHeader className="pb-3 border-b bg-muted/20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Activity className="w-4 h-4 text-emerald-500" />
                            <CardTitle className="text-xs font-black uppercase tracking-widest">Scaling & Telemetry</CardTitle>
                        </div>
                        <Badge variant="outline" className="text-[9px] font-mono border-emerald-500/20 text-emerald-500">PARALLEL: {safeConfig.concurrency > 1 ? 'YES' : 'NO'}</Badge>
                    </div>
                </CardHeader>
                <CardContent className="p-6 space-y-8">
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label className="text-[10px] uppercase font-black tracking-widest">Parallel Concurrency</Label>
                                <p className="text-[10px] text-muted-foreground">Number of items to process simultaneously.</p>
                            </div>
                            <span className="text-xs font-black font-mono bg-background px-3 py-1 rounded-lg border">{safeConfig.concurrency}x</span>
                        </div>
                        <Slider 
                            value={[safeConfig.concurrency]} 
                            min={1} 
                            max={50} 
                            step={1}
                            onValueChange={([v]) => updateConfig({ concurrency: v })}
                            className="py-4"
                        />
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-xl bg-background border border-border/40">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-emerald-500/10 rounded-lg">
                                <Share2 className="w-4 h-4 text-emerald-500" />
                            </div>
                            <div className="space-y-0.5">
                                <Label className="text-[10px] uppercase font-black tracking-widest">Aggregate Results</Label>
                                <p className="text-[10px] text-muted-foreground">Collect all sub-outputs into a single result array.</p>
                            </div>
                        </div>
                        <Switch 
                            checked={safeConfig.aggregateOutputs}
                            onCheckedChange={(v) => updateConfig({ aggregateOutputs: v })}
                        />
                    </div>
                </CardContent>
            </Card>

            <div className="p-4 rounded-xl bg-muted/30 border border-dashed flex flex-col items-center gap-2 text-center">
                <div className="p-2 bg-indigo-500/10 rounded-full border border-indigo-500/20">
                    <Settings2 className="w-4 h-4 text-indigo-500" />
                </div>
                <div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest">Runtime Isolation</h4>
                    <p className="text-[9px] text-muted-foreground max-w-sm mt-1">Each iteration is isolated in its own context. Variable mutations within the target will not persist across iterations unless using Global Store.</p>
                </div>
            </div>
        </div>
    );
}
