import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2, Lightbulb, ChevronDown, ChevronRight, Play, Copy, ThumbsUp, ThumbsDown, XCircle, History, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@domain-ui/core/ui/components/ui/collapsible';
import { Progress } from '@domain-ui/core/ui/components/ui/progress';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';

interface DiagnosisResult {
    diagnosisId: string;
    bestMatch?: {
        pattern: {
            id: string;
            name: string;
            category: string;
            diagnosis: {
                summary: string;
                explanation: string;
                rootCause?: string;
            };
        };
        score: number;
    };
    aiDiagnosis?: {
        summary: string;
        explanation: string;
        suggestedFixes: string[];
        confidence: number;
    };
    recommendations: Array<{
        id: string;
        type: 'fix' | 'retry' | 'manual' | 'escalate';
        priority: number;
        title: string;
        description: string;
        canAutoApply: boolean;
        confidence: number;
    }>;
}

interface DiagnosisPanelProps {
    stepExecutionId?: number;
    error?: string | any;
    httpStatus?: number;
    requestUrl?: string;
    jobType?: string;
    jobConfig?: any;
    onApplyFix?: (fixId: string, action: any) => void;
    compact?: boolean;
}

export function DiagnosisPanel({
    stepExecutionId,
    error,
    httpStatus,
    requestUrl,
    jobType,
    jobConfig,
    onApplyFix,
    compact = false,
}: DiagnosisPanelProps) {
    const [isExpanded, setIsExpanded] = useState(!compact);
    const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [feedbackGiven, setFeedbackGiven] = useState<'yes' | 'no' | 'wrong' | null>(null);
    const [applyingFix, setApplyingFix] = useState<string | null>(null);
    const { toast } = useToast();

    // Auto-fetch diagnosis on mount
    useEffect(() => {
        if (error || httpStatus) {
            fetchDiagnosis();
        }
    }, [error, httpStatus]);

    const fetchDiagnosis = async () => {
        setIsLoading(true);
        try {
            const errorStr = typeof error === 'object'
                ? JSON.stringify(error)
                : String(error || '');

            const result = await apiRequest('POST', '/api/diagnosis/analyze', {
                error: errorStr,
                httpStatus,
                requestUrl,
                jobType,
                stepExecutionId,
                includeAI: true,
            }) as unknown as DiagnosisResult;

            setDiagnosis(result);
        } catch (err: any) {
            console.error('Failed to fetch diagnosis:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleApplyFix = async (recommendation: DiagnosisResult['recommendations'][0]) => {
        if (!onApplyFix) return;

        setApplyingFix(recommendation.id);
        try {
            // Notify parent to apply the fix
            onApplyFix(recommendation.id, recommendation);
            toast({
                title: 'Fix Applied',
                description: recommendation.title,
            });
        } catch (err: any) {
            toast({
                title: 'Failed to apply fix',
                description: err.message,
                variant: 'destructive',
            });
        } finally {
            setApplyingFix(null);
        }
    };

    const handleFeedback = async (feedback: 'yes' | 'no' | 'wrong') => {
        setFeedbackGiven(feedback);
        if (diagnosis) {
            try {
                await apiRequest('POST', `/api/diagnosis/${diagnosis.diagnosisId}/feedback`, {
                    helpful: feedback,
                });
                toast({
                    title: 'Thanks for your feedback!',
                    description: feedback === 'yes' ? 'This helps improve future diagnoses.' : 'We\'ll work on improving this.',
                });
            } catch (err) {
                // Non-critical, don't show error
            }
        }
    };

    const getCategoryColor = (category: string): string => {
        switch (category) {
            case 'auth':
                return 'bg-red-100 text-red-700 border-red-200';
            case 'rate_limit':
                return 'bg-orange-100 text-orange-700 border-orange-200';
            case 'deprecated':
                return 'bg-purple-100 text-purple-700 border-purple-200';
            case 'not_found':
                return 'bg-yellow-100 text-yellow-700 border-yellow-200';
            case 'server_error':
                return 'bg-muted text-foreground border-border';
            case 'network':
                return 'bg-blue-100 text-blue-700 border-blue-200';
            default:
                return 'bg-amber-100 text-amber-700 border-amber-200';
        }
    };

    const getConfidenceColor = (confidence: number): string => {
        if (confidence >= 0.8) return 'text-green-600';
        if (confidence >= 0.5) return 'text-yellow-600';
        return 'text-red-600';
    };

    if (isLoading) {
        return (
            <Card className="border-amber-200 bg-amber-50/30">
                <CardContent className="py-4">
                    <div className="flex items-center gap-2 text-amber-700">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Analyzing error...</span>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (!diagnosis) {
        return null;
    }

    const bestMatch = diagnosis.bestMatch;
    const aiDiagnosis = diagnosis.aiDiagnosis;
    const primaryDiagnosis = bestMatch?.pattern.diagnosis || aiDiagnosis;

    if (!primaryDiagnosis && diagnosis.recommendations.length === 0) {
        return null;
    }

    return (
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <Card className="border-amber-200 bg-amber-50/30">
                <CardHeader className="py-3 px-4">
                    <CollapsibleTrigger className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-amber-600" />
                            <CardTitle className="text-sm font-medium text-amber-800">
                                Error Diagnosis
                            </CardTitle>
                            {bestMatch && (
                                <Badge
                                    variant="outline"
                                    className={cn("text-xs", getCategoryColor(bestMatch.pattern.category))}
                                >
                                    {bestMatch.pattern.category}
                                </Badge>
                            )}
                            {bestMatch && (
                                <span className={cn("text-xs font-medium", getConfidenceColor(bestMatch.score))}>
                                    {Math.round(bestMatch.score * 100)}% match
                                </span>
                            )}
                        </div>
                        {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-amber-600" />
                        ) : (
                            <ChevronRight className="h-4 w-4 text-amber-600" />
                        )}
                    </CollapsibleTrigger>
                </CardHeader>

                <CollapsibleContent>
                    <CardContent className="pt-0 px-4 pb-4 space-y-4">
                        {/* Root Cause */}
                        {primaryDiagnosis && (
                            <div className="space-y-2">
                                <div className="flex items-start gap-2">
                                    <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                                    <div>
                                        <h4 className="font-medium text-sm text-amber-900">
                                            {primaryDiagnosis.summary}
                                        </h4>
                                        <p className="text-sm text-amber-800 mt-1">
                                            {primaryDiagnosis.explanation}
                                        </p>
                                        {bestMatch?.pattern.diagnosis.rootCause && (
                                            <p className="text-xs text-amber-600 mt-1">
                                                <strong>Root cause:</strong> {bestMatch.pattern.diagnosis.rootCause}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Recommendations */}
                        {diagnosis.recommendations.length > 0 && (
                            <div className="space-y-2">
                                <h4 className="text-xs font-medium text-amber-700 uppercase tracking-wide">
                                    Recommended Fixes
                                </h4>
                                <div className="space-y-2">
                                    {diagnosis.recommendations.slice(0, 3).map((rec, index) => (
                                        <div
                                            key={rec.id}
                                            className="flex items-start justify-between gap-2 p-2 bg-card rounded border border-amber-100"
                                        >
                                            <div className="flex items-start gap-2 flex-1 min-w-0">
                                                <span className="text-xs font-medium text-amber-600 bg-amber-100 rounded-full w-5 h-5 flex items-center justify-center shrink-0">
                                                    {index + 1}
                                                </span>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-foreground">
                                                        {rec.title}
                                                    </p>
                                                    {rec.description !== rec.title && (
                                                        <p className="text-xs text-muted-foreground truncate">
                                                            {rec.description}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className={cn("text-xs", getConfidenceColor(rec.confidence))}>
                                                    {Math.round(rec.confidence * 100)}%
                                                </span>
                                                {rec.canAutoApply && onApplyFix && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-7 text-xs gap-1"
                                                        onClick={() => handleApplyFix(rec)}
                                                        disabled={applyingFix === rec.id}
                                                    >
                                                        {applyingFix === rec.id ? (
                                                            <Loader2 className="h-3 w-3 animate-spin" />
                                                        ) : (
                                                            <Play className="h-3 w-3" />
                                                        )}
                                                        Apply
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* AI Badge */}
                        {aiDiagnosis && !bestMatch && (
                            <div className="flex items-center gap-1 text-xs text-purple-600">
                                <span className="px-1.5 py-0.5 bg-purple-100 rounded text-[10px] font-medium">AI</span>
                                <span>Diagnosis powered by AI</span>
                            </div>
                        )}

                        {/* Feedback */}
                        {!feedbackGiven ? (
                            <div className="flex items-center gap-2 pt-2 border-t border-amber-200">
                                <span className="text-xs text-amber-700">Was this helpful?</span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs gap-1 text-green-600 hover:text-green-700 hover:bg-green-50"
                                    onClick={() => handleFeedback('yes')}
                                >
                                    <ThumbsUp className="h-3 w-3" />
                                    Yes
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                                    onClick={() => handleFeedback('no')}
                                >
                                    <ThumbsDown className="h-3 w-3" />
                                    No
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                                    onClick={() => handleFeedback('wrong')}
                                >
                                    <XCircle className="h-3 w-3" />
                                    Wrong
                                </Button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1 text-xs text-green-600 pt-2 border-t border-amber-200">
                                <CheckCircle2 className="h-3 w-3" />
                                Thanks for your feedback!
                            </div>
                        )}
                    </CardContent>
                </CollapsibleContent>
            </Card>
        </Collapsible>
    );
}

export default DiagnosisPanel;

