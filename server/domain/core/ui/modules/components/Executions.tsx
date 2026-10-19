import { useState } from 'react';
import { Activity, Clock, CheckCircle, XCircle, Calendar } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@domain-ui/core/ui/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@domain-ui/core/ui/components/ui/dialog';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';

interface Execution {
  id: number;
  job: string;
  status: 'success' | 'failed' | 'running';
  startTime: string;
  duration: string;
  exitCode: number | null;
  output?: string;
  errorOutput?: string;
}

interface UpcomingExecution {
  id: number;
  jobId: number;
  jobName: string;
  scheduleId: number;
  scheduleName: string;
  nextRunTime: string;
  pattern: string;
}

export default function Executions() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);

  const upcomingExecutions: UpcomingExecution[] = [
    { id: 1, jobId: 1, jobName: 'Daily Cleanup Script', scheduleId: 10, scheduleName: 'Daily 2 AM Run', nextRunTime: 'Tomorrow at 2:00 AM', pattern: 'Every day at 02:00 UTC' },
    { id: 2, jobId: 2, jobName: 'API Data Sync', scheduleId: 11, scheduleName: 'Hourly Health Check', nextRunTime: 'Today at 3:00 PM', pattern: 'Every hour' },
    { id: 3, jobId: 3, jobName: 'Report Generator', scheduleId: 12, scheduleName: 'Weekly Report', nextRunTime: 'Monday at 9:00 AM', pattern: 'Every Monday at 09:00 UTC' },
    { id: 4, jobId: 4, jobName: 'Database Backup', scheduleId: 13, scheduleName: 'Monthly Cleanup', nextRunTime: 'February 1 at 3:00 AM', pattern: 'First day of month at 03:00 UTC' },
  ];

  const executions: Execution[] = [
    { id: 1003, job: 'API Data Sync', status: 'failed', startTime: '2024-01-15 14:23:15', duration: '50s', exitCode: 1, output: 'Connecting to API...', errorOutput: '429 TOO MANY REQUESTS - Rate limit exceeded' },
    { id: 1002, job: 'Daily Cleanup Script', status: 'success', startTime: '2024-01-15 14:18:22', duration: '1.2s', exitCode: 0, output: 'Cleanup completed successfully\nRemoved 145 temporary files' },
    { id: 1001, job: 'Report Generator', status: 'success', startTime: '2024-01-15 14:11:30', duration: '45s', exitCode: 0, output: 'Generating weekly report...\nReport saved to /reports/weekly_2024_01_15.pdf' },
    { id: 1000, job: 'Database Backup', status: 'running', startTime: '2024-01-15 14:09:00', duration: '2m 15s', exitCode: null, output: 'Backup in progress...\n45% complete' },
    { id: 999, job: 'Email Notification', status: 'success', startTime: '2024-01-15 14:05:42', duration: '0.8s', exitCode: 0, output: 'Sent 23 notification emails' },
  ];

  const filteredExecutions = executions.filter(exec =>
    exec.job.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-destructive" />;
      case 'running':
        return <Activity className="w-4 h-4 text-blue-600 animate-pulse" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const handleViewDetails = (execution: Execution) => {
    setSelectedExecution(execution);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Executions</h1>
          <p className="text-sm text-muted-foreground mt-1">Job execution history and logs</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="default" className="bg-green-100 text-green-800">
            <CheckCircle className="w-3 h-3 mr-1" />
            187 successful today
          </Badge>
          <Badge variant="destructive">
            <XCircle className="w-3 h-3 mr-1" />
            3 failed today
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming Executions</CardTitle>
          <CardDescription>Scheduled jobs that will run soon</CardDescription>
        </CardHeader>
        <CardContent>
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
              {upcomingExecutions.map((upcoming) => (
                <TableRow key={upcoming.id} data-testid={`row-upcoming-${upcoming.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/jobs/${upcoming.jobId}`} className="text-primary hover:underline cursor-pointer" data-testid={`link-upcoming-job-${upcoming.id}`}>
                      {upcoming.jobName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/schedules/${upcoming.scheduleId}`} className="text-primary hover:underline cursor-pointer" data-testid={`link-upcoming-schedule-${upcoming.id}`}>
                      {upcoming.scheduleName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      {upcoming.nextRunTime}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{upcoming.pattern}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Execution History</CardTitle>
              <CardDescription>View past job executions and their results</CardDescription>
            </div>
            <Input
              placeholder="Search executions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-sm"
              data-testid="input-search-executions"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Start Time</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Exit Code</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredExecutions.map((exec) => (
                <TableRow key={exec.id} data-testid={`row-execution-${exec.id}`}>
                  <TableCell className="font-mono text-sm">#{exec.id}</TableCell>
                  <TableCell className="font-medium">{exec.job}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(exec.status)}
                      {getStatusBadge(exec.status)}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{exec.startTime}</TableCell>
                  <TableCell className="text-muted-foreground">{exec.duration}</TableCell>
                  <TableCell>
                    {exec.exitCode !== null ? (
                      <Badge variant={exec.exitCode === 0 ? 'secondary' : 'destructive'} className="font-mono">
                        {exec.exitCode}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewDetails(exec)}
                      data-testid={`button-view-${exec.id}`}
                    >
                      View Logs
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filteredExecutions.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No executions found matching your search.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedExecution} onOpenChange={() => setSelectedExecution(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Execution Details - #{selectedExecution?.id}</DialogTitle>
            <DialogDescription>{selectedExecution?.job}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Status</p>
              <div className="mt-1">{selectedExecution && getStatusBadge(selectedExecution.status)}</div>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Duration</p>
              <p className="mt-1">{selectedExecution?.duration}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Start Time</p>
              <p className="mt-1 text-sm">{selectedExecution?.startTime}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Exit Code</p>
              <p className="mt-1">{selectedExecution?.exitCode ?? 'N/A'}</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Output</p>
              <ScrollArea className="h-40 rounded-md border border-border bg-muted p-4">
                <pre className="text-sm font-mono">{selectedExecution?.output || 'No output'}</pre>
              </ScrollArea>
            </div>
            {selectedExecution?.errorOutput && (
              <div>
                <p className="text-sm font-medium mb-2 text-destructive">Error Output</p>
                <ScrollArea className="h-40 rounded-md border border-destructive bg-destructive/5 p-4">
                  <pre className="text-sm font-mono text-destructive">{selectedExecution.errorOutput}</pre>
                </ScrollArea>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
