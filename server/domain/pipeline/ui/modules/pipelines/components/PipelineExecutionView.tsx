import React, { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { CheckCircle2, XCircle, ChevronDown, ChevronRight, ChevronLeft, Zap, Info, Eye, ShieldCheck, Pin } from 'lucide-react';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { Job } from "@shared/schema/jobs/table";
import { KnowledgeExtractionProgress } from '@domain-ui/knowledge/ui/components/knowledge/KnowledgeExtractionProgress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { ForensicTimeline } from '@domain-ui/analytics/ui/components/observability/ForensicTimeline';
import { SupervisorPlanReview } from './SupervisorPlanReview.js';
import { SemanticLogViewer } from '@domain-ui/analytics/ui/components/observability/SemanticLogViewer';
import { PipelineExecutionTimeline } from './PipelineExecutionTimeline.js';
import { PipelineLineageGraph } from './PipelineLineageGraph.js';
import { ThreadViewer } from './ThreadViewer.js';
import { ArrowLeft, RefreshCw, Square, Play, Calendar, Clock, BrainCircuit } from "lucide-react";
import PipelineStatusBadge from './PipelineStatusBadge.js';

interface PipelineExecutionViewProps {
    executionResults: any;
    pipelineStats: any;
    jobs: Job[];
    pipelineId: number;
}

export function PipelineExecutionView({ executionResults, pipelineStats, jobs, pipelineId }: PipelineExecutionViewProps) {
    const { toast } = useToast();
    const [isExpanded, setIsExpanded] = useState(false);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [childExecutions, setChildExecutions] = useState<any[]>([]);
    const [isLoadingChildren, setIsLoadingChildren] = useState(false);

    const promoteMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest('POST', `/api/pipelines/${pipelineId}/runs/${executionResults.id}/promote-to-baseline`, {});
            return res.json();
        },
        onSuccess: () => {
            toast({
                title: "Baseline Stabilized",
                description: "This execution is now the Gold Standard for drift detection.",
            });
            queryClient.invalidateQueries({ queryKey: [`/api/pipelines/${pipelineId}`] });
        },
        onError: (error: any) => {
            toast({
                title: "Promotion Failed",
                description: error.message || "Failed to establish baseline.",
                variant: "destructive"
            });
        }
    });

    useEffect(() => {
        if (isExpanded && executionResults?.id) {
            setIsLoadingChildren(true);
            fetch(`/api/pipeline-executions/${executionResults.id}/children`)
                .then(res => res.json())
                .then(data => {
                    setChildExecutions(data);
                    setIsLoadingChildren(false);
                })
                .catch(err => {
                    console.error("Failed to fetch child executions", err);
                    setIsLoadingChildren(false);
                });
        }
    }, [isExpanded, executionResults?.id]);

    if (!executionResults) return null;

    return (
        <Card data-testid="card-execution-results" className="shadow-sm">
            <CardHeader
                className="space-y-1 pb-4 bg-muted/20 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {executionResults?.success === true ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        ) : executionResults?.success === false ? (
                            <XCircle className="w-5 h-5 text-destructive" />
                        ) : (
                            <div className="w-5 h-5 rounded-full border-2 border-border" />
                        )}
                        <CardTitle>Pipeline Execution Results</CardTitle>
                    </div>
                    <div className="flex items-center gap-3">
                        {executionResults?.success && (
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-7 text-[10px] border-cyan-500/50 hover:bg-cyan-500/10 text-cyan-400 font-bold uppercase tracking-widest gap-2"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    promoteMutation.mutate();
                                }}
                                disabled={promoteMutation.isPending}
                            >
                                <ShieldCheck className="w-3 h-3" />
                                {promoteMutation.isPending ? 'PROMOTING...' : 'PIN AS GOLD BASELINE'}
                            </Button>
                        )}
                        <Badge variant="outline" className="font-normal text-muted-foreground">
                            {executionResults ? (executionResults.success ? 'Success' : 'Failed') : 'No results'}
                        </Badge>
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    </div>
                </div>
                <CardDescription className="flex items-center gap-2">
                    <span onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }} className="cursor-pointer hover:underline">
                        Click to {isExpanded ? 'collapse' : 'expand'} execution details
                    </span>
                    {executionResults?.parentExecutionId && (
                        <span className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
                            <Zap className="w-3 h-3" />
                            Parent: <a href={`/operations/workstream-executions/${executionResults.parentExecutionId}`} className="hover:underline font-medium" onClick={(e) => e.stopPropagation()}>#{executionResults.parentExecutionId}</a>
                        </span>
                    )}
                    {childExecutions.length > 0 && (
                        <span className="flex items-center gap-1 text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full border border-border">
                            <ChevronDown className="w-3 h-3" />
                            {childExecutions.length} Children
                        </span>
                    )}
                    {executionResults?.stepResults && executionResults.stepResults.length > 0 && (
                        <span> • {executionResults.stepResults.length} steps</span>
                    )}
                </CardDescription>
            </CardHeader>

            {isExpanded && (
                <CardContent className="space-y-4 pt-6">
                    {!executionResults ? (
                        <div className="text-center py-8 text-muted-foreground">
                            No execution results available
                        </div>
                    ) : (
                        <Tabs defaultValue="output" className="w-full">
                            <TabsList className="mb-4">
                                <TabsTrigger value="output">Execution Output</TabsTrigger>
                                <TabsTrigger value="children">
                                    Sub-Tasks ({childExecutions.length})
                                </TabsTrigger>
                                <TabsTrigger value="forensics">Forensic Trace</TabsTrigger>
                                <TabsTrigger value="timeline" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
                                    Timeline
                                </TabsTrigger>
                                <TabsTrigger value="reasoning" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
                                    Reasoning Trace
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="output" className="space-y-4">
                                {/* Overall error */}
                                {!executionResults.success && !executionResults.stepResults && executionResults.error && (
                                    <div className="space-y-2">
                                        <Label className="text-destructive">Pipeline Error</Label>
                                        <pre className="text-sm bg-destructive/10 text-destructive p-4 rounded max-w-full overflow-x-auto font-mono">
                                            {executionResults.error}
                                        </pre>
                                    </div>
                                )}

                                {/* Step results */}
                                {executionResults?.stepResults && executionResults.stepResults.length > 0 && (
                                    <div className="space-y-4">
                                        {/* Summary Table */}
                                        <div className="rounded-md border bg-muted/20 p-4 mb-4">
                                            <div className="rounded-md border bg-card overflow-hidden">
                                                <table className="w-full text-sm">
                                                    <thead className="bg-muted text-xs">
                                                        <tr className="border-b">
                                                            <th className="px-3 py-2 text-left w-12">#</th>
                                                            <th className="px-3 py-2 text-left">Step Name</th>
                                                            <th className="px-3 py-2 text-left w-24">Status</th>
                                                            <th className="px-3 py-2 text-right w-24">Run Time</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {executionResults.stepResults.map((step: any, idx: number) => {
                                                            const job = jobs.find(j => j.id === step.jobId);
                                                            const duration = (step.executedAt && step.completedAt)
                                                                ? Math.round((new Date(step.completedAt).getTime() - new Date(step.executedAt).getTime()) / 1000)
                                                                : 0;

                                                            return (
                                                                <tr
                                                                    key={idx}
                                                                    className={`border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors ${currentStepIndex === idx ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : ''}`}
                                                                    onClick={() => setCurrentStepIndex(idx)}
                                                                >
                                                                    <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                                                                    <td className="px-3 py-2 font-medium">
                                                                        {job?.name || `Job ${step.jobId || '(Decision)'}`}
                                                                    </td>
                                                                    <td className="px-3 py-2">
                                                                        <Badge variant="outline" className={`h-5 text-[10px] px-1.5 ${step.status === 'success' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-destructive/10 text-destructive'}`}>
                                                                            {step.status}
                                                                        </Badge>
                                                                    </td>
                                                                    <td className="px-3 py-2 text-right font-mono text-xs text-foreground font-medium">
                                                                        {duration}s
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                        {/* Step Navigation & Details */}
                                        <div className="flex items-center justify-between gap-4">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setCurrentStepIndex(Math.max(0, currentStepIndex - 1))}
                                                disabled={currentStepIndex === 0}
                                            >
                                                <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                                            </Button>
                                            <div className="text-center">
                                                <div className="text-sm font-medium">
                                                    Step {currentStepIndex + 1}: {jobs.find(j => j.id === executionResults.stepResults[currentStepIndex].jobId)?.name ?? 'Unknown'}
                                                </div>
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setCurrentStepIndex(Math.min(executionResults.stepResults.length - 1, currentStepIndex + 1))}
                                                disabled={currentStepIndex === executionResults.stepResults.length - 1}
                                            >
                                                Next <ChevronRight className="w-4 h-4 ml-1" />
                                            </Button>
                                        </div>

                                        {/* Output Display */}
                                        <div>
                                            <Label>Output</Label>
                                            {(() => {
                                                const currentStep = executionResults.stepResults[currentStepIndex];
                                                if (currentStep.status === 'waiting_external_input') {
                                                    try {
                                                        const outputJson = JSON.parse(currentStep.output);
                                                        if (outputJson._type === 'hil_context') {
                                                            return (
                                                                <div className="bg-primary/5 border border-primary/20 rounded-md p-4 text-foreground mt-2">
                                                                    <div className="flex items-center gap-2 mb-2 font-semibold">
                                                                        <Info className="w-4 h-4" />
                                                                        Approval Pending
                                                                    </div>
                                                                    <p>{outputJson.message}</p>
                                                                    {outputJson.requestId && (
                                                                        <div className="mt-2 text-xs text-amber-700/70">
                                                                            Request IDs: {Array.isArray(outputJson.requestId) ? outputJson.requestId.join(', ') : outputJson.requestId}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        } else if (outputJson._type === 'supervisor_plan_approval') {
                                                            return (
                                                                <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 text-foreground mt-2 shadow-sm">
                                                                    <div className="flex items-center gap-2 mb-2 font-bold text-primary">
                                                                        <Eye className="w-4 h-4" />
                                                                        Draft Execution Plan
                                                                    </div>
                                                                    <p className="text-xs text-muted-foreground mb-4">{outputJson.message}</p>

                                                                    <SupervisorPlanReview
                                                                        plan={outputJson.plan}
                                                                        executionId={executionResults.id}
                                                                        stepExecutionId={currentStep.id}
                                                                        onVanish={() => queryClient.invalidateQueries({ queryKey: [`/api/pipeline-executions/${executionResults.id}`] })}
                                                                    />
                                                                </div>
                                                            );
                                                        }
                                                    } catch (e) {
                                                        // Fallback to raw output if not valid JSON
                                                    }
                                                }
                                                return (
                                                    <pre className="text-sm bg-muted p-4 rounded max-w-full overflow-x-auto font-mono whitespace-pre-wrap">
                                                        {currentStep.output || "No output"}
                                                    </pre>
                                                );
                                            })()}
                                        </div>

                                        {/* Knowledge Extraction Status */}
                                        {executionResults.stepResults[currentStepIndex].knowledgeDocumentId && (
                                            <div className="pt-4 border-t">
                                                <Label className="mb-2 block">Knowledge Extraction</Label>
                                                <KnowledgeExtractionProgress
                                                    documentId={executionResults.stepResults[currentStepIndex].knowledgeDocumentId}
                                                    compact={false}
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </TabsContent>

                            <TabsContent value="timeline" className="pt-4">
                                <PipelineExecutionTimeline
                                    execution={executionResults}
                                    stepExecutions={executionResults.stepResults || []}
                                />
                            </TabsContent>

                            <TabsContent value="forensics" className="pt-4">
                                <ForensicTimeline executionId={executionResults.id} />
                            </TabsContent>
                            <TabsContent value="reasoning" className="pt-4">
                                <SemanticLogViewer executionId={executionResults.id} />
                            </TabsContent>
                            <TabsContent value="children" className="space-y-4">
                                <div className="rounded-md border">
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted/50 text-xs text-muted-foreground">
                                            <tr className="border-b">
                                                <th className="px-4 py-3 text-left">Pipeline</th>
                                                <th className="px-4 py-3 text-left">Status</th>
                                                <th className="px-4 py-3 text-left">Execution ID</th>
                                                <th className="px-4 py-3 text-right">Started At</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {childExecutions.map((child: any) => (
                                                <tr key={child.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                                                    <td className="px-4 py-3 font-medium">
                                                        <a href={`/operations/workstream-executions/${child.id}`} className="text-primary hover:underline flex items-center gap-1">
                                                            <Zap className="w-3 h-3" />
                                                            {child.pipelineName}
                                                        </a>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <Badge variant="outline" className={`capitalize ${child.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' :
                                                            child.status === 'failed' ? 'bg-destructive/10 text-destructive' :
                                                                child.status === 'running' ? 'bg-primary/10 text-primary' :
                                                                    'bg-muted text-muted-foreground'
                                                            }`}>
                                                            {child.status}
                                                        </Badge>
                                                    </td>
                                                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">#{child.id}</td>
                                                    <td className="px-4 py-3 text-right text-muted-foreground">
                                                        {new Date(child.startedAt).toLocaleString()}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </TabsContent>
                        </Tabs>
                    )}
                </CardContent>
            )}
        </Card>
    );
}

