
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@domain-ui/core/ui/components/ui/alert";
import { Bot, AlertTriangle, ThumbsUp, ThumbsDown, CheckCircle, Smartphone } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useErrorToast } from "@domain-ui/core/ui/hooks/use-error-toast";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

interface DiagnosisDetailProps {
    diagnosisId: string;
}

export function DiagnosisDetail({ diagnosisId }: DiagnosisDetailProps) {
    const { toast } = useToast();
    const { notify } = useErrorToast();
    const queryClient = useQueryClient();

    const [feedbackGiven, setFeedbackGiven] = useState(false);

    const { data: diagnosis, isLoading } = useQuery({
        queryKey: ['admin', 'diagnosis', diagnosisId],
        queryFn: async () => {
            const res = await fetch(`/api/admin/diagnoses/${diagnosisId}`);
            if (!res.ok) throw new Error('Failed to fetch diagnosis details');
            return res.json();
        }
    });

    const feedbackMutation = useMutation({
        mutationFn: async (helpful: 'yes' | 'no') => {
            await apiRequest('POST', `/api/admin/diagnoses/${diagnosisId}/feedback`, { helpful });
        },
        onSuccess: () => {
            setFeedbackGiven(true);
            toast({ title: "Feedback recorded", description: "Thank you for helping improve the agent." });
        },
        onError: (err) => notify(err)
    });

    const applyFixMutation = useMutation({
        mutationFn: async (recommendationId: string) => {
            const res = await apiRequest('POST', `/api/admin/diagnoses/${diagnosisId}/fix`, { recommendationId });
            return res.json();
        },
        onSuccess: (data) => {
            toast({ title: "Fix Applied", description: data.message || "Pipeline resumed." });
            queryClient.invalidateQueries({ queryKey: ['admin', 'diagnosis', diagnosisId] });
        },
        onError: (err) => notify(err)
    });

    if (isLoading || !diagnosis) {
        return <div className="h-64 flex items-center justify-center">Loading details...</div>;
    }

    const { aiDiagnosis, matchedPatternId, matchedPatternScore, recommendations } = diagnosis;

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-xl font-bold">Incident Report</h2>
                    <p className="text-sm text-muted-foreground font-mono">{diagnosisId}</p>
                </div>
                <Badge variant={diagnosis.httpStatus >= 500 ? "destructive" : "secondary"} className="text-lg">
                    {diagnosis.httpStatus} {diagnosis.errorCode}
                </Badge>
            </div>

            <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Error Message</AlertTitle>
                <AlertDescription className="font-mono text-xs mt-1 whitespace-pre-wrap">
                    {diagnosis.errorMessage}
                </AlertDescription>
            </Alert>

            {/* AI Analysis Section */}
            {aiDiagnosis ? (
                <Card className="border-purple-200 bg-purple-50/50 dark:bg-purple-950/10">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-purple-700 dark:text-purple-300 flex items-center gap-2">
                            <Bot className="w-5 h-5" /> AI Analysis
                            <Badge variant="outline" className="ml-auto border-purple-200">
                                Confidence: {Math.round(aiDiagnosis.confidence * 100)}%
                            </Badge>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <h4 className="font-semibold text-sm text-purple-900 dark:text-purple-100 mb-1">Summary</h4>
                            <p className="text-sm text-purple-800 dark:text-purple-200">{aiDiagnosis.summary}</p>
                        </div>
                        <div>
                            <h4 className="font-semibold text-sm text-purple-900 dark:text-purple-100 mb-1">Explanation</h4>
                            <p className="text-sm text-muted-foreground">{aiDiagnosis.explanation}</p>
                        </div>
                    </CardContent>
                </Card>
            ) : matchedPatternId ? (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <CheckCircle className="w-5 h-5 text-green-600" /> Known Issue Match
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p>Matched Pattern ID: <span className="font-mono">{matchedPatternId}</span></p>
                        <p>Score: {matchedPatternScore}%</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="p-4 border border-dashed rounded-md text-center text-muted-foreground">
                    No automated diagnosis available.
                </div>
            )}

            {/* Recommendations */}
            {recommendations && recommendations.length > 0 && (
                <div className="space-y-3">
                    <h3 className="font-semibold">Recommended Actions</h3>
                    <div className="grid gap-3">
                        {recommendations.map((rec: any, idx: number) => (
                            <Card key={idx} className="border-l-4 border-l-blue-500">
                                <CardContent className="p-4 flex items-center justify-between">
                                    <div>
                                        <h4 className="font-medium">{rec.title}</h4>
                                        <p className="text-sm text-muted-foreground">{rec.description}</p>
                                    </div>
                                    {rec.canAutoApply && diagnosis.stepExecutionId && (
                                        <Button
                                            size="sm"
                                            variant="default"
                                            className="bg-blue-600 hover:bg-blue-700"
                                            disabled={applyFixMutation.isPending || !!diagnosis.appliedFixId}
                                            onClick={() => applyFixMutation.mutate(rec.id)}
                                        >
                                            {applyFixMutation.isPending ? "Applying..." : "Auto-Fix"}
                                        </Button>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            )}

            <Separator />

            {/* Feedback Loop */}
            <div className="flex items-center justify-between text-sm text-muted-foreground bg-muted/30 p-3 rounded-lg">
                <span>Was this diagnosis helpful?</span>
                <div className="flex gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        className={feedbackGiven ? "text-green-600" : ""}
                        onClick={() => feedbackMutation.mutate('yes')}
                        disabled={feedbackGiven}
                    >
                        <ThumbsUp className="w-4 h-4 mr-1" /> Yes
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => feedbackMutation.mutate('no')}
                        disabled={feedbackGiven}
                    >
                        <ThumbsDown className="w-4 h-4 mr-1" /> No
                    </Button>
                </div>
            </div>

            <div className="text-xs text-muted-foreground font-mono pt-4 border-t">
                Job Type: {diagnosis.jobType || 'N/A'} | Execution ID: {diagnosis.stepExecutionId || 'N/A'}
            </div>
        </div>
    );
}

