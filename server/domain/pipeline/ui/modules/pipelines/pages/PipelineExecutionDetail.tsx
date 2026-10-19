import { useRoute, useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, RotateCcw, ExternalLink, Wand2 } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { CopyButton } from '@domain-ui/core/ui/components/ui/copy-button';
import { formatDistanceToNow } from 'date-fns';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@domain-ui/core/ui/components/ui/accordion";
import { StepDiffViewer } from '../components/StepDiffViewer.js';
import { SchemaDiffViewer } from '../components/SchemaDiffViewer.js';
import { CreateSnapshotButton } from '@domain-ui/core/ui/components/snapshots/CreateSnapshotButton';
import { RootCauseGraph } from '@domain-ui/pipeline/ui/components/execution/RootCauseGraph';
import { getStatusBadge, getStepStatusBadge, formatDuration } from '@/lib/status-badges';
import { FailedStepFixDialog } from '@domain-ui/jobs/ui/modules/jobs/components/FailedStepFixDialog';
import { TraceWaterfall } from '@domain-ui/analytics/ui/components/observability/TraceWaterfall';
import { ExecutionGanttChart } from '@domain-ui/analytics/ui/components/observability/ExecutionGanttChart';
import { AIMetrics } from '@domain-ui/analytics/ui/components/observability/AIMetrics';
import { ExecutionExplorer, type ExecutionGroup } from '@/components/execution/ExecutionExplorer';
import { useState } from 'react';

const StepOutputRenderer = ({ output }: { output: string }) => {
  let content = output;
  let citations: any = null;

  try {
    if (output.trim().startsWith('{')) {
      const json = JSON.parse(output);
      if (json.citation_metadata) {
        content = json.generated_content;
        citations = json.citation_metadata;
      }
    }
  } catch (e) {
    // ignore
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <pre className="text-xs bg-muted p-3 pr-10 rounded max-w-full overflow-x-auto overflow-y-auto max-h-[600px] font-mono whitespace-pre-wrap">
          {content.length > 50000 && !citations ? `${content.substring(0, 50000)}... (truncated)` : content}
        </pre>
        <CopyButton
          value={content}
          size="sm"
          className="absolute top-2 right-2"
          tooltipText="Copy output"
        />
      </div>

      {citations && (
        <div className="border rounded-md px-4 bg-background">
          <Accordion type="single" collapsible>
            <AccordionItem value="citations" className="border-b-0">
              <AccordionTrigger className="text-sm py-2 hover:no-underline">
                <div className="flex items-center gap-2">
                  <span>Citations & Usage</span>
                  {citations.usage?.total_tokens > 0 && (
                    <Badge variant="secondary" className="text-[10px] h-5">
                      {citations.usage.total_tokens} tokens
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2 pb-2">
                  {citations.citations?.map((c: any, i: number) => (
                    <div key={i} className="text-xs space-y-1">
                      <div className="font-medium text-foreground flex items-center gap-2">
                        <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px]">{i + 1}</span>
                        {c.document_name}
                      </div>
                      <div className="text-muted-foreground bg-muted/50 p-2 rounded border-l-2 border-primary/30 italic">
                        "{c.snippet_text?.substring(0, 300)}{c.snippet_text?.length > 300 ? '...' : ''}"
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}
    </div>
  );
};

interface PipelineExecution {
  id: number;
  pipelineId: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  createdBy: string;
  startStepId?: number | null;
  pipeline: {
    id: number;
    name: string;
    description: string | null;
  };
  stepExecutions: Array<{
    id: number;
    pipelineStepId: number;
    jobId: number;
    stepOrder: number;
    outputName: string | null;
    output: string;
    status: string;
    executedAt: string;
    completedAt: string | null;
    traceId?: string;
    retryCount?: number | null;
    error?: string | null;
    retryConfig?: {
      maxRetries?: number | null;
      backoffMs?: number | null;
      backoffMultiplier?: number | null;
      retryOnCategories?: string[] | null;
    } | null;
    jobName: string;
    jobType: string;
  }>;
  metrics: {
    totalSteps: number;
    failedSteps: number;
    duration: number | null; // in seconds
  };
  aiUsageLogs?: any[]; // Added for Observability
}

export default function PipelineExecutionDetailPage() {
  const [, legacyParams] = useRoute('/pipeline-executions/:id');
  const [, operationsParams] = useRoute('/operations/workstream-executions/:id');
  const params = operationsParams?.id ? operationsParams : legacyParams;
  const [, setLocation] = useLocation();
  const executionId = parseInt(params?.id || '0');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fixDialogState, setFixDialogState] = useState<{ isOpen: boolean; jobId: number; stepName: string; stepId: number } | null>(null);

  const { data: execution, isLoading, error } = useQuery<PipelineExecution>({
    queryKey: ['/api/pipeline-executions', executionId],
    queryFn: async () => {
      const res = await fetch(`/api/pipeline-executions/${executionId}`);
      if (!res.ok) throw new Error('Failed to fetch pipeline execution');
      return res.json();
    },
    enabled: !!executionId,
    // Poll while the execution is in flight so the "Live" badge is truthful;
    // stop once it reaches a terminal state. (Mission detail already does this.)
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && !['completed', 'failed', 'cancelled', 'timeout'].includes(status) ? 5000 : false;
    },
  });

  const rerunMutation = useMutation({
    mutationFn: async (startStepId: number) => {
      const res = await fetch(`/api/pipeline-executions/${executionId}/rerun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startStepId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to rerun pipeline');
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Rerun initiated',
        description: `New execution ID: ${data.executionId}`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/pipelines', execution?.pipelineId, 'executions'] });
      setLocation(`/operations/workstream-executions/${data.executionId}`);
      setFixDialogState(null);
    },
    onError: (error: Error) => {
      toast({
        title: 'Rerun failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const { data: rootCauseData } = useQuery({
    queryKey: ['/api/pipeline-executions', executionId, 'root-cause'],
    queryFn: async () => {
      const res = await fetch(`/api/pipeline-executions/${executionId}/root-cause`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!executionId && execution?.status === 'failed',
  });

  const handleRerun = () => {
    if (!execution) return;
    const failedStep = execution.stepExecutions.find(step => step.status === 'failure');
    if (!failedStep) {
      toast({ title: 'No failed step found', description: 'Cannot rerun: no failed steps', variant: 'destructive' });
      return;
    }
    if (!confirm(`Are you sure you want to RERUN starting from step ${failedStep.stepOrder + 1} (${failedStep.jobName})?`)) {
      return;
    }
    rerunMutation.mutate(failedStep.pipelineStepId);
  };

  const handleFixAndResume = (step: any) => {
    setFixDialogState({
      isOpen: true,
      jobId: step.jobId,
      stepName: step.jobName,
      stepId: step.pipelineStepId
    });
  };

  const onResumeFromFix = () => {
    if (fixDialogState) {
      rerunMutation.mutate(fixDialogState.stepId);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !execution) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setLocation('/operations/workstreams')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Workstreams
          </Button>
        </div>
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">Failed to load pipeline execution: {error instanceof Error ? error.message : 'Unknown error'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const duration = execution.metrics.duration !== null
    ? formatDuration(execution.metrics.duration)
    : execution.status === 'running'
      ? `Running for ${formatDistanceToNow(new Date(execution.startedAt), { addSuffix: false })}`
      : 'N/A';

  const executionGroups: ExecutionGroup[] = execution.stepExecutions
    .slice()
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map((step) => {
      const status =
        step.status === 'success' ? 'completed' :
        step.status === 'failure' ? 'failed' :
        step.status === 'running' ? 'running' :
        step.status === 'retrying' ? 'retrying' :
        step.status === 'waiting_async' || step.status === 'waiting_delay' || step.status === 'waiting_external_input' ? 'waiting' :
        step.status === 'cancelled' ? 'cancelled' :
        step.status === 'skipped' ? 'skipped' : 'pending';
      const durationMs = step.completedAt
        ? new Date(step.completedAt).getTime() - new Date(step.executedAt).getTime()
        : undefined;
      const retryCount = step.retryCount ?? 0;
      const policy = step.retryConfig ?? undefined;
      const maxRetries = policy?.maxRetries ?? null;

      // Classify a failure using retry budget usage. NOTE: this is inferred from
      // retryCount vs the policy budget — the step execution does not persist an
      // error *category*, so we cannot say which retryOnCategories matched. A
      // precise transient/permanent badge needs an errorCategory column.
      let failureClass: string | undefined;
      if (status === 'failed' && policy) {
        if (retryCount === 0) failureClass = 'Permanent — failed without retrying (error not in retry policy)';
        else if (maxRetries != null && retryCount >= maxRetries) failureClass = `Transient — retries exhausted (${retryCount}/${maxRetries})`;
        else failureClass = `Failed after ${retryCount} ${retryCount === 1 ? 'retry' : 'retries'}`;
      }
      const policySummary = policy
        ? [
            maxRetries != null ? `up to ${maxRetries} ${maxRetries === 1 ? 'retry' : 'retries'}` : null,
            policy.backoffMs != null ? `backoff ${policy.backoffMs >= 1000 ? `${policy.backoffMs / 1000}s` : `${policy.backoffMs}ms`}${policy.backoffMultiplier && policy.backoffMultiplier !== 1 ? ` ×${policy.backoffMultiplier}` : ''}` : null,
            policy.retryOnCategories?.length ? `on ${policy.retryOnCategories.join(', ')}` : null,
          ].filter(Boolean).join(' · ')
        : undefined;

      return {
        id: `pipeline-step-${step.id}`,
        title: step.jobName,
        subtitle: `Step ${step.stepOrder + 1} • ${step.jobType}`,
        category: step.status === 'waiting_async' ? 'async wait' : 'pipeline step',
        status,
        startedAt: step.executedAt,
        completedAt: step.completedAt,
        durationMs,
        progress: status === 'completed' ? 100 : status === 'running' || status === 'waiting' || status === 'retrying' ? 50 : status === 'failed' ? 100 : 0,
        isCritical: step.status === 'failure' || step.status === 'waiting_async' || status === 'retrying',
        retryCount,
        retryPolicy: policy,
        metadata: {
          stepExecutionId: step.id,
          pipelineStepId: step.pipelineStepId,
          jobId: step.jobId,
          traceId: step.traceId,
          retryCount,
          ...(policySummary ? { 'Retry policy': policySummary } : {}),
          ...(failureClass ? { 'Failure class': failureClass } : {}),
          ...(step.error ? { error: step.error } : {}),
          outputName: step.outputName,
          status: step.status,
          output: step.output,
        },
        events: [
          {
            id: `pipeline-step-${step.id}-scheduled`,
            timestamp: step.executedAt,
            type: 'step.scheduled',
            title: `${step.jobName} scheduled`,
            description: `Pipeline step ${step.stepOrder + 1} entered execution.`,
            status,
          },
          ...(retryCount > 0 ? [{
            id: `pipeline-step-${step.id}-retried`,
            timestamp: step.executedAt,
            type: 'step.retried',
            title: `${step.jobName} retried ${retryCount}×`,
            description: `Step was retried ${retryCount} time${retryCount === 1 ? '' : 's'} before settling.`,
            status: 'retrying' as const,
          }] : []),
          ...(step.completedAt ? [{
            id: `pipeline-step-${step.id}-completed`,
            timestamp: step.completedAt,
            type: step.status === 'failure' ? 'step.failed' : 'step.completed',
            title: step.status === 'failure' ? `${step.jobName} failed` : `${step.jobName} completed`,
            description: step.status === 'failure' ? (step.error || step.output)?.substring(0, 500) : step.outputName || 'Step produced output.',
            status,
          }] : []),
        ],
      } satisfies ExecutionGroup;
    });

  const pipelineRelationships = [
    {
      id: `pipeline-${execution.pipelineId}`,
      label: 'Parent pipeline',
      value: execution.pipeline.name,
      type: 'parent' as const,
      href: `/operations/workstreams/${execution.pipelineId}`,
      status: execution.status,
    },
    ...execution.stepExecutions
      .filter(step => step.traceId)
      .map(step => ({
        id: `external-task-${step.id}`,
        label: 'External task',
        value: `${step.jobName} • ${step.traceId}`,
        type: 'execution' as const,
        href: `/external/task/${step.traceId}`,
        status: step.status,
      })),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setLocation(`/operations/workstreams/${execution.pipelineId}/executions`)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Executions
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pipeline Execution #{execution.id}</h1>
            <p className="text-muted-foreground">{execution.pipeline.name}</p>
          </div>
        </div>
      </div>

      {fixDialogState && (
        <FailedStepFixDialog
          isOpen={fixDialogState.isOpen}
          onClose={() => setFixDialogState(null)}
          jobId={fixDialogState.jobId}
          stepName={fixDialogState.stepName}
          onResume={onResumeFromFix}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Status</CardDescription>
          </CardHeader>
          <CardContent>
            {getStatusBadge(execution.status)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Total Steps</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{execution.metrics.totalSteps}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Failed Steps</CardDescription>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${execution.metrics.failedSteps > 0 ? 'text-destructive' : 'text-green-600'}`}>
              {execution.metrics.failedSteps}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Duration</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
              {duration}
            </div>
          </CardContent>
        </Card>
      </div>

      {execution.startStepId && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-yellow-800">
              <RotateCcw className="w-4 h-4" />
              <span className="text-sm font-medium">Rerun Execution</span>
              <span className="text-sm">Started from Step ID: {execution.startStepId}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {execution.status === 'failed' && execution.stepExecutions.some(step => step.status === 'failure') && (
        <div className="flex justify-end">
          <Button
            variant="destructive"
            onClick={handleRerun}
            disabled={rerunMutation.isPending}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            {rerunMutation.isPending ? 'Rerunning...' : 'Rerun from Failed Step'}
          </Button>
        </div>
      )}

      {execution.error && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Execution Error</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm bg-destructive/10 text-destructive p-4 rounded max-w-full overflow-x-auto font-mono">
              {execution.error}
            </pre>
          </CardContent>
        </Card>
      )}

      {rootCauseData && (
        <RootCauseGraph traceData={rootCauseData} />
      )}

      {/* Execution Timeline with State-Aware Latency Tracking */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ExecutionGanttChart
            executionStartedAt={execution.startedAt}
            executionCompletedAt={execution.completedAt}
            steps={execution.stepExecutions}
            showTimeBreakdown={true}
          />
        </div>
        <div>
          <AIMetrics usageLogs={execution.aiUsageLogs} />
        </div>
      </div>

      <ExecutionExplorer
        title="Pipeline Execution Explorer"
        description="Grouped step execution with compact, timeline, full-history, relationship, and metadata views."
        status={execution.status}
        groups={executionGroups}
        relationships={pipelineRelationships}
        metadata={[
          { label: 'Execution ID', value: execution.id },
          { label: 'Pipeline ID', value: execution.pipelineId },
          { label: 'Created By', value: execution.createdBy || 'Unknown' },
          { label: 'Started', value: new Date(execution.startedAt).toLocaleString() },
          { label: 'Completed', value: execution.completedAt ? new Date(execution.completedAt).toLocaleString() : 'Still running' },
          { label: 'Duration', value: duration },
          { label: 'Failed Steps', value: execution.metrics.failedSteps },
          { label: 'AI Usage Logs', value: execution.aiUsageLogs?.length || 0 },
        ]}
        lastUpdatedAt={execution.completedAt || execution.startedAt}
        isLive={execution.status === 'running'}
        defaultView="timeline"
        renderGroupActions={(group) => {
          const step = execution.stepExecutions.find(item => `pipeline-step-${item.id}` === group.id);
          if (!step) return null;
          return (
            <div className="flex flex-wrap items-center gap-2">
              {getStepStatusBadge(step.status)}
              {step.status === 'failure' && (
                <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => handleFixAndResume(step)}>
                  <Wand2 className="w-3 h-3 mr-1" />
                  Inspect & Fix
                </Button>
              )}
              {step.status === 'waiting_async' && step.traceId && (
                <Button variant="outline" size="sm" className="h-7 border-yellow-500 text-yellow-600 hover:bg-yellow-50" onClick={() => window.open(`/external/task/${step.traceId}`, '_blank')}>
                  <ExternalLink className="w-3 h-3 mr-1" />
                  Review
                </Button>
              )}
              {step.status === 'success' && step.id && (
                <Button variant="outline" size="sm" className="h-7" onClick={() => setLocation(`/health/monitoring/step/${step.id}`)}>
                  <ExternalLink className="w-3 h-3 mr-1" />
                  Log
                </Button>
              )}
            </div>
          );
        }}
        renderGroupDetail={(group) => {
          const step = execution.stepExecutions.find(item => `pipeline-step-${item.id}` === group.id);
          if (!step) return null;
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {step.status === 'success' && <SchemaDiffViewer stepExecutionId={step.id} />}
                {step.status === 'success' && <StepDiffViewer stepExecutionId={step.id} stepName={step.jobName} />}
                {step.status === 'success' && (
                  <CreateSnapshotButton
                    entityType="pipeline_step"
                    entityId={step.pipelineStepId}
                    jobId={step.jobId}
                    data={step.output}
                    defaultLabel={`${step.jobName} - Execution #${execution.id}`}
                  />
                )}
              </div>
              {step.output ? (
                <StepOutputRenderer output={step.output} />
              ) : (
                <p className="text-xs text-muted-foreground">No output has been captured for this step.</p>
              )}
            </div>
          );
        }}
      />

      {false && execution && (
      <Card>
        <CardHeader>
          <CardTitle>Execution Steps</CardTitle>
          <CardDescription>Sequential workflow visualization</CardDescription>
        </CardHeader>
        <CardContent>
          {(execution?.stepExecutions || []).length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No steps executed</p>
          ) : (
            <div className="space-y-6">
              {(execution?.stepExecutions || []).map((step, index) => (
                <div key={step.id} className="flex items-start gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${step.status === 'success' ? 'bg-green-100 text-green-800' :
                      step.status === 'failure' ? 'bg-red-100 text-red-800' :
                        step.status === 'running' ? 'bg-blue-100 text-blue-800' :
                          'bg-muted text-foreground'
                      }`}>
                      {step.stepOrder + 1}
                    </div>
                    {index < (execution?.stepExecutions || []).length - 1 && (
                      <div className={`w-0.5 h-16 my-2 ${step.status === 'success' ? 'bg-green-300' :
                        step.status === 'failure' ? 'bg-red-300' :
                          'bg-muted'
                        }`} />
                    )}
                  </div>

                  <div className="flex-1 space-y-2 pb-6 border-b last:border-0">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{step.jobName}</h3>
                        <p className="text-sm text-muted-foreground">Step {step.stepOrder + 1} • {step.jobType}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStepStatusBadge(step.status)}

                        {step.status === 'failure' && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 text-xs"
                            onClick={() => handleFixAndResume(step)}
                          >
                            <Wand2 className="w-3 h-3 mr-1" />
                            Inspect & Fix
                          </Button>
                        )}

                        {step.status === 'waiting_async' && step.traceId && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-yellow-500 text-yellow-600 hover:bg-yellow-50"
                            onClick={() => window.open(`/external/task/${step.traceId}`, '_blank')}
                          >
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Review Task
                          </Button>
                        )}
                        {step.status === 'success' && step.id && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setLocation(`/health/monitoring/step/${step.id}`)}
                          >
                            <ExternalLink className="w-4 h-4 mr-2" />
                            View Job Log
                          </Button>
                        )}
                        {step.status === 'success' && step.id && (
                          <SchemaDiffViewer stepExecutionId={step.id} />
                        )}
                        {step.status === 'success' && step.id && (
                          <StepDiffViewer
                            stepExecutionId={step.id}
                            stepName={step.jobName}
                          />
                        )}
                        {step.status === 'success' && step.id && (
                          <CreateSnapshotButton
                            entityType="pipeline_step"
                            entityId={step.pipelineStepId}
                            jobId={step.jobId}
                            data={step.output}
                            defaultLabel={`${step.jobName} - Execution #${execution?.id}`}
                          />
                        )}
                      </div>
                    </div>

                    {step.output && (
                      <div className="mt-2 text-sm">
                        <p className="text-xs text-muted-foreground mb-1">Output:</p>
                        <StepOutputRenderer output={step.output} />
                      </div>
                    )}

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Executed: {new Date(step.executedAt).toLocaleString()}</span>
                      {step.completedAt && (
                        <span>Completed: {new Date(step.completedAt).toLocaleString()}</span>
                      )}
                      {step.completedAt && (
                        <span className="font-medium text-blue-600">
                          Execution Time: {formatDuration(
                            Math.round(
                              (new Date(step.completedAt).getTime() - new Date(step.executedAt).getTime()) / 1000
                            )
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}

