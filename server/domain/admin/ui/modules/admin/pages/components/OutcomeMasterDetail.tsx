
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import {
    Loader2, Plus, Trash2, Edit, Activity, ChevronRight,
    Sparkles, AlertCircle, RefreshCw, CheckCircle2
} from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { ScoreThresholdForm } from './ScoreThresholdForm.js';
import { ScoringRuleForm } from './ScoringRuleForm.js';
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@domain-ui/core/ui/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@domain-ui/core/ui/components/ui/accordion";

interface OutcomeMasterDetailProps {
    vector: string;
    vectorLabel: string;
    vectorDescription: string;
}

export function OutcomeMasterDetail({ vector, vectorLabel, vectorDescription }: OutcomeMasterDetailProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Selection State
    const [selectedThresholdId, setSelectedThresholdId] = useState<number | null>(null);
    const [isCreatingOutcome, setIsCreatingOutcome] = useState(false);
    const [isCreatingRule, setIsCreatingRule] = useState(false);

    // Fetch Data
    const { data: rules } = useQuery<any[]>({
        queryKey: ["/api/scoring/rules"],
        queryFn: async () => (await apiRequest("GET", "/api/scoring/rules")).json()
    });

    const { data: thresholds, isLoading } = useQuery<any[]>({
        queryKey: ["/api/scoring/thresholds"],
        queryFn: async () => (await apiRequest("GET", "/api/scoring/thresholds")).json()
    });

    // Filtering
    const vectorThresholds = thresholds?.filter(t => t.vector === vector) || [];
    const vectorRules = rules?.filter(r => r.vector === vector) || []; // All rules for this vector

    // Helper: Get rules for current context
    // Ideally, rules are linked to a threshold logic, but currently they are just linked by Vector.
    // So "Contributing Rules" for an Outcome (Threshold) are effectively ALL rules of that vector.
    // In a future schema, we might link rules->threshold explicitly, but for now, they share the Vector.

    const selectedThreshold = vectorThresholds.find(t => t.id === selectedThresholdId);

    // AI Description State
    const [aiDescription, setAiDescription] = useState<string | null>(null);
    const [isGeneratingAi, setIsGeneratingAi] = useState(false);

    // Mutations
    const generateDescription = async () => {
        if (!selectedThreshold) return;
        setIsGeneratingAi(true);
        try {
            const res = await apiRequest("POST", "/api/scoring/generate-description", {
                threshold: selectedThreshold,
                rules: vectorRules
            });
            const data = await res.json();
            setAiDescription(data.description);
        } catch (e) {
            toast({ title: "Failed to generate description", variant: "destructive" });
        } finally {
            setIsGeneratingAi(false);
        }
    };

    const deleteThreshold = useMutation({
        mutationFn: async (id: number) => await apiRequest("DELETE", `/api/scoring/thresholds/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/scoring/thresholds"] });
            if (selectedThresholdId === selectedThreshold?.id) setSelectedThresholdId(null);
            toast({ title: "Outcome Deleted" });
        }
    });

    const createThreshold = useMutation({
        mutationFn: async (data: any) => await apiRequest("POST", "/api/scoring/thresholds", data),
        onSuccess: (data: any) => { // Type as any for quick fix
            queryClient.invalidateQueries({ queryKey: ["/api/scoring/thresholds"] });
            setIsCreatingOutcome(false);
            setSelectedThresholdId(data.id); // Select the new item
            toast({ title: "Outcome Created" });
        },
        onError: (error) => {
            toast({
                title: "Failed to create outcome",
                description: error instanceof Error ? error.message : "An error occurred while saving.",
                variant: "destructive"
            });
        }
    });

    const updateThreshold = useMutation({
        mutationFn: async (data: any) => {
            const { id, ...rest } = data;
            await apiRequest("PUT", `/api/scoring/thresholds/${id}`, rest);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/scoring/thresholds"] });
            toast({ title: "Outcome Updated" });
        },
        onError: (error) => {
            toast({
                title: "Failed to update outcome",
                description: error instanceof Error ? error.message : "An error occurred while saving.",
                variant: "destructive"
            });
        }
    });

    const deleteRule = useMutation({
        mutationFn: async (id: number) => await apiRequest("DELETE", `/api/scoring/rules/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/scoring/rules"] });
            toast({ title: "Rule Deleted" });
        }
    });

    // Add create/update rule mutations here as needed by ScoringRuleForm
    const createRule = useMutation({
        mutationFn: async (data: any) => await apiRequest("POST", "/api/scoring/rules", data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/scoring/rules"] });
            setIsCreatingRule(false);
            toast({ title: "Rule Created" });
        }
    });

    const updateRule = useMutation({
        mutationFn: async (data: any) => {
            const { id, ...rest } = data;
            await apiRequest("PUT", `/api/scoring/rules/${id}`, rest);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/scoring/rules"] });
            toast({ title: "Rule Updated" });
        }
    });

    if (isLoading) return <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto" /></div>;

    return (
        <div className="grid grid-cols-12 gap-6 h-[calc(100vh-200px)] min-h-[600px]">
            {/* LEFT PANEL: LIST */}
            <div className="col-span-4 border rounded-lg bg-card flex flex-col overflow-hidden">
                <div className="p-4 border-b bg-muted/30 flex justify-between items-center">
                    <div>
                        <h3 className="font-semibold text-lg">Outcomes</h3>
                        <p className="text-xs text-muted-foreground">{vectorRules.length} Signals Monitoring</p>
                    </div>
                    <Button size="sm" onClick={() => { setSelectedThresholdId(null); setIsCreatingOutcome(true); }}>
                        <Plus className="h-4 w-4" />
                    </Button>
                </div>

                <ScrollArea className="flex-1">
                    <div className="p-2 space-y-2">
                        {isCreatingOutcome && (
                            <Card className={cn("border-primary bg-primary/5")}>
                                <CardHeader className="p-3">
                                    <span className="text-sm font-semibold text-primary">New Outcome</span>
                                </CardHeader>
                            </Card>
                        )}
                        {vectorThresholds.length === 0 && !isCreatingOutcome ? (
                            <div className="p-8 text-center text-muted-foreground">
                                <p>No outcomes defined.</p>
                                <Button variant="link" onClick={() => setIsCreatingOutcome(true)}>Create First Outcome</Button>
                            </div>
                        ) : (
                            vectorThresholds.map(t => (
                                <div
                                    key={t.id}
                                    onClick={() => { setSelectedThresholdId(t.id); setIsCreatingOutcome(false); }}
                                    className={cn(
                                        "p-3 rounded-md border cursor-pointer transition-all hover:bg-muted/50 flex flex-col gap-1",
                                        selectedThresholdId === t.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-card"
                                    )}
                                >
                                    <div className="flex justify-between items-start">
                                        <span className="font-medium truncate">{t.name}</span>
                                        <Badge variant="outline" className="text-[10px] h-5">
                                            {t.operator} {t.thresholdValue}
                                        </Badge>
                                    </div>
                                    <div className="flex items-center text-xs text-muted-foreground gap-2">
                                        <Activity className="h-3 w-3" />
                                        {t.triggeredAction?.type || "No Action"}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>
            </div>

            {/* RIGHT PANEL: DETAIL */}
            <div className="col-span-8 flex flex-col gap-6 overflow-hidden">
                {!selectedThresholdId && !isCreatingOutcome ? (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground bg-muted/10 border rounded-lg border-dashed">
                        <Activity className="h-12 w-12 mb-4 opacity-20" />
                        <h3 className="text-lg font-semibold">Select an Outcome</h3>
                        <p>Choose an outcome from the list to view details and contributing rules.</p>
                    </div>
                ) : (
                    <ScrollArea className="h-full pr-4">
                        <div className="space-y-6 pb-12">
                            {/* 1. OUTCOME EDITOR */}
                            <Card className={cn(isCreatingOutcome && "border-primary border-2")}>
                                <CardHeader>
                                    <CardTitle>{isCreatingOutcome ? "Define New Outcome" : "Outcome Configuration"}</CardTitle>
                                    <CardDescription>
                                        When accumulated <b>{vectorLabel}</b> score meets this threshold, the intervention fires.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {(selectedThreshold || isCreatingOutcome) && (
                                        <ScoreThresholdForm
                                            initialData={selectedThreshold}
                                            defaultVector={vector}
                                            onSave={(data) => {
                                                if (isCreatingOutcome) createThreshold.mutate(data);
                                                else if (selectedThreshold) updateThreshold.mutate({ ...data, id: selectedThreshold.id });
                                            }}
                                            onCancel={isCreatingOutcome ? () => setIsCreatingOutcome(false) : undefined}
                                            isSubmitting={createThreshold.isPending || updateThreshold.isPending}
                                        />
                                    )}
                                </CardContent>
                            </Card>

                            {!isCreatingOutcome && selectedThreshold && (
                                <>
                                    {/* 2. AI DESCRIPTION CARD */}
                                    <Card className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-slate-900 dark:to-slate-900 border-purple-200 dark:border-purple-900/50">
                                        <CardHeader className="pb-2">
                                            <div className="flex justify-between items-center">
                                                <CardTitle className="text-base flex items-center gap-2 text-purple-700 dark:text-purple-400">
                                                    <Sparkles className="h-4 w-4" />
                                                    System Agent Explanation
                                                </CardTitle>
                                                <Button size="sm" variant="ghost" onClick={generateDescription} disabled={isGeneratingAi} className="h-8">
                                                    {isGeneratingAi ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <RefreshCw className="h-3 w-3 mr-2" />}
                                                    {aiDescription ? "Regenerate" : "Generate Description"}
                                                </Button>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            {aiDescription ? (
                                                <p className="text-sm leading-relaxed text-foreground/80 dark:text-foreground/70">
                                                    {aiDescription}
                                                </p>
                                            ) : (
                                                <div className="text-xs text-muted-foreground italic flex items-center gap-2">
                                                    <AlertCircle className="h-3 w-3" />
                                                    Click generate to get a non-technical summary of this configuration.
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>

                                    {/* 3. CONTRIBUTING RULES (INLINE LIST) */}
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-semibold text-lg">Contributing Signals</h3>
                                            <Button size="sm" variant="outline" onClick={() => setIsCreatingRule(true)} disabled={isCreatingRule}>
                                                <Plus className="h-3.5 w-3.5 mr-2" />
                                                Add Signal
                                            </Button>
                                        </div>

                                        {isCreatingRule && (
                                            <Card className="border-l-4 border-l-green-500 animate-in fade-in slide-in-from-top-4">
                                                <CardHeader className="pb-2">
                                                    <CardTitle className="text-base">New Signal Rule</CardTitle>
                                                </CardHeader>
                                                <CardContent>
                                                    <ScoringRuleForm
                                                        defaultVector={vector}
                                                        onSave={(data) => createRule.mutate(data)}
                                                        onCancel={() => setIsCreatingRule(false)}
                                                        isSubmitting={createRule.isPending}
                                                    />
                                                </CardContent>
                                            </Card>
                                        )}

                                        <Accordion type="single" collapsible className="w-full space-y-2">
                                            {vectorRules.map((rule) => (
                                                <AccordionItem key={rule.id} value={`rule-${rule.id}`} className="border rounded-md px-4 bg-card">
                                                    <AccordionTrigger className="hover:no-underline py-3">
                                                        <div className="flex items-center gap-4 w-full text-left">
                                                            <div className="flex-1">
                                                                <div className="font-medium text-sm flex items-center gap-2">
                                                                    {rule.name}
                                                                    {!rule.enabled && <Badge variant="secondary" className="text-[10px] h-4">Disabled</Badge>}
                                                                </div>
                                                                <div className="text-xs text-muted-foreground mt-0.5">
                                                                    {rule.activity} ({rule.page || "Global"})
                                                                </div>
                                                            </div>
                                                            <Badge variant="outline" className="mr-2">+{rule.weight}</Badge>
                                                        </div>
                                                    </AccordionTrigger>
                                                    <AccordionContent className="pt-2 pb-4 border-t mt-2">
                                                        <ScoringRuleForm
                                                            initialData={rule}
                                                            defaultVector={vector}
                                                            onSave={(data) => updateRule.mutate({ ...data, id: rule.id })}
                                                            // We don't need cancel here as accordions just close, but could add Delete
                                                            isSubmitting={updateRule.isPending}
                                                        />
                                                        <div className="mt-4 pt-4 border-t flex justify-end">
                                                            <Button
                                                                variant="destructive"
                                                                size="sm"
                                                                onClick={() => {
                                                                    if (confirm("Delete this rule?")) deleteRule.mutate(rule.id);
                                                                }}
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                                                Delete Rule
                                                            </Button>
                                                        </div>
                                                    </AccordionContent>
                                                </AccordionItem>
                                            ))}
                                        </Accordion>

                                        {vectorRules.length === 0 && !isCreatingRule && (
                                            <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                                                No signals defined for {vectorLabel}.
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </ScrollArea>
                )}
            </div>
        </div>
    );
}

