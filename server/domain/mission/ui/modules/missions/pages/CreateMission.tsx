
import { useState } from "react";
import { ErrorBoundary } from "@domain-ui/core/ui/components/shared/ErrorBoundary";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@domain-ui/core/ui/components/ui/form";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { 
  Plus, User, Terminal, Send, MessageSquareCode, Wand2, 
  Database, AlertTriangle, FileText, Loader2, Coins, 
  Bot, Sparkles, Code, Globe, Brain, ChevronLeft,
  ShieldCheck, LayoutDashboard
} from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { formSchema, missionPlanResponseSchema, MissionMember } from '../types/index.js';
import { EXAMPLE_PROMPTS, STEPS, DELIVERABLE_TYPES } from '../constants/index.js';
import { MissionBriefStep } from '../components/MissionBriefStep.js';
import type { ExecutionStrategy } from "@/modules/missions/config/mission-strategies.config";
import { MissionPlanningStep } from '../components/MissionPlanningStep.js';
import { TeamDesignStep } from '../components/TeamDesignStep.js';
import { PreflightStep } from '../components/PreflightStep.js';
import { LaunchStep } from '../components/LaunchStep.js';
import { CopilotGuidePanel } from '../components/CopilotGuidePanel.js';
import { SimilarMissionsPanel } from '../components/SimilarMissionsPanel.js';
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";

// We now use EXAMPLE_PROMPTS from ../constants


const getJobIcon = (type: string) => {
    switch (type) {
        case "developer": return <Code className="w-3 h-3" />;
        case "researcher": return <Globe className="w-3 h-3" />;
        case "analyst": return <Brain className="w-3 h-3" />;
        case 'api':
        case 'curl': return <Globe className="w-4 h-4 text-green-400" />;
        case 'human_approval': return <User className="w-4 h-4 text-pink-400" />;
        default: return <Bot className="w-3 h-3" />;
    }
};

// We now use MissionMember from ../types


export default function CreateMissionPage() {
    const [, setLocation] = useLocation();
    const [activeTab, setActiveTab] = useState<"ai" | "manual">("manual");
    const [aiPrompt, setAiPrompt] = useState("");
    const [planHistory, setPlanHistory] = useState<{ prompt: string, response: any }[]>([]);
    const [pendingMembers, setPendingMembers] = useState<MissionMember[]>([]);
    const [currentStep, setCurrentStep] = useState(0);
    const [validationBlockers, setValidationBlockers] = useState<string[]>([]);
    const [dependencyResults, setDependencyResults] = useState<any>(null);
    const [commandUplinkOpen, setCommandUplinkOpen] = useState(false);
    const [uplinkChat, setUplinkChat] = useState<{ role: 'user' | 'assistant', content: string }[]>([]);
    const [uplinkInput, setUplinkInput] = useState("");
    const [selectedDeliverables, setSelectedDeliverables] = useState<string[]>([]);
    const [selectedAssets, setSelectedAssets] = useState<{ id: number; name: string; purpose: string }[]>([]);
    const [selectedTemplates, setSelectedTemplates] = useState<{ id: number; name: string; role: string }[]>([]);
    const [pickingAssetId, setPickingAssetId] = useState("");
    const [pickingAssetPurpose, setPickingAssetPurpose] = useState("reference");
    const [pickingTemplateId, setPickingTemplateId] = useState("");
    const [pickingTemplateRole, setPickingTemplateRole] = useState("output_standard");
    const [isUploading, setIsUploading] = useState(false);
    const [addingAgent, setAddingAgent] = useState(false);
    const [selectedJobId, setSelectedJobId] = useState("");
    const [addAgentRole, setAddAgentRole] = useState("");

    // We now use DELIVERABLE_TYPES and STEPS from ../constants


    const { selectedOrgId } = useOrgContext();
    const { user } = useAuth();
    const effectiveOrgId = selectedOrgId ?? user?.defaultOrgId ?? null;
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const { data: availableAssets = [] } = useQuery<{ id: number; name: string; assetType: string; sourceType: string }[]>({
        queryKey: ["/api/missions/available/rag-assets"],
    });

    const { data: availableTemplatesData = [] } = useQuery<{ id: number; name: string; type: string; category: string | null }[]>({
        queryKey: ["/api/document-blueprints"],
    });

    const { data: availableJobs = [] } = useQuery<any, Error, { id: number; name: string; description: string; type: string; tool: string }[]>({
        queryKey: ["/api/jobs"],
        enabled: currentStep === 2, // Only when on team step
        select: (data: any) => data?.items || data || [],
    });

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            objective: "",
            budgetLimitUsd: 0,
            executionStrategy: "pre_planned",
            saveAsTemplate: false,
            targetMetric: {
                type: "latency_total_seconds",
                target: "30"
            },
            isShadowMode: false,
            reasoningProtocol: "json_manifest"
        },
    });

    const createMutation = useMutation({
        mutationFn: async (payload: { values: z.infer<typeof formSchema>; forceCreate?: boolean }) => {
            const { values, forceCreate } = payload;
            const resolvedMembers = [...pendingMembers];
            for (let i = 0; i < resolvedMembers.length; i++) {
                const m = resolvedMembers[i];
                if (!m.entityId || !availableJobs.some((j: any) => j.id === m.entityId)) {
                    try {
                        const synthRes = await apiRequest("POST", "/api/jobs/synthesize", {
                            role: m.role,
                            context: values.objective,
                            suggestedConfig: m.suggestedConfig
                        });
                        const job = await synthRes.json();
                        resolvedMembers[i] = {
                            ...m,
                            entityId: job.id,
                            jobName: job.name,
                            jobType: job.type,
                            jobTool: job.tool
                        };
                    } catch (err: any) {
                        console.warn(`[CreateMission] Auto-synthesis failed for ${m.role}:`, err.message);
                    }
                }
            }
            setPendingMembers(resolvedMembers);

            const url = "/api/missions?strict=false";
            const baseObjective = values.objective;
            const objectiveWithDeliverables = selectedDeliverables.length > 0
                ? `${baseObjective}\n\n[Target Product: ${selectedDeliverables.join(", ")}]`
                : baseObjective;

            const res = await apiRequest("POST", url, {
                ...values,
                objective: objectiveWithDeliverables,
                organizationId: selectedOrgId,
                members: resolvedMembers.map(m => ({
                    entityType: m.entityType || "job",
                    entityId: m.entityId,
                    role: m.role
                })),
                saveAsTemplate: values.saveAsTemplate,
            });
            return res.json();
        },
        onSuccess: async (data: any) => {
            const missionId = data?.id || data?.missionId;
            if (missionId) {
                for (const asset of selectedAssets) {
                    try {
                        await apiRequest("POST", `/api/missions/${missionId}/assets`, {
                            ragAssetId: asset.id,
                            purpose: asset.purpose,
                        });
                    } catch (e) { console.warn("Failed to attach asset:", e); }
                }
                for (const tmpl of selectedTemplates) {
                    try {
                        await apiRequest("POST", `/api/missions/${missionId}/document-templates`, {
                            documentTemplateId: tmpl.id,
                            role: tmpl.role,
                        });
                    } catch (e) { console.warn("Failed to attach template:", e); }
                }
            }
            // Invalidate all missions queries to ensure dashboard is up to date
            await queryClient.invalidateQueries({ 
                queryKey: ["/api/missions"],
                refetchType: 'all'
            });
            toast({
                title: "Mission Created",
                description: pendingMembers.length > 0
                    ? `Mission initialized with ${pendingMembers.length} agents.`
                    : "New mission has been initialized.",
            });
            setLocation("/operations/missions");
        },
        onError: (error) => {
            toast({
                title: "Error",
                description: error.message,
                variant: "destructive",
            });
        }
    });

    const planMutation = useMutation({
        mutationFn: async () => {
            const objective = aiPrompt || form.getValues("objective");
            const promptWithDeliverables = selectedDeliverables.length > 0
                ? `${objective}\n\nExpected Deliverables: ${selectedDeliverables.join(", ")}`
                : objective;

            const res = await apiRequest("POST", "/api/missions/plan", {
                prompt: promptWithDeliverables,
                history: planHistory,
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Failed to generate strategic plan");
            }
            // Reject incomplete generated plans before they overwrite the brief.
            // Otherwise undefined objective/name values crash the next render.
            const plan = await res.json();
            missionPlanResponseSchema.parse(plan);
            return plan;
        },
        onSuccess: (plan) => {
            form.setValue("name", plan.name);
            form.setValue("objective", plan.objective);
            if (plan.budgetLimitUsd) {
                form.setValue("budgetLimitUsd", plan.budgetLimitUsd);
            }
            if (plan.members) {
                setPendingMembers(plan.members);
            }
            const promptUsed = aiPrompt || form.getValues("objective");
            setPlanHistory(prev => [...prev.slice(-2), { prompt: promptUsed, response: plan }]);
            setAiPrompt(""); 
            if (currentStep === 0) {
                setCurrentStep(1);
            }
            toast({
                title: planHistory.length > 0 ? "Transmission Received" : "Mission Command Uplink Active",
                description: "Review the strategic plan and workstream nodes.",
            });
        },
        onError: (error: any) => {
            toast({
                title: "Planning Failed",
                description: error.message || "Failed to architect the mission plan.",
                variant: "destructive",
            });
        }
    });

    const synthesizeMutation = useMutation({
        mutationFn: async ({ role, index, suggestedConfig }: { role: string, index: number, suggestedConfig?: any }) => {
            const res = await apiRequest("POST", "/api/jobs/synthesize", {
                role,
                context: form.getValues("objective"),
                suggestedConfig
            });
            return { job: await res.json(), index, role };
        },
        onSuccess: ({ job, index, role }) => {
            setPendingMembers(prev => prev.map((m, i) =>
                i === index ? {
                    ...m,
                    entityId: job.id,
                    jobName: job.name,
                    jobType: job.type,
                    jobTool: job.tool
                } : m
            ));
            setValidationBlockers(prev => prev.filter(b => !b.includes(`Member "${role}"`)));
            queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
        },
        onError: (error: any) => {
            toast({
                title: "Synthesis Failed",
                description: error.message || "Failed to synthesize agent.",
                variant: "destructive",
            });
        }
    });

    const validateMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", "/api/missions/validate", {
                name: form.getValues("name"),
                objective: form.getValues("objective"),
                organizationId: selectedOrgId,
                members: pendingMembers.map(m => ({
                    entityType: m.entityType || "job",
                    entityId: m.entityId,
                    role: m.role
                })),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Validation request failed");
            }
            return res.json();
        },
        onSuccess: (result) => {
            setDependencyResults(result);
            if (result.valid) {
                setValidationBlockers([]);
                setCurrentStep(3);
                toast({
                    title: "Systems Check Nominal",
                    description: "Pre-flight verification complete. All dependencies resolved.",
                });
            } else {
                setValidationBlockers(result.blockers || []);
                setCurrentStep(2);
                toast({
                    title: "Check Failed",
                    description: "Mission structure or dependencies require adjustment.",
                    variant: "destructive"
                });
            }
        },
        onError: (error: any) => {
            toast({
                title: "Verification Error",
                description: error.message || "Failed to complete pre-flight check.",
                variant: "destructive",
            });
        }
    });

    function onSubmit(values: z.infer<typeof formSchema>, forceCreate = false) {
        if (!effectiveOrgId) {
            toast({ title: "Organization required", variant: "destructive" });
            return;
        }
        setValidationBlockers([]);
        if (forceCreate) {
            createMutation.mutate({ values, forceCreate: true });
            return;
        }
        validateMutation.mutate();
    }

    const nextStep = () => {
        const isDynamic = form.getValues("executionStrategy") === "dynamic_autonomous";
        if (currentStep === 0) {
            if (form.getValues("name") && form.getValues("objective")) {
                if (isDynamic) {
                    setCurrentStep(4);
                } else if (planHistory.length > 0) {
                    setCurrentStep(1);
                } else {
                    planMutation.mutate();
                }
            } else {
                toast({ title: "Details required" });
            }
        } else if (currentStep === 1) {
            setCurrentStep(2);
        } else if (currentStep === 2) {
            onSubmit(form.getValues());
        } else if (currentStep === 3) {
            setCurrentStep(4);
        }
    };

    const handleFileUpload = async (file: File) => {
        setIsUploading(true);
        try {
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve, reject) => {
                reader.onload = () => {
                    const result = reader.result as string;
                    resolve(result.split(',')[1]);
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const base64Data = await base64Promise;
            const res = await apiRequest("POST", "/api/rag-assets", {
                name: file.name,
                assetType: "PDF",
                sourceType: "upload",
                fileData: base64Data,
                contentType: file.type || 'application/octet-stream',
                fileSize: file.size,
                organizationId: selectedOrgId
            });
            const { asset } = await res.json();
            if (asset) {
                setSelectedAssets(prev => [...prev, { id: asset.id, name: asset.name, purpose: pickingAssetPurpose }]);
            }
        } finally {
            setIsUploading(false);
        }
    };

    const handleFormSubmit = (values: z.infer<typeof formSchema>) => {
        createMutation.mutate({ values, forceCreate: false });
    };

    const prevStep = () => setCurrentStep(prev => Math.max(0, prev - 1));

    const useGuidedPrompt = (prompt: string) => {
        setActiveTab("ai");
        setAiPrompt(prompt);
        form.setValue("objective", prompt);
        toast({
            title: "Guided prompt loaded",
            description: "Review the mission brief, attach any trusted knowledge, then generate the team plan.",
        });
    };

    return (
        <ErrorBoundary name="Create Mission">
        <div className="min-h-screen bg-background text-foreground flex flex-col relative overflow-hidden">
            {/* Ambient Background Glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-primary/10 blur-[120px] rounded-full pointer-events-none z-0" />
            
            {/* Header / Nav */}
            <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl z-10 px-4 py-4 md:px-6 flex items-center justify-between sticky top-0">
                <div className="flex items-center gap-6">
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => setLocation("/operations/missions")}
                    >
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        Back to Missions
                    </Button>
                    <div className="h-4 w-px bg-border" />
                    <div>
                        <h1 className="text-xl font-black uppercase tracking-tighter italic text-primary flex items-center gap-2">
                           Create New Mission
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                     <Badge variant="outline" className="border-primary/50 text-[10px] text-primary px-2 h-5 uppercase tracking-wider">Step {currentStep + 1} of {STEPS.length}</Badge>
                </div>
            </header>

            <main className="flex-1 max-w-[2000px] mx-auto w-full z-10 pt-12 px-4 md:px-6 pb-24">
                {/* Step Description Section */}
                <div className="mb-10 text-center">
                    <h2 className="text-3xl font-bold tracking-tight text-foreground mb-2">{STEPS[currentStep].description}</h2>
                    <p className="text-muted-foreground font-mono text-xs uppercase tracking-[0.2em] font-bold">{STEPS[currentStep].title}</p>
                </div>

                {/* Progress Bar */}
                <div className="flex gap-2 mb-12">
                    {STEPS.map((step, i) => (
                        <div 
                            key={step.id} 
                            className={cn(
                                "h-1.5 flex-1 rounded-full transition-all duration-500 shadow-lg",
                                i <= currentStep ? "bg-primary" : "bg-muted border border-border"
                            )} 
                        />
                    ))}
                </div>

                {/* Step Content */}
                <div className="glass-card rounded-3xl p-8 shadow-2xl relative">
                    {currentStep === 0 && (
                        <CopilotGuidePanel onUsePrompt={useGuidedPrompt} />
                    )}

                    {currentStep === 0 && (
                        <MissionBriefStep
                            activeTab={activeTab}
                            setActiveTab={setActiveTab}
                            aiPrompt={aiPrompt}
                            setAiPrompt={setAiPrompt}
                            EXAMPLE_PROMPTS={EXAMPLE_PROMPTS}
                            DELIVERABLE_TYPES={DELIVERABLE_TYPES}
                            selectedDeliverables={selectedDeliverables}
                            setSelectedDeliverables={setSelectedDeliverables}
                            planMutation={planMutation}
                            form={form}
                            availableAssets={availableAssets}
                            selectedAssets={selectedAssets}
                            setSelectedAssets={setSelectedAssets}
                            pickingAssetId={pickingAssetId}
                            setPickingAssetId={setPickingAssetId}
                            pickingAssetPurpose={pickingAssetPurpose}
                            setPickingAssetPurpose={setPickingAssetPurpose}
                            isUploading={isUploading}
                            handleFileUpload={handleFileUpload}
                            availableTemplatesData={availableTemplatesData}
                            selectedTemplates={selectedTemplates}
                            setSelectedTemplates={setSelectedTemplates}
                            pickingTemplateId={pickingTemplateId}
                            setPickingTemplateId={setPickingTemplateId}
                            pickingTemplateRole={pickingTemplateRole}
                            setPickingTemplateRole={setPickingTemplateRole}
                            nextStep={nextStep}
                        />
                    )}

                    {currentStep <= 1 && effectiveOrgId && (
                        <div className="mt-6">
                            <SimilarMissionsPanel
                                objective={currentStep === 0 && activeTab === "ai" ? aiPrompt : form.watch("objective")}
                                organizationId={effectiveOrgId}
                                onStrategySelect={(strategy) => {
                                    form.setValue("executionStrategy", strategy, { shouldDirty: true, shouldValidate: true });
                                    setValidationBlockers([]);
                                    setDependencyResults(null);
                                }}
                            />
                        </div>
                    )}

                    {currentStep === 1 && (
                        <MissionPlanningStep
                            plan={planHistory[planHistory.length - 1]?.response}
                            onRefine={() => setCurrentStep(0)}
                            onAccept={() => setCurrentStep(2)}
                            prevStep={prevStep}
                        />
                    )}

                    {currentStep === 2 && (
                        <TeamDesignStep
                            addingAgent={addingAgent}
                            setAddingAgent={setAddingAgent}
                            selectedJobId={selectedJobId}
                            setSelectedJobId={setSelectedJobId}
                            availableJobs={availableJobs}
                            pendingMembers={pendingMembers}
                            setPendingMembers={setPendingMembers}
                            addAgentRole={addAgentRole}
                            setAddAgentRole={setAddAgentRole}
                            getJobIcon={getJobIcon}
                            synthesizeMutation={synthesizeMutation}
                            planHistory={planHistory}
                            setCurrentStep={setCurrentStep}
                            prevStep={prevStep}
                            nextStep={nextStep}
                            validateMutation={validateMutation}
                            validationBlockers={validationBlockers}
                            setValidationBlockers={setValidationBlockers}
                            executionStrategy={form.watch("executionStrategy") as ExecutionStrategy}
                        />
                    )}

                    {currentStep === 3 && (
                        <PreflightStep
                            dependencyResults={dependencyResults}
                            commandUplinkOpen={commandUplinkOpen}
                            setCommandUplinkOpen={setCommandUplinkOpen}
                            uplinkChat={uplinkChat}
                            setUplinkChat={setUplinkChat}
                            uplinkInput={uplinkInput}
                            setUplinkInput={setUplinkInput}
                            toast={toast}
                            synthesizeMutation={synthesizeMutation}
                            setCurrentStep={setCurrentStep}
                            prevStep={prevStep}
                        />
                    )}

                    {currentStep === 4 && (
                        <LaunchStep
                            form={form}
                            handleFormSubmit={handleFormSubmit}
                            pendingMembers={pendingMembers}
                            getJobIcon={getJobIcon}
                            prevStep={prevStep}
                            createMutation={createMutation}
                            knowledgeAssetCount={selectedAssets.length}
                            documentTemplateCount={selectedTemplates.length}
                        />
                    )}
                </div>
            </main>

            {/* Footer Status Bar */}
            <footer className="border-t border-border/50 bg-background/80 backdrop-blur-lg fixed bottom-0 left-0 right-0 py-3 px-4 md:px-6 z-20">
                <div className="max-w-[2000px] mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                           <LayoutDashboard className="w-3.5 h-3.5 text-muted-foreground" />
                           <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">Workspace Status:</span>
                           <Badge variant="outline" className="bg-green-500/10 text-green-500 border-none text-[8px]">Operational</Badge>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-[9px] uppercase font-bold tracking-tighter text-muted-foreground/50">Authorized Access Only</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                        <span className="text-[9px] font-mono text-muted-foreground/50 italic">Oddjob Hypervisor v2.4</span>
                    </div>
                </div>
            </footer>
        </div>
        </ErrorBoundary>
    );
}

