import React, { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { 
    Cloud, 
    Search, 
    ArrowRight, 
    Sparkles, 
    Download, 
    Link as LinkIcon, 
    Plus, 
    FileUp, 
    Check, 
    AlertTriangle, 
    Shield, 
    Info, 
    ChevronLeft,
    Loader2,
    Bot,
    GitMerge,
    CheckCircle2
} from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface ImportSkillModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

// Mirrors DiscoverableSkill in server/domain/jobs/skill-import.service.ts —
// GET /api/jobs/import/discover returns a flat { skills: [...] }, not categories.
interface DiscoverableSkill {
    name: string;
    description: string;
    author: string;
    sourceUrl: string;
    platform: "skills.sh" | "clawhub" | "github";
    stars?: number;
    tags: string[];
}

interface AnalyzedSkill {
    name: string;
    description: string;
    tools: string[];
    missingDependencies: string[];
    persona: string;
    instructions: string;
    sourceFile: string;
    extractedJobs?: any[];
    securityReport?: {
        riskLevel: "low" | "medium" | "high";
        findings: {
            type: string;
            message: string;
            severity: string;
        }[];
        score: number;
    };
}

export default function ImportSkillModal({ open, onOpenChange }: ImportSkillModalProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [view, setView] = useState<'selection' | 'review' | 'decision'>('selection');
    const [activeTab, setActiveTab] = useState('discover');
    const [url, setUrl] = useState('');
    const [analyzedSkills, setAnalyzedSkills] = useState<AnalyzedSkill[]>([]);
    const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [evaluationResult, setEvaluationResult] = useState<any>(null);
    const [selectedAction, setSelectedAction] = useState<'augment' | 'create_new' | 'submit_review'>('augment');
    const [selectedTargetAgentId, setSelectedTargetAgentId] = useState<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Mutation for live skill evaluation against org agent cards
    const evaluateSkillMutation = useMutation({
        mutationFn: async (skillData: AnalyzedSkill) => {
            const res = await apiRequest("POST", "/api/admin/skills/evaluate", {
                name: skillData.name,
                description: skillData.description,
                persona: skillData.persona,
                capabilities: skillData.extractedJobs?.map((j: any) => j.name) || [skillData.name],
                tools: skillData.tools || [],
                securityReport: skillData.securityReport,
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
        onSuccess: (data) => {
            setEvaluationResult(data);
            if (data.targetAgentCardId) {
                setSelectedTargetAgentId(data.targetAgentCardId);
                setSelectedAction('augment');
            } else {
                setSelectedAction('create_new');
            }
            setView('decision');
        },
        onError: (error: Error) => {
            toast({ title: "Evaluation failed", description: error.message, variant: "destructive" });
        }
    });

    // Mutation for submitting review & decision
    const submitDecisionMutation = useMutation({
        mutationFn: async ({ skillData, action, targetAgentId }: { skillData: AnalyzedSkill; action: string; targetAgentId?: number | null }) => {
            if (action === 'create_new') {
                return importMutation.mutateAsync(skillData);
            }

            const reviewRes = await apiRequest("POST", "/api/admin/skills/reviews", {
                skillName: skillData.name,
                skillDescription: skillData.description,
                sourceUrl: url || skillData.sourceFile || "manual",
                sourcePlatform: "custom",
                extractedPersona: skillData.persona,
                extractedCapabilities: skillData.extractedJobs?.map((j: any) => j.name) || [skillData.name],
                extractedTools: skillData.tools || [],
                securityReport: skillData.securityReport,
            });
            if (!reviewRes.ok) throw new Error(await reviewRes.text());
            const review = await reviewRes.json();

            if (action === 'augment' && targetAgentId) {
                const decisionRes = await apiRequest("POST", `/api/admin/skills/reviews/${review.id}/decision`, {
                    action: "augment",
                    targetAgentCardId: targetAgentId,
                    reviewNotes: `Augmentation applied directly via Skill Import Hub`,
                });
                if (!decisionRes.ok) throw new Error(await decisionRes.text());
                return decisionRes.json();
            }

            return review;
        },
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/skills"] });
            queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
            toast({ 
                title: selectedAction === 'augment' ? "Agent Augmented" : selectedAction === 'submit_review' ? "Review Submitted" : "Skill Imported", 
                description: selectedAction === 'augment' ? "The agent card was successfully augmented with the new capabilities." : "Skill processed successfully." 
            });
            onOpenChange(false);
            resetModal();
        },
        onError: (error: any) => {
            toast({ title: "Operation failed", description: error.message, variant: "destructive" });
        }
    });

    // Fetch discoverable skills
    const { data: discoveryData, isLoading: isLoadingDiscovery } = useQuery<{ skills: DiscoverableSkill[] }>({
        queryKey: ["/api/jobs/import/discover"],
        enabled: open && activeTab === 'discover',
    });

    // Mutation for URL analysis
    const analyzeUrlMutation = useMutation({
        mutationFn: async (urlToAnalyze: string) => {
            const res = await apiRequest("POST", "/api/jobs/import/analyze-url", { url: urlToAnalyze });
            if (!res.ok) throw new Error(await res.text());
            return res.json() as Promise<{ skills: AnalyzedSkill[] }>;
        },
        onSuccess: (data) => {
            if (data.skills && data.skills.length > 0) {
                setAnalyzedSkills(data.skills);
                setSelectedSkillIndex(0);
                setView('review');
            } else {
                toast({ title: "No skills found", description: "Couldn't detect any AI scripts or skills at this URL.", variant: "destructive" });
            }
        },
        onError: (error: Error) => {
            toast({ title: "Analysis failed", description: error.message, variant: "destructive" });
        }
    });

    // Mutation for file / zip bundle analysis
    const analyzeFileMutation = useMutation({
        mutationFn: async (file: File) => {
            const formData = new FormData();
            formData.append("file", file);
            const res = await apiRequest("POST", "/api/jobs/import/analyze", formData);
            if (!res.ok) throw new Error(await res.text());
            return res.json() as Promise<{ skills: AnalyzedSkill[] }>;
        },
        onSuccess: (data) => {
            if (data.skills && data.skills.length > 0) {
                setAnalyzedSkills(data.skills);
                setSelectedSkillIndex(0);
                setView('review');
            } else {
                toast({ title: "No skills found", description: "Couldn't detect a SKILL.md or any AI scripts in that bundle.", variant: "destructive" });
            }
        },
        onError: (error: Error) => {
            toast({ title: "Analysis failed", description: error.message, variant: "destructive" });
        }
    });

    const handleFiles = (files: FileList | null) => {
        const file = files?.[0];
        if (!file) return;
        analyzeFileMutation.mutate(file);
    };

    // Mutation for Import Confirmation
    const importMutation = useMutation({
        mutationFn: async (skillData: AnalyzedSkill) => {
            if (!skillData) throw new Error("Skill data is required");
            console.log("[IMPORT_DEBUG] Submitting skill for confirmation:", {
                name: skillData.name,
                jobsCount: skillData.extractedJobs?.length || 0,
                payloadSize: JSON.stringify(skillData).length
            });
            const res = await apiRequest("POST", "/api/jobs/confirm-skill-import", {
                skill: skillData,
                extractedJobs: skillData.extractedJobs || []
            });
            if (!res.ok) {
                const errorText = await res.text();
                console.error("[IMPORT_DEBUG] Confirm endpoint returned non-OK status:", res.status, errorText);
                throw new Error(errorText);
            }
            return res.json();
        },
        onSuccess: () => {
            console.log("[IMPORT_DEBUG] Confirm successful");
            queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/skills"] });
            toast({ title: "Skill Imported", description: "The skill has been successfully added to your organization." });
            onOpenChange(false);
            resetModal();
        },
        onError: (error: any) => {
            console.error("[IMPORT_DEBUG] Confirm mutation error:", error);
            toast({ title: "Import failed", description: error.message, variant: "destructive" });
        }
    });

    const resetModal = () => {
        setView('selection');
        setAnalyzedSkills([]);
        setUrl('');
        setIsDragging(false);
    };

    const handleBack = () => {
        if (view === 'decision') {
            setView('review');
        } else {
            setView('selection');
        }
    };

    const currentSkill = analyzedSkills[selectedSkillIndex];

    return (
        <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetModal(); }}>
            <DialogContent className={cn(
                "p-0 overflow-hidden border-none bg-espresso text-foreground transition-all duration-300",
                view === 'selection' ? "sm:max-w-[600px]" : "sm:max-w-[850px]"
            )}>
                <div className="absolute top-0 right-0 -mt-20 -mr-20 w-64 h-64 bg-vibrantBronze/20 rounded-full blur-3xl opacity-50 pointer-events-none" />
                
                <DialogHeader className="p-8 pb-4 relative z-10">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2 mb-2">
                                <Badge variant="outline" className="bg-vibrantBronze/20 border-vibrantBronze/30 text-vibrantBronze text-[10px] font-black tracking-widest uppercase">
                                    <Sparkles className="w-3 h-3 mr-1" />
                                    {view === 'decision' ? 'Multi-Agent Intelligence' : 'Curated Intelligence'}
                                </Badge>
                            </div>
                            <DialogTitle className="text-3xl font-black italic uppercase tracking-tighter">
                                {view === 'selection' ? 'Discover ' : view === 'review' ? 'Review ' : 'Integration '}
                                <span className="text-vibrantBronze not-italic font-light">
                                    {view === 'selection' ? 'Community Skills' : view === 'review' ? 'Skill Assessment' : 'Decision Router'}
                                </span>
                            </DialogTitle>
                            <DialogDescription className="text-muted-foreground font-medium">
                                {view === 'selection' 
                                    ? "Import verified, high-performance capabilities directly into your private registry."
                                    : view === 'review'
                                    ? `Analyzing metadata and security protocols for: ${currentSkill?.name}`
                                    : `Determine whether to augment an existing agent or provision a new specialized agent.`
                                }
                            </DialogDescription>
                        </div>
                        {view !== 'selection' && (
                            <Button variant="ghost" onClick={handleBack} className="text-muted-foreground hover:text-foreground group">
                                <ChevronLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
                                Back
                            </Button>
                        )}
                    </div>
                </DialogHeader>

                <div className="relative z-10">
                    {view === 'selection' ? (
                        <div className="p-8 pt-0 space-y-6">
                            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                                <TabsList className="grid w-full grid-cols-2 bg-foreground/5 border border-foreground/10 rounded-xl h-12 p-1">
                                    <TabsTrigger value="discover" className="rounded-lg data-[state=active]:bg-vibrantBronze data-[state=active]:text-espresso font-bold uppercase tracking-widest text-[10px] text-foreground/40 data-[state=active]:opacity-100">
                                        <Cloud className="w-3.5 h-3.5 mr-2" /> Discovery Hub
                                    </TabsTrigger>
                                    <TabsTrigger value="import" className="rounded-lg data-[state=active]:bg-vibrantBronze data-[state=active]:text-espresso font-bold uppercase tracking-widest text-[10px] text-foreground/40 data-[state=active]:opacity-100">
                                        <Plus className="w-3.5 h-3.5 mr-2" /> Manual Import
                                    </TabsTrigger>
                                </TabsList>

                                <TabsContent value="discover" className="mt-6">
                                    <ScrollArea className="h-[400px] pr-4">
                                        {isLoadingDiscovery ? (
                                            <div className="flex flex-col items-center justify-center h-48 gap-4">
                                                <Loader2 className="w-8 h-8 animate-spin text-vibrantBronze" />
                                                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Scanning Skill Registry...</p>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 gap-2">
                                                {(discoveryData?.skills ?? []).map((skill, si) => (
                                                    <div
                                                        key={skill.sourceUrl || si}
                                                        className="group p-4 rounded-2xl bg-foreground/5 border border-foreground/10 hover:bg-foreground/10 hover:border-vibrantBronze/30 transition-all cursor-pointer"
                                                        onClick={() => {
                                                            if (skill.sourceUrl) {
                                                                setUrl(skill.sourceUrl);
                                                                analyzeUrlMutation.mutate(skill.sourceUrl);
                                                            }
                                                        }}
                                                    >
                                                        <div className="flex items-center justify-between mb-2">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-10 h-10 rounded-xl bg-espresso/50 border border-foreground/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                                                                    <Cloud className="w-5 h-5 text-vibrantBronze" />
                                                                </div>
                                                                <div>
                                                                    <h4 className="font-bold text-sm uppercase tracking-tight italic">{skill.name}</h4>
                                                                    <p className="text-[11px] text-muted-foreground font-medium line-clamp-1">{skill.description}</p>
                                                                </div>
                                                            </div>
                                                            <Badge variant="outline" className="text-[9px] font-mono border-foreground/10 opacity-60">
                                                                {skill.platform || 'AI'}
                                                            </Badge>
                                                        </div>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[10px] text-muted-foreground font-medium truncate">
                                                                {skill.author}{typeof skill.stars === 'number' ? ` · ★ ${skill.stars}` : ''}
                                                            </span>
                                                            <span className="text-[10px] font-black text-vibrantBronze uppercase tracking-widest flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                Detail Assessment <ArrowRight className="w-3 h-3" />
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                                {(discoveryData?.skills?.length ?? 0) === 0 && (
                                                    <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
                                                        <Search className="w-6 h-6 text-muted-foreground" />
                                                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">No skills found in the registry</p>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </ScrollArea>
                                </TabsContent>

                                <TabsContent value="import" className="mt-6 space-y-6">
                                    <div className="grid grid-cols-1 gap-6">
                                        <div className="space-y-3">
                                            <Label htmlFor="skill-url" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Resource URL</Label>
                                            <div className="space-y-4">
                                                <div className="relative">
                                                    <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                                                    <Input 
                                                        id="skill-url"
                                                        placeholder="GitHub Gist, raw URL, or Skills Hub URL..." 
                                                        className="bg-foreground/5 border-foreground/10 pl-10 h-14 text-sm focus-visible:ring-vibrantBronze/30 rounded-xl w-full"
                                                        value={url}
                                                        onChange={(e) => setUrl(e.target.value)}
                                                    />
                                                </div>
                                                <Button 
                                                    type="button"
                                                    onClick={() => {
                                                        console.log("Forcing analysis for URL:", url);
                                                        analyzeUrlMutation.mutate(url);
                                                    }}
                                                    disabled={analyzeUrlMutation.isPending || !url}
                                                    style={{ 
                                                        backgroundColor: '#D4AF37', 
                                                        color: '#2A1E17',
                                                        opacity: 1,
                                                        display: 'flex'
                                                    }}
                                                    className="w-full font-black uppercase tracking-widest text-xs h-14 rounded-xl hover:bg-card shadow-2xl transition-all border-2 border-foreground/20"
                                                >
                                                    {analyzeUrlMutation.isPending ? (
                                                        <div className="flex items-center justify-center">
                                                            <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                                                            <span>Analyzing System...</span>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center justify-center">
                                                            <Sparkles className="w-5 h-5 mr-3" />
                                                            <span>Initiate Structural Analysis</span>
                                                        </div>
                                                    )}
                                                </Button>
                                            </div>
                                            <p className="text-[10px] text-muted-foreground italic">Supports .sh, .ts, .py AI scripts and community agent bundles.</p>
                                        </div>

                                        <div
                                            role="button"
                                            tabIndex={0}
                                            aria-label="Upload skill bundle"
                                            data-testid="skill-bundle-dropzone"
                                            onClick={() => fileInputRef.current?.click()}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    fileInputRef.current?.click();
                                                }
                                            }}
                                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                            onDragLeave={() => setIsDragging(false)}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                setIsDragging(false);
                                                handleFiles(e.dataTransfer.files);
                                            }}
                                            className={cn(
                                                "p-8 rounded-2xl bg-foreground/5 border border-dashed flex flex-col items-center justify-center gap-3 group transition-all cursor-pointer hover:bg-foreground/10 hover:border-vibrantBronze/30",
                                                isDragging ? "border-vibrantBronze bg-foreground/10" : "border-foreground/10",
                                                analyzeFileMutation.isPending && "pointer-events-none opacity-60"
                                            )}
                                        >
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept=".zip,.md,.json"
                                                className="hidden"
                                                data-testid="skill-bundle-input"
                                                onChange={(e) => {
                                                    handleFiles(e.target.files);
                                                    e.target.value = '';
                                                }}
                                            />
                                            <div className="w-12 h-12 rounded-full bg-foreground/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                                                {analyzeFileMutation.isPending
                                                    ? <Loader2 className="w-6 h-6 text-vibrantBronze animate-spin" />
                                                    : <FileUp className="w-6 h-6 text-muted-foreground group-hover:text-vibrantBronze" />}
                                            </div>
                                            <div className="text-center">
                                                <p className="text-sm font-bold uppercase tracking-tight italic">
                                                    {analyzeFileMutation.isPending ? 'Analyzing Bundle...' : 'Drag & Drop Skill Bundle'}
                                                </p>
                                                <p className="text-[10px] text-muted-foreground font-medium mt-1">Accepts .zip agent packages, SKILL.md, or .json</p>
                                            </div>
                                        </div>
                                    </div>
                                </TabsContent>
                            </Tabs>

                            <div className="pt-4 border-t border-foreground/5 flex items-center justify-between">
                                <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                    <Search className="w-3 h-3 text-vibrantBronze" />
                                    Browsing Multi-Chain Skill Nodes
                                </div>
                                <Button 
                                    variant="ghost" 
                                    className="text-muted-foreground hover:text-foreground hover:bg-foreground/5 text-[10px] font-black uppercase tracking-widest"
                                    onClick={() => onOpenChange(false)}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    ) : view === 'review' ? (
                        <div className="p-8 pt-0 space-y-6">
                            <ScrollArea className="h-[450px] pr-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                                    <div className="md:col-span-2 space-y-6">
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2">
                                                <Badge className="bg-vibrantBronze/10 text-vibrantBronze border-vibrantBronze/20 uppercase text-[9px]">Verified Blueprint</Badge>
                                                <Badge variant="outline" className="border-foreground/10 text-muted-foreground uppercase text-[9px]">{currentSkill?.tools?.length || 0} Tools Included</Badge>
                                            </div>
                                            
                                            <div className="space-y-2">
                                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Persona & Intent</h3>
                                                <div className="p-4 rounded-xl bg-foreground/5 border border-foreground/10 text-sm font-medium leading-relaxed italic text-foreground">
                                                    "{currentSkill?.persona}"
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Instructions</h3>
                                                <div className="p-4 rounded-xl bg-foreground/5 border border-foreground/10 text-xs font-mono text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">
                                                    {currentSkill?.instructions}
                                                </div>
                                            </div>
                                            
                                            <div className="space-y-2">
                                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Capability Matrix</h3>
                                                <div className="flex flex-wrap gap-2">
                                                    {currentSkill?.tools?.map((tool, i) => (
                                                        <Badge key={i} variant="secondary" className="bg-foreground/5 text-foreground border-foreground/10 hover:bg-foreground/10">
                                                            {tool}
                                                        </Badge>
                                                    ))}
                                                    {(!currentSkill?.tools || currentSkill.tools.length === 0) && (
                                                        <p className="text-[10px] text-muted-foreground italic">No specific external tools detected.</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="p-6 rounded-2xl bg-espresso border border-foreground/10 shadow-2xl relative overflow-hidden group">
                                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                                <Shield className="w-12 h-12" />
                                            </div>
                                            
                                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-vibrantBronze mb-4 flex items-center gap-2">
                                                <Shield className="w-3.5 h-3.5" /> Security Rating
                                            </h3>
                                            
                                            <div className="flex flex-col items-center gap-2 mb-6">
                                                <div className={cn(
                                                    "text-4xl font-black italic",
                                                    currentSkill?.securityReport?.riskLevel === 'high' ? "text-red-500" : 
                                                    currentSkill?.securityReport?.riskLevel === 'medium' ? "text-yellow-500" : "text-emerald-500"
                                                )}>
                                                    {currentSkill?.securityReport?.score || 100}
                                                    <span className="text-xs not-italic opacity-40 ml-1">/ 100</span>
                                                </div>
                                                <Badge className={cn(
                                                    "uppercase text-[9px] font-black px-3",
                                                    currentSkill?.securityReport?.riskLevel === 'high' ? "bg-red-500 text-foreground" : 
                                                    currentSkill?.securityReport?.riskLevel === 'medium' ? "bg-yellow-500 text-espresso" : "bg-emerald-500 text-espresso"
                                                )}>
                                                    {currentSkill?.securityReport?.riskLevel || 'LOW'} RISK
                                                </Badge>
                                            </div>

                                            <div className="space-y-3">
                                                {currentSkill?.securityReport?.findings?.map((finding, i) => (
                                                    <div key={i} className="flex gap-2">
                                                        <AlertTriangle className={cn(
                                                            "w-3 h-3 flex-shrink-0 mt-0.5",
                                                            finding.severity === 'high' ? "text-red-500" : "text-yellow-500"
                                                        )} />
                                                        <p className="text-[10px] text-muted-foreground font-medium leading-tight">{finding.message}</p>
                                                    </div>
                                                ))}
                                                {(!currentSkill?.securityReport?.findings || currentSkill.securityReport.findings.length === 0) && (
                                                    <div className="flex gap-2">
                                                        <Check className="w-3 h-3 text-emerald-500 mt-0.5" />
                                                        <p className="text-[10px] text-muted-foreground">No malicious intent or secrets detected.</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="p-6 rounded-2xl bg-foreground/5 border border-foreground/10">
                                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4 flex items-center gap-2">
                                                <Info className="w-3.5 h-3.5" /> Metadata
                                            </h3>
                                            <div className="space-y-2 text-[10px]">
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Source:</span>
                                                    <span className="text-foreground font-mono truncate max-w-[120px]">{currentSkill?.sourceFile}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Integrations:</span>
                                                    <span className="text-foreground">Multi-Channel</span>
                                                </div>
                                            </div>
                                        </div>

                                        {analyzedSkills.length > 1 && (
                                            <div className="space-y-2">
                                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Detected Skills ({analyzedSkills.length})</h3>
                                                <div className="space-y-1 bg-foreground/5 rounded-xl p-2 border border-foreground/10">
                                                    {analyzedSkills.map((s, i) => (
                                                        <Button 
                                                            key={i} 
                                                            variant="ghost" 
                                                            className={cn(
                                                                "w-full justify-start text-[10px] font-bold h-7 px-2",
                                                                selectedSkillIndex === i ? "bg-vibrantBronze/20 text-vibrantBronze" : "text-muted-foreground"
                                                            )}
                                                            onClick={() => setSelectedSkillIndex(i)}
                                                        >
                                                            {s.name}
                                                        </Button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </ScrollArea>

                            <div className="pt-6 border-t border-foreground/5 flex items-center justify-between">
                                <p className="text-[10px] text-muted-foreground italic max-w-sm">
                                    By importing, you agree to execute this script within your organization's security sandbox.
                                </p>
                                <div className="flex gap-3">
                                    <Button 
                                        variant="ghost" 
                                        className="text-muted-foreground hover:text-foreground hover:bg-foreground/5 text-[10px] font-black uppercase tracking-widest"
                                        onClick={handleBack}
                                    >
                                        Edit Resource
                                    </Button>
                                    <Button 
                                        onClick={() => evaluateSkillMutation.mutate(currentSkill)}
                                        disabled={evaluateSkillMutation.isPending}
                                        style={{ 
                                            backgroundColor: '#D4AF37', 
                                            color: '#2A1E17',
                                            opacity: 1,
                                            display: 'flex'
                                        }}
                                        className="font-black uppercase tracking-widest text-xs h-12 px-8 rounded-xl hover:bg-card shadow-2xl transition-all border-2 border-foreground/20 active:scale-95"
                                    >
                                        {evaluateSkillMutation.isPending ? (
                                            <>
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                Analyzing Compatibility...
                                            </>
                                        ) : (
                                            <>
                                                <ArrowRight className="w-4 h-4 mr-2" />
                                                Next: Agent Decision
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* ── DECISION VIEW (Phase 4) ── */
                        <div className="p-8 pt-0 space-y-6">
                            <ScrollArea className="h-[460px] pr-4">
                                <div className="space-y-6">
                                    {/* Recommendation Banner */}
                                    <div className="p-6 rounded-2xl bg-foreground/5 border border-foreground/10 flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-xl bg-vibrantBronze/20 border border-vibrantBronze/30 flex items-center justify-center text-vibrantBronze font-black text-lg">
                                                {evaluationResult?.compatibilityScore ?? 0}%
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <Badge className="bg-vibrantBronze text-espresso text-[10px] font-black uppercase tracking-widest">
                                                        {evaluationResult?.overallRecommendation === 'augment_existing' ? 'Augment Recommended' :
                                                         evaluationResult?.overallRecommendation === 'assign_multiple' ? 'Shared Affinity' :
                                                         evaluationResult?.overallRecommendation === 'hybrid' ? 'Hybrid Candidate' : 'Novel Capability'}
                                                    </Badge>
                                                </div>
                                                <p className="text-sm font-bold mt-1">
                                                    {evaluationResult?.overallRecommendation === 'augment_existing'
                                                        ? `High compatibility detected with ${evaluationResult?.bestMatch?.agentName || 'an existing agent'}.`
                                                        : evaluationResult?.overallRecommendation === 'assign_multiple'
                                                        ? `Multiple agents share topic affinities with this skill.`
                                                        : evaluationResult?.overallRecommendation === 'hybrid'
                                                        ? `Partial overlap — merge capabilities or create a specialized variant.`
                                                        : `No strong overlap detected. Provisioning a standalone agent is recommended.`}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Strategy Selector */}
                                    <div className="space-y-3">
                                        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-vibrantBronze flex items-center gap-2">
                                            <Bot className="w-4 h-4" /> Select Integration Strategy
                                        </h3>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            {/* Option 1: Augment Existing */}
                                            <div
                                                onClick={() => {
                                                    setSelectedAction('augment');
                                                    if (!selectedTargetAgentId && evaluationResult?.targetAgentCardId) {
                                                        setSelectedTargetAgentId(evaluationResult.targetAgentCardId);
                                                    }
                                                }}
                                                className={cn(
                                                    "p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between",
                                                    selectedAction === 'augment'
                                                        ? "border-vibrantBronze bg-vibrantBronze/10 ring-1 ring-vibrantBronze"
                                                        : "border-foreground/10 bg-foreground/5 hover:bg-foreground/10"
                                                )}
                                            >
                                                <div>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <GitMerge className="w-5 h-5 text-vibrantBronze" />
                                                        {selectedAction === 'augment' && <CheckCircle2 className="w-4 h-4 text-vibrantBronze" />}
                                                    </div>
                                                    <h4 className="text-xs font-bold uppercase">Augment Existing Agent</h4>
                                                    <p className="text-[10px] text-muted-foreground mt-1">
                                                        Merge tools & capabilities into an existing Agent Card.
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Option 2: Create New Standalone Agent */}
                                            <div
                                                onClick={() => setSelectedAction('create_new')}
                                                className={cn(
                                                    "p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between",
                                                    selectedAction === 'create_new'
                                                        ? "border-vibrantBronze bg-vibrantBronze/10 ring-1 ring-vibrantBronze"
                                                        : "border-foreground/10 bg-foreground/5 hover:bg-foreground/10"
                                                )}
                                            >
                                                <div>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <Plus className="w-5 h-5 text-vibrantBronze" />
                                                        {selectedAction === 'create_new' && <CheckCircle2 className="w-4 h-4 text-vibrantBronze" />}
                                                    </div>
                                                    <h4 className="text-xs font-bold uppercase">Create New Agent</h4>
                                                    <p className="text-[10px] text-muted-foreground mt-1">
                                                        Provision a dedicated agent job from this skill bundle.
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Option 3: Submit for Governance Review */}
                                            <div
                                                onClick={() => setSelectedAction('submit_review')}
                                                className={cn(
                                                    "p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between",
                                                    selectedAction === 'submit_review'
                                                        ? "border-vibrantBronze bg-vibrantBronze/10 ring-1 ring-vibrantBronze"
                                                        : "border-foreground/10 bg-foreground/5 hover:bg-foreground/10"
                                                )}
                                            >
                                                <div>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <Shield className="w-5 h-5 text-vibrantBronze" />
                                                        {selectedAction === 'submit_review' && <CheckCircle2 className="w-4 h-4 text-vibrantBronze" />}
                                                    </div>
                                                    <h4 className="text-xs font-bold uppercase">Submit for Review</h4>
                                                    <p className="text-[10px] text-muted-foreground mt-1">
                                                        Queue in Governance Review for human operator approval.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Candidate Agent Match List (shown if Augment is chosen) */}
                                    {selectedAction === 'augment' && (
                                        <div className="space-y-3">
                                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                                                <Bot className="w-3.5 h-3.5" /> Target Agent Candidates
                                            </h3>
                                            {(!evaluationResult?.topMatches || evaluationResult.topMatches.length === 0) ? (
                                                <div className="p-4 rounded-xl bg-foreground/5 text-center text-xs text-muted-foreground">
                                                    No existing agent cards found for this organization. Consider creating a new agent.
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    {evaluationResult.topMatches.map((match: any) => (
                                                        <div
                                                            key={match.agentCardId}
                                                            onClick={() => setSelectedTargetAgentId(match.agentCardId)}
                                                            className={cn(
                                                                "p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between",
                                                                selectedTargetAgentId === match.agentCardId
                                                                    ? "border-vibrantBronze bg-vibrantBronze/15"
                                                                    : "border-foreground/10 bg-foreground/5 hover:bg-foreground/10"
                                                            )}
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-8 h-8 rounded-lg bg-vibrantBronze/20 flex items-center justify-center font-bold text-xs text-vibrantBronze">
                                                                    {match.score}%
                                                                </div>
                                                                <div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-xs font-bold">{match.agentName}</span>
                                                                        {match.agentCardId === evaluationResult?.bestMatch?.agentCardId && (
                                                                            <Badge className="bg-emerald-500/20 text-emerald-400 text-[8px] font-black uppercase">
                                                                                Top Match
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                    <p className="text-[10px] text-muted-foreground">
                                                                        Overlap: {match.breakdown?.capabilityOverlap}/25 · Persona: {match.breakdown?.personaAlignment}/25 · Tools: {match.breakdown?.toolCompatibility}/25
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            {selectedTargetAgentId === match.agentCardId && (
                                                                <Check className="w-4 h-4 text-vibrantBronze" />
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* 4-Factor Breakdown Chips */}
                                    {evaluationResult?.scoringBreakdown && (
                                        <div className="p-4 rounded-xl bg-foreground/5 border border-foreground/10 space-y-2">
                                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                                                Scoring Breakdown
                                            </h4>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center text-[10px]">
                                                <div className="p-2 rounded-lg bg-foreground/5 border border-foreground/5">
                                                    <span className="text-muted-foreground block">Capability</span>
                                                    <span className="font-bold text-foreground">{evaluationResult.scoringBreakdown.capabilityOverlap} / 25</span>
                                                </div>
                                                <div className="p-2 rounded-lg bg-foreground/5 border border-foreground/5">
                                                    <span className="text-muted-foreground block">Persona</span>
                                                    <span className="font-bold text-foreground">{evaluationResult.scoringBreakdown.personaAlignment} / 25</span>
                                                </div>
                                                <div className="p-2 rounded-lg bg-foreground/5 border border-foreground/5">
                                                    <span className="text-muted-foreground block">Tool Set</span>
                                                    <span className="font-bold text-foreground">{evaluationResult.scoringBreakdown.toolCompatibility} / 25</span>
                                                </div>
                                                <div className="p-2 rounded-lg bg-foreground/5 border border-foreground/5">
                                                    <span className="text-muted-foreground block">Security</span>
                                                    <span className="font-bold text-foreground">{evaluationResult.scoringBreakdown.riskScore} / 25</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>

                            {/* Decision Footer */}
                            <div className="pt-6 border-t border-foreground/5 flex items-center justify-between">
                                <p className="text-[10px] text-muted-foreground italic max-w-sm">
                                    {selectedAction === 'augment'
                                        ? "Augmentation captures an exact pre-mutation snapshot and is 100% reversible."
                                        : selectedAction === 'create_new'
                                        ? "Creates a standalone agent job with its own dedicated lifecycle and permissions."
                                        : "Queues in Governance with full telemetry for operator evaluation."}
                                </p>
                                <div className="flex gap-3">
                                    <Button 
                                        variant="ghost" 
                                        className="text-muted-foreground hover:text-foreground hover:bg-foreground/5 text-[10px] font-black uppercase tracking-widest"
                                        onClick={handleBack}
                                    >
                                        Back to Review
                                    </Button>
                                    <Button 
                                        onClick={() => submitDecisionMutation.mutate({
                                            skillData: currentSkill,
                                            action: selectedAction,
                                            targetAgentId: selectedTargetAgentId,
                                        })}
                                        disabled={submitDecisionMutation.isPending || (selectedAction === 'augment' && !selectedTargetAgentId)}
                                        style={{ 
                                            backgroundColor: '#D4AF37', 
                                            color: '#2A1E17',
                                            opacity: 1,
                                            display: 'flex'
                                        }}
                                        className="font-black uppercase tracking-widest text-xs h-12 px-8 rounded-xl hover:bg-card shadow-2xl transition-all border-2 border-foreground/20 active:scale-95"
                                    >
                                        {submitDecisionMutation.isPending ? (
                                            <>
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                Applying Integration...
                                            </>
                                        ) : (
                                            <>
                                                <Check className="w-4 h-4 mr-2" />
                                                {selectedAction === 'augment' ? 'Apply Augmentation' :
                                                 selectedAction === 'create_new' ? 'Create Agent' : 'Submit Review'}
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
