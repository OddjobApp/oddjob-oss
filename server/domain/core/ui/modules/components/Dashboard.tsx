import { Briefcase, Activity, AlertTriangle, Zap, Clock, CheckCircle, XCircle } from 'lucide-react';
import { Link } from 'wouter';
import StatCard from '@domain-ui/core/ui/components/shared/StatCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@domain-ui/core/ui/components/ui/table';

export default function Dashboard() {
  const stats = [
    { title: 'Total Jobs', value: 42, description: 'Active jobs configured', icon: Briefcase, linkTo: '/jobs' },
    { title: 'Executions Today', value: 187, description: '12 currently running', icon: Activity, linkTo: '/executions' },
    { title: 'Active Alerts', value: 3, description: '2 critical, 1 warning', icon: AlertTriangle, linkTo: '/health/alerts' },
    { title: 'Pipelines', value: 8, description: '6 active workflows', icon: Zap, linkTo: '/pipelines' },
  ];

  const recentExecutions = [
    { id: 1003, jobId: 1, job: 'API Data Sync', status: 'failed', duration: '50s', time: '2 min ago', exitCode: 1 },
    { id: 1002, jobId: 2, job: 'Daily Cleanup Script', status: 'success', duration: '1.2s', time: '5 min ago', exitCode: 0 },
    { id: 1001, jobId: 3, job: 'Report Generator', status: 'success', duration: '45s', time: '12 min ago', exitCode: 0 },
    { id: 1000, jobId: 4, job: 'Database Backup', status: 'running', duration: '2m 15s', time: 'Started 2m ago', exitCode: null },
    { id: 999, jobId: 5, job: 'Email Notification', status: 'success', duration: '0.8s', time: '18 min ago', exitCode: 0 },
  ];

  const activeAlerts = [
    { id: 3, jobId: 1, severity: 'critical', title: 'Job Failed: Rate Limit', job: 'API Data Sync', time: '2 min ago' },
    { id: 2, jobId: 6, severity: 'critical', title: 'Execution Timeout', job: 'Long Running Process', time: '45 min ago' },
    { id: 1, jobId: 7, severity: 'warning', title: 'High Memory Usage', job: 'Data Processing', time: '1 hour ago' },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return <Badge variant="default" className="bg-green-100 text-green-800">Success</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'running':
        return <Badge variant="default" className="bg-blue-100 text-blue-800">Running</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <Badge variant="destructive">Critical</Badge>;
      case 'warning':
        return <Badge variant="default" className="bg-yellow-100 text-yellow-800">Warning</Badge>;
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
        <Card>
          <CardHeader>
            <CardTitle>Recent Executions</CardTitle>
            <CardDescription>Latest job execution results</CardDescription>
          </CardHeader>
          <CardContent>
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
                {recentExecutions.map((exec) => (
                  <TableRow key={exec.id} data-testid={`row-execution-${exec.id}`}>
                    <TableCell className="font-medium">
                      <Link href={`/jobs/${exec.jobId}`} className="text-primary hover:underline cursor-pointer" data-testid={`link-job-${exec.id}`}>
                        {exec.job}
                      </Link>
                    </TableCell>
                    <TableCell>{getStatusBadge(exec.status)}</TableCell>
                    <TableCell className="text-muted-foreground">{exec.duration}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{exec.time}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Alerts</CardTitle>
            <CardDescription>System notifications requiring attention</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {activeAlerts.map((alert) => (
                <div key={alert.id} className="flex gap-3 p-3 rounded-lg border border-border hover-elevate" data-testid={`alert-${alert.id}`}>
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
                      <span className="text-xs text-muted-foreground">{alert.time}</span>
                    </div>
                    <p className="text-sm font-medium text-foreground">{alert.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Job: <Link href={`/jobs/${alert.jobId}`} className="text-primary hover:underline cursor-pointer" data-testid={`link-alert-job-${alert.id}`}>{alert.job}</Link>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity Timeline</CardTitle>
          <CardDescription>Recent system activity</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { action: 'Job failed', detail: 'API Data Sync encountered rate limit', time: '2 minutes ago', icon: XCircle, iconColor: 'text-destructive', jobId: 1, jobName: 'API Data Sync' },
              { action: 'Job completed', detail: 'Daily Cleanup Script finished successfully', time: '5 minutes ago', icon: CheckCircle, iconColor: 'text-green-600', jobId: 2, jobName: 'Daily Cleanup Script' },
              { action: 'New schedule created', detail: 'added by admin@oddjob.com', time: '15 minutes ago', icon: Clock, iconColor: 'text-blue-600', scheduleId: 11, scheduleName: 'Hourly Health Check' },
              { action: 'Job completed', detail: 'Report Generator finished successfully', time: '18 minutes ago', icon: CheckCircle, iconColor: 'text-green-600', jobId: 3, jobName: 'Report Generator' },
            ].map((item, idx) => (
              <div key={idx} className="flex gap-3" data-testid={`activity-${idx}`}>
                <div className="flex-shrink-0">
                  <item.icon className={`w-5 h-5 ${item.iconColor}`} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{item.action}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.jobId && (
                      <Link href={`/jobs/${item.jobId}`} className="text-primary hover:underline cursor-pointer" data-testid={`link-activity-job-${idx}`}>
                        {item.jobName}
                      </Link>
                    )}
                    {item.scheduleId && (
                      <Link href={`/schedules/${item.scheduleId}`} className="text-primary hover:underline cursor-pointer" data-testid={`link-activity-schedule-${idx}`}>
                        {item.scheduleName}
                      </Link>
                    )}
                    {item.jobId || item.scheduleId ? ' ' : ''}
                    {item.detail}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{item.time}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
