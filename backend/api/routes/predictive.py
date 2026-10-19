"""
Predictive Analytics API
REST endpoints for predictive analytics, monitoring, and automation
"""

from typing import Dict, List, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field
from datetime import datetime, timezone, timedelta
from enum import Enum

from core.predictive_service import predictive_service, PredictiveServiceMode
from core.predictive_analytics import predictive_engine, PredictionType
from core.resource_optimizer import resource_optimizer
from core.workflow_optimizer import workflow_optimizer
from core.structured_logging import get_structured_logger

logger = get_structured_logger("predictive_api")

router = APIRouter(prefix="/predictive", tags=["predictive"])


# Pydantic models for API requests/responses
class PredictionRequest(BaseModel):
    """Request model for generating predictions."""
    entity: str = Field(..., description="Entity to predict for (e.g., 'system:cpu', 'workflow:user_registration')")
    prediction_type: str = Field("failure", description="Type of prediction (failure, performance, resource_usage)")
    context: Optional[Dict[str, Any]] = Field(None, description="Additional context for prediction")


class PredictionResponse(BaseModel):
    """Response model for predictions."""
    prediction: Optional[Dict[str, Any]] = None
    message: str


class ObservationRequest(BaseModel):
    """Request model for recording observations."""
    entity: str = Field(..., description="Entity identifier")
    value: float = Field(..., description="Observed value")
    context: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Observation context")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Additional metadata")


class HealthReportResponse(BaseModel):
    """Response model for health reports."""
    report: Optional[Dict[str, Any]] = None
    timestamp: datetime
    status: str


class OptimizationRequest(BaseModel):
    """Request model for requesting optimizations."""
    target: str = Field(..., description="Target for optimization (workflow:id, resource:type)")
    optimization_type: Optional[str] = Field(None, description="Type of optimization")


class ScalingRecommendationRequest(BaseModel):
    """Request model for resource scaling recommendations."""
    resource_type: Optional[str] = Field(None, description="Specific resource type to analyze")


class ServiceModeUpdate(BaseModel):
    """Request model for updating service mode."""
    mode: str = Field(..., description="New service mode (monitoring, advisory, automated, learning)")


@router.post("/observations", response_model=Dict[str, str])
async def record_observation(request: ObservationRequest):
    """Record an observation for predictive analysis."""
    try:
        await predictive_engine.record_observation(
            entity=request.entity,
            value=request.value,
            context=request.context,
            metadata=request.metadata
        )
        return {"message": f"Observation recorded for entity: {request.entity}"}
    except Exception as e:
        logger.error(f"Failed to record observation: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to record observation: {str(e)}")


@router.post("/predictions", response_model=PredictionResponse)
async def generate_prediction(request: PredictionRequest):
    """Generate a prediction for an entity."""
    try:
        prediction_type = PredictionType(request.prediction_type)

        if prediction_type == PredictionType.FAILURE:
            prediction = await predictive_engine.predict_failure(request.entity)
        elif prediction_type == PredictionType.PERFORMANCE:
            # Assume performance metric from context
            metric = request.context.get("metric", "execution_time") if request.context else "execution_time"
            prediction = await predictive_engine.predict_performance(request.entity, metric)
        elif prediction_type == PredictionType.RESOURCE_USAGE:
            # Resource usage prediction
            metric = "usage_percentage"
            prediction = await predictive_engine.predict_performance(request.entity, metric)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported prediction type: {request.prediction_type}")

        if prediction:
            return PredictionResponse(
                prediction=prediction.to_dict(),
                message="Prediction generated successfully"
            )
        else:
            return PredictionResponse(
                prediction=None,
                message="Insufficient data for prediction"
            )

    except Exception as e:
        logger.error(f"Failed to generate prediction: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate prediction: {str(e)}")


@router.get("/predictions/active")
async def get_active_predictions():
    """Get all active predictions."""
    try:
        predictions = predictive_engine.get_active_predictions()
        return {
            "predictions": [pred.to_dict() for pred in predictions.values()],
            "total": len(predictions)
        }
    except Exception as e:
        logger.error(f"Failed to get active predictions: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get predictions: {str(e)}")


@router.get("/health")
async def get_system_health():
    """Get current system health report."""
    try:
        report = predictive_service.get_current_health_report()
        return HealthReportResponse(
            report=report,
            timestamp=datetime.now(timezone.utc),
            status="success"
        )
    except Exception as e:
        logger.error(f"Failed to get health report: {e}")
        return HealthReportResponse(
            report=None,
            timestamp=datetime.now(timezone.utc),
            status="error"
        )


@router.get("/alerts")
async def get_active_alerts():
    """Get all active alerts."""
    try:
        alerts = predictive_service.get_active_alerts()
        return {
            "alerts": list(alerts.values()),
            "total": len(alerts)
        }
    except Exception as e:
        logger.error(f"Failed to get alerts: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get alerts: {str(e)}")


@router.delete("/alerts/{alert_key}")
async def clear_alert(alert_key: str):
    """Clear a specific alert."""
    try:
        success = await predictive_service.clear_alert(alert_key)
        if success:
            return {"message": f"Alert cleared: {alert_key}"}
        else:
            raise HTTPException(status_code=404, detail=f"Alert not found: {alert_key}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to clear alert: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to clear alert: {str(e)}")


@router.get("/resources/metrics")
async def get_resource_metrics():
    """Get current resource metrics."""
    try:
        metrics = resource_optimizer.get_resource_metrics()
        return {
            "metrics": metrics,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Failed to get resource metrics: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get resource metrics: {str(e)}")


@router.get("/resources/scaling-recommendations")
async def get_scaling_recommendations(request: ScalingRecommendationRequest = None):
    """Get resource scaling recommendations."""
    try:
        recommendations = resource_optimizer.get_scaling_recommendations()

        if request and request.resource_type:
            recommendations = [
                rec for rec in recommendations
                if rec.get("resource_type") == request.resource_type
            ]

        return {
            "recommendations": recommendations,
            "total": len(recommendations),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Failed to get scaling recommendations: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get recommendations: {str(e)}")


@router.get("/resources/efficiency")
async def get_resource_efficiency():
    """Get resource efficiency scores."""
    try:
        efficiency = resource_optimizer.get_resource_efficiency_score()
        return {
            "efficiency_scores": efficiency,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Failed to get efficiency scores: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get efficiency scores: {str(e)}")


@router.get("/resources/cost-optimization")
async def get_cost_optimization_recommendations():
    """Get cost optimization recommendations."""
    try:
        recommendations = resource_optimizer.get_cost_optimization_recommendations()
        return {
            "recommendations": recommendations,
            "total": len(recommendations),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Failed to get cost optimization recommendations: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get cost recommendations: {str(e)}")


@router.get("/workflows/{workflow_id}/metrics")
async def get_workflow_metrics(workflow_id: str):
    """Get metrics for a specific workflow."""
    try:
        metrics = workflow_optimizer.get_workflow_metrics(workflow_id)
        if metrics:
            return metrics
        else:
            raise HTTPException(status_code=404, detail=f"Workflow not found: {workflow_id}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get workflow metrics: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get workflow metrics: {str(e)}")


@router.post("/workflows/{workflow_id}/optimize")
async def optimize_workflow(workflow_id: str, background_tasks: BackgroundTasks):
    """Trigger optimization for a specific workflow."""
    try:
        background_tasks.add_task(workflow_optimizer.optimize_workflow, workflow_id)

        return {
            "message": f"Optimization initiated for workflow: {workflow_id}",
            "status": "optimization_started"
        }
    except Exception as e:
        logger.error(f"Failed to initiate workflow optimization: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to optimize workflow: {str(e)}")


@router.get("/workflows/{workflow_id}/optimizations")
async def get_workflow_optimizations(workflow_id: str, limit: int = 5):
    """Get optimization history for a workflow."""
    try:
        optimizations = workflow_optimizer.get_workflow_optimizations(workflow_id, limit)
        return {
            "workflow_id": workflow_id,
            "optimizations": optimizations,
            "total": len(optimizations)
        }
    except Exception as e:
        logger.error(f"Failed to get workflow optimizations: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get optimizations: {str(e)}")


@router.get("/workflows/optimization-effectiveness")
async def get_optimization_effectiveness():
    """Get optimization effectiveness metrics."""
    try:
        effectiveness = workflow_optimizer.get_optimization_effectiveness()
        return {
            "effectiveness": effectiveness,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Failed to get optimization effectiveness: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get effectiveness metrics: {str(e)}")


@router.post("/optimize", response_model=Dict[str, Any])
async def request_optimization(request: OptimizationRequest, background_tasks: BackgroundTasks):
    """Request optimization for a target entity."""
    try:
        result = await predictive_service.request_manual_optimization(
            request.target,
            request.optimization_type
        )

        if result:
            return {
                "optimization": result,
                "message": f"Optimization completed for {request.target}"
            }
        else:
            return {
                "optimization": None,
                "message": f"No optimization available for {request.target}"
            }

    except Exception as e:
        logger.error(f"Failed to request optimization: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to request optimization: {str(e)}")


@router.get("/actions/pending")
async def get_pending_actions():
    """Get all pending predictive actions."""
    try:
        actions = predictive_service.get_pending_actions()
        return {
            "actions": actions,
            "total": len(actions)
        }
    except Exception as e:
        logger.error(f"Failed to get pending actions: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get pending actions: {str(e)}")


@router.get("/actions/completed")
async def get_completed_actions(limit: int = 20):
    """Get recent completed actions."""
    try:
        actions = predictive_service.get_completed_actions(limit)
        return {
            "actions": actions,
            "total": len(actions),
            "limit": limit
        }
    except Exception as e:
        logger.error(f"Failed to get completed actions: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get completed actions: {str(e)}")


@router.put("/service/mode")
async def update_service_mode(request: ServiceModeUpdate):
    """Update the predictive service operating mode."""
    try:
        mode_map = {
            "monitoring": PredictiveServiceMode.MONITORING,
            "advisory": PredictiveServiceMode.ADVISORY,
            "automated": PredictiveServiceMode.AUTOMATED,
            "learning": PredictiveServiceMode.LEARNING
        }

        if request.mode not in mode_map:
            raise HTTPException(status_code=400, detail=f"Invalid mode: {request.mode}")

        predictive_service.set_mode(mode_map[request.mode])

        return {
            "message": f"Service mode updated to: {request.mode}",
            "mode": request.mode
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update service mode: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update mode: {str(e)}")


@router.get("/service/status")
async def get_service_status():
    """Get the current status of the predictive service."""
    try:
        health_report = predictive_service.get_current_health_report()
        pending_actions = len(predictive_service.get_pending_actions())
        active_alerts = len(predictive_service.get_active_alerts())

        return {
            "service_mode": predictive_service.mode.value,
            "is_monitoring_active": predictive_service.monitoring_task is not None and not predictive_service.monitoring_task.done(),
            "health_score": health_report.get("overall_health_score") if health_report else None,
            "pending_actions": pending_actions,
            "active_alerts": active_alerts,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    except Exception as e:
        logger.error(f"Failed to get service status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get service status: {str(e)}")


@router.post("/service/start-monitoring", response_model=Dict[str, str])
async def start_monitoring():
    """Start the predictive monitoring system."""
    try:
        await predictive_service.start_predictive_monitoring()
        return {"message": "Predictive monitoring started"}
    except Exception as e:
        logger.error(f"Failed to start monitoring: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start monitoring: {str(e)}")


@router.post("/service/stop-monitoring", response_model=Dict[str, str])
async def stop_monitoring():
    """Stop the predictive monitoring system."""
    try:
        predictive_service.stop_predictive_monitoring()
        return {"message": "Predictive monitoring stopped"}
    except Exception as e:
        logger.error(f"Failed to stop monitoring: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to stop monitoring: {str(e)}")


@router.get("/analytics/summary")
async def get_analytics_summary():
    """Get a comprehensive analytics summary."""
    try:
        # Collect data from all components
        health_report = predictive_service.get_current_health_report()
        active_predictions = len(predictive_engine.get_active_predictions())
        resource_metrics = resource_optimizer.get_resource_metrics()
        scaling_recs = len(resource_optimizer.get_scaling_recommendations())

        workflow_count = len(workflow_optimizer.workflow_metrics)
        total_optimizations = sum(
            len(opts) for opts in workflow_optimizer.optimization_history.values()
        )

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "system_health": {
                "overall_score": health_report.get("overall_health_score") if health_report else None,
                "active_alerts": len(predictive_service.get_active_alerts()),
                "pending_actions": len(predictive_service.get_pending_actions())
            },
            "predictions": {
                "active_predictions": active_predictions,
                "prediction_types": list(set(
                    pred.prediction_type.value
                    for pred in predictive_engine.get_active_predictions().values()
                ))
            },
            "resources": {
                "monitored_resources": len(resource_metrics),
                "scaling_recommendations": scaling_recs
            },
            "workflows": {
                "total_workflows": workflow_count,
                "total_optimizations": total_optimizations
            },
            "service_mode": predictive_service.mode.value
        }

    except Exception as e:
        logger.error(f"Failed to get analytics summary: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get analytics summary: {str(e)}")


@router.get("/analytics/performance-trends")
async def get_performance_trends(hours: int = 24):
    """Get performance trends over time."""
    try:
        # This would aggregate historical data from memory store
        # For now, return current metrics
        current_metrics = resource_optimizer.get_resource_metrics()

        # In a real implementation, this would query historical data
        trends = {
            "period_hours": hours,
            "current_metrics": current_metrics,
            "note": "Historical trend analysis not yet implemented"
        }

        return trends

    except Exception as e:
        logger.error(f"Failed to get performance trends: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get performance trends: {str(e)}")


@router.get("/analytics/prediction-accuracy")
async def get_prediction_accuracy():
    """Get prediction accuracy metrics."""
    try:
        # This would compare predictions with actual outcomes
        # For now, return placeholder
        accuracy_metrics = {
            "overall_accuracy": 0.85,  # Placeholder
            "prediction_types": {
                "failure": {"accuracy": 0.82, "total_predictions": 45},
                "performance": {"accuracy": 0.88, "total_predictions": 120},
                "resource_usage": {"accuracy": 0.79, "total_predictions": 67}
            },
            "note": "Prediction accuracy tracking not yet fully implemented"
        }

        return accuracy_metrics

    except Exception as e:
        logger.error(f"Failed to get prediction accuracy: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get prediction accuracy: {str(e)}")


# Bulk operations
@router.post("/bulk/optimize-all-workflows", response_model=Dict[str, str])
async def optimize_all_workflows(background_tasks: BackgroundTasks):
    """Trigger optimization for all registered workflows."""
    try:
        workflow_ids = list(workflow_optimizer.workflow_definitions.keys())

        for workflow_id in workflow_ids:
            background_tasks.add_task(workflow_optimizer.optimize_workflow, workflow_id)

        return {
            "message": f"Optimization initiated for {len(workflow_ids)} workflows",
            "workflows": workflow_ids
        }

    except Exception as e:
        logger.error(f"Failed to optimize all workflows: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to optimize workflows: {str(e)}")


@router.post("/bulk/clear-old-predictions", response_model=Dict[str, str])
async def clear_old_predictions(days: int = 7):
    """Clear old predictions to free up memory."""
    try:
        max_age = timedelta(days=days)
        cleared = predictive_engine.clear_old_predictions(max_age)

        return {"message": f"Cleared {cleared} old predictions older than {days} days"}

    except Exception as e:
        logger.error(f"Failed to clear old predictions: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to clear predictions: {str(e)}")


@router.get("/debug/component-status")
async def get_component_status():
    """Get status of all predictive components (for debugging)."""
    try:
        components = {
            "predictive_engine": {
                "active_predictions": len(predictive_engine.get_active_predictions()),
                "historical_entities": len(predictive_engine.historical_data)
            },
            "resource_optimizer": {
                "monitored_resources": len(resource_optimizer.current_metrics),
                "scaling_recommendations": len(resource_optimizer.get_scaling_recommendations())
            },
            "workflow_optimizer": {
                "registered_workflows": len(workflow_optimizer.workflow_definitions),
                "total_optimizations": sum(
                    len(opts) for opts in workflow_optimizer.optimization_history.values()
                )
            },
            "predictive_service": {
                "mode": predictive_service.mode.value,
                "active_alerts": len(predictive_service.active_alerts),
                "health_reports": len(predictive_service.health_reports)
            }
        }

        return {
            "components": components,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    except Exception as e:
        logger.error(f"Failed to get component status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get component status: {str(e)}")