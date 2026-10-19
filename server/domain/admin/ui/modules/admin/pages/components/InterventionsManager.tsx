
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Loader2, Trash2 } from "lucide-react";
import { TRIGGERED_ACTION_TYPES } from "@/lib/ui-constants";
import { VECTORS } from './ScoringRuleForm.js';

export function InterventionsManager() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: interventions, isLoading, isError, error } = useQuery({
        queryKey: ["/api/scoring/interventions"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/scoring/interventions");
            return res.json();
        }
    });

    const [newItem, setNewItem] = useState({
        title: "",
        conditionState: "S",
        conditionConfidenceThreshold: 0.7,
        effectType: "popup",
        effectTargetSelector: "",
        userMessageTemplate: "",
        aiPromptTemplate: ""
    });

    const createItem = useMutation({
        mutationFn: async (item: any) => {
            await apiRequest("POST", "/api/scoring/interventions", item);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/scoring/interventions"] });
            toast({ title: "Intervention Created" });
            setNewItem({ ...newItem, title: "" });
        },
        onError: (error) => {
            toast({
                title: "Failed to create intervention",
                description: error instanceof Error ? error.message : "Unknown error",
                variant: "destructive"
            });
        }
    });

    const deleteItem = useMutation({
        mutationFn: async (id: number) => {
            await apiRequest("DELETE", `/api/scoring/interventions/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/scoring/interventions"] });
        },
    });

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Create Intervention Trigger</CardTitle>
                    <CardDescription>Define what happens when a cognitive state stabilizes.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Rule Title</Label>
                            <Input
                                value={newItem.title}
                                onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
                                placeholder="e.g. Frustrated on Job Config"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Trigger State</Label>
                            <Select value={newItem.conditionState} onValueChange={(v) => setNewItem({ ...newItem, conditionState: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {VECTORS.map(v => (
                                        <SelectItem key={v.id} value={v.id}>{v.id} - {v.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Confidence Threshold</Label>
                            <Input
                                type="number" step="0.05" max="1.0"
                                value={newItem.conditionConfidenceThreshold}
                                onChange={(e) => setNewItem({ ...newItem, conditionConfidenceThreshold: parseFloat(e.target.value) })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Visual Effect</Label>
                            <Select value={newItem.effectType} onValueChange={(v) => setNewItem({ ...newItem, effectType: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {TRIGGERED_ACTION_TYPES.ui.map(a => (
                                        <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {newItem.effectType !== 'popup' && newItem.effectType !== 'toast' && (
                        <div className="space-y-2">
                            <Label>Target CSS Selector</Label>
                            <Input
                                value={newItem.effectTargetSelector}
                                onChange={(e) => setNewItem({ ...newItem, effectTargetSelector: e.target.value })}
                                placeholder="#save-button or .job-card-header"
                            />
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label>User Message Template</Label>
                        <Input
                            value={newItem.userMessageTemplate}
                            onChange={(e) => setNewItem({ ...newItem, userMessageTemplate: e.target.value })}
                            placeholder="Hey, looks like you're stuck on {element}..."
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>AI System Prompt</Label>
                        <Textarea
                            value={newItem.aiPromptTemplate}
                            onChange={(e) => setNewItem({ ...newItem, aiPromptTemplate: e.target.value })}
                            placeholder="User is confused about..."
                        />
                    </div>

                    <Button onClick={() => createItem.mutate(newItem)} disabled={!newItem.title || createItem.isPending}>
                        Create Intervention
                    </Button>
                </CardContent>
            </Card>

            <div className="grid gap-4">
                {isLoading ? (
                    <Loader2 className="animate-spin mx-auto" />
                ) : isError ? (
                    <div className="p-4 text-center text-destructive border border-destructive rounded-md bg-destructive/10">
                        Failed to load interventions: {error instanceof Error ? error.message : "Unknown error"}
                    </div>
                ) : interventions?.map((iv: any) => (
                    <Card key={iv.id}>
                        <CardHeader className="pb-2">
                            <div className="flex justify-between items-start">
                                <div className="space-y-1">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        {iv.title}
                                        <Badge variant="outline">
                                            {iv.conditionState} &gt; {iv.conditionConfidenceThreshold}
                                        </Badge>
                                    </CardTitle>
                                    <CardDescription>Effect: {iv.effectType}</CardDescription>
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => deleteItem.mutate(iv.id)}>
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </div>
                        </CardHeader>
                    </Card>
                ))}
            </div>
        </div>
    );
}

