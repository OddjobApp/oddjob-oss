import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Brain, Zap, Clock, ThumbsUp, ArrowRight } from "lucide-react";
import { usePredictiveAnalytics } from "@domain-ui/core/ui/hooks/use-predictive";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";

export default function WorkflowIntelligence() {
  const { workflowEffectiveness, isLoadingWorkflow } = usePredictiveAnalytics();

  if (isLoadingWorkflow) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const overallScore = workflowEffectiveness?.overall_improvement || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Workflow Intelligence</h1>
        <p className="text-muted-foreground">
          AI-powered workflow optimization and bottleneck detection
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Workflows Optimizeed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-500" />
              {workflowEffectiveness?.workflows_optimized || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Overall Improvement</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-500" />
              {Math.round(overallScore * 100)}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">AI Confidence</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <ThumbsUp className="w-5 h-5 text-blue-500" />
              High
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Optimization Impact</CardTitle>
          <CardDescription>Measured improvements across active workflows</CardDescription>
        </CardHeader>
        <CardContent>
          {(!workflowEffectiveness?.metrics || workflowEffectiveness.metrics.length === 0) ? (
            <div className="text-center py-8 text-muted-foreground">
              No optimization data available yet. Run more workflows to generate insights.
            </div>
          ) : (
            <div className="space-y-6">
              {workflowEffectiveness.metrics.map((metric, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-32 font-medium truncate" title={metric.workflow_id}>Workflow #{metric.workflow_id}</div>
                  <div className="flex-1 space-y-1">
                    <div className="flex justify-between text-xs mb-1">
                      <span>Execution Speed</span>
                      <span className="text-green-600">+{Math.round(metric.execution_time_improvement * 100)}%</span>
                    </div>
                    <Progress value={metric.execution_time_improvement * 100} className="h-2 [&>div]:bg-green-500" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex justify-between text-xs mb-1">
                      <span>Error Reduction</span>
                      <span className="text-blue-600">-{Math.round(metric.error_rate_reduction * 100)}%</span>
                    </div>
                    <Progress value={metric.error_rate_reduction * 100} className="h-2 [&>div]:bg-blue-500" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

