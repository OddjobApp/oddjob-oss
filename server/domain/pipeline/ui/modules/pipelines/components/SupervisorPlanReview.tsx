import React, { useState } from 'react';
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Check, Edit, Play, Zap } from "lucide-react";
import type { SupervisorPlan } from "@shared/schema/supervisor";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";

interface Props {
    plan: SupervisorPlan;
    executionId: number;
    stepExecutionId: number;
    onVanish?: () => void;
}

export function SupervisorPlanReview({ plan, executionId, stepExecutionId, onVanish }: Props) {
    const [tasks, setTasks] = useState(plan.tasks);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { toast } = useToast();

    const handleApprove = async () => {
        setIsSubmitting(true);
        try {
            await apiRequest("POST", `/api/pipeline-executions/${executionId}/resume-step`, {
                stepExecutionId,
                responses: {
                    approved: true,
                    plan: { ...plan, tasks }
                }
            });
            toast({ title: "Plan Approved", description: "Supervisor execution resumed." });
            if (onVanish) onVanish();
        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="mt-4 space-y-4">
            <div className="grid gap-3 max-h-[600px] overflow-y-auto pr-1">
                {tasks.map((task, idx) => (
                    <div key={task.id} className="group relative flex items-start gap-3 p-4 bg-foreground/40 backdrop-blur-sm border border-blue-100/50 rounded-xl hover:border-blue-200 hover:bg-foreground/60 transition-all duration-200">
                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[10px] font-bold ring-4 ring-blue-50/50">
                            {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-1">
                                <h4 className="font-semibold text-sm text-foreground truncate">{task.name}</h4>
                                <div className="flex items-center gap-2">
                                    {(task as any).estimatedCostUSD !== undefined && (
                                        <span className="text-[10px] text-blue-600 font-mono">
                                            ${(task as any).estimatedCostUSD.toFixed(4)}
                                        </span>
                                    )}
                                    {task.assignedAgent && (
                                        <Badge variant="secondary" className="bg-muted text-[9px] uppercase tracking-wider h-4 px-1">
                                            {task.assignedAgent}
                                        </Badge>
                                    )}
                                </div>
                            </div>
                            <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">{task.description}</p>

                            {task.dependencies && task.dependencies.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                    <span className="text-[9px] text-muted-foreground font-medium uppercase mr-1">Depends on:</span>
                                    {task.dependencies.map(depId => (
                                        <span key={depId} className="text-[9px] font-mono bg-amber-50 text-amber-600 px-1 rounded">
                                            #{tasks.findIndex(t => t.id === depId) + 1}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex items-center justify-between gap-4 pt-4 border-t border-blue-100/30">
                <div className="flex flex-col gap-0.5">
                    <div className="text-[10px] text-blue-600/70 italic flex items-center gap-1.5">
                        <Zap className="w-3 h-3" />
                        Autonomous orchestrator ready
                    </div>
                    {(plan as any).estimatedCostUSD !== undefined && (
                        <div className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">
                            Estimated Cost: <span className="text-blue-600">${(plan as any).estimatedCostUSD.toFixed(4)}</span>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-8 text-xs border-blue-100 hover:bg-blue-50" disabled={isSubmitting}>
                        <Edit className="w-3.5 h-3.5 mr-1.5" /> Edit
                    </Button>
                    <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-200" onClick={handleApprove} disabled={isSubmitting}>
                        <Play className="w-3.5 h-3.5 mr-1.5 fill-current" /> Approve
                    </Button>
                </div>
            </div>
        </div>
    );
}

