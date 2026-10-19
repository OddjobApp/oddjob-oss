import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { 
    Plus, 
    Trash2, 
    GripVertical, 
    Eye, 
    Layout, 
    Settings2, 
    Zap, 
    FileText, 
    Database, 
    Clock,
    ChevronRight,
    Type,
    Hash,
    CheckSquare,
    Mail,
    Calendar,
    ChevronDown,
    Wand2,
    Monitor
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import "./jobs-components.css";

const FIELD_TYPES = [
    { value: "text", label: "Text", icon: Type },
    { value: "boolean", label: "Checkbox", icon: CheckSquare },
    { value: "select", label: "Dropdown", icon: ChevronDown },
    { value: "textarea", label: "Long Text", icon: FileText },
    { value: "markdown", label: "Markdown", icon: FileText },
    { value: "rating", label: "Rating", icon: Hash },
];

interface FormField {
    key: string;
    label: string;
    type: string;
    required?: boolean;
    placeholder?: string;
    options?: string[];
    stepId?: string;
}

interface FormStep {
    id: string;
    title: string;
    description?: string;
}

interface FormAgentConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function FormAgentConfig({ config, onChange }: FormAgentConfigProps) {
    const { data: templatesData }: any = useQuery({ queryKey: ["/api/templates"] });
    const { data: datasetsData }: any = useQuery({ queryKey: ["/api/datasets"] });
    const [activeTab, setActiveTab] = useState("fields");
    const [previewStep, setPreviewStep] = useState(0);

    const templates = templatesData?.templates ?? templatesData ?? [];
    const datasets = datasetsData?.datasets ?? datasetsData ?? [];

    const set = (field: string, value: any) => onChange({ ...config, [field]: value });

    const formFields: FormField[] = Array.isArray(config.formSchema?.fields) ? config.formSchema.fields : [];
    const formSteps: FormStep[] = Array.isArray(config.steps) ? config.steps : [{ id: "default", title: "General Information" }];

    // Which fields render under a given step. Fields with no stepId — or a stepId that
    // matches no existing step — are "orphans" (e.g. AI-extracted fields from template
    // conversion never carry a stepId) and must fall into the FIRST step, otherwise they
    // exist in config.formSchema.fields but render nowhere (the reported "schema not showing").
    const stepIdSet = new Set(formSteps.map(s => s.id));
    const fieldsForStep = (step: FormStep, stepIndex: number): FormField[] =>
        formFields.filter(f => {
            if (f.stepId === step.id) return true;
            if (stepIndex === 0 && (f.stepId == null || !stepIdSet.has(f.stepId))) return true;
            return false;
        });

    const addField = (stepId?: string) => {
        set("formSchema", { fields: [...formFields, {
            key: `field_${formFields.length + 1}`,
            label: "New Field", 
            type: "text", 
            required: false,
            stepId: stepId || formSteps[0].id
        }] });
    };

    const updateField = (index: number, updates: Partial<FormField>) => {
        const updated = formFields.map((f, i) => i === index ? { ...f, ...updates } : f);
        set("formSchema", { fields: updated });
    };

    const removeField = (index: number) => {
        set("formSchema", { fields: formFields.filter((_, i) => i !== index) });
    };

    const addStep = () => {
        const newStepId = `step_${formSteps.length + 1}`;
        set("steps", [...formSteps, { id: newStepId, title: `Step ${formSteps.length + 1}` }]);
    };

    const updateStep = (index: number, updates: Partial<FormStep>) => {
        const updated = formSteps.map((s, i) => i === index ? { ...s, ...updates } : s);
        set("steps", updated);
    };

    const removeStep = (index: number) => {
        const stepToDelete = formSteps[index];
        const newSteps = formSteps.filter((_, i) => i !== index);
        // Reassign fields in this step to the first step or hide them? 
        // For now, move them to the first available step.
        const firstStepId = newSteps[0]?.id;
        const newFields = formFields.map(f => f.stepId === stepToDelete.id ? { ...f, stepId: firstStepId } : f);
        
        onChange({ ...config, steps: newSteps, formSchema: { fields: newFields } });
    };

    return (
        <div className="flex bg-background/50 backdrop-blur-xl h-full min-h-[600px] rounded-xl overflow-hidden border border-foreground/5 divide-x divide-white/5 animate-in fade-in zoom-in duration-500">
            {/* Left Column: Designer */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="p-4 border-b border-foreground/5 bg-foreground/5 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md">
                    <div className="flex items-center gap-2">
                        <Wand2 className="w-4 h-4 text-primary" />
                        <span className="text-xs font-black uppercase tracking-[0.2em]">Visual Designer</span>
                    </div>
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <div className="px-4 pt-4">
                        <TabsList className="bg-background/20 border border-foreground/5 h-10 p-1 w-full flex">
                            <TabsTrigger value="fields" className="flex-1 flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all">
                                <Layout className="w-3.5 h-3.5" /> Fields
                            </TabsTrigger>
                            <TabsTrigger value="steps" className="flex-1 flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all">
                                <ChevronRight className="w-3.5 h-3.5" /> Steps
                            </TabsTrigger>
                            <TabsTrigger value="settings" className="flex-1 flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all">
                                <Settings2 className="w-3.5 h-3.5" /> Settings
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    <TabsContent value="fields" className="p-4 space-y-4 focus-visible:ring-0">
                        {formSteps.map((step, stepIndex) => (
                            <div key={step.id} className="space-y-3">
                                <div className="flex items-center justify-between px-1">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-[9px] font-black tracking-widest uppercase py-0">{step.title}</Badge>
                                        <span className="text-[10px] text-muted-foreground/60 font-bold uppercase tracking-widest">{fieldsForStep(step, stepIndex).length} Fields</span>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => addField(step.id)}
                                        className="h-6 px-2 text-[9px] font-black uppercase tracking-widest text-primary hover:bg-primary/10"
                                    >
                                        <Plus className="w-3 h-3 mr-1" /> Add Field
                                    </Button>
                                </div>

                                <div className="space-y-2">
                                    {fieldsForStep(step, stepIndex).map((field, idx) => {
                                        const globalIdx = formFields.findIndex(f => f === field);
                                        const FieldIcon = FIELD_TYPES.find(t => t.value === field.type)?.icon || Type;
                                        
                                        return (
                                            <Card key={globalIdx} className="group border-foreground/5 bg-foreground/[0.02] hover:bg-foreground/[0.04] hover:shadow-xl transition-all duration-300">
                                                <CardContent className="p-3">
                                                    <div className="flex gap-3">
                                                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
                                                            <FieldIcon className="w-4 h-4 text-primary shrink-0" />
                                                        </div>
                                                        <div className="flex-1 min-w-0 space-y-2">
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div className="space-y-1">
                                                                    <Label className="text-[8px] font-black text-muted-foreground/50 uppercase tracking-widest">Field Identifier</Label>
                                                                    <Input 
                                                                        className="h-7 text-[10px] font-mono bg-background/20 border-foreground/5" 
                                                                        value={field.key}
                                                                        onChange={e => updateField(globalIdx, { key: e.target.value })}
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[8px] font-black text-muted-foreground/50 uppercase tracking-widest">Display Label</Label>
                                                                    <Input 
                                                                        className="h-7 text-[10px] font-bold bg-background/20 border-foreground/5" 
                                                                        value={field.label}
                                                                        onChange={e => updateField(globalIdx, { label: e.target.value })}
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <Select 
                                                                    value={field.type} 
                                                                    onValueChange={v => updateField(globalIdx, { type: v })}
                                                                >
                                                                    <SelectTrigger className="h-6 text-[9px] font-bold uppercase tracking-widest w-[110px] bg-background/20 border-foreground/5">
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {FIELD_TYPES.map(t => (
                                                                            <SelectItem key={t.value} value={t.value} className="text-[10px] font-bold uppercase tracking-widest">
                                                                                <div className="flex items-center gap-2">
                                                                                    <t.icon className="w-3 h-3 text-primary" />
                                                                                    {t.label}
                                                                                </div>
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                                <Separator orientation="vertical" className="h-4 bg-foreground/10" />
                                                                <div className="flex items-center gap-1.5 px-2">
                                                                    <button
                                                                        onClick={() => updateField(globalIdx, { required: !field.required })}
                                                                        className={cn(
                                                                            "text-[9px] font-black uppercase tracking-widest border px-1.5 py-0.5 rounded transition-all",
                                                                            field.required ? "bg-primary/20 text-primary border-primary/30 shadow-[0_0_8px_rgba(var(--primary),0.3)]" : "text-muted-foreground/40 border-foreground/10 hover:border-foreground/20"
                                                                        )}
                                                                    >
                                                                        {field.required ? "Required" : "Optional"}
                                                                    </button>
                                                                </div>
                                                                <div className="flex-1" />
                                                                <Button 
                                                                    variant="ghost" 
                                                                    size="icon" 
                                                                    className="h-6 w-6 text-muted-foreground/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                                                                    onClick={() => removeField(globalIdx)}
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                </Button>
                                                            </div>
                                                            
                                                            {field.type === "select" && (
                                                                <div className="space-y-1 animate-in slide-in-from-top-1 duration-200">
                                                                    <Label className="text-[8px] font-black text-muted-foreground/50 uppercase tracking-widest italic">Options (comma-separated list)</Label>
                                                                    <Input
                                                                        className="h-7 text-[10px] bg-background/20 border-foreground/5"
                                                                        value={Array.isArray(field.options) ? field.options.join(", ") : ""}
                                                                        onChange={e => updateField(globalIdx, { options: e.target.value.split(",").map(v => v.trim()).filter(Boolean) })}
                                                                        placeholder="Blue, Red, Green"
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </TabsContent>

                    <TabsContent value="steps" className="p-4 space-y-4 focus-visible:ring-0">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Sequence Definition</span>
                            <Button
                                size="sm"
                                onClick={addStep}
                                className="h-7 px-3 text-[10px] font-black uppercase tracking-widest bg-primary/20 text-primary hover:bg-primary/30"
                            >
                                <Plus className="w-3.5 h-3.5 mr-1" /> Add Step
                            </Button>
                        </div>
                        <div className="space-y-3">
                            {formSteps.map((step, idx) => (
                                <div key={step.id} className="relative group">
                                    <Card className="border-foreground/5 bg-foreground/[0.02] overflow-hidden group-hover:border-primary/20 transition-all duration-300">
                                        <CardContent className="p-0">
                                            <div className="flex items-center">
                                                <div className="w-10 flex items-center justify-center border-r border-foreground/5 h-16 bg-foreground/[0.05]">
                                                    <span className="text-sm font-black text-primary/40 italic">{idx + 1}</span>
                                                </div>
                                                <div className="flex-1 p-3 space-y-1">
                                                    <Input
                                                        className="h-8 bg-transparent border-none focus-visible:ring-0 text-xs font-black uppercase tracking-widest px-0"
                                                        value={step.title}
                                                        onChange={e => updateStep(idx, { title: e.target.value })}
                                                        placeholder="Step Title"
                                                    />
                                                    <Input
                                                        className="h-6 bg-transparent border-none focus-visible:ring-0 text-[10px] text-muted-foreground italic px-0"
                                                        value={step.description || ""}
                                                        onChange={e => updateStep(idx, { description: e.target.value })}
                                                        placeholder="Step description (optional)..."
                                                    />
                                                </div>
                                                {formSteps.length > 1 && (
                                                    <div className="px-3">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => removeStep(idx)}
                                                            className="h-8 w-8 text-muted-foreground/40 hover:text-red-400 hover:bg-red-400/10"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>
                            ))}
                        </div>
                    </TabsContent>

                    <TabsContent value="settings" className="p-4 space-y-6 focus-visible:ring-0">
                        <div className="space-y-4 pt-2">
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                    <FileText className="w-3.5 h-3.5" /> Output Manifestation
                                </Label>
                                <Select
                                    value={config.documentTemplateId?.toString()}
                                    onValueChange={(v) => set("documentTemplateId", parseInt(v))}
                                >
                                    <SelectTrigger className="h-9 bg-background/40 border-foreground/5 text-[11px] font-bold uppercase tracking-widest">
                                        <SelectValue placeholder="Select document template..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {templates.map((t: any) => (
                                            <SelectItem key={t.id} value={t.id.toString()} className="text-[11px] font-bold uppercase tracking-widest">{t.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-[9px] text-muted-foreground font-medium italic">Automatically populate this template with form data upon submission.</p>
                            </div>

                            <Separator className="bg-foreground/5" />

                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                    <Database className="w-3.5 h-3.5" /> Intelligence Silo
                                </Label>
                                <Select
                                    value={config.outputDataset?.toString() || "none"}
                                    onValueChange={(v) => set("outputDataset", v === "none" ? undefined : v)}
                                >
                                    <SelectTrigger className="h-9 bg-background/40 border-foreground/5 text-[11px] font-bold uppercase tracking-widest">
                                        <SelectValue placeholder="Select dataset silo..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none" className="text-[11px] font-bold uppercase tracking-widest">Default Pipeline Memory</SelectItem>
                                        {datasets.map((d: any) => (
                                            <SelectItem key={d.id} value={d.id.toString()} className="text-[11px] font-bold uppercase tracking-widest">{d.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-[9px] text-muted-foreground font-medium italic">Stream submission events directly into this database collection.</p>
                            </div>

                            <Separator className="bg-foreground/5" />

                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                    <Clock className="w-3.5 h-3.5" /> Retention Window
                                </Label>
                                <div className="flex items-center gap-3">
                                    <Input
                                        type="number"
                                        className="h-9 bg-background/40 border-foreground/5 text-sm font-black w-24"
                                        value={config.timeoutMinutes ?? 30}
                                        onChange={(e) => set("timeoutMinutes", parseInt(e.target.value) || 30)}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Minutes</span>
                                </div>
                                <p className="text-[9px] text-muted-foreground font-medium italic">Total availability duration for human interaction.</p>
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>

            {/* Right Column: Live Manifestation */}
            <div className="w-[45%] bg-background/40 flex flex-col h-full sticky top-0">
                <div className="p-4 border-b border-foreground/5 bg-foreground/5 flex items-center justify-between backdrop-blur-md">
                    <div className="flex items-center gap-2">
                        <Monitor className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-black uppercase tracking-[0.2em]">Live Manifestation</span>
                    </div>
                    <Badge variant="outline" className="text-[8px] font-black uppercase tracking-widest border-emerald-500/20 text-emerald-400 bg-emerald-500/5 px-2 py-0.5">
                        Reactive Preview
                    </Badge>
                </div>
                
                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    {/* Mock Mobile/Tablet Frame for Realism */}
                    <div className="mx-auto max-w-[400px] bg-card border border-foreground/10 rounded-[40px] p-2 shadow-2xl relative">
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-background rounded-b-2xl z-10 border border-t-0 border-foreground/5 flex items-center justify-center">
                            <div className="w-10 h-1 bg-foreground/10 rounded-full" />
                        </div>
                        
                        <div className="bg-background rounded-[32px] overflow-hidden min-h-[500px] flex flex-col border border-foreground/5">
                            {/* Inner Preview Content */}
                            <div className="flex-1 p-6 space-y-6 animate-in fade-in duration-700">
                                <div className="space-y-1">
                                    <h3 className="text-lg font-black tracking-tight text-foreground">{formSteps[previewStep]?.title || "Form Initialized"}</h3>
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest italic">{formSteps[previewStep]?.description || "Please provide the requested operational data."}</p>
                                </div>

                                <div className="space-y-5 stagger-list">
                                    {(formSteps[previewStep] ? fieldsForStep(formSteps[previewStep], previewStep) : []).length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-12 text-center space-y-3 opacity-30 italic">
                                            <Zap className="w-8 h-8 text-primary animate-pulse" />
                                            <span className="text-[10px] font-bold uppercase tracking-widest">Waiting for field injection...</span>
                                        </div>
                                    ) : (
                                        (formSteps[previewStep] ? fieldsForStep(formSteps[previewStep], previewStep) : []).map((field, i) => (
                                            <div key={i} className="space-y-1.5 animate-in slide-in-from-right-2 fade-in duration-300">
                                                <Label className="text-[10px] font-black uppercase tracking-[0.1em] text-foreground/80">
                                                    {field.label}
                                                    {field.required && <span className="text-primary ml-1">*</span>}
                                                </Label>
                                                
                                                {field.type === "textarea" ? (
                                                    <div className="w-full h-24 rounded-lg bg-background/40 border border-foreground/10 p-3 text-[10px] text-muted-foreground/40 italic">
                                                        User response area...
                                                    </div>
                                                ) : field.type === "select" ? (
                                                    <div className="h-9 rounded-lg bg-background/40 border border-foreground/10 px-3 flex items-center justify-between">
                                                        <span className="text-[10px] text-muted-foreground/40 italic">Select option...</span>
                                                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />
                                                    </div>
                                                ) : field.type === "boolean" ? (
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-4 h-4 rounded border border-foreground/10 bg-background/40" />
                                                        <span className="text-[10px] text-muted-foreground/60 font-medium">Verify requirement</span>
                                                    </div>
                                                ) : (
                                                    <div className="h-9 rounded-lg bg-background/40 border border-foreground/10 px-3 flex items-center">
                                                        <span className="text-[10px] text-muted-foreground/40 italic">
                                                            {field.placeholder || "Enter value..."}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>

                                <div className="mt-auto pt-6 flex items-center justify-between gap-4">
                                    <div className="flex gap-1">
                                        {formSteps.map((_, i) => (
                                            <div 
                                                key={i} 
                                                className={cn(
                                                    "w-1.5 h-1.5 rounded-full transition-all duration-500",
                                                    i === previewStep ? "bg-primary w-4 shadow-[0_0_8px_rgba(var(--primary),0.5)]" : "bg-foreground/10"
                                                )}
                                            />
                                        ))}
                                    </div>
                                    <div className="flex gap-2">
                                        {previewStep > 0 && (
                                            <Button variant="outline" className="h-8 rounded-lg text-[9px] font-black uppercase tracking-widest px-4" onClick={() => setPreviewStep(p => p - 1)}>Back</Button>
                                        )}
                                        <Button className="h-8 rounded-lg text-[9px] font-black uppercase tracking-widest px-6 shadow-xl shadow-primary/20" onClick={() => {
                                            if (previewStep < formSteps.length - 1) setPreviewStep(p => p + 1);
                                        }}>
                                            {previewStep === formSteps.length - 1 ? "Submit" : "Next"}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
        </div>
    );
}
