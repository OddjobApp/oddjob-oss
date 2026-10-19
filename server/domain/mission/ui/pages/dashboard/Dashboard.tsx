import { Briefcase, Activity, AlertTriangle, Zap, Clock, CheckCircle, XCircle } from 'lucide-react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import StatCard from '@domain-ui/core/ui/components/shared/StatCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@domain-ui/core/ui/components/ui/table';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';
import { formatDistanceToNow, isToday } from 'date-fns';
import { Virtuoso } from 'react-virtuoso';

export default function Dashboard() {
  const queryOptions = {
    staleTime: 5000, 
    refetchInterval: 10000, // Sync every 10s for the dashboard
  };

  const { data: jobs = [], isLoading: loadingJobs } = useQuery<any[]>({ queryKey: ['/api/jobs'], ...queryOptions });
  const { data: pipelines = [], isLoading: loadingPipelines } = useQuery<any[]>({ queryKey: ['/api/pipelines'], ...queryOptions });
  const { data: executions = [], isLoading: loadingExecutions } = useQuery<any[]>({ queryKey: ['/api/executions'], ...queryOptions });
  const { data: alerts = [], isLoading: loadingAlerts } = useQuery<any[]>({ queryKey: ['/api/alerts'], ...queryOptions });
  const { data: activityData, isLoading: loadingActivity } = useQuery<any>({ queryKey: ['/api/missions/activity/global'], ...queryOptions });

  const executionsArray = Array.isArray(executions) ? executions : [];
  const alertsArray = Array.isArray(alerts) ? alerts : [];
  const activity = Array.isArray(activityData) ? activityData : (activityData?.items ?? activityData?.events ?? []);

  const executionsToday = executionsArray.filter((e: any) => {
    const d = e.startedAt ?? e.createdAt;
    return d && isToday(new Date(d));
  }).length;

  const activeAlerts = alertsArray.filter((a: any) => a.status === 'active' || !a.resolvedAt);
  const criticalCount = activeAlerts.filter((a: any) => a.severity === 'critical').length;
  const warningCount = activeAlerts.filter((a: any) => a.severity === 'warning').length;

  const recentExecutions = executionsArray.slice(0, 5);

  const stats = [
    {
      title: 'Total Jobs',
      value: loadingJobs ? '—' : jobs.length,
      description: 'Active jobs configured',
      icon: Briefcase,
      linkTo: '/jobs',
    },
    {
      title: 'Executions Today',
      value: loadingExecutions ? '—' : executionsToday,
      description: `${executionsArray.filter((e: any) => e.status === 'running').length} currently running`,
      icon: Activity,
      linkTo: '/executions',
    },
    {
      title: 'Active Alerts',
      value: loadingAlerts ? '—' : activeAlerts.length,
      description: activeAlerts.length > 0 ? `${criticalCount} critical, ${warningCount} warning` : 'No active alerts',
      icon: AlertTriangle,
      linkTo: '/health/alerts',
    },
    {
      title: 'Pipelines',
      value: loadingPipelines ? '—' : pipelines.length,
      description: `${(Array.isArray(pipelines) ? pipelines : []).filter((p: any) => p.isActive || p.status === 'active').length} active workflows`,
      icon: Zap,
      linkTo: '/pipelines',
    },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
      case 'completed':
        return <Badge variant="default" className="bg-green-100 text-green-800 dark:bg-green-500/10 dark:text-green-400">Success</Badge>;
      case 'failed':
      case 'error':
        return <Badge variant="destructive">Failed</Badge>;
      case 'running':
      case 'active':
        return <Badge variant="default" className="bg-blue-100 text-blue-800 dark:bg-blue-500/10 dark:text-blue-400">Running</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <Badge variant="destructive">Critical</Badge>;
      case 'warning':
        return <Badge variant="default" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-500/10 dark:text-green-400">Warning</Badge>;
      default:
        return <Badge variant="secondary">{severity}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Overview of your job automation system</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <StatCard key={stat.title} {...stat} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Executions */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Executions</CardTitle>
            <CardDescription>Latest job execution results</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingExecutions ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : recentExecutions.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No executions recorded yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                     <TableHead>Job</TableHead>
                     <TableHead>Status</TableHead>
                     <TableHead>Duration</TableHead>
                     <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentExecutions.map((exec: any) => {
                    const durationMs =
                      exec.completedAt && exec.startedAt
                        ? new Date(exec.completedAt).getTime() - new Date(exec.startedAt).getTime()
                        : null;
                    const durationLabel = durationMs != null
                      ? durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`
                      : '—';
                    const timeAgo = exec.startedAt
                      ? formatDistanceToNow(new Date(exec.startedAt), { addSuffix: true })
                      : '—';
                    return (
                      <TableRow key={exec.id}>
                        <TableCell className="font-medium">
                          {exec.jobId ? (
                            <Link href={`/jobs/${exec.jobId}`} className="text-primary hover:underline cursor-pointer">
                              {exec.jobName ?? exec.name ?? `Job #${exec.jobId}`}
                            </Link>
                          ) : (
                            exec.jobName ?? exec.name ?? `#${exec.id}`
                          )}
                        </TableCell>
                        <TableCell>{getStatusBadge(exec.status)}</TableCell>
                        <TableCell className="text-muted-foreground">{durationLabel}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{timeAgo}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Active Alerts */}
        <Card>
          <CardHeader>
            <CardTitle>Active Alerts</CardTitle>
            <CardDescription>System notifications requiring attention</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingAlerts ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : activeAlerts.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                <CheckCircle className="w-6 h-6 text-green-500" />
                All systems operational — no active alerts.
              </div>
            ) : (
              <div className="space-y-4">
                {activeAlerts.slice(0, 5).map((alert: any) => (
                  <div key={alert.id} className="flex gap-3 p-3 rounded-lg border border-border hover-elevate">
                    <div className="flex-shrink-0">
                      {alert.severity === 'critical' ? (
                        <XCircle className="w-5 h-5 text-destructive" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-yellow-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {getSeverityBadge(alert.severity)}
                        <span className="text-xs text-muted-foreground">
                          {alert.createdAt ? formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true }) : ''}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-foreground">{alert.title ?? alert.message ?? 'Alert'}</p>
                      {alert.jobId && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Job: <Link href={`/jobs/${alert.jobId}`} className="text-primary hover:underline cursor-pointer">{alert.jobName ?? `#${alert.jobId}`}</Link>
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Activity Timeline (Virtualised) */}
      <Card>
        <CardHeader>
          <CardTitle>Activity Timeline</CardTitle>
          <CardDescription>Recent system activity</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingActivity ? (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : activity.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No recent activity.</div>
          ) : (
            <div className="h-[400px]">
              <Virtuoso
                data={activity}
                itemContent={(idx, item) => {
                  const isFailure = item.eventType === 'failed' || item.status === 'failed' || item.type === 'failed';
                  const IconComponent = isFailure ? XCircle : CheckCircle;
                  const iconColor = isFailure ? 'text-destructive' : 'text-green-600';
                  const timeAgo = item.createdAt ?? item.timestamp
                    ? formatDistanceToNow(new Date(item.createdAt ?? item.timestamp), { addSuffix: true })
                    : '';
                  return (
                    <div className="flex gap-3 py-3 border-b border-border/50 last:border-0 hover:bg-muted/5 transition-colors pr-2">
                        <div className="flex-shrink-0">
                          <IconComponent className={`w-5 h-5 ${iconColor}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-4">
                            <p className="text-sm font-medium text-foreground truncate">
                              {item.title ?? item.action ?? item.eventType ?? 'Event'}
                            </p>
                            {timeAgo && <span className="text-[10px] text-muted-foreground shrink-0 uppercase tracking-tighter">{timeAgo}</span>}
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            {item.missionId && (
                              <Link href={`/missions/${item.missionId}`} className="text-primary hover:underline cursor-pointer mr-1">
                                {item.missionName ?? `Mission #${item.missionId}`}
                              </Link>
                            )}
                            {item.description ?? item.detail ?? ''}
                          </p>
                        </div>
                    </div>
                  );
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
