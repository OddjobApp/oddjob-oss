import { useRoute, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@domain-ui/core/ui/components/ui/table';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';
import { formatDistanceToNow, format } from 'date-fns';
import { getStatusBadge } from '@/lib/status-badges';
import { ExportButton } from '@domain-ui/core/ui/components/shared/ExportButton';
import { formatDateForExport } from '@/lib/export-utils';
import { ExecutionExplorer, type ExecutionGroup } from '@/components/execution/ExecutionExplorer';

interface PipelineExecution {
  id: number;
  pipelineId: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  createdBy: string;
  stepCount: number;
  failedStepCount: number;
}

// getStatusBadge now imported from @/lib/status-badges

const formatDuration = (startedAt: string, completedAt: string | null, status: string): string => {
  if (status === 'running') {
    return `Running for ${formatDistanceToNow(new Date(startedAt), { addSuffix: false })}`;
  }
  if (!completedAt) return 'N/A';
  const duration = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const seconds = Math.round(duration / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m ${secs}s`;
};

export default function PipelineExecutionsPage() {
  const [, legacyParams] = useRoute('/pipelines/:id/executions');
  const [, operationsParams] = useRoute('/operations/workstreams/:id/executions');
  const params = operationsParams?.id ? operationsParams : legacyParams;
  const [, setLocation] = useLocation();
  const pipelineId = parseInt(params?.id || '0');

  const { data: executions, isLoading } = useQuery<PipelineExecution[]>({
    queryKey: ['/api/pipelines', pipelineId, 'executions'],
    queryFn: async () => {
      const res = await fetch(`/api/pipelines/${pipelineId}/executions`);
      if (!res.ok) throw new Error('Failed to fetch pipeline executions');
      return res.json();
    },
    enabled: !!pipelineId,
    // Keep the "Live" badge honest: poll while any execution is still in flight.
    refetchInterval: (query) => {
      const rows = query.state.data;
      const active = Array.isArray(rows) && rows.some(r => !['completed', 'failed', 'cancelled', 'timeout'].includes(r.status));
      return active ? 5000 : false;
    },
  });

  const { data: pipeline } = useQuery({
    queryKey: ['/api/pipelines', pipelineId],
    queryFn: async () => {
      const res = await fetch(`/api/pipelines/${pipelineId}`);
      if (!res.ok) throw new Error('Failed to fetch pipeline');
      return res.json();
    },
    enabled: !!pipelineId,
  });

  const executionExplorerGroups: ExecutionGroup[] = (executions || [])
    .map((execution) => {
      const status =
        execution.status === 'success' || execution.status === 'completed' ? 'completed' :
        execution.status === 'failure' || execution.status === 'failed' ? 'failed' :
        execution.status === 'running' ? 'running' :
        execution.status === 'cancelled' ? 'cancelled' : 'pending';
      const durationMs = execution.completedAt
        ? new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime()
        : undefined;

      return {
        id: `pipeline-execution-${execution.id}`,
        title: `Execution #${execution.id}`,
        subtitle: execution.error || `${execution.stepCount || 0} steps • ${execution.failedStepCount || 0} failed`,
        category: execution.failedStepCount > 0 ? 'failed run' : 'workstream run',
        status,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        durationMs,
        progress: status === 'completed' ? 100 : status === 'running' ? 50 : status === 'failed' ? 100 : 0,
        count: execution.stepCount,
        isCritical: execution.failedStepCount > 0 || status === 'failed',
        metadata: {
          executionId: execution.id,
          pipelineId: execution.pipelineId,
          createdBy: execution.createdBy,
          stepCount: execution.stepCount,
          failedStepCount: execution.failedStepCount,
          error: execution.error,
        },
        events: [
          {
            id: `pipeline-execution-${execution.id}-started`,
            timestamp: execution.startedAt,
            type: 'workstream.execution.started',
            title: `Execution #${execution.id} started`,
            description: `${execution.stepCount || 0} steps scheduled.`,
            status,
          },
          ...(execution.completedAt ? [{
            id: `pipeline-execution-${execution.id}-completed`,
            timestamp: execution.completedAt,
            type: status === 'failed' ? 'workstream.execution.failed' : 'workstream.execution.completed',
            title: status === 'failed' ? `Execution #${execution.id} failed` : `Execution #${execution.id} completed`,
            description: execution.error || `${execution.failedStepCount || 0} failed steps.`,
            status,
          }] : []),
        ],
      } satisfies ExecutionGroup;
    })
    .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setLocation(`/operations/workstreams/${pipelineId}`)} aria-label="Go back to workstream details">
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" /> Back to Workstream
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Execution History</h1>
            <p className="text-muted-foreground">{pipeline?.name || `Pipeline #${pipelineId}`}</p>
          </div>
        </div>
        <ExportButton
          data={executions || []}
          filename={`pipeline_${pipelineId}_executions`}
          columns={[
            { key: 'id', header: 'Execution ID' },
            { key: 'pipelineId', header: 'Pipeline ID' },
            { key: 'status', header: 'Status' },
            { key: 'startedAt', header: 'Started At', formatter: formatDateForExport },
            { key: 'completedAt', header: 'Completed At', formatter: formatDateForExport },
            { key: 'stepCount', header: 'Total Steps', formatter: (v) => String(v || 0) },
            { key: 'failedStepCount', header: 'Failed Steps', formatter: (v) => String(v || 0) },
            { key: 'createdBy', header: 'Created By' },
            { key: 'error', header: 'Error', formatter: (v) => v || '' },
          ]}
        />
      </div>

      <ExecutionExplorer
        title="Workstream Execution Explorer"
        description="Grouped execution history for this workstream with compact, timeline, full-history, relationship, and metadata views."
        status={executionExplorerGroups.some(group => group.status === 'failed') ? 'warning' : executionExplorerGroups.some(group => group.status === 'running') ? 'running' : 'completed'}
        groups={executionExplorerGroups}
        relationships={[
          {
            id: `pipeline-${pipelineId}`,
            label: 'Parent workstream',
            value: pipeline?.name || `Pipeline #${pipelineId}`,
            type: 'parent',
            href: `/operations/workstreams/${pipelineId}`,
            status: pipeline?.isActive ? 'running' : 'pending',
          },
          ...(executions || []).filter(execution => execution.failedStepCount > 0).map(execution => ({
            id: `failed-execution-${execution.id}`,
            label: 'Needs investigation',
            value: `Execution #${execution.id}`,
            type: 'execution' as const,
            href: `/operations/workstream-executions/${execution.id}`,
            status: 'failed',
          })),
        ]}
        metadata={[
          { label: 'Pipeline ID', value: pipelineId },
          { label: 'Execution Count', value: executions?.length || 0 },
          { label: 'Running', value: (executions || []).filter(e => e.status === 'running').length },
          { label: 'Failed Runs', value: (executions || []).filter(e => e.failedStepCount > 0 || e.status === 'failed').length },
          { label: 'Total Steps', value: (executions || []).reduce((total, execution) => total + (execution.stepCount || 0), 0) },
          { label: 'Failed Steps', value: (executions || []).reduce((total, execution) => total + (execution.failedStepCount || 0), 0) },
        ]}
        lastUpdatedAt={executionExplorerGroups[0]?.startedAt}
        isLive={(executions || []).some(execution => execution.status === 'running')}
        defaultView="timeline"
      />

      {/* Executions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline Executions</CardTitle>
          <CardDescription>View all execution runs for this pipeline</CardDescription>
        </CardHeader>
        <CardContent>
          {!executions || executions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No executions found for this pipeline
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Steps</TableHead>
                  <TableHead>Failed Steps</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.map((execution) => (
                  <TableRow key={execution.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/operations/workstream-executions/${execution.id}`)}>
                    <TableCell className="font-medium">#{execution.id}</TableCell>
                    <TableCell>{getStatusBadge(execution.status)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{format(new Date(execution.startedAt), 'MMM d, yyyy HH:mm:ss')}</span>
                      </div>
                    </TableCell>
                    <TableCell>{formatDuration(execution.startedAt, execution.completedAt, execution.status)}</TableCell>
                    <TableCell>{execution.stepCount}</TableCell>
                    <TableCell>
                      <span className={execution.failedStepCount > 0 ? 'text-destructive font-semibold' : ''}>
                        {execution.failedStepCount}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{execution.createdBy}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLocation(`/operations/workstream-executions/${execution.id}`);
                        }}
                      >
                        View Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

