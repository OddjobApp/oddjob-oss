import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@domain-ui/core/ui/components/ui/form";
import { MessageSquareCode, Loader2, Wand2, Database, FileText, Plus, X } from "lucide-react";
import { UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { formSchema } from '../types/index.js';
import { FileDropzone } from "@domain-ui/core/ui/components/ui/file-dropzone";
import { cn } from "@/lib/utils";
import { Checkbox } from "@domain-ui/core/ui/components/ui/checkbox";
import { Activity, ShieldCheck, MessageSquare, Coins, Target, Zap, BarChart } from "lucide-react";
import { StrategySelector } from "@/modules/missions/components";
import { ExecutionStrategy } from "@/modules/missions/config/mission-strategies.config";

interface MissionBriefStepProps {
    activeTab: "ai" | "manual";
    setActiveTab: (val: "ai" | "manual") => void;
    aiPrompt: string;
    setAiPrompt: (val: string) => void;
    EXAMPLE_PROMPTS: string[];
    DELIVERABLE_TYPES: string[];
    selectedDeliverables: string[];
    setSelectedDeliverables: React.Dispatch<React.SetStateAction<string[]>>;
    planMutation: any;
    form: UseFormReturn<z.infer<typeof formSchema>>;
    availableAssets: any[];
    selectedAssets: any[];
    setSelectedAssets: React.Dispatch<React.SetStateAction<any[]>>;
    pickingAssetId: string;
    setPickingAssetId: (val: string) => void;
    pickingAssetPurpose: string;
    setPickingAssetPurpose: (val: string) => void;
    isUploading: boolean;
    handleFileUpload: (file: File) => void;
    availableTemplatesData: any[];
    selectedTemplates: any[];
    setSelectedTemplates: React.Dispatch<React.SetStateAction<any[]>>;
    pickingTemplateId: string;
    setPickingTemplateId: (val: string) => void;
    pickingTemplateRole: string;
    setPickingTemplateRole: (val: string) => void;
    nextStep: () => void;
}

export function MissionBriefStep({
    activeTab,
    setActiveTab,
    aiPrompt,
    setAiPrompt,
    EXAMPLE_PROMPTS,
    DELIVERABLE_TYPES,
    selectedDeliverables,
    setSelectedDeliverables,
    planMutation,
    form,
    availableAssets,
    selectedAssets,
    setSelectedAssets,
    pickingAssetId,
    setPickingAssetId,
    pickingAssetPurpose,
    setPickingAssetPurpose,
    isUploading,
    handleFileUpload,
    availableTemplatesData,
    selectedTemplates,
    setSelectedTemplates,
    pickingTemplateId,
    setPickingTemplateId,
    pickingTemplateRole,
    setPickingTemplateRole,
    nextStep
}: MissionBriefStepProps) {
    return (
        <Tabs value={activeTab} onValueChange={setActiveTab as any} className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-card border-border">
                <TabsTrigger value="ai" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-2">
                    <MessageSquareCode className="w-3 h-3" />
                    Mission Command
                </TabsTrigger>
                <TabsTrigger value="manual" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground uppercase text-[10px] font-bold font-mono">Stand Alone</TabsTrigger>
            </TabsList>

            <TabsContent value="ai" className="space-y-4 pt-4">
                <div className="space-y-2">
                    <label className="text-sm font-medium leading-none text-muted-foreground font-mono text-[10px] uppercase">Mission Brief</label>
                    <Textarea
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder="Broadcast your mission intent. Mission Command will architect the workstream and recruit the necessary specialized agents."
                        className="min-h-[150px] bg-card border-border focus:ring-primary text-sm font-mono placeholder:opacity-30"
                    />
                    <div className="flex flex-wrap gap-2 pt-2">
                        <span className="text-[10px] text-muted-foreground w-full mb-1 uppercase font-bold font-mono">Quick Start Suggestions:</span>
                        {EXAMPLE_PROMPTS.map((p, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => setAiPrompt(p)}
                                className="text-[10px] bg-card hover:bg-muted border border-border rounded px-2 py-1 text-muted-foreground transition-colors font-mono"
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground uppercase font-bold font-mono">Target Products</label>
                    <div className="flex flex-wrap gap-1.5">
                        {DELIVERABLE_TYPES.map(type => (
                            <Badge
                                key={type}
                                variant={selectedDeliverables.includes(type) ? "default" : "outline"}
                                className={`cursor-pointer text-[9px] uppercase tracking-wider py-0.5 h-5 ${selectedDeliverables.includes(type)
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "border-border text-muted-foreground hover:border-border"
                                    }`}
                                onClick={() => setSelectedDeliverables(prev =>
                                    prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                                )}
                            >
                                {type}
                            </Badge>
                        ))}
                    </div>
                    {selectedDeliverables.includes("Agentic App Forge") && (
                        <div className="mt-4 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 flex items-start gap-4 animate-in fade-in slide-in-from-top-2 duration-500 font-mono">
                            <Zap className="w-5 h-5 text-amber-500 mt-1 fill-amber-500/20" />
                            <div>
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-amber-500 mb-1">Industrial Forge Mode Active</h4>
                                <p className="text-[9px] text-muted-foreground leading-relaxed">
                                    This mission will utilize the **Oddjob Industrial Forge**. Agents will autonomously construct, containerize, and deploy a versioned App Arsenal app.
                                    <span className="text-amber-500/80 font-bold ml-1">Requires Docker Runtime.</span>
                                </p>
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex justify-end pt-4">
                    <Button
                        onClick={() => planMutation.mutate()}
                        disabled={!aiPrompt || planMutation.isPending}
                        className="bg-primary hover:bg-primary/90 w-full sm:w-auto font-bold uppercase text-xs"
                    >
                        {planMutation.isPending ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Designing...</>
                        ) : (
                            <><Wand2 className="w-4 h-4 mr-2" />Generate Team Plan</>
                        )}
                    </Button>
                </div>
            </TabsContent>

            <TabsContent value="manual" className="space-y-4 pt-4">
                <Form {...form}>
                    <div className="space-y-6">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="font-mono text-[10px] uppercase text-muted-foreground">Mission Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g. Q1 Marketing Campaign" {...field} className="bg-card border-border focus:ring-primary" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="executionStrategy"
                            render={({ field }) => (
                                <FormItem>
                                    <StrategySelector 
                                        value={field.value as ExecutionStrategy}
                                        onChange={(strategy) => field.onChange(strategy)}
                                    />
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="reasoningProtocol"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="font-mono text-[10px] uppercase text-muted-foreground">Reasoning Protocol</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl>
                                            <SelectTrigger className="bg-card border-border h-10 w-full focus:ring-primary text-xs">
                                                <SelectValue placeholder="Select a protocol" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="json_manifest">Standard (JSON Manifest)</SelectItem>
                                            <SelectItem value="hermes_xml">Hermes (Conversational XML)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <div className="text-[10px] text-muted-foreground mt-1">
                                        {field.value === "hermes_xml" ? (
                                            <span className="text-amber-500">Hermes protocol enables deeper reasoning and an 'Internal Monologue' in the trace.</span>
                                        ) : (
                                            <span>Standard protocol uses structured JSON for direct tool execution.</span>
                                        )}
                                    </div>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {form.watch("executionStrategy") === "dynamic_autonomous" && (
                            <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <ShieldCheck className="w-4 h-4 text-primary" />
                                    <h3 className="text-xs font-black uppercase tracking-widest text-primary">Dynamic Rules of Engagement</h3>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="dynamicCycleBudgetLimitUsd"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="font-mono text-[9px] uppercase text-muted-foreground">Cycle Budget Limit (USD)</FormLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <Coins className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                                        <Input type="number" step="0.01" className="pl-9 bg-card border-border focus:ring-primary" {...field} />
                                                    </div>
                                                </FormControl>
                                                <div className="text-[9px] text-muted-foreground italic mt-1">Maximum spend allowed per OODA cycle.</div>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="hilStrictness"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="font-mono text-[9px] uppercase text-muted-foreground">HIL Strictness</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="bg-card border-border focus:ring-primary h-10">
                                                            <SelectValue placeholder="Select strictness" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="lenient">Lenient (Intervene only on alert)</SelectItem>
                                                        <SelectItem value="moderate">Moderate (Confirm major tactics)</SelectItem>
                                                        <SelectItem value="strict">Strict (Approve every cycle)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <FormField
                                    control={form.control}
                                    name="hilNotificationChannels"
                                    render={() => (
                                        <FormItem>
                                            <FormLabel className="font-mono text-[9px] uppercase text-muted-foreground">Notification Channels</FormLabel>
                                            <div className="flex gap-4 pt-1">
                                                {['inbox', 'slack', 'sms'].map((item) => (
                                                    <FormField
                                                        key={item}
                                                        control={form.control}
                                                        name="hilNotificationChannels"
                                                        render={({ field }) => {
                                                            return (
                                                                <FormItem key={item} className="flex flex-row items-start space-x-2 space-y-0">
                                                                    <FormControl>
                                                                        <Checkbox
                                                                            checked={field.value?.includes(item)}
                                                                            onCheckedChange={(checked) => {
                                                                                return checked
                                                                                    ? field.onChange([...field.value, item])
                                                                                    : field.onChange(
                                                                                        field.value?.filter(
                                                                                            (value: string) => value !== item
                                                                                        )
                                                                                    )
                                                                            }}
                                                                            className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                                                        />
                                                                    </FormControl>
                                                                    <FormLabel className="text-[10px] uppercase font-bold text-muted-foreground cursor-pointer">
                                                                        {item}
                                                                    </FormLabel>
                                                                </FormItem>
                                                            )
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        )}
                        {/* Optimization Goal (Phase 1 Autoresearch) */}
                        <div className="p-4 rounded-xl border border-dashed border-primary/30 bg-primary/5 space-y-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Target className="w-4 h-4 text-primary" />
                                <h3 className="text-[10px] font-black uppercase tracking-widest text-primary">Optimization Goal</h3>
                                <Badge variant="outline" className="text-[8px] h-4 px-1 lowercase font-mono opacity-50">Phase 1: Metrics</Badge>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="targetMetric.type"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="font-mono text-[9px] uppercase text-muted-foreground">Target Metric</FormLabel>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="bg-card border-border h-9 text-xs focus:ring-primary">
                                                        <SelectValue placeholder="Select metric" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="latency_total_seconds">Total Latency (Seconds)</SelectItem>
                                                    <SelectItem value="latency_per_step">Per-Step Latency (MS)</SelectItem>
                                                    <SelectItem value="cost_usd">Total Cost (USD)</SelectItem>
                                                    <SelectItem value="accuracy_score">Accuracy Score (0-1)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="targetMetric.target"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="font-mono text-[9px] uppercase text-muted-foreground">Target Value</FormLabel>
                                            <FormControl>
                                                <div className="relative">
                                                    <Zap className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                                                    <Input type="text" className="pl-9 h-9 bg-card border-border text-xs focus:ring-primary" placeholder="e.g. 30" {...field} />
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <div className="text-[9px] text-muted-foreground italic flex items-center gap-1.5 opacity-60">
                                <BarChart className="w-3 h-3" />
                                <span>Establishing baseline for Phase 3 recursive optimization.</span>
                            </div>

                            <FormField
                                control={form.control}
                                name="isShadowMode"
                                render={({ field }) => (
                                    <FormItem className="flex flex-row items-start space-x-2 space-y-0 p-3 bg-primary/10 rounded-lg border border-primary/20">
                                        <FormControl>
                                            <Checkbox
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                className="border-primary/50 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                            />
                                        </FormControl>
                                        <div className="space-y-1 leading-none">
                                            <FormLabel className="text-[10px] uppercase font-black text-primary cursor-pointer flex items-center gap-1.5">
                                                <Zap className="w-3 h-3" />
                                                Activate Shadow Mode
                                            </FormLabel>
                                            <p className="text-[9px] text-muted-foreground leading-tight">
                                                Enables parallel, non-mutating agent evaluation in the sandbox for prompt/model comparison.
                                            </p>
                                        </div>
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="objective"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="font-mono text-[10px] uppercase text-muted-foreground">Mission Objective</FormLabel>
                                    <FormControl>
                                        <Textarea
                                            placeholder="Describe the ultimate goal..."
                                            className="min-h-[120px] bg-card border-border focus:ring-primary"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <div className="space-y-2">
                            <label className="text-[10px] text-muted-foreground uppercase font-bold font-mono">Target Products</label>
                            <div className="flex flex-wrap gap-1.5">
                                {DELIVERABLE_TYPES.map(type => (
                                    <Badge
                                        key={type}
                                        variant={selectedDeliverables.includes(type) ? "default" : "outline"}
                                        className={`cursor-pointer text-[9px] uppercase tracking-wider py-0.5 h-5 ${selectedDeliverables.includes(type)
                                            ? "bg-primary text-primary-foreground border-primary"
                                            : "border-border text-muted-foreground hover:border-border"
                                            }`}
                                        onClick={() => setSelectedDeliverables(prev =>
                                            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                                        )}
                                    >
                                        {type}
                                    </Badge>
                                ))}
                            </div>
                        </div>

                        {/* Mission Resources */}
                        <div className="space-y-3 pt-2">
                            <label className="text-[10px] text-muted-foreground uppercase font-bold font-mono">Knowledge Assets</label>
                            <div className="flex items-center gap-2">
                                <Select value={pickingAssetId} onValueChange={setPickingAssetId}>
                                    <SelectTrigger className="flex-1 bg-card border-border h-8 text-xs">
                                        <SelectValue placeholder="Attach a knowledge asset..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableAssets.filter(a => !selectedAssets.some(s => s.id === a.id)).map(a => (
                                            <SelectItem key={a.id} value={String(a.id)}>
                                                <span className="flex items-center gap-2">
                                                    <Database className="w-3 h-3 text-muted-foreground" />
                                                    {a.name}
                                                    <span className="text-muted-foreground text-[10px]">({a.assetType})</span>
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select value={pickingAssetPurpose} onValueChange={setPickingAssetPurpose}>
                                    <SelectTrigger className="w-[120px] bg-card border-border h-8 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="example">Example</SelectItem>
                                        <SelectItem value="blueprint">Blueprint</SelectItem>
                                        <SelectItem value="reference">Reference</SelectItem>
                                        <SelectItem value="context">Context</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Button
                                    type="button"
                                    size="sm"
                                    className="bg-primary hover:bg-primary/90 h-8 px-2"
                                    disabled={!pickingAssetId || isUploading}
                                    onClick={() => {
                                        const asset = availableAssets.find(a => a.id === parseInt(pickingAssetId));
                                        if (asset) {
                                            setSelectedAssets(prev => [...prev, { id: asset.id, name: asset.name, purpose: pickingAssetPurpose }]);
                                            setPickingAssetId("");
                                        }
                                    }}
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                </Button>
                            </div>

                            <div className="pt-1">
                                <FileDropzone
                                    onFileSelect={handleFileUpload}
                                    maxSize={10 * 1024 * 1024}
                                    accept=".pdf,.txt,.csv,.md,.json"
                                    label={isUploading ? "Uploading..." : "Drag files here to include in mission context"}
                                    description="PDF, TXT, CSV, MD, JSON supported (Max 10MB)"
                                    className={cn(isUploading && "opacity-50 pointer-events-none")}
                                />
                            </div>

                            {selectedAssets.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {selectedAssets.map(a => (
                                        <Badge key={a.id} variant="outline" className="border-border text-foreground text-[10px] gap-1 pr-1">
                                            <Database className="w-2.5 h-2.5 text-primary" />
                                            {a.name}
                                            <span className="text-muted-foreground">({a.purpose})</span>
                                            <button type="button" title="Remove asset" onClick={() => setSelectedAssets(prev => prev.filter(x => x.id !== a.id))} className="ml-0.5 hover:text-red-400">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="space-y-3">
                            <label className="text-[10px] text-muted-foreground uppercase font-bold font-mono">Document Blueprints</label>
                            <div className="flex items-center gap-2">
                                <Select value={pickingTemplateId} onValueChange={setPickingTemplateId}>
                                    <SelectTrigger className="flex-1 bg-card border-border h-8 text-xs">
                                        <SelectValue placeholder="Attach a document blueprint..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableTemplatesData.filter(t => !selectedTemplates.some(s => s.id === t.id)).map(t => (
                                            <SelectItem key={t.id} value={String(t.id)}>
                                                <span className="flex items-center gap-2">
                                                    <FileText className="w-3 h-3 text-muted-foreground" />
                                                    {t.name}
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select value={pickingTemplateRole} onValueChange={setPickingTemplateRole}>
                                    <SelectTrigger className="w-[140px] bg-card border-border h-8 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="output_standard">Output Standard</SelectItem>
                                        <SelectItem value="tool">Mission Tool</SelectItem>
                                        <SelectItem value="reference">Reference</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Button
                                    type="button"
                                    size="sm"
                                    className="bg-primary hover:bg-primary/90 h-8 px-2"
                                    disabled={!pickingTemplateId}
                                    onClick={() => {
                                        const tmpl = availableTemplatesData.find(t => t.id === parseInt(pickingTemplateId));
                                        if (tmpl) {
                                            setSelectedTemplates(prev => [...prev, { id: tmpl.id, name: tmpl.name, role: pickingTemplateRole }]);
                                            setPickingTemplateId("");
                                        }
                                    }}
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                            {selectedTemplates.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {selectedTemplates.map(t => (
                                        <Badge key={t.id} variant="outline" className="border-border text-foreground text-[10px] gap-1 pr-1">
                                            <FileText className="w-2.5 h-2.5 text-primary" />
                                            {t.name}
                                            <span className="text-muted-foreground">({t.role === "output_standard" ? "output" : t.role})</span>
                                            <button type="button" title="Remove blueprint" onClick={() => setSelectedTemplates(prev => prev.filter(x => x.id !== t.id))} className="ml-0.5 hover:text-red-400">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end pt-4">
                            <Button 
                                onClick={nextStep} 
                                disabled={planMutation.isPending}
                                className="bg-primary hover:bg-primary/90 font-bold uppercase text-xs"
                            >
                                {planMutation.isPending ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Architecting...
                                    </>
                                ) : (
                                    "Next: Strategic Plan"
                                )}
                            </Button>
                        </div>
                    </div>
                </Form>
            </TabsContent>
        </Tabs>
    );
}
