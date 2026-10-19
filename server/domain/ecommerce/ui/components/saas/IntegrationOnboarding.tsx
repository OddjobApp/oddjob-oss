import React, { useState, useEffect } from "react";
import { 
    Check, 
    ChevronRight, 
    ChevronLeft, 
    ShieldCheck, 
    Database, 
    Zap, 
    Activity, 
    Settings2,
    Lock,
    Link as LinkIcon,
    Radio,
    Terminal,
    ArrowRight,
    SearchCode,
    RefreshCw
} from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { 
    Select, 
    SelectContent, 
    SelectItem, 
    SelectTrigger, 
    SelectValue 
} from "@domain-ui/core/ui/components/ui/select";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { NeuralFieldMapper } from './NeuralFieldMapper.js';
import { LogicGateBuilder } from './LogicGateBuilder.js';
import { SyncFormData, Connector } from './types.js';
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

interface IntegrationOnboardingProps {
    isOpen: boolean;
    onClose: () => void;
    connectors: Connector[];
    onComplete: (data: SyncFormData) => void;
}

const STEPS = [
    { id: "AUTH", label: "Establish Uplink", icon: Lock },
    { id: "PROBE", label: "Neural Discovery", icon: SearchCode },
    { id: "MAP", label: "Parity Mapping", icon: Database },
    { id: "CALIBRATE", label: "Logic Calibration", icon: Settings2 },
    { id: "ACTIVATE", label: "Initialize Pulse", icon: Activity }
];

export function IntegrationOnboarding({ 
    isOpen, 
    onClose, 
    connectors,
    onComplete 
}: IntegrationOnboardingProps) {
    const [currentStep, setCurrentStep] = useState(0);
    const [formData, setFormData] = useState<SyncFormData>({
        platform: "",
        enabled: true,
        sync_interval: 15,
        conflict_resolution: "last_write_wins",
        field_mappings: "{}",
        filters: "{}"
    });
    const [discoveredFields, setDiscoveredFields] = useState<any[]>([]);
    const [discoveredProjects, setDiscoveredProjects] = useState<any[]>([]);
    const [projectKey, setProjectKey] = useState("");
    const { toast } = useToast();

    const currentStepId = STEPS[currentStep].id;

    // Discovery Mutations
    const discoveryMutation = useMutation({
        mutationFn: async (platform: string) => {
            const res = await fetch(`/api/saas/connectors/${platform}/discovery`);
            if (!res.ok) throw new Error('Discovery failed');
            return res.json();
        },
        onSuccess: (data) => {
            setDiscoveredProjects(data.projects || []);
        }
    });

    const schemaMutation = useMutation({
        mutationFn: async ({ platform, projectKey }: { platform: string, projectKey?: string }) => {
            const url = `/api/saas/connectors/${platform}/schema${projectKey ? `?projectKey=${projectKey}` : ''}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Schema discovery failed');
            return res.json();
        },
        onSuccess: (data) => {
            setDiscoveredFields(data.fields || []);
        }
    });

    const handleNext = () => {
        if (currentStepId === "AUTH" && !formData.platform) {
            toast({ title: "PLATFORM_REQUIRED", description: "Select a target bridge to continue.", variant: "destructive" });
            return;
        }

        if (currentStepId === "AUTH") {
            if (formData.platform === 'jira' || formData.platform === 'confluence') {
                discoveryMutation.mutate(formData.platform);
            } else {
                schemaMutation.mutate({ platform: formData.platform });
            }
        }

        if (currentStepId === "PROBE" && formData.platform === 'jira' && !projectKey) {
            toast({ title: "PROJECT_REQUIRED", description: "Select a project vector to scan.", variant: "destructive" });
            return;
        }

        if (currentStep < STEPS.length - 1) {
            setCurrentStep(currentStep + 1);
        } else {
            onComplete(formData);
        }
    };

    const handleBack = () => {
        if (currentStep > 0) setCurrentStep(currentStep - 1);
    };

    const updateMappings = (newMappings: Record<string, string>) => {
        setFormData(prev => ({ ...prev, field_mappings: JSON.stringify(newMappings, null, 2) }));
    };

    const updateFilters = (newFilters: Record<string, any>) => {
        setFormData(prev => ({ ...prev, filters: JSON.stringify(newFilters, null, 2) }));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-3xl">
            <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="w-full max-w-5xl h-[80vh] bg-background/90 border border-foreground/10 rounded-[3rem] overflow-hidden flex flex-col shadow-[0_0_100px_rgba(0,0,0,0.5)]"
            >
                {/* Header */}
                <div className="p-8 border-b border-foreground/5 bg-foreground/[0.02] flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-[0_0_20px_rgba(var(--primary),0.2)]">
                            <Radio className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black italic uppercase tracking-tighter text-foreground">
                                Establish <span className="text-primary font-light not-italic">Neural Uplink</span>
                            </h2>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/20">Unified Integration Onboarding Protocol v2.0</p>
                        </div>
                    </div>
                    
                    {/* Stepper HUD */}
                    <div className="flex items-center gap-2">
                        {STEPS.map((step, idx) => (
                            <React.Fragment key={step.id}>
                                <div className={cn(
                                    "flex items-center gap-3 px-4 py-2 rounded-xl transition-all duration-500",
                                    idx === currentStep ? "bg-primary/10 border border-primary/20" : "opacity-30"
                                )}>
                                    <step.icon className={cn("w-3.5 h-3.5", idx === currentStep ? "text-primary" : "text-foreground")} />
                                    <span className={cn("text-[9px] font-black uppercase tracking-widest italic", idx === currentStep ? "text-foreground" : "text-foreground/40")}>
                                        {step.label}
                                    </span>
                                </div>
                                {idx < STEPS.length - 1 && <div className="w-4 h-[1px] bg-foreground/10 mx-1" />}
                            </React.Fragment>
                        ))}
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto p-12 scrollbar-hide">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={currentStepId}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.4, ease: "circOut" }}
                            className="h-full"
                        >
                            {/* Step 1: Authentication */}
                            {currentStepId === "AUTH" && (
                                <div className="max-w-2xl mx-auto space-y-12">
                                    <div className="space-y-4 text-center">
                                        <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px] font-black tracking-widest uppercase italic py-1 px-4 rounded-full">Connection Initialize</Badge>
                                        <h3 className="text-4xl font-black uppercase italic tracking-tighter text-foreground">Target Bridge Selection</h3>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        {connectors.map(c => (
                                            <button 
                                                key={c.platform}
                                                onClick={() => setFormData(prev => ({ ...prev, platform: c.platform }))}
                                                className={cn(
                                                    "p-8 rounded-[2rem] border transition-all text-left group relative overflow-hidden",
                                                    formData.platform === c.platform 
                                                        ? "bg-primary/5 border-primary/50 shadow-2xl shadow-primary/10" 
                                                        : "bg-foreground/[0.02] border-foreground/5 hover:border-foreground/10"
                                                )}
                                            >
                                                <div className={cn(
                                                    "w-12 h-12 rounded-2xl flex items-center justify-center mb-6 transition-colors",
                                                    formData.platform === c.platform ? "bg-primary text-primary-foreground" : "bg-foreground/5 text-foreground/40 group-hover:bg-foreground/10"
                                                )}>
                                                    <Database className="w-6 h-6" />
                                                </div>
                                                <div className="text-xl font-black uppercase italic tracking-tight text-foreground mb-2">{c.platform}</div>
                                                <div className="text-[10px] font-bold uppercase tracking-widest text-foreground/30">{c.base_url || 'Cloud_Instance'}</div>
                                                {formData.platform === c.platform && (
                                                    <div className="absolute top-6 right-6 w-3 h-3 rounded-full bg-primary animate-pulse" />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Step 2: Probe */}
                            {currentStepId === "PROBE" && (
                                <div className="max-w-2xl mx-auto space-y-12">
                                    <div className="space-y-4 text-center">
                                        <Badge className="bg-blue-400/10 text-blue-400 border-blue-400/20 text-[9px] font-black tracking-widest uppercase italic py-1 px-4 rounded-full">Neural Discovery Active</Badge>
                                        <h3 className="text-4xl font-black uppercase italic tracking-tighter text-foreground">Schema Indexing</h3>
                                    </div>
                                    
                                    {formData.platform === 'jira' ? (
                                        <div className="space-y-8 p-10 rounded-[3rem] bg-foreground/[0.02] border border-foreground/5">
                                            <div className="space-y-4">
                                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40">Select Project Vector</Label>
                                                <Select value={projectKey} onValueChange={(val) => {
                                                    setProjectKey(val);
                                                    schemaMutation.mutate({ platform: 'jira', projectKey: val });
                                                }}>
                                                    <SelectTrigger className="h-14 bg-background/40 border-foreground/5 rounded-2xl text-lg font-black uppercase tracking-tight italic text-foreground">
                                                        <SelectValue placeholder="LOCATE PROJECT..." />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-background/95 border-foreground/10 backdrop-blur-3xl rounded-2xl">
                                                        {discoveredProjects.map(p => (
                                                            <SelectItem key={p.key} value={p.key} className="text-[10px] font-black uppercase italic tracking-widest text-foreground">
                                                                {p.name} ({p.key})
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            
                                            {schemaMutation.isPending && (
                                                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                                                    <RefreshCw className="w-12 h-12 text-primary animate-spin" />
                                                    <div className="text-[10px] font-black uppercase tracking-widest text-primary animate-pulse">Scanning Node Structure...</div>
                                                </div>
                                            )}
                                            
                                            {discoveredFields.length > 0 && (
                                                <div className="flex items-center gap-4 p-6 rounded-2xl bg-primary/5 border border-primary/20">
                                                    <ShieldCheck className="w-8 h-8 text-primary" />
                                                    <div className="space-y-1">
                                                        <div className="text-[11px] font-black uppercase italic tracking-widest text-foreground">Schema Integrity Verified</div>
                                                        <div className="text-[9px] font-bold uppercase tracking-widest text-primary">{discoveredFields.length} Data Vectors Detected</div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-20 space-y-8">
                                            {schemaMutation.isPending ? (
                                                <>
                                                    <div className="w-32 h-32 rounded-full border-4 border-primary/10 border-t-primary animate-spin" />
                                                    <div className="text-xl font-black uppercase italic tracking-widest text-primary animate-pulse italic">Scanning Global Vectors...</div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="w-32 h-32 rounded-full bg-primary/20 flex items-center justify-center text-primary shadow-[0_0_50px_rgba(var(--primary),0.3)]">
                                                        <Check className="w-16 h-16" />
                                                    </div>
                                                    <div className="space-y-2 text-center">
                                                        <div className="text-3xl font-black uppercase italic tracking-tight text-foreground">{discoveredFields.length} Vectors Found</div>
                                                        <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/30 italic">Target Bridge Schema has been indexed and ready for parity mapping.</p>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Step 3: Map */}
                            {currentStepId === "MAP" && (
                                <NeuralFieldMapper 
                                    discoveredFields={discoveredFields}
                                    mappings={JSON.parse(formData.field_mappings)}
                                    onMappingChange={updateMappings}
                                    platform={formData.platform}
                                />
                            )}

                            {/* Step 4: Calibrate */}
                            {currentStepId === "CALIBRATE" && (
                                <div className="space-y-12">
                                    <div className="grid grid-cols-2 gap-12">
                                        <div className="space-y-8">
                                            <div className="space-y-4">
                                                <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground italic flex items-center">
                                                    <Activity className="w-4 h-4 mr-3 text-primary" />
                                                    Handshake Interval
                                                </h4>
                                                <div className="flex items-center gap-6">
                                                    {[5, 15, 30, 60].map(val => (
                                                        <button 
                                                            key={val}
                                                            onClick={() => setFormData(prev => ({ ...prev, sync_interval: val }))}
                                                            className={cn(
                                                                "flex-1 h-20 rounded-2xl border transition-all text-center",
                                                                formData.sync_interval === val 
                                                                    ? "bg-primary/5 border-primary/50 text-primary" 
                                                                    : "bg-foreground/[0.02] border-foreground/5 text-foreground/40 hover:border-foreground/10"
                                                            )}
                                                        >
                                                            <div className="text-xl font-black uppercase tracking-tight">{val}</div>
                                                            <div className="text-[8px] font-bold uppercase tracking-widest opacity-60 italic">MINUTES</div>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground italic flex items-center">
                                                    <ShieldCheck className="w-4 h-4 mr-3 text-amber-400" />
                                                    Parity Resolution
                                                </h4>
                                                <Select value={formData.conflict_resolution} onValueChange={(val) => setFormData(prev => ({ ...prev, conflict_resolution: val }))}>
                                                    <SelectTrigger className="h-14 bg-background/40 border-foreground/5 rounded-2xl text-lg font-black uppercase tracking-tight italic text-foreground">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-background/95 border-foreground/10 backdrop-blur-3xl rounded-2xl">
                                                        <SelectItem value="last_write_wins" className="text-[10px] font-black uppercase italic tracking-widest text-foreground">LAST WRITE WINS</SelectItem>
                                                        <SelectItem value="source_wins" className="text-[10px] font-black uppercase italic tracking-widest text-foreground">EXTERNAL SOURCE PRIORITY</SelectItem>
                                                        <SelectItem value="destination_wins" className="text-[10px] font-black uppercase italic tracking-widest text-foreground">INTERNAL STORE PRIORITY</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        <LogicGateBuilder 
                                            discoveredFields={discoveredFields}
                                            filters={JSON.parse(formData.filters)}
                                            onFiltersChange={updateFilters}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Step 5: Activate */}
                            {currentStepId === "ACTIVATE" && (
                                <div className="max-w-2xl mx-auto space-y-12">
                                    <div className="space-y-4 text-center">
                                        <Badge className="bg-emerald-400/10 text-emerald-400 border-emerald-400/20 text-[9px] font-black tracking-widest uppercase italic py-1 px-4 rounded-full">Ready For Deployment</Badge>
                                        <h3 className="text-4xl font-black uppercase italic tracking-tighter text-foreground">Initialize Data Tunnel</h3>
                                    </div>
                                    
                                    <div className="p-10 rounded-[3rem] bg-foreground/[0.02] border border-foreground/5 space-y-8">
                                        <div className="grid grid-cols-2 gap-8">
                                            <div className="space-y-1">
                                                <div className="text-[9px] font-black uppercase tracking-widest text-foreground/30">Neural Bridge</div>
                                                <div className="text-xl font-black uppercase italic tracking-tight text-foreground">{formData.platform}</div>
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-[9px] font-black uppercase tracking-widest text-foreground/30">Parity Pulse</div>
                                                <div className="text-xl font-black uppercase italic tracking-tight text-foreground">Every {formData.sync_interval} Minutes</div>
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-[9px] font-black uppercase tracking-widest text-foreground/30">Vector Mappings</div>
                                                <div className="text-xl font-black uppercase italic tracking-tight text-foreground">{Object.keys(JSON.parse(formData.field_mappings)).length} Active</div>
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-[9px] font-black uppercase tracking-widest text-foreground/30">Logic Gates</div>
                                                <div className="text-xl font-black uppercase italic tracking-tight text-foreground">{Object.keys(JSON.parse(formData.filters)).length} Active</div>
                                            </div>
                                        </div>
                                        
                                        <div className="pt-8 border-t border-foreground/5 flex items-center justify-center">
                                            <div className="w-full h-12 rounded-2xl bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center gap-4 text-emerald-400">
                                                <Zap className="w-5 h-5 animate-pulse" />
                                                <span className="text-[10px] font-black uppercase tracking-[0.3em] italic">Full Handshake Synchronized</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>

                {/* Footer Actions */}
                <div className="p-8 border-t border-foreground/5 bg-foreground/[0.02] flex items-center justify-between">
                    <Button 
                        variant="ghost" 
                        onClick={handleBack}
                        disabled={currentStep === 0}
                        className="h-14 px-8 rounded-2xl text-[11px] font-black uppercase tracking-widest italic text-foreground/40 hover:text-foreground hover:bg-foreground/5 transition-all"
                    >
                        <ChevronLeft className="w-4 h-4 mr-3" />
                        Retrace Step
                    </Button>
                    
                    <div className="flex items-center gap-4">
                        <Button 
                            variant="ghost" 
                            onClick={onClose}
                            className="h-14 px-8 rounded-2xl text-[11px] font-black uppercase tracking-widest italic text-foreground/20 hover:text-rose-500 hover:bg-rose-500/5 transition-all"
                        >
                            Abort Linkup
                        </Button>
                        <Button 
                            onClick={handleNext}
                            className="h-14 px-10 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-black uppercase tracking-widest italic shadow-xl shadow-primary/20 group"
                        >
                            {currentStep === STEPS.length - 1 ? "Initialize_Pulse" : "Advance_Phase"}
                            <ChevronRight className="w-4 h-4 ml-3 group-hover:translate-x-1 transition-transform" />
                        </Button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
