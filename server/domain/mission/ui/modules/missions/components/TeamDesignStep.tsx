import * as React from "react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { formSchema } from '../types/index.js';
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Loader2, Plus, Terminal, User, Wand2 } from "lucide-react";
import { StrategyContextPanel } from "@/modules/missions/components";
import { ExecutionStrategy } from "@/modules/missions/config/mission-strategies.config";

interface TeamDesignStepProps {
    executionStrategy?: ExecutionStrategy;
    addingAgent: boolean;
    setAddingAgent: React.Dispatch<React.SetStateAction<boolean>>;
    selectedJobId: string;
    setSelectedJobId: (val: string) => void;
    availableJobs: any[];
    pendingMembers: any[];
    setPendingMembers: React.Dispatch<React.SetStateAction<any[]>>;
    addAgentRole: string;
    setAddAgentRole: (val: string) => void;
    getJobIcon: (type: string) => React.ReactNode;
    synthesizeMutation: any;
    planHistory: any[];
    setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
    prevStep: () => void;
    nextStep: () => void;
    validateMutation: any;
    validationBlockers: string[];
    setValidationBlockers: React.Dispatch<React.SetStateAction<string[]>>;
}

export function TeamDesignStep({
    executionStrategy = "pre_planned",
    addingAgent,
    setAddingAgent,
    selectedJobId,
    setSelectedJobId,
    availableJobs,
    pendingMembers,
    setPendingMembers,
    addAgentRole,
    setAddAgentRole,
    getJobIcon,
    synthesizeMutation,
    planHistory,
    setCurrentStep,
    prevStep,
    nextStep,
    validateMutation,
    validationBlockers,
    setValidationBlockers
}: TeamDesignStepProps) {
    const unsynthesizedCount = pendingMembers.filter(m => 
        !m.entityId || !availableJobs.some((j: any) => j.id === m.entityId)
    ).length;

    const synthesizeAll = () => {
        pendingMembers.forEach((m, i) => {
            const isSynthesized = m.entityId && availableJobs.some((j: any) => j.id === m.entityId);
            if (!isSynthesized) {
                synthesizeMutation.mutate({ role: m.role, index: i, suggestedConfig: m.suggestedConfig });
            }
        });
    };

    React.useEffect(() => {
        // Diagnostic sync
    }, []);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold text-primary uppercase font-mono tracking-wider">Recruitment Board</h4>
                <div className="flex gap-2">
                    {unsynthesizedCount > 1 && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[10px] border-primary/50 text-primary hover:bg-primary/10"
                            onClick={synthesizeAll}
                            disabled={synthesizeMutation.isPending}
                        >
                            <Wand2 className="w-3 h-3 mr-1" /> Synthesize All ({unsynthesizedCount})
                        </Button>
                    )}
                    <Button variant="outline" size="sm" className="h-7 text-[10px] border-border text-muted-foreground" onClick={() => setAddingAgent(prev => !prev)}>
                        <Plus className="w-3 h-3 mr-1" /> Add Agent
                    </Button>
                </div>
            </div>

            {addingAgent && (
                <div className="flex items-end gap-2 p-3 bg-card/80 border border-border rounded-lg mb-2">
                    <div className="flex-1 space-y-1">
                        <label className="text-[10px] text-muted-foreground uppercase font-bold font-mono">Select Agent</label>
                        <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                            <SelectTrigger className="bg-background border-border h-8 text-xs">
                                <SelectValue placeholder="Choose an existing agent..." />
                            </SelectTrigger>
                            <SelectContent>
                                {availableJobs
                                    .filter((j: any) => !pendingMembers.some(m => m.entityId === j.id))
                                    .map((j: any) => (
                                        <SelectItem key={j.id} value={String(j.id)}>
                                            <span className="flex items-center gap-2">
                                                {getJobIcon(j.type)}
                                                {j.name}
                                                <span className="text-muted-foreground text-[10px]">({j.type})</span>
                                            </span>
                                        </SelectItem>
                                    ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="w-[110px] space-y-1">
                        <label className="text-[10px] text-muted-foreground uppercase font-bold font-mono">Role</label>
                        <Input
                            value={addAgentRole}
                            onChange={(e) => setAddAgentRole(e.target.value)}
                            placeholder="member"
                            className="bg-background border-border h-8 text-xs"
                        />
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        className="h-8 px-3 bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold"
                        disabled={!selectedJobId}
                        onClick={() => {
                            const job = availableJobs.find((j: any) => j.id === parseInt(selectedJobId));
                            if (job) {
                                setPendingMembers(prev => [...prev, {
                                    role: addAgentRole || job.name,
                                    entityType: "job",
                                    entityId: job.id,
                                    jobName: job.name,
                                    jobType: job.type,
                                    jobTool: job.tool,
                                    description: job.description,
                                }]);
                                setSelectedJobId("");
                                setAddAgentRole("");
                                setAddingAgent(false);
                            }
                        }}
                    >
                        <Plus className="w-3 h-3 mr-1" /> Add
                    </Button>
                </div>
            )}

            {validationBlockers.length > 0 && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg space-y-2 mb-2">
                    <p className="text-[10px] font-bold text-red-500 uppercase font-mono tracking-wider">Verification Blockers</p>
                    <ul className="text-[11px] text-red-400 space-y-1.5 list-disc list-inside bg-transparent p-0">
                        {validationBlockers.map((blocker, i) => (
                            <li key={i}>{blocker}</li>
                        ))}
                    </ul>
                </div>
            )}

            <ScrollArea className="h-[500px] rounded-md border border-border bg-card/50 p-4">
                <div className="space-y-3">
                    {pendingMembers.map((m, i) => (
                        <div key={i} className="flex items-center justify-between text-xs bg-background/40 p-3 rounded-lg border border-border hover:border-primary/30 transition-colors">
                            <div className="flex items-start gap-4">
                                <div className="mt-1 p-2 bg-card rounded border border-border shadow-inner">
                                    {getJobIcon(m.jobType || "ai_agent")}
                                </div>
                                <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-foreground text-sm tracking-tight">{m.role || "Specialized Agent"}</span>
                                        <Badge variant="outline" className="text-[10px] h-3.5 py-0 border-border text-muted-foreground font-mono">
                                            {m.jobType || "AI"}
                                        </Badge>
                                    </div>
                                    <span className="text-muted-foreground font-mono text-[9px] uppercase opacity-50">{m.jobName || "Waitlisting Synthesis"}</span>
                                    <p className="text-muted-foreground italic leading-tight text-[10px] max-w-[350px] line-clamp-2">{m.description || "Synthesizing capabilities for specific mission requirements..."}</p>
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-3">
                                {m.entityId && availableJobs.some((j: any) => j.id === m.entityId) ? (
                                    <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-mono text-[10px]">
                                        READY
                                    </Badge>
                                ) : (
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="h-7 px-3 text-[10px] bg-primary text-primary-foreground hover:bg-primary/90 font-bold border-b-2 border-bronze-dark"
                                        onClick={() => synthesizeMutation.mutate({ role: m.role, index: i, suggestedConfig: m.suggestedConfig })}
                                        disabled={synthesizeMutation.isPending}
                                    >
                                        {synthesizeMutation.isPending ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                            <><Wand2 className="w-3 h-3 mr-1.5" />SYNTHESIZE</>
                                        )}
                                    </Button>
                                )}
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-red-400" onClick={() => setPendingMembers(prev => prev.filter((_, idx) => idx !== i))}>
                                    <Plus className="w-3 h-3 rotate-45" />
                                </Button>
                            </div>
                        </div>
                    ))}

                    {pendingMembers.length === 0 && (
                        <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed border-border rounded-xl">
                            <User className="w-8 h-8 mb-2 opacity-20" />
                            <p className="text-xs uppercase font-mono font-bold tracking-widest">No agents recruited</p>
                            <p className="text-[10px] mt-1 italic">Define mission or add members manually</p>
                        </div>
                    )}
                </div>
            </ScrollArea>

            {/* Strategy Context Panel - Recruitment Guidance */}
            <div className="mt-4">
                <StrategyContextPanel strategy={executionStrategy} />
            </div>

            {planHistory.length > 0 && (
                <div className="p-3 bg-card/80 border border-border rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Terminal className="w-5 h-5 text-primary" />
                        <div>
                            <p className="text-[10px] uppercase font-bold text-muted-foreground font-mono tracking-tighter">Command Uplink Online</p>
                            <p className="text-xs text-foreground">Strategy refined by Mission Control</p>
                        </div>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentStep(0)}
                        className="h-7 text-[10px] border-border bg-transparent text-muted-foreground hover:text-primary hover:border-primary/50 hover:bg-primary/5"
                    >
                        Refine Plan
                    </Button>
                </div>
            )}

            <div className="flex justify-between pt-4 border-t border-border">
                <Button variant="ghost" onClick={prevStep} className="text-muted-foreground hover:text-foreground uppercase text-[10px] font-bold">
                    Back
                </Button>
                <Button 
                    type="button"
                    onClick={nextStep} 
                    className="bg-primary hover:bg-primary/90 font-bold uppercase text-xs"
                >
                    {validateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Run Pre-flight Check
                </Button>
            </div>
        </div>
    );
}
