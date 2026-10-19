import { useMemo, useState } from "react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Checkbox } from "@domain-ui/core/ui/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@domain-ui/core/ui/components/ui/form";
import { Coins, Loader2, Target, Zap } from "lucide-react";
import { UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { formSchema } from '../types/index.js';
import { cn } from "@/lib/utils";
import type { MissionReadinessResponse } from "@shared/mission-readiness";
import { MissionReadinessLab } from "./MissionReadinessLab";

interface LaunchStepProps {
    form: UseFormReturn<z.infer<typeof formSchema>>;
    handleFormSubmit: (values: z.infer<typeof formSchema>) => void;
    pendingMembers: any[];
    getJobIcon: (type: string) => React.ReactNode;
    prevStep: () => void;
    createMutation: any;
    knowledgeAssetCount: number;
    documentTemplateCount: number;
}

export function LaunchStep({
    form,
    handleFormSubmit,
    pendingMembers,
    getJobIcon,
    prevStep,
    createMutation,
    knowledgeAssetCount,
    documentTemplateCount,
}: LaunchStepProps) {
    const [serverReadiness, setServerReadiness] = useState<MissionReadinessResponse | null>(null);
    const values = form.watch();
    const readinessRequest = useMemo(() => ({
        name: values.name || "",
        objective: values.objective || "",
        budgetLimitUsd: Number(values.budgetLimitUsd || 0),
        executionStrategy: values.executionStrategy,
        hilStrictness: values.hilStrictness,
        members: pendingMembers.map((member) => ({
            entityType: member.entityType || "job",
            entityId: member.entityId,
            role: member.role || "member",
        })),
        knowledgeAssetCount,
        documentTemplateCount,
        targetMetric: values.targetMetric,
    }), [values, pendingMembers, knowledgeAssetCount, documentTemplateCount]);
    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="font-mono text-[10px] uppercase text-muted-foreground">Mission Identity</FormLabel>
                                <FormControl>
                                    <Input {...field} className="bg-card border-border" readOnly />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="budgetLimitUsd"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="font-mono text-[10px] uppercase text-muted-foreground">Max Budget Approval</FormLabel>
                                <FormControl>
                                    <div className="relative">
                                        <Coins className="absolute left-2 top-2.5 h-4 w-4 text-primary" />
                                        <Input type="number" step="0.01" {...field} className="pl-8 bg-card border-border focus:ring-primary" />
                                    </div>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <MissionReadinessLab request={readinessRequest} onReadinessChange={setServerReadiness} />

                <div className="p-4 rounded-xl bg-background border border-border">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="text-[10px] font-bold text-muted-foreground uppercase font-mono tracking-widest">Protocol & Strategy</h4>
                        <div className="flex gap-2">
                             <Badge variant="outline" className="border-primary/30 text-primary uppercase text-[9px]">
                                {form.watch("executionStrategy").replace(/_/g, ' ')}
                             </Badge>
                             <Badge variant="outline" className={cn(
                                "uppercase text-[9px]",
                                form.watch("reasoningProtocol") === "hermes_xml" 
                                    ? "border-amber-500/30 text-amber-500" 
                                    : "border-border text-muted-foreground"
                             )}>
                                {form.watch("reasoningProtocol").replace(/_/g, ' ')}
                             </Badge>
                        </div>
                    </div>
                </div>

                <div className="p-4 rounded-xl bg-background border border-border">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="text-[10px] font-bold text-muted-foreground uppercase font-mono tracking-widest">Team Summary</h4>
                        <Badge variant="outline" className="border-primary/30 text-primary">{pendingMembers.length} Agents</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {pendingMembers.map((m, i) => (
                            <div key={i} className="px-3 py-1.5 rounded-full bg-card border border-border text-[10px] flex items-center gap-2">
                                {getJobIcon(m.jobType || "ai_agent")}
                                <span className="font-bold">{m.role}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* --- NEW: Optimization Goal Summary --- */}
                <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 space-y-3">
                    <div className="flex items-center gap-2">
                        <Target className="w-4 h-4 text-primary" />
                        <h4 className="text-[10px] font-bold text-primary uppercase font-mono tracking-widest">Performance Objective</h4>
                        <Badge variant="outline" className="ml-auto text-[8px] border-primary/30 text-primary opacity-70">AUTORESEARCH P1</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Zap className="w-3 h-3 text-muted-foreground" />
                            <span className="text-[11px] font-mono text-muted-foreground uppercase">Target ({form.watch("targetMetric.type")?.replace(/_/g, ' ')})</span>
                        </div>
                        <span className="text-xs font-black font-mono text-primary">
                            {form.watch("targetMetric.target")}
                            {form.watch("targetMetric.type")?.includes('latency') ? 's/ms' : ''}
                            {form.watch("targetMetric.type") === 'cost_usd' ? ' USD' : ''}
                        </span>
                    </div>
                </div>

                <FormField
                    control={form.control}
                    name="saveAsTemplate"
                    render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-xl border border-border bg-card/40 p-4">
                            <FormControl>
                                <Checkbox
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                    className="border-border data-[state=checked]:bg-primary"
                                />
                            </FormControl>
                            <div className="space-y-1">
                                <FormLabel className="text-xs font-bold text-foreground uppercase font-mono">
                                    Archive as Template
                                </FormLabel>
                                <p className="text-[10px] text-muted-foreground">
                                    Save this team configuration for future one-click deployment.
                                </p>
                            </div>
                        </FormItem>
                    )}
                />

                <div className="flex justify-between pt-4 border-t border-border">
                    <Button variant="ghost" onClick={prevStep} className="text-muted-foreground hover:text-foreground uppercase text-[10px] font-bold">
                        Back to Check
                    </Button>
                    <Button type="submit" className="bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)] font-black uppercase text-xs px-6" disabled={createMutation.isPending || !serverReadiness?.ready}>
                        {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        {serverReadiness?.ready ? "Initialize Mission" : "Run Preflight to Continue"}
                    </Button>
                </div>
            </form>
        </Form>
    );
}
