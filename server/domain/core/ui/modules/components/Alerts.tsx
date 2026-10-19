import { useState, useCallback, lazy, Suspense } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, XCircle, Info, BellOff, Download, FileJson, Shield, Settings } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@domain-ui/core/ui/components/ui/dropdown-menu';
import { Link } from 'wouter';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@domain-ui/core/ui/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import type { Alert } from "@shared/schema/alerts";

// Lazy load the auto-rescue config component
const AlertAutoRescueConfig = lazy(() => import('./AlertAutoRescueConfig'));

export default function Alerts() {
  const { toast } = useToast();
  const [selectedSeverity, setSelectedSeverity] = useState('all');

  const { data: alertsData = [], isLoading } = useQuery<Alert[]>({
    queryKey: ['/api/alerts'],
    queryFn: async () => {
      const res = await fetch("/api/alerts", {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to fetch alerts");
      }
      return res.json();
    },
  });

  const alerts = alertsData.map((alert) => {
    // jobRunId is deliberately not linkable. The column has no foreign key, there
    // is no job-run table in the schema, and nothing resolves it — alert-mission
    // -bridge only passes it through as opaque metadata. It used to link to
    // /health/monitoring/:id, which resolves pipeline_step_executions: an
    // unrelated id space, so the link could only ever 404.
    //
    // It was also checked first, so an alert carrying both a jobRunId and a
    // pipelineRunId took the broken branch and never reached the working one.
    // The run number is still shown as text on the row below.
    let linkTo: string | null = null;
    if (alert.pipelineRunId) {
      linkTo = `/pipeline-executions/${alert.pipelineRunId}`;
    } else if (alert.scheduledJobId) {
      linkTo = `/scheduled-jobs/${alert.scheduledJobId}`;
    }

    return {
      id: alert.id,
      severity: alert.severity as 'critical' | 'warning' | 'info',
      title: alert.message?.split(':')[0] || 'Alert',
      message: alert.message || '',
      job: alert.pipelineRunId
        ? `Pipeline Run #${alert.pipelineRunId}`
        : alert.jobRunId
          ? `Job Run #${alert.jobRunId}`
          : alert.scheduledJobId
            ? `Scheduled Job #${alert.scheduledJobId}`
            : 'System',
      time: alert.createdAt ? new Date(alert.createdAt).toLocaleString() : 'Unknown',
      acknowledged: !!alert.acknowledgedAt,
      suppressed: alert.suppressed || false,
      suppressedReason: alert.suppressedReason || null,
      linkTo,
    };
  });

  const filteredAlerts = selectedSeverity === 'all'
    ? alerts
    : alerts.filter(alert => alert.severity === selectedSeverity);

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <XCircle className="w-5 h-5 text-destructive" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
      case 'info':
        return <Info className="w-5 h-5 text-blue-600" />;
      default:
        return <Info className="w-5 h-5" />;
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <Badge variant="destructive">Critical</Badge>;
      case 'warning':
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 dark:bg-yellow-500/20 dark:text-yellow-400">Warning</Badge>;
      case 'info':
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 dark:bg-blue-500/20 dark:text-blue-400">Info</Badge>;
      default:
        return <Badge variant="secondary">{severity}</Badge>;
    }
  };

  const acknowledgeMutation = useMutation({
    mutationFn: async (alertId: number) => {
      return await apiRequest('POST', `/api/alerts/${alertId}/acknowledge`, {});
    },
    onSuccess: (data, alertId) => {
      queryClient.setQueryData<Alert[]>(['/api/alerts'], (oldData) => {
        if (!oldData) return oldData;
        return oldData.map((alert) =>
          alert.id === alertId
            ? { ...alert, acknowledgedAt: new Date() }
            : alert
        );
      });
      queryClient.invalidateQueries({ queryKey: ['/api/alerts'] });
      toast({
        title: 'Alert acknowledged',
        description: 'The alert has been acknowledged successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to acknowledge alert',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

    const handleAcknowledge = (alertId: number) => {
    acknowledgeMutation.mutate(alertId);
  };

  const clearAcknowledgedMutation = useMutation<{ count?: number }, Error, void>({
    mutationFn: async () => {
      const response = await apiRequest('DELETE', '/api/alerts/clear-acknowledged', {});
      return response.json() as Promise<{ count?: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/alerts'] });
      toast({
        title: 'Alerts cleared',
        description: `Successfully cleared ${data.count || 0} acknowledged alerts.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to clear alerts',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const criticalCount = alerts.filter(a => a.severity === 'critical' && !a.acknowledged).length;
  const warningCount = alerts.filter(a => a.severity === 'warning' && !a.acknowledged).length;
  const infoCount = alerts.filter(a => a.severity === 'info' && !a.acknowledged).length;
  const acknowledgedCount = alerts.filter(a => a.acknowledged).length;

  const exportAsMarkdown = useCallback(() => {
    const ts = new Date().toISOString();
    const scope = selectedSeverity === 'all' ? 'All Severities' : selectedSeverity.charAt(0).toUpperCase() + selectedSeverity.slice(1);
    const lines: string[] = [
      `# Oddjob Incident Report`,
      `**Exported:** ${ts}`,
      `**Filter:** ${scope}`,
      `**Total incidents:** ${filteredAlerts.length}`,
      `**Unacknowledged critical:** ${criticalCount}`,
      `**Unacknowledged warnings:** ${warningCount}`,
      ``,
      `---`,
      ``,
      `## Instructions for AI Agent`,
      `The following incidents were exported from the Oddjob platform.`,
      `Each incident includes severity, category, message, associated job/pipeline run, and current status.`,
      `Please analyse each incident, identify root causes, and suggest or apply fixes.`,
      ``,
      `---`,
      ``,
    ];

    filteredAlerts.forEach((alert, idx) => {
      const rawAlert = alertsData.find(a => a.id === alert.id);
      lines.push(`## Incident ${idx + 1} — ${alert.severity.toUpperCase()} — ${alert.title}`);
      lines.push(`- **ID:** ${alert.id}`);
      lines.push(`- **Severity:** ${alert.severity}`);
      lines.push(`- **Category:** ${rawAlert?.category ?? 'unknown'}`);
      lines.push(`- **Message:** ${alert.message}`);
      lines.push(`- **Source:** ${alert.job}`);
      lines.push(`- **Time:** ${alert.time}`);
      lines.push(`- **Status:** ${alert.suppressed ? `Suppressed (${alert.suppressedReason ?? 'no reason'})` : alert.acknowledged ? 'Acknowledged' : 'Pending'}`);
      if (alert.linkTo) lines.push(`- **Link:** ${window.location.origin}${alert.linkTo}`);
      if (rawAlert?.details && Object.keys(rawAlert.details as object).length > 0) {
        lines.push(`- **Details:**`);
        lines.push(`  \`\`\`json`);
        lines.push(`  ${JSON.stringify(rawAlert.details, null, 2).replace(/\n/g, '\n  ')}`);
        lines.push(`  \`\`\``);
      }
      lines.push(``);
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `oddjob-incidents-${ts.slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);

    toast({ title: 'Exported', description: `${filteredAlerts.length} incidents exported as Markdown.` });
  }, [filteredAlerts, alertsData, selectedSeverity, criticalCount, warningCount, toast]);

  const exportAsJson = useCallback(() => {
    const ts = new Date().toISOString();
    const payload = {
      exportedAt: ts,
      filter: selectedSeverity,
      totalCount: filteredAlerts.length,
      incidents: filteredAlerts.map(alert => ({
        ...alert,
        details: alertsData.find(a => a.id === alert.id)?.details ?? {},
        category: alertsData.find(a => a.id === alert.id)?.category ?? 'unknown',
        rawLink: alert.linkTo ? `${window.location.origin}${alert.linkTo}` : null,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `oddjob-incidents-${ts.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast({ title: 'Exported', description: `${filteredAlerts.length} incidents exported as JSON.` });
  }, [filteredAlerts, alertsData, selectedSeverity, toast]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">System notifications and error reports</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="destructive">{criticalCount} Critical</Badge>
          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 dark:bg-yellow-500/20 dark:text-yellow-400">{warningCount} Warning</Badge>
          <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 dark:bg-blue-500/20 dark:text-blue-400">{infoCount} Info</Badge>
          
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-1.5 border-green-500/20 hover:bg-green-500/10 text-green-600 dark:text-green-400 ml-2"
            onClick={() => clearAcknowledgedMutation.mutate()}
            disabled={acknowledgedCount === 0 || clearAcknowledgedMutation.isPending}
          >
            <CheckCircle className="w-4 h-4" />
            Clear Fixed ({acknowledgedCount})
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5" disabled={filteredAlerts.length === 0}>
                <Download className="w-4 h-4" />
                Export Incidents
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportAsMarkdown} className="gap-2">
                <Download className="w-4 h-4" />
                Export as Markdown <span className="text-xs text-muted-foreground ml-1">(for Claude / AI agents)</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportAsJson} className="gap-2">
                <FileJson className="w-4 h-4" />
                Export as JSON <span className="text-xs text-muted-foreground ml-1">(machine-readable)</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs value={selectedSeverity} onValueChange={setSelectedSeverity}>
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-all">All Alerts</TabsTrigger>
          <TabsTrigger value="critical" data-testid="tab-critical">Critical</TabsTrigger>
          <TabsTrigger value="warning" data-testid="tab-warning">Warning</TabsTrigger>
          <TabsTrigger value="info" data-testid="tab-info">Info</TabsTrigger>
          <TabsTrigger value="auto-rescue" data-testid="tab-auto-rescue">
            <Shield className="w-4 h-4 mr-1" />
            Auto-Rescue
          </TabsTrigger>
        </TabsList>

        <TabsContent value="auto-rescue" className="mt-6">
          <Suspense fallback={
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Settings className="w-8 h-8 mx-auto mb-4 animate-spin" />
                Loading Auto-Rescue Configuration...
              </CardContent>
            </Card>
          }>
            <AlertAutoRescueConfig />
          </Suspense>
        </TabsContent>

        <TabsContent value={selectedSeverity} className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Alert List</CardTitle>
              <CardDescription>
                {selectedSeverity === 'all' ? 'All system alerts' : `${selectedSeverity.charAt(0).toUpperCase() + selectedSeverity.slice(1)} alerts`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading alerts...</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Severity</TableHead>
                      <TableHead>Alert</TableHead>
                      <TableHead>Job</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAlerts.map((alert) => (
                      <TableRow
                        key={alert.id}
                        data-testid={`row-alert-${alert.id}`}
                        className={alert.suppressed ? "opacity-75" : ""}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getSeverityIcon(alert.severity)}
                            {getSeverityBadge(alert.severity)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            {alert.linkTo ? (
                              <Link href={alert.linkTo} className="block">
                                <p className="font-medium text-primary hover:text-primary/80 hover:underline cursor-pointer transition-colors">
                                  {alert.title}
                                </p>
                              </Link>
                            ) : (
                              <p className="font-medium">{alert.title}</p>
                            )}
                            <p className="text-sm text-muted-foreground">{alert.message}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{alert.job}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{alert.time}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {alert.suppressed ? (
                              <div className="flex items-center gap-2 text-amber-600">
                                <BellOff className="w-4 h-4" />
                                <Badge variant="outline" className="text-amber-700 border-amber-300">
                                  Suppressed
                                </Badge>
                              </div>
                            ) : alert.acknowledged ? (
                              <div className="flex items-center gap-2 text-green-600">
                                <CheckCircle className="w-4 h-4" />
                                <span className="text-sm">Acknowledged</span>
                              </div>
                            ) : (
                              <Badge variant="secondary">Pending</Badge>
                            )}
                            {alert.suppressed && alert.suppressedReason && (
                              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                                {alert.suppressedReason}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {!alert.acknowledged && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleAcknowledge(alert.id)}
                              data-testid={`button-acknowledge-${alert.id}`}
                            >
                              Acknowledge
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {!isLoading && filteredAlerts.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">No alerts found.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

