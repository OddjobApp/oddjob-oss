import React, { useState } from "react";
import { useLocation } from "wouter";
import { ErrorBoundary } from "@domain-ui/core/ui/components/shared/ErrorBoundary";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import { 
    Card, 
    CardContent, 
    CardDescription, 
    CardHeader, 
    CardTitle,
    CardFooter
} from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { 
    ArrowLeft, 
    ArrowRight, 
    Check, 
    Plus, 
    Terminal, 
    Bot, 
    Code, 
    Database, 
    Globe, 
    FileText,
    Zap,
    Search,
    Wind,
    Repeat,
    RefreshCw,
    Layers,
    Inbox,
    Server,
    Workflow,
    Cpu,
    HardDrive,
    Share2,
    Slack,
    Mail,
    PlayCircle,
    GitBranch,
    Timer,
    BarChart,
    LayoutGrid,
    FileOutput,
    FolderSync,
    MessageSquare,
    ExternalLink,
    AlertCircle,
    Loader2,
    Save,
    ShieldCheck,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import UniversalJobEditor from '../components/UniversalJobEditor.js';
import { AGENT_TYPE_GROUPS, getDefaultJobConfig } from '../job-constants.js';

interface ConfigValidationResult {
    valid: boolean;
    errors: string[];
    suggestions: string[];
}

const GROUP_ICONS: Record<string, React.ElementType> = {
    "Agents & Intelligence": Bot,
    "Code & Automation":     Terminal,
    "Integration & Data":    Database,
    "Flow Control":          Workflow,
    "File Operations":       HardDrive,
    "Utilities":             Cpu,
};

export default function CreateAgent() {
    const [, setLocation] = useLocation();
    const { selectedOrgId } = useOrgContext();
    const { user } = useAuth();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [step, setStep] = useState(1);
    const [selectedType, setSelectedType] = useState("");
    const [formData, setFormData] = useState({
        name: "",
        description: "",
        config: {}
    });

    const validationQuery = useQuery<ConfigValidationResult>({
        queryKey: ["/api/jobs/validate-config", selectedType, formData.config],
        queryFn: async () => {
            const res = await apiRequest("POST", "/api/jobs/validate-config", {
                type: selectedType,
                config: formData.config,
            });
            if (!res.ok) throw new Error("Unable to validate configuration");
            return res.json();
        },
        enabled: step === 3 && !!selectedType,
        retry: false,
    });

    const createMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await apiRequest("POST", "/api/jobs", {
                ...data,
                organizationId: selectedOrgId,
                createdBy: user?.username || "anonymous",
                type: selectedType
            });
            if (!res.ok) throw new Error("Failed to initialize agent");
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
            const isDraft = data.lifecycleStatus === "draft" || data.isActive === false;
            toast({
                title: isDraft ? "Draft Saved" : "Agent Activated",
                description: isDraft
                    ? `"${formData.name}" is saved as a draft.`
                    : `"${formData.name}" is active in the library.`,
            });
            setLocation(`/operations/agents/${data.id}`);
        },
        onError: (error: Error) => {
            toast({
                title: "Unable to save agent",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    const selectType = (type: string) => {
        setSelectedType(type);
        setFormData(prev => ({ ...prev, config: getDefaultJobConfig(type) }));
    };

    const submit = (mode: "draft" | "active") => {
        if (mode === "active" && !validationQuery.data?.valid) {
            toast({
                title: "Configuration is not ready",
                description: validationQuery.data?.errors?.[0] || "Resolve the validation issues before activation.",
                variant: "destructive",
            });
            return;
        }

        createMutation.mutate({
            ...formData,
            lifecycleStatus: mode === "draft" ? "draft" : "active",
            isActive: mode === "active",
        });
    };

    const nextStep = () => setStep(prev => prev + 1);
    const prevStep = () => setStep(prev => prev - 1);

    const isStepValid = () => {
        if (step === 1) return !!selectedType;
        if (step === 2) return formData.name.length >= 3;
        return true;
    };

    return (
        <ErrorBoundary name="Create Agent">
        <div className="p-6 md:p-12 w-full max-w-full space-y-8 animate-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex items-center justify-between">
                <Button variant="ghost" className="gap-2" onClick={() => setLocation("/operations/agents")}>
                    <ArrowLeft className="w-4 h-4" /> Back to Library
                </Button>
                <div className="flex items-center gap-4">
                    {[1, 2, 3].map(s => (
                        <div key={s} className="flex items-center gap-2">
                            <div className={cn(
                                "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border transition-all",
                                step === s ? "bg-primary border-primary text-primary-foreground shadow-lg scale-110" : 
                                step > s ? "bg-emerald-500 border-emerald-500 text-foreground" : "bg-muted border-border text-muted-foreground"
                            )}>
                                {step > s ? <Check className="w-3 h-3" /> : s}
                            </div>
                            <span className={cn(
                                "text-[10px] uppercase font-bold tracking-widest hidden md:block",
                                step === s ? "text-primary" : "text-muted-foreground"
                            )}>
                                {s === 1 ? "Select Type" : s === 2 ? "Identity" : "Configuration"}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Content area */}
            <div className="min-h-[600px]">
                {step === 1 && (
                    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-300">
                        <div className="text-center space-y-2">
                            <h2 className="text-3xl font-black italic uppercase tracking-tighter">Choose Agent <span className="text-primary">Genome</span></h2>
                            <p className="text-muted-foreground text-sm uppercase tracking-widest font-bold">Select the execution backbone for your new agent</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {AGENT_TYPE_GROUPS.map(group => {
                                const GroupIcon = GROUP_ICONS[group.name] || Cpu;
                                return (
                                <div key={group.name} className="space-y-4">
                                    <div className="flex items-center gap-2 px-1">
                                        <GroupIcon className="w-4 h-4 text-primary" />
                                        <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">{group.name}</h3>
                                    </div>
                                    <div className="grid grid-cols-1 gap-3">
                                        {group.types.map(type => (
                                            <button
                                                key={type.id}
                                                onClick={() => selectType(type.id)}
                                                aria-pressed={selectedType === type.id}
                                                className={cn(
                                                    "flex items-start gap-4 p-4 rounded-xl border text-left transition-all hover:shadow-md group",
                                                    selectedType === type.id 
                                                        ? "border-primary bg-primary/5 shadow-inner" 
                                                        : "border-border bg-card hover:border-primary/40"
                                                )}
                                            >
                                                <div className={cn(
                                                    "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-all",
                                                    selectedType === type.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                                                )}>
                                                    <Zap className="w-5 h-5" />
                                                </div>
                                                <div className="space-y-1">
                                                    <h4 className="text-sm font-bold tracking-tight">{type.label}</h4>
                                                    <p className="text-[11px] text-muted-foreground leading-snug">{type.description}</p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="w-full max-w-full space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="text-center space-y-2">
                            <h2 className="text-3xl font-black italic uppercase tracking-tighter">Agent <span className="text-primary">Briefing</span></h2>
                            <p className="text-muted-foreground text-sm uppercase tracking-widest font-bold">Define the identity and mission objective</p>
                        </div>

                        <Card className="border-border shadow-xl">
                            <CardHeader>
                                <CardTitle className="text-lg font-bold">Agent Identity</CardTitle>
                                <CardDescription>This will represent the agent in the library and mission logs.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="space-y-2">
                                    <Label htmlFor="name" className="text-[10px] uppercase font-bold tracking-widest">Agent Name</Label>
                                    <Input 
                                        id="name" 
                                        placeholder="e.g., Salesforce Opportunity Scout" 
                                        className="h-12 text-lg font-medium shadow-inner"
                                        value={formData.name}
                                        onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                        autoFocus
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="description" className="text-[10px] uppercase font-bold tracking-widest">Core Directive</Label>
                                    <Textarea 
                                        id="description" 
                                        placeholder="Explain the specific responsibility of this agent..." 
                                        className="min-h-[120px] resize-none text-sm"
                                        value={formData.description}
                                        onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {step === 3 && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="text-center space-y-2">
                            <h2 className="text-3xl font-black italic uppercase tracking-tighter">Matrix <span className="text-primary">Initialization</span></h2>
                            <p className="text-muted-foreground text-sm uppercase tracking-widest font-bold">Configure technical parameters for {selectedType.toUpperCase()}</p>
                        </div>

                        <Card className="border-border shadow-2xl overflow-hidden rounded-2xl">
                            <CardHeader className="bg-muted/30 border-b p-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle className="text-lg font-bold uppercase tracking-tight">Technical Matrix</CardTitle>
                                        <CardDescription>Calibrate settings for the {selectedType} engine.</CardDescription>
                                    </div>
                                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 h-6 px-3">
                                        {selectedType}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <UniversalJobEditor 
                                    type={selectedType}
                                    config={formData.config}
                                    onChange={(config) => setFormData(prev => ({ ...prev, config }))}
                                />
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>

            {/* Footer Navigation */}
            <div className="flex items-center justify-between pt-8 border-t border-border/40">
                <Button 
                    variant="outline" 
                    onClick={prevStep} 
                    disabled={step === 1}
                    className="h-11 px-8 font-bold uppercase tracking-widest text-[11px]"
                >
                    Previous Phase
                </Button>

                {step < 3 ? (
                    <Button 
                        onClick={nextStep} 
                        disabled={!isStepValid()}
                        className="h-11 px-10 font-bold uppercase tracking-widest text-[11px] gap-2 shadow-lg"
                    >
                        Next Phase <ArrowRight className="w-4 h-4" />
                    </Button>
                ) : (
                    <div className="flex flex-col items-end gap-3">
                        <div className="flex items-center gap-2 text-sm" role="status" aria-live="polite">
                            {validationQuery.isFetching ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Checking readiness...</>
                            ) : validationQuery.data?.valid ? (
                                <><ShieldCheck className="w-4 h-4 text-emerald-500" /> Ready to activate</>
                            ) : (
                                <><AlertCircle className="w-4 h-4 text-amber-500" /> {validationQuery.data?.errors?.length || 0} configuration issue(s)</>
                            )}
                        </div>
                        {validationQuery.data && !validationQuery.data.valid && (
                            <div className="max-w-xl rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-200" role="alert">
                                <p className="font-semibold">Resolve before activation</p>
                                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                                    {validationQuery.data.errors.slice(0, 4).map(error => <li key={error}>{error}</li>)}
                                </ul>
                            </div>
                        )}
                        <div className="flex items-center gap-3">
                            <Button
                                variant="outline"
                                onClick={() => validationQuery.refetch()}
                                disabled={validationQuery.isFetching || createMutation.isPending}
                                className="h-11 px-6 font-bold uppercase tracking-widest text-[11px] gap-2"
                            >
                                <ShieldCheck className="w-4 h-4" /> Check Readiness
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => submit("draft")}
                                disabled={createMutation.isPending}
                                className="h-11 px-6 font-bold uppercase tracking-widest text-[11px] gap-2"
                            >
                                <Save className="w-4 h-4" /> Save Draft
                            </Button>
                            <Button
                                onClick={() => submit("active")}
                                disabled={createMutation.isPending || validationQuery.isFetching || !validationQuery.data?.valid}
                                className="h-11 px-8 font-black uppercase tracking-widest text-[11px] gap-2 shadow-[0_0_20px_rgba(217,119,6,0.3)]"
                            >
                                {createMutation.isPending ? "Saving..." : "Activate Agent"} <Check className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
        </ErrorBoundary>
    );
}

