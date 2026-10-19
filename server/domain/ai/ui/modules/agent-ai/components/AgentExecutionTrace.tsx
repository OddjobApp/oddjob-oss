import React from "react";
import { format } from "date-fns";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Loader2, Terminal, Edit3, Check, X, Save } from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { useState } from "react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface AgentRunStep {
    id: number;
    type: string;
    toolName: string | null;
    toolArgs: any;
    content: string;
    createdAt: string;
    confidence?: number | null; // 0-100 (AI_AGENT_ENHANCEMENTS_SPEC)
}

interface AgentExecutionTraceProps {
    selectedRunId: string | null;
    steps: AgentRunStep[] | undefined;
    stepsLoading: boolean;
}

export default function AgentExecutionTrace({ selectedRunId, steps, stepsLoading }: AgentExecutionTraceProps) {
    const [editingStepId, setEditingStepId] = useState<number | null>(null);
    const [editedContent, setEditedContent] = useState<string>("");
    const [correctionReason, setCorrectionReason] = useState<string>("");
    const { toast } = useToast();

    const handleEditStep = (step: AgentRunStep) => {
        setEditingStepId(step.id);
        setEditedContent(step.content);
        setCorrectionReason("");
    };

    const handleSaveCorrection = async () => {
        if (!editingStepId || !correctionReason.trim()) {
            toast({
                title: "Correction Required",
                description: "Please provide a reason for the correction.",
                variant: "destructive",
            });
            return;
        }

        try {
            await apiRequest("POST", `/api/agent/memory/correct-response`, {
                stepId: editingStepId,
                originalContent: steps?.find(s => s.id === editingStepId)?.content,
                correctedContent: editedContent,
                correctionReason: correctionReason,
                runId: selectedRunId
            });

            toast({
                title: "Correction Saved",
                description: "The agent response has been corrected and will be used for future learning.",
            });

            setEditingStepId(null);
            setEditedContent("");
            setCorrectionReason("");
        } catch (error: any) {
            toast({
                title: "Save Failed",
                description: error.message || "Failed to save correction",
                variant: "destructive",
            });
        }
    };

    const handleCancelEdit = () => {
        setEditingStepId(null);
        setEditedContent("");
        setCorrectionReason("");
    };

    const getStepColor = (type: string) => {
        switch (type) {
            case "thought": return "bg-blue-50/50 border-blue-200 text-blue-800 dark:bg-blue-900/10 dark:text-blue-300 dark:border-blue-800";
            case "action": return "bg-purple-50/50 border-purple-200 text-purple-800 dark:bg-purple-900/10 dark:text-purple-300 dark:border-purple-800";
            case "observation": return "bg-green-50/50 border-green-200 text-green-800 dark:bg-green-900/10 dark:text-green-300 dark:border-green-800";
            case "user": return "bg-gray-100 border-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700";
            case "system": return "bg-yellow-50/50 border-yellow-200 text-yellow-800 dark:bg-yellow-900/10 dark:text-yellow-300 dark:border-yellow-800";
            default: return "bg-muted border-border";
        }
    };

    return (
        <Card className="col-span-8 flex flex-col h-full overflow-hidden">
            <CardHeader className="py-4 px-6 border-b bg-card z-10">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Terminal className="h-5 w-5 text-primary" />
                            Execution Trace
                        </CardTitle>
                    </div>
                    {selectedRunId && (
                        <div className="text-xs text-muted-foreground font-mono">
                            ID: {selectedRunId}
                        </div>
                    )}
                </div>
            </CardHeader>

            <div className="flex-1 min-h-0 bg-slate-50/50 dark:bg-slate-950/50 overflow-hidden relative">
                {!selectedRunId ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Terminal className="h-12 w-12 mb-4 opacity-20" />
                        <p>Select a run to view detailed steps</p>
                    </div>
                ) : stepsLoading ? (
                    <div className="flex justify-center p-12">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                ) : (
                    <ScrollArea className="h-full p-6">
                        <div className="space-y-6 pb-12">
                            {steps?.map((step, idx) => (
                                <div
                                    key={idx}
                                    className={`relative pl-4 border-l-2 ${
                                        step.type === 'observation'
                                            ? 'border-green-300 dark:border-green-800'
                                            : step.type === 'action'
                                            ? 'border-purple-300 dark:border-purple-800'
                                            : step.type === 'thought'
                                            ? 'border-blue-300 dark:border-blue-800'
                                            : 'border-gray-200 dark:border-gray-700'
                                    }`}
                                >
                                    {/* Time & Type Badge */}
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <Badge
                                                variant="outline"
                                                className={`capitalize font-semibold text-xs border ${getStepColor(step.type)}`}
                                            >
                                                {step.type} {step.toolName && `• ${step.toolName}`}
                                            </Badge>
                                            {step.confidence != null && (
                                                <Badge
                                                    variant="secondary"
                                                    className={`text-[10px] h-5 ${
                                                        step.confidence >= 80 ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" :
                                                        step.confidence >= 50 ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" :
                                                        "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                                                    }`}
                                                    title="Confidence score"
                                                >
                                                    {step.confidence}%
                                                </Badge>
                                            )}
                                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                                                {format(new Date(step.createdAt), "HH:mm:ss.SSS")}
                                            </span>
                                        </div>

                                        {/* Edit button for agent responses */}
                                        {(step.type === 'thought' || step.type === 'action' || step.type === 'observation') && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleEditStep(step)}
                                                disabled={editingStepId !== null}
                                                className="h-6 w-6 p-0"
                                            >
                                                <Edit3 className="h-3 w-3" />
                                            </Button>
                                        )}
                                    </div>

                                    {/* Content */}
                                    {editingStepId === step.id ? (
                                        <div className="space-y-3">
                                            <div className="bg-white dark:bg-card border rounded-md p-3 shadow-sm">
                                                <div className="text-xs font-medium text-muted-foreground mb-2">Corrected Response:</div>
                                                <Textarea
                                                    value={editedContent}
                                                    onChange={(e) => setEditedContent(e.target.value)}
                                                    className="font-mono text-xs min-h-[100px]"
                                                    placeholder="Enter the corrected agent response..."
                                                />
                                            </div>

                                            <div className="bg-white dark:bg-card border rounded-md p-3 shadow-sm">
                                                <div className="text-xs font-medium text-muted-foreground mb-2">Reason for Correction:</div>
                                                <Textarea
                                                    value={correctionReason}
                                                    onChange={(e) => setCorrectionReason(e.target.value)}
                                                    className="text-xs min-h-[60px]"
                                                    placeholder="Explain why this correction is needed and what the agent should learn..."
                                                />
                                            </div>

                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleCancelEdit}
                                                >
                                                    <X className="h-3 w-3 mr-1" />
                                                    Cancel
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    onClick={handleSaveCorrection}
                                                >
                                                    <Save className="h-3 w-3 mr-1" />
                                                    Save Correction
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-sm bg-white dark:bg-card border rounded-md p-3 shadow-sm whitespace-pre-wrap font-mono text-xs overflow-x-auto">
                                            {step.toolArgs ? (
                                                <>
                                                    <div className="font-semibold text-purple-600 mb-1">In:</div>
                                                    <pre className="mb-2 text-muted-foreground">
                                                        {JSON.stringify(step.toolArgs, null, 2)}
                                                    </pre>
                                                </>
                                            ) : null}

                                            {step.content}

                                            {/* Try to pretty print JSON content if it looks like JSON */}
                                            {step.content.startsWith('{') && step.content.endsWith('}') && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-5 text-[10px] mt-2"
                                                    onClick={(e: any) => {
                                                        try {
                                                            const pretty = JSON.stringify(JSON.parse(step.content), null, 2);
                                                            e.target.parentElement.innerText = pretty;
                                                        } catch (e) { }
                                                    }}
                                                >
                                                    Format JSON
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                )}
            </div>
        </Card>
    );
}

