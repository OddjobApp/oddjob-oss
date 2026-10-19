import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Target, AlertTriangle, TrendingUp, Activity, Settings, RefreshCw, Power } from "lucide-react";
import { usePredictiveAnalytics } from "@domain-ui/core/ui/hooks/use-predictive";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";

export default function PredictiveDashboard() {
  const { summary, isLoadingSummary, startMonitoring, stopMonitoring, isTogglingMonitoring } = usePredictiveAnalytics();

  const isMonitoringActive = summary?.service_mode === 'monitoring' || summary?.service_mode === 'automated' || summary?.service_mode === 'advisory' || summary?.service_mode === 'learning';
  // Note: The backend enum might be lowercase.

  if (isLoadingSummary) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-12 space-y-12 max-w-none mx-auto">
      <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Predictive AI Dashboard</h1>
          <p className="text-muted-foreground">
            AI-powered insights and automated optimization for your system
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isMonitoringActive ? "default" : "secondary"} className={isMonitoringActive ? "bg-green-600 hover:bg-green-700" : ""}>
            {summary?.service_mode || 'OFFLINE'}
          </Badge>
          <Button
            variant={isMonitoringActive ? "destructive" : "default"}
            size="sm"
            onClick={() => isMonitoringActive ? stopMonitoring() : startMonitoring()}
            disabled={isTogglingMonitoring}
          >
            <Power className="w-4 h-4 mr-2" />
            {isMonitoringActive ? "Stop Monitoring" : "Start Monitoring"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">System Health</CardTitle>
            <Target className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.system_health.overall_score !== null && summary?.system_health.overall_score !== undefined
                ? `${Math.round(summary.system_health.overall_score * 100)}%`
                : 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground">Overall health score</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Predictions</CardTitle>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.predictions.active_predictions || 0}</div>
            <p className="text-xs text-muted-foreground">Ongoing predictions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
            <AlertTriangle className={`w-4 h-4 ${(summary?.system_health.active_alerts || 0) > 0 ? "text-red-500" : "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.system_health.active_alerts || 0}</div>
            <p className="text-xs text-muted-foreground">Require attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Optimizations</CardTitle>
            <Settings className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.workflows.total_optimizations || 0}</div>
            <p className="text-xs text-muted-foreground">Total applied optimizatons</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="text-center py-6">
          {isMonitoringActive ? (
            <>
              <Activity className="w-12 h-12 mx-auto mb-4 text-green-500 animate-pulse" />
              <h3 className="text-lg font-semibold mb-2">Predictive Monitoring Active</h3>
              <p className="text-muted-foreground">
                AI systems are continuously monitoring and optimizing your infrastructure.
                <br />
                Analyzing {summary?.resources.monitored_resources || 0} resources and {summary?.workflows.total_workflows || 0} workflows.
              </p>
            </>
          ) : (
            <>
              <Activity className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">Monitoring Paused</h3>
              <p className="text-muted-foreground">
                Predictive services are currently offline. Start monitoring to enable AI insights.
              </p>
            </>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

