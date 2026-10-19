import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Activity, Server, Cpu, HardDrive, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { usePredictiveAnalytics } from "@domain-ui/core/ui/hooks/use-predictive";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";

export default function PredictiveMonitoring() {
  const { resourceMetrics, resourceEfficiency, isLoadingResources } = usePredictiveAnalytics();

  if (isLoadingResources) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'increasing': return <TrendingUp className="w-4 h-4 text-red-500" />;
      case 'decreasing': return <TrendingDown className="w-4 h-4 text-green-500" />;
      default: return <Minus className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getResourceIcon = (type: string) => {
    if (type.includes('cpu')) return <Cpu className="w-4 h-4" />;
    if (type.includes('memory') || type.includes('ram')) return <Server className="w-4 h-4" />;
    if (type.includes('disk') || type.includes('storage')) return <HardDrive className="w-4 h-4" />;
    return <Activity className="w-4 h-4" />;
  };

  const metricsList = Object.entries(resourceMetrics);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Predictive Monitoring</h1>
        <p className="text-muted-foreground">
          Real-time system monitoring with predictive analytics
        </p>
      </div>

      {metricsList.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Activity className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Active Metrics</h3>
            <p className="text-muted-foreground">
              Start monitoring to see real-time resource usage and predictions.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {metricsList.map(([key, metric]) => {
            const efficiency = resourceEfficiency[key] || 0;

            return (
              <Card key={key}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium capitalize flex items-center gap-2">
                    {getResourceIcon(key)}
                    {key.replace('system:', '').replace('_', ' ')}
                  </CardTitle>
                  {getTrendIcon(metric.trend)}
                </CardHeader>
                <CardContent>
                  <div className="mt-4 space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Usage</span>
                        <span className="font-bold">{Math.round(metric.usage_percentage)}%</span>
                      </div>
                      <Progress value={metric.usage_percentage} className={metric.usage_percentage > 80 ? "bg-red-100 [&>div]:bg-red-500" : ""} />
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Efficiency Score</span>
                        <span className={`font-bold ${efficiency < 0.6 ? 'text-orange-500' : 'text-green-600'}`}>{Math.round(efficiency * 100)}%</span>
                      </div>
                      <Progress value={efficiency * 100} className="[&>div]:bg-blue-500" />
                    </div>

                    {metric.anomalies_detected > 0 && (
                      <div className="pt-2 text-xs text-red-500 font-medium flex items-center gap-1">
                        <Activity className="w-3 h-3" />
                        {metric.anomalies_detected} anomalies detected recently
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

