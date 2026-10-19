import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { TrendingUp, ArrowUp, ArrowDown, DollarSign, CheckCircle2 } from "lucide-react";
import { usePredictiveAnalytics } from "@domain-ui/core/ui/hooks/use-predictive";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";

export default function ResourceOptimization() {
  const { scalingRecommendations, costRecommendations, isLoadingResources } = usePredictiveAnalytics();

  if (isLoadingResources) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const hasRecommendations = scalingRecommendations.length > 0 || costRecommendations.length > 0;

  return (
    <div className="p-6 md:p-12 space-y-12 max-w-[2200px] mx-auto">
      <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Resource Optimization</h1>
        <p className="text-muted-foreground">
          Intelligent resource allocation and predictive scaling
        </p>
      </div>

      {!hasRecommendations ? (
        <Card>
          <CardContent className="text-center py-12">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-500" />
            <h3 className="text-lg font-semibold mb-2">Optimized</h3>
            <p className="text-muted-foreground">
              No optimization recommendations at this time. Your resources are operating efficiently.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Scaling Recommendations */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-500" />
              Scaling Recommendations
            </h2>
            {scalingRecommendations.length === 0 ? (
              <Card className="bg-muted border-dashed">
                <CardContent className="p-6 text-center text-muted-foreground text-sm">
                  No scaling actions needed.
                </CardContent>
              </Card>
            ) : (
              scalingRecommendations.map((rec, i) => (
                <Card key={i}>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <CardTitle className="text-base font-medium capitalize">
                        {rec.resource_type.replace('_', ' ')}
                      </CardTitle>
                      <Badge variant={rec.action === 'scale_up' ? 'destructive' : 'default'} className={rec.action === 'scale_up' ? 'bg-orange-500' : 'bg-green-600'}>
                        {rec.action.replace('_', ' ')}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm space-y-2">
                    <p className="text-muted-foreground">{rec.reason}</p>
                    <div className="flex justify-between items-center bg-muted p-2 rounded">
                      <span>Current: <strong>{rec.current_usage}%</strong></span>
                      {rec.action === 'scale_up' ? <ArrowUp className="w-4 h-4 text-orange-500" /> : <ArrowDown className="w-4 h-4 text-green-600" />}
                      <span>Target: <strong>{rec.recommended_limit}%</strong></span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Cost Optimization */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-green-600" />
              Cost Optimization
            </h2>
            {costRecommendations.length === 0 ? (
              <Card className="bg-muted border-dashed">
                <CardContent className="p-6 text-center text-muted-foreground text-sm">
                  No cost saving opportunities detected.
                </CardContent>
              </Card>
            ) : (
              costRecommendations.map((rec, i) => (
                <Card key={i}>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <CardTitle className="text-base font-medium capitalize">
                        {rec.resource_type.replace('_', ' ')}
                      </CardTitle>
                      <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-200">
                        Save ${rec.estimated_savings}/mo
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm space-y-3">
                    <p>{rec.action}</p>
                    <Separator />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Confidence: {Math.round(rec.confidence * 100)}%</span>
                      <span>Impact: <span className="capitalize text-foreground font-medium">{rec.impact}</span></span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

