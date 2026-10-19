import { useState } from 'react';
import { useParams, useLocation, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@domain-ui/core/ui/components/ui/table";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@domain-ui/core/ui/components/ui/dialog";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import { format } from "date-fns";
import { CheckCircle, XCircle, Clock, Activity, ArrowLeft, Calendar, GitBranch, Loader2 } from "lucide-react";

// Helper function to safely format dates
const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Invalid Date';
    return format(date, 'MMM d, yyyy HH:mm:ss');
  } catch (e) {
    return 'Invalid Date';
  }
};

// Helper to format duration
const formatDuration = (startTime: string | null | undefined, endTime: string | null | undefined): string => {
  if (!startTime) return 'N/A';
  try {
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date();
    const diffMs = end.getTime() - start.getTime();

    // Handle negative durations (shouldn't happen, but protect against it)
    if (diffMs < 0) return 'N/A';

    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  } catch (e) {
    return 'N/A';
  }
};

const getStatusBadge = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'success':
    case 'completed':
      return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 dark:bg-green-500/20 dark:text-green-400">Success</Badge>;
    case 'failed':
    case 'failure':
      return <Badge variant="destructive">Failed</Badge>;
    case 'running':
    case 'in_progress':
      return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 dark:bg-blue-500/20 dark:text-blue-400">Running</Badge>;
    case 'pending':
      return <Badge variant="secondary">Pending</Badge>;
    default:
      return <Badge variant="secondary">{status || 'Unknown'}</Badge>;
  }
};

// Detail view component
function ExecutionDetailView({ executionId, kind }: { executionId: number; kind: MonitoringIdKind }) {
  const [, setLocation] = useLocation();
  const { data: execution, isLoading, error } = useQuery({
    // kind is part of the key as well as the request: ids 35 and 48-51 exist in
    // both pipeline_step_executions and agent_run_steps, so caching on id alone
    // would serve one record for the other.
    queryKey: ['/api/executions', kind, executionId],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/executions/${executionId}?kind=${kind}`);
      return res.json();
    },
    enabled: !!executionId,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-8 text-muted-foreground">Loading execution details...</div>
      </div>
    );
  }

  if (error || !execution) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setLocation('/health/monitoring')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Executions
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">Failed to load execution: {error instanceof Error ? error.message : 'Unknown error'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => setLocation('/health/monitoring')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Executions
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Execution #{execution.executionId || execution.id}</h1>
          <p className="text-muted-foreground">{execution.jobName || 'Unknown Job'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent>
            {getStatusBadge(execution.status)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Start Time</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{formatDate(execution.startTime)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Duration</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{formatDuration(execution.startTime, execution.endTime)}</p>
          </CardContent>
        </Card>
      </div>

      {execution.output && (
        <Card>
          <CardHeader>
            <CardTitle>Output</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64 w-full rounded border p-4">
              <pre className="text-xs font-mono whitespace-pre-wrap">{execution.output}</pre>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {execution.errorUri && (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Error URI: {execution.errorUri}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Pipeline Executions List View
function PipelineExecutionsView() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const { isLoading: isAuthLoading } = useAuth();

  const { data: pipelineExecutions = [], isLoading, error } = useQuery<any[]>({
    queryKey: ['/api/pipeline-executions'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/pipeline-executions?limit=100');
      return res.json();
    },
    refetchInterval: 15000,
    enabled: !isAuthLoading
  });

  const filteredExecutions = pipelineExecutions.filter((exec: any) => {
    const pipelineName = (exec.pipeline?.name || '').toLowerCase();
    const status = (exec.status || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return pipelineName.includes(query) || status.includes(query);
  });

  const successCount = pipelineExecutions.filter((e: any) => e.status === 'success' || e.status === 'completed').length;
  const runningCount = pipelineExecutions.filter((e: any) => e.status === 'running').length;
  const failedCount = pipelineExecutions.filter((e: any) => e.status === 'failed').length;

  const formatDurationFromMs = (startedAt: string | null, completedAt: string | null): string => {
    if (!startedAt) return 'N/A';
    const start = new Date(startedAt);
    const end = completedAt ? new Date(completedAt) : new Date();
    const diffMs = end.getTime() - start.getTime();
    if (diffMs < 0) return 'N/A';
    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {successCount > 0 && (
          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 dark:bg-green-500/20 dark:text-green-400">
            <CheckCircle className="w-3 h-3 mr-1" />
            {successCount} successful
          </Badge>
        )}
        {runningCount > 0 && (
          <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 dark:bg-blue-500/20 dark:text-blue-400">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            {runningCount} running
          </Badge>
        )}
        {failedCount > 0 && (
          <Badge variant="destructive">
            <XCircle className="w-3 h-3 mr-1" />
            {failedCount} failed
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Pipeline Executions</CardTitle>
              <CardDescription>Monitor multi-step workflow executions</CardDescription>
            </div>
            <Input
              placeholder="Search pipelines..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-sm"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading pipeline executions...</div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-destructive mb-2">
                {error instanceof Error ? error.message : 'Failed to load pipeline executions'}
              </p>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          ) : filteredExecutions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pipeline</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Steps</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExecutions.map((exec: any) => (
                  <TableRow
                    key={exec.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setLocation(`/pipeline-executions/${exec.id}`)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <GitBranch className="w-4 h-4 text-muted-foreground" />
                        {exec.pipeline?.name || `Pipeline #${exec.pipelineId}`}
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(exec.status)}</TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {exec.stepExecutions?.length || 0} steps
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(exec.startedAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDurationFromMs(exec.startedAt, exec.completedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLocation(`/pipeline-executions/${exec.id}`);
                        }}
                      >
                        View Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery ? 'No pipeline executions found matching your search.' : 'No pipeline executions found.'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Main list view component
export function ExecutionListView() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedExecution, setSelectedExecution] = useState<any | null>(null);

  const { isLoading: isAuthLoading } = useAuth();

  const { data: executions, isLoading, error: executionsError } = useQuery<any[]>({
    queryKey: ['/api/executions'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/executions');
      return res.json();
    },
    refetchInterval: 15000,
    enabled: !isAuthLoading
  });

  // Fetch scheduled jobs for upcoming executions
  const { data: scheduledJobs = [], isLoading: isLoadingScheduled } = useQuery<any[]>({
    queryKey: ['/api/scheduled-jobs'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/scheduled-jobs');
      return res.json();
    },
    enabled: !isAuthLoading
  });

  const filteredExecutions = executions?.filter((exec: any) => {
    const jobName = (exec.jobName || '').toLowerCase();
    const status = (exec.status || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return jobName.includes(query) || status.includes(query);
  }) || [];

  const successCount = executions?.filter((e: any) => e.status === 'success' || e.status === 'completed').length || 0;
  const failedCount = executions?.filter((e: any) => e.status === 'failed' || e.status === 'failure').length || 0;

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Execution Monitoring</h1>
            <p className="text-muted-foreground">Monitor job and pipeline executions in real-time</p>
          </div>
        </div>

        <Tabs defaultValue="jobs" className="w-full">
          <TabsList>
            <TabsTrigger value="jobs" className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Job Executions
            </TabsTrigger>
            <TabsTrigger value="pipelines" className="flex items-center gap-2">
              <GitBranch className="w-4 h-4" />
              Pipeline Executions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="jobs" className="mt-6 space-y-6">
            <div className="flex items-center gap-2">
              {successCount > 0 && (
                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 dark:bg-green-500/20 dark:text-green-400">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  {successCount} successful
                </Badge>
              )}
              {failedCount > 0 && (
                <Badge variant="destructive">
                  <XCircle className="w-3 h-3 mr-1" />
                  {failedCount} failed
                </Badge>
              )}
            </div>

            {/* Upcoming Executions Section */}
            <Card>
              <CardHeader>
                <CardTitle>Upcoming Executions</CardTitle>
                <CardDescription>Scheduled jobs that will run soon</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingScheduled ? (
                  <div className="text-center py-8 text-muted-foreground">Loading upcoming executions...</div>
                ) : scheduledJobs.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Job</TableHead>
                        <TableHead>Schedule</TableHead>
                        <TableHead>Next Run</TableHead>
                        <TableHead>Pattern</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scheduledJobs
                        .filter((sj: any) => sj.isActive !== false)
                        .slice(0, 10)
                        .map((sj: any) => (
                          <TableRow key={sj.id}>
                            <TableCell className="font-medium">
                              <Link href={`/jobs/${sj.jobId}`} className="text-primary hover:text-primary/80 hover:underline cursor-pointer transition-colors">
                                {sj.jobName || `Job #${sj.jobId}`}
                              </Link>
                            </TableCell>
                            <TableCell>
                              {sj.scheduleId ? (
                                <Link href={`/schedules/${sj.scheduleId}`} className="text-primary hover:text-primary/80 hover:underline cursor-pointer transition-colors">
                                  {sj.scheduleName || `Schedule #${sj.scheduleId}`}
                                </Link>
                              ) : (
                                <span className="text-muted-foreground">Manual</span>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              <div className="flex items-center gap-2">
                                <Calendar className="w-4 h-4" />
                                {sj.nextRunTime || 'Not scheduled'}
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {sj.schedulePattern || sj.cronExpression || 'N/A'}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">No upcoming executions scheduled</div>
                )}
              </CardContent>
            </Card>

            {/* Recent Executions Section */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Recent Executions</CardTitle>
                    <CardDescription>View and monitor job execution history</CardDescription>
                  </div>
                  <Input
                    placeholder="Search executions..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="max-w-sm"
                  />
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading executions...</div>
                ) : executionsError ? (
                  <div className="text-center py-8">
                    <p className="text-destructive mb-2">
                      {executionsError instanceof Error ? executionsError.message : 'Failed to load executions'}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.location.reload()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : filteredExecutions.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Job Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Start Time</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredExecutions.map((exec: any) => {
                        const execId = exec.executionId || exec.id;
                        return (
                          <TableRow
                            key={execId}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => setLocation(`/health/monitoring/step/${execId}`)}
                          >
                            <TableCell className="font-medium">{exec.jobName || 'Unknown Job'}</TableCell>
                            <TableCell>{getStatusBadge(exec.status)}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {formatDate(exec.startTime)}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {formatDuration(exec.startTime, exec.endTime)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedExecution(exec);
                                }}
                              >
                                View Details
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    {searchQuery ? 'No executions found matching your search.' : 'No executions found.'}
                  </div>
                )}
              </CardContent>
            </Card>

            <Dialog open={!!selectedExecution} onOpenChange={() => setSelectedExecution(null)}>
              <DialogContent className="max-w-4xl">
                <DialogHeader>
                  <DialogTitle>Execution Details - #{selectedExecution?.executionId || selectedExecution?.id}</DialogTitle>
                  <DialogDescription>{selectedExecution?.jobName || 'Unknown Job'}</DialogDescription>
                </DialogHeader>
                {selectedExecution && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Status</p>
                        <div className="mt-1">{getStatusBadge(selectedExecution.status)}</div>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Duration</p>
                        <p className="mt-1">{formatDuration(selectedExecution.startTime, selectedExecution.endTime)}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Start Time</p>
                        <p className="mt-1 text-sm">{formatDate(selectedExecution.startTime)}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">End Time</p>
                        <p className="mt-1 text-sm">{formatDate(selectedExecution.endTime)}</p>
                      </div>
                    </div>
                    {selectedExecution.output && (
                      <div>
                        <p className="text-sm font-medium text-muted-foreground mb-2">Output</p>
                        <ScrollArea className="h-48 w-full rounded border p-4">
                          <pre className="text-xs font-mono whitespace-pre-wrap">{selectedExecution.output}</pre>
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="pipelines" className="mt-6">
            <PipelineExecutionsView />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

/**
 * Which table the :id in the URL belongs to.
 *
 * This page resolves ids against pipeline_step_executions only. Four different
 * call sites used to link here with ids from four different tables — agent run
 * steps, alert jobRunIds, audit entityIds — and every mismatch surfaced as an
 * unexplained 404 from /api/executions/:id rather than as a bad link.
 *
 * Naming the kind in the path makes a mismatch a visible, local error instead.
 */
const SUPPORTED_ID_KINDS = ["step", "agent-step"] as const;
export type MonitoringIdKind = (typeof SUPPORTED_ID_KINDS)[number];

function UnsupportedIdKind({ kind, id }: { kind: string; id: string }) {
  return (
    <div className="p-8 max-w-xl mx-auto text-center space-y-3">
      <h2 className="text-lg font-semibold text-foreground">Unsupported link</h2>
      <p className="text-sm text-muted-foreground">
        This page resolves pipeline step executions. It was given{" "}
        <code className="font-mono text-xs">{kind}</code> id{" "}
        <code className="font-mono text-xs">{id}</code>, which it cannot look up.
      </p>
      <p className="text-xs text-muted-foreground">
        This is a bad link rather than a missing record — the id belongs to a different table.
      </p>
    </div>
  );
}

export default function MonitoringPage({
  id: propId,
  kind = "step",
}: {
  id?: string;
  /** Defaults to "step" so the legacy /health/monitoring/:id shape keeps working. */
  kind?: string;
}) {
  // useParams() is the canonical wouter v3 hook for extracting route params
  // from the nearest ancestor <Route> match. The propId fallback supports
  // render-prop usage: <Route path="/health/monitoring/step/:id">{(p) => <MonitoringPage id={p.id} kind="step" />}</Route>
  const routeParams = useParams<{ id?: string }>();
  const idParam = propId ?? routeParams?.id;
  const executionId = idParam ? parseInt(idParam, 10) : null;

  if (executionId && !isNaN(executionId)) {
    if (!SUPPORTED_ID_KINDS.includes(kind as MonitoringIdKind)) {
      // Better a stated "wrong kind of id" than a silent query against the
      // wrong table that comes back as a generic not-found.
      return <UnsupportedIdKind kind={kind} id={String(idParam)} />;
    }
    return <ExecutionDetailView executionId={executionId} kind={kind as MonitoringIdKind} />;
  }

  return <ExecutionListView />;
}
