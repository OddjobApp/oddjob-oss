
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface PredictiveAnalyticsSummary {
    timestamp: string;
    system_health: {
        overall_score: number | null;
        active_alerts: number;
        pending_actions: number;
    };
    predictions: {
        active_predictions: number;
        prediction_types: string[];
    };
    resources: {
        monitored_resources: number;
        scaling_recommendations: number;
    };
    workflows: {
        total_workflows: number;
        total_optimizations: number;
    };
    service_mode: string;
}

export interface ResourceMetric {
    resource_type: string;
    usage_percentage: number;
    trend: 'stable' | 'increasing' | 'decreasing';
    anomalies_detected: number;
}

export interface ResourceEfficiency {
    [resourceType: string]: number; // 0.0 to 1.0
}

export interface CostOptimizationRecommendation {
    resource_type: string;
    action: string;
    estimated_savings: number;
    impact: string;
    confidence: number;
}

export interface ScalingRecommendation {
    resource_type: string;
    current_usage: number;
    recommended_limit: number;
    action: 'scale_up' | 'scale_down' | 'maintain';
    reason: string;
}

export interface WorkflowEffectiveMetric {
    workflow_id: string;
    execution_time_improvement: number;
    error_rate_reduction: number;
    resource_savings: number;
}

export interface WorkflowEffectiveness {
    overall_improvement: number;
    workflows_optimized: number;
    metrics: WorkflowEffectiveMetric[];
}

export interface PredictionResult {
    prediction_type: string;
    target_entity: string;
    predicted_value: any;
    confidence: number;
    risk_level: string;
    prediction_horizon_hours: number;
    timestamp: string;
    features_used: {
        name: string;
        value: any;
        weight: number;
        importance: number;
    }[];
    recommendations: string[];
    preventive_actions: string[];
}

export interface ActivePredictionsResponse {
    predictions: PredictionResult[];
    total: number;
}

import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

export const usePredictiveAnalytics = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const summaryQuery = useQuery<PredictiveAnalyticsSummary>({
        queryKey: ['/api/predictive/analytics/summary'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/predictive/analytics/summary');
            return res.json();
        },
        refetchInterval: 30000, // Refresh every 30 seconds
    });

    const activePredictionsQuery = useQuery<ActivePredictionsResponse>({
        queryKey: ['/api/predictive/predictions/active'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/predictive/predictions/active');
            return res.json();
        },
        refetchInterval: 30000,
    });

    const healthQuery = useQuery({
        queryKey: ['/api/predictive/health'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/predictive/health');
            return res.json();
        }
    });

    const resourceMetricsQuery = useQuery<{ metrics: Record<string, ResourceMetric> }>({
        queryKey: ['/api/predictive/resources/metrics'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/predictive/resources/metrics');
            return res.json();
        }
    });

    const resourceEfficiencyQuery = useQuery<{ efficiency_scores: ResourceEfficiency }>({
        queryKey: ['/api/predictive/resources/efficiency'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/predictive/resources/efficiency');
            return res.json();
        }
    });

    const scalingRecommendationsQuery = useQuery<{ recommendations: ScalingRecommendation[] }>({
        queryKey: ['/api/predictive/resources/scaling-recommendations'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/predictive/resources/scaling-recommendations');
            return res.json();
        }
    });

    const costOptimizationQuery = useQuery<{ recommendations: CostOptimizationRecommendation[] }>({
        queryKey: ['/api/predictive/resources/cost-optimization'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/predictive/resources/cost-optimization');
            return res.json();
        }
    });

    const workflowEffectivenessQuery = useQuery<{ effectiveness: WorkflowEffectiveness }>({
        queryKey: ['/api/predictive/workflows/optimization-effectiveness'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/predictive/workflows/optimization-effectiveness');
            return res.json();
        }
    });

    const startMonitoringMutation = useMutation({
        mutationFn: async () => {
            await apiRequest('POST', '/api/predictive/service/start-monitoring');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/predictive/analytics/summary'] });
            toast({
                title: "Monitoring Started",
                description: "Predictive monitoring services are now active.",
            });
        },
        onError: (error: Error) => {
            toast({
                title: "Error",
                description: "Failed to start monitoring: " + error.message,
                variant: "destructive",
            });
        }
    });

    const stopMonitoringMutation = useMutation({
        mutationFn: async () => {
            await apiRequest('POST', '/api/predictive/service/stop-monitoring');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/predictive/analytics/summary'] });
            toast({
                title: "Monitoring Stopped",
                description: "Predictive monitoring services have been paused.",
            });
        },
        onError: (error: Error) => {
            toast({
                title: "Error",
                description: "Failed to stop monitoring: " + error.message,
                variant: "destructive",
            });
        }
    });

    const setServiceModeMutation = useMutation({
        mutationFn: async (mode: string) => {
            await apiRequest('PUT', '/api/predictive/service/mode', { mode });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/predictive/analytics/summary'] });
            toast({ title: "Configuration Updated", description: "Service mode updated successfully." });
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    return {
        summary: summaryQuery.data,
        isLoadingSummary: summaryQuery.isLoading,
        isSummaryError: summaryQuery.isError,

        activePredictions: activePredictionsQuery.data?.predictions || [],
        isLoadingPredictions: activePredictionsQuery.isLoading,

        health: healthQuery.data,

        resourceMetrics: resourceMetricsQuery.data?.metrics || {},
        resourceEfficiency: resourceEfficiencyQuery.data?.efficiency_scores || {},
        scalingRecommendations: scalingRecommendationsQuery.data?.recommendations || [],
        costRecommendations: costOptimizationQuery.data?.recommendations || [],

        workflowEffectiveness: workflowEffectivenessQuery.data?.effectiveness,

        isLoadingResources: resourceMetricsQuery.isLoading || resourceEfficiencyQuery.isLoading || scalingRecommendationsQuery.isLoading || costOptimizationQuery.isLoading,
        isLoadingWorkflow: workflowEffectivenessQuery.isLoading,

        startMonitoring: startMonitoringMutation.mutate,
        stopMonitoring: stopMonitoringMutation.mutate,
        setServiceMode: setServiceModeMutation.mutate,
        isTogglingMonitoring: startMonitoringMutation.isPending || stopMonitoringMutation.isPending
    };
};

