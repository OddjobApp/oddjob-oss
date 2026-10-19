import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { AlertTriangle, CheckCircle2, AlertCircle } from "lucide-react";
import { usePredictiveAnalytics, PredictionResult } from "@domain-ui/core/ui/hooks/use-predictive";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

export default function FailurePredictions() {
  const { activePredictions, isLoadingPredictions } = usePredictiveAnalytics();

  const failurePredictions = activePredictions.filter(p => p.prediction_type === 'failure');

  if (isLoadingPredictions) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const getRiskBadge = (level: string) => {
    switch (level) {
      case 'critical': return <Badge variant="destructive">Critical</Badge>;
      case 'high': return <Badge variant="destructive" className="bg-orange-500 hover:bg-orange-600">High</Badge>;
      case 'medium': return <Badge variant="secondary" className="bg-yellow-500 hover:bg-yellow-600 text-foreground">Medium</Badge>;
      default: return <Badge variant="outline">Low</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Failure Predictions</h1>
        <p className="text-muted-foreground">
          AI-powered failure prediction and preventive maintenance
        </p>
      </div>

      {failurePredictions.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-500" />
            <h3 className="text-lg font-semibold mb-2">System Healthy</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              No potential failures detected. The AI is continuously analyzing system behavior for anomalies.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {failurePredictions.map((prediction, idx) => (
            <Card key={idx} className="border-l-4 border-l-red-500">
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-500" />
                      {prediction.target_entity}
                    </CardTitle>
                    <CardDescription>
                      Predicted to fail within {Math.round(prediction.prediction_horizon_hours)} hours
                    </CardDescription>
                  </div>
                  {getRiskBadge(prediction.risk_level)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold mb-1">Risk Confidence</h4>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 bg-secondary rounded-full overflow-hidden">
                        <div
                          className={`h-full ${prediction.confidence > 0.7 ? 'bg-red-500' : 'bg-yellow-500'}`}
                          style={{ width: `${prediction.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium">{Math.round(prediction.confidence * 100)}%</span>
                    </div>
                  </div>

                  {prediction.recommendations.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-1">Recommendations</h4>
                      <ul className="text-sm text-muted-foreground list-disc pl-4 space-y-1">
                        {prediction.recommendations.map((rec, i) => (
                          <li key={i}>{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {prediction.preventive_actions.length > 0 && (
                    <div className="bg-muted p-3 rounded-md">
                      <h4 className="text-sm font-semibold mb-1 text-foreground">Preventive Actions</h4>
                      <ul className="text-sm text-muted-foreground list-disc pl-4 space-y-1">
                        {prediction.preventive_actions.map((rec, i) => (
                          <li key={i}>{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground pt-2 border-t">
                    Detected {formatDistanceToNow(new Date(prediction.timestamp), { addSuffix: true })}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

