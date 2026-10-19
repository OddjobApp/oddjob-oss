import React from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Loader2, Sparkles, CheckCircle } from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { UseMutationResult } from "@tanstack/react-query";

interface SuggestionItem {
    id: number;
    jobId: number | null;
    type: string;
    reasoning: string;
    content: string;
    status: string;
}

interface AgentOptimizationPanelProps {
    selectedRunId: string | null;
    suggestions: SuggestionItem[] | undefined;
    suggestionsLoading: boolean;
    optimizeMutation: UseMutationResult<any, any, void, unknown>;
    applyMutation: UseMutationResult<any, any, number, unknown>;
    onApplySuggestion: (suggestionId: number) => void;
}

export default function AgentOptimizationPanel({
    selectedRunId,
    suggestions,
    suggestionsLoading,
    optimizeMutation,
    applyMutation,
    onApplySuggestion
}: AgentOptimizationPanelProps) {
    if (!selectedRunId) {
        return (
            <div className="flex-1 min-h-0 bg-muted/50 p-6 overflow-auto">
                <div className="text-center text-muted-foreground pt-20">Select a run first</div>
            </div>
        );
    }

    return (
        <div className="flex-1 min-h-0 bg-muted/50 p-6 overflow-auto">
            <div className="space-y-6 max-w-3xl mx-auto">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold">Self-Optimization Analysis</h3>
                        <p className="text-sm text-muted-foreground">
                            Analyze execution history to generate improvements.
                        </p>
                    </div>
                    <Button
                        onClick={() => optimizeMutation.mutate()}
                        disabled={optimizeMutation.isPending}
                    >
                        {optimizeMutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Sparkles className="mr-2 h-4 w-4" />
                        )}
                        Run Analysis
                    </Button>
                </div>

                {suggestionsLoading && (
                    <div className="flex justify-center p-8">
                        <Loader2 className="animate-spin" />
                    </div>
                )}

                {suggestions?.length === 0 && !suggestionsLoading && (
                    <Card className="p-8 text-center text-muted-foreground border-dashed">
                        No suggestions found yet. Click "Run Analysis" to start.
                    </Card>
                )}

                {suggestions?.map((item) => (
                    <Card key={item.id} className="border-l-4 border-l-blue-500">
                        <CardHeader className="pb-2">
                            <div className="flex justify-between">
                                <CardTitle className="text-base font-medium flex items-center gap-2">
                                    {item.type === 'tool_suggestion'
                                        ? '🛠️ Tool Usage'
                                        : item.type === 'test_case'
                                            ? '🧪 Test Case'
                                            : '💡 Prompt Improvement'
                                    }
                                </CardTitle>
                                <div className="flex items-center gap-2">
                                    {!item.jobId && item.type === 'prompt_improvement' && (
                                        <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">
                                            Ad-hoc Run
                                        </Badge>
                                    )}
                                    <Badge variant={item.status === 'applied' ? 'default' : 'secondary'}>
                                        {item.status}
                                    </Badge>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-sm text-muted-foreground mb-2 italic">
                                Reasoning: {item.reasoning}
                            </div>
                            <div className="bg-muted p-3 rounded-md font-mono text-xs whitespace-pre-wrap">
                                {item.content}
                            </div>
                            <div className="flex justify-end gap-2 mt-4">
                                <Button variant="outline" size="sm">
                                    Dismiss
                                </Button>
                                <Button
                                    size="sm"
                                    variant="default"
                                    onClick={() => onApplySuggestion(item.id)}
                                    disabled={
                                        applyMutation.isPending ||
                                        item.status === 'applied' ||
                                        (!item.jobId && item.type === 'prompt_improvement')
                                    }
                                    title={!item.jobId && item.type === 'prompt_improvement' ? "Cannot apply prompt changes to ad-hoc runs" : ""}
                                >
                                    {applyMutation.isPending ? (
                                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <CheckCircle className="mr-2 h-3.5 w-3.5" />
                                    )}
                                    {item.status === 'applied'
                                        ? 'Applied'
                                        : (item.type === 'test_case' ? 'Save as Test' : 'Apply Change')
                                    }
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
