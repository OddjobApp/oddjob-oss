
import React, { useState } from 'react';
import { 
    Zap, 
    Plus, 
    Trash2, 
    Link as LinkIcon, 
    Code, 
    Database, 
    ArrowRight,
    Search,
    Type,
    Brain,
    Binary
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";

interface TransformationRule {
    id: string;
    sourcePath: string;
    targetPath: string;
    type: "direct" | "wrap_object" | "map_value" | "parse_json" | "to_string" | "extract_field" | "custom_script" | "template";
    template?: string;
    targetType: "string" | "number" | "boolean" | "date" | "json" | "array";
    config?: any;
}

interface TransformationJobConfigProps {
    config: {
        rules: TransformationRule[];
        inputSource: "previous_step" | "provided";
        entityExtraction?: {
            enabled: boolean;
            autoCreate: boolean;
        };
    };
    onChange: (config: any) => void;
    availableVariables?: any[];
    outputSchema?: any;
}

export default function TransformationJobConfig({ config, onChange, availableVariables = [] }: TransformationJobConfigProps) {
    const [activeTab, setActiveTab] = useState("rules");

    // Ensure config is safe
    const safeConfig = {
        ...config,
        rules: config.rules || [],
        inputSource: config.inputSource || "previous_step",
        entityExtraction: config.entityExtraction || { enabled: false, autoCreate: true },
    };

    const updateConfig = (updates: Partial<typeof safeConfig>) => {
        onChange({ ...safeConfig, ...updates });
    };

    const addRule = () => {
        const newRule: TransformationRule = {
            id: Math.random().toString(36).substring(7),
            sourcePath: "",
            targetPath: "",
            type: "direct",
            targetType: "string"
        };
        updateConfig({ rules: [...safeConfig.rules, newRule] });
    };

    const updateRule = (id: string, updates: Partial<TransformationRule>) => {
        const newRules = safeConfig.rules.map(r => r.id === id ? { ...r, ...updates } : r);
        updateConfig({ rules: newRules });
    };

    const removeRule = (id: string) => {
        updateConfig({ rules: safeConfig.rules.filter(r => r.id !== id) });
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                        <Zap className="w-5 h-5 text-indigo-500" />
                    </div>
                    <div>
                        <h3 className="text-sm font-black uppercase tracking-widest leading-none">Data Alchemy Engine</h3>
                        <p className="text-[10px] text-muted-foreground mt-1">Transform, map, and extrude data structures with surgical precision.</p>
                    </div>
                </div>
                
                <Tabs value={activeTab} onValueChange={setActiveTab} className="h-8">
                    <TabsList className="bg-background/50 border h-8 p-0.5">
                        <TabsTrigger value="rules" className="text-[9px] uppercase font-bold tracking-tighter px-3 h-7">Matrix Rules</TabsTrigger>
                        <TabsTrigger value="extraction" className="text-[9px] uppercase font-bold tracking-tighter px-3 h-7">Entity Extraction</TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            <TabsContent value="rules" className="mt-0 space-y-6">
                <div className="space-y-4">
                    {safeConfig.rules.map((rule, idx) => (
                        <Card key={rule.id} className="border-border/40 overflow-hidden bg-muted/5 group">
                            <CardHeader className="py-2 px-4 bg-muted/20 border-b flex flex-row items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Badge variant="secondary" className="bg-background text-[9px] font-mono opacity-60">RULE #{idx + 1}</Badge>
                                    <span className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground">{rule.type}</span>
                                </div>
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-6 w-6 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => removeRule(rule.id)}
                                >
                                    <Trash2 className="w-3 h-3" />
                                </Button>
                            </CardHeader>
                            <CardContent className="p-4">
                                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                                    <div className="md:col-span-5 space-y-1.5">
                                        <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Source Path (JSON Path)</Label>
                                        <div className="relative">
                                            <Input 
                                                className="h-8 text-xs font-mono bg-background" 
                                                placeholder="e.g. data.customer.name"
                                                value={rule.sourcePath}
                                                onChange={(e) => updateRule(rule.id, { sourcePath: e.target.value })}
                                            />
                                            <Search className="w-3 h-3 absolute right-2.5 top-2.5 text-muted-foreground/30" />
                                        </div>
                                    </div>
                                    
                                    <div className="md:col-span-1 flex justify-center pb-2 text-muted-foreground/30">
                                        <ArrowRight className="w-4 h-4" />
                                    </div>

                                    <div className="md:col-span-5 space-y-1.5">
                                        <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Target Key</Label>
                                        <Input 
                                            className="h-8 text-xs font-mono bg-background border-indigo-500/10 focus-visible:border-indigo-500/30" 
                                            placeholder="e.g. full_name"
                                            value={rule.targetPath}
                                            onChange={(e) => updateRule(rule.id, { targetPath: e.target.value })}
                                        />
                                    </div>

                                    <div className="md:col-span-12 grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t border-dashed mt-2 opacity-80 group-hover:opacity-100 transition-opacity">
                                        <div className="space-y-1">
                                            <Label className="text-[8px] uppercase font-bold text-muted-foreground">Transformation</Label>
                                            <Select value={rule.type} onValueChange={(v: any) => updateRule(rule.id, { type: v })}>
                                                <SelectTrigger className="h-7 text-[10px] bg-background">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="direct">Direct Copy</SelectItem>
                                                    <SelectItem value="template">Liquid Template</SelectItem>
                                                    <SelectItem value="to_string">To String</SelectItem>
                                                    <SelectItem value="parse_json">Parse JSON</SelectItem>
                                                    <SelectItem value="custom_script">Custom JS</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[8px] uppercase font-bold text-muted-foreground">Target Type</Label>
                                            <Select value={rule.targetType} onValueChange={(v: any) => updateRule(rule.id, { targetType: v })}>
                                                <SelectTrigger className="h-7 text-[10px] bg-background">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="string">String</SelectItem>
                                                    <SelectItem value="number">Number</SelectItem>
                                                    <SelectItem value="boolean">Boolean</SelectItem>
                                                    <SelectItem value="json">JSON Object</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    {rule.type === 'template' && (
                                        <div className="md:col-span-12 pt-2">
                                            <Label className="text-[9px] uppercase font-black tracking-widest opacity-50 mb-1.5 block">Liquid Template</Label>
                                            <Textarea 
                                                className="min-h-[60px] text-[11px] font-mono bg-background" 
                                                placeholder="Hello {{source}}, welcome to {{system.name}}"
                                                value={rule.template || ""}
                                                onChange={(e) => updateRule(rule.id, { template: e.target.value })}
                                            />
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))}

                    <Button 
                        variant="outline" 
                        className="w-full border-dashed py-8 border-primary/20 bg-muted/10 hover:bg-primary/5 hover:border-primary/40 transition-all group"
                        onClick={addRule}
                    >
                        <div className="flex flex-col items-center gap-2">
                            <Plus className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                            <span className="text-[10px] uppercase font-black tracking-widest text-muted-foreground group-hover:text-primary">Append Transformation Rule</span>
                        </div>
                    </Button>
                </div>
            </TabsContent>

            <TabsContent value="extraction" className="mt-0 space-y-6">
                <Card className="border-border/40 bg-muted/5">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <CardTitle className="text-sm font-bold uppercase tracking-tight">Semantic Extraction</CardTitle>
                                <CardDescription className="text-[10px]">Automatically identify and register Knowledge Graph entities from the payload.</CardDescription>
                            </div>
                            <Switch 
                                checked={safeConfig.entityExtraction.enabled}
                                onCheckedChange={(v) => updateConfig({ 
                                    entityExtraction: { ...safeConfig.entityExtraction, enabled: v } 
                                })}
                            />
                        </div>
                    </CardHeader>
                    {safeConfig.entityExtraction.enabled && (
                        <CardContent className="space-y-6 border-t pt-6 bg-background/30">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="p-4 rounded-xl border bg-background space-y-3">
                                    <div className="flex items-center gap-2">
                                        <Brain className="w-3.5 h-3.5 text-indigo-500" />
                                        <h4 className="text-[10px] font-black uppercase tracking-widest">Natural Language Context</h4>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                                        When enabled, the transformer will attempt to "Hallucinate-to-Fact" any identified companies, products, or people found in the source data.
                                    </p>
                                    <div className="flex items-center justify-between pt-2">
                                        <Label className="text-[9px] uppercase font-bold tracking-tight">Auto-Register Entities</Label>
                                        <Switch 
                                            checked={safeConfig.entityExtraction.autoCreate}
                                            onCheckedChange={(v) => updateConfig({ 
                                                entityExtraction: { ...safeConfig.entityExtraction, autoCreate: v } 
                                            })}
                                        />
                                    </div>
                                </div>
                                <div className="p-4 rounded-xl border bg-background space-y-3 flex flex-col justify-center items-center text-center opacity-40">
                                    <Binary className="w-6 h-6 mb-2" />
                                    <span className="text-[9px] uppercase font-black tracking-widest">Custom Extractors (vNext)</span>
                                </div>
                            </div>
                        </CardContent>
                    )}
                </Card>
            </TabsContent>
            
            <Separator className="opacity-50" />
            
            <div className="flex items-center gap-6 p-4 rounded-2xl bg-muted/20 border border-indigo-500/10">
                <div className="space-y-1 flex-1">
                    <Label className="text-[10px] uppercase font-black tracking-widest opacity-70">Primary Input Stream</Label>
                    <Select value={safeConfig.inputSource} onValueChange={(v: any) => updateConfig({ inputSource: v })}>
                        <SelectTrigger className="h-9 bg-background">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="previous_step">Direct Sequence (Previous Step Output)</SelectItem>
                            <SelectItem value="provided">External Manifest (Trigger Params)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="w-1/3 p-3 bg-background/50 rounded-xl border flex items-center justify-center gap-2">
                    <Database className="w-4 h-4 text-muted-foreground" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Context: {availableVariables.length} Vars Available</span>
                </div>
            </div>
        </div>
    );
}
