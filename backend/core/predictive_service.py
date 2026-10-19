"""
Predictive Service
High-level orchestration service for predictive analytics and automation
"""

import asyncio
from typing import Dict, List, Any, Optional, Tuple, Union
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum

from core.service_base import BaseService, ServiceConfig
from core.structured_logging import get_structured_logger
from core.predictive_analytics import predictive_engine, PredictionResult, PredictionType
from core.resource_optimizer import resource_optimizer, ScalingRecommendation
from core.workflow_optimizer import workflow_optimizer, WorkflowOptimization
from core.memory_store import memory_store, MemoryType

logger = get_structured_logger("predictive_service")


class PredictiveServiceMode(Enum):
    """Operating modes for the predictive service."""
    MONITORING = "monitoring"      # Only monitor and analyze
    ADVISORY = "advisory"          # Provide recommendations but don't act
    AUTOMATED = "automated"        # Automatically implement optimizations
    LEARNING = "learning"          # Focus on learning and model improvement


@dataclass
class SystemHealthReport:
    """Comprehensive system health report."""
    timestamp: datetime
    overall_health_score: float  # 0-100
    component_health: Dict[str, float]
    active_alerts: List[Dict[str, Any]]
    predictions: List[PredictionResult]
    recommendations: List[Dict[str, Any]]
    optimization_opportunities: List[Dict[str, Any]]

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "timestamp": self.timestamp.isoformat(),
            "overall_health_score": self.overall_health_score,
            "component_health": self.component_health,
            "active_alerts": self.active_alerts,
            "predictions": [p.to_dict() for p in self.predictions],
            "recommendations": self.recommendations,
            "optimization_opportunities": self.optimization_opportunities
        }


@dataclass
class PredictiveAction:
    """An action taken by the predictive service."""
    action_id: str
    action_type: str
    target_entity: str
    description: str
    confidence: float
    expected_impact: Dict[str, Any]
    status: str  # "pending", "executing", "completed", "failed"
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    completion_time: Optional[datetime] = None
    result: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "action_id": self.action_id,
            "action_type": self.action_type,
            "target_entity": self.target_entity,
            "description": self.description,
            "confidence": self.confidence,
            "expected_impact": self.expected_impact,
            "status": self.status,
            "timestamp": self.timestamp.isoformat(),
            "completion_time": self.completion_time.isoformat() if self.completion_time else None,
            "result": self.result
        }


class PredictiveService(BaseService):
    """High-level orchestration service for predictive analytics and automation."""

    def __init__(self, config: ServiceConfig):
        super().__init__(config)
        self.logger = get_structured_logger("predictive_service")

        # Service configuration
        self.mode = PredictiveServiceMode.ADVISORY
        self.monitoring_interval = 300  # 5 minutes
        self.reporting_interval = 3600  # 1 hour

        # Health monitoring
        self.health_reports: List[SystemHealthReport] = []
        self.active_alerts: Dict[str, Dict[str, Any]] = {}
        self.alert_thresholds = {
            "cpu_usage": 85.0,
            "memory_usage": 90.0,
            "error_rate": 0.1,
            "response_time": 5000  # milliseconds
        }

        # Action tracking
        self.pending_actions: Dict[str, PredictiveAction] = {}
        self.completed_actions: List[PredictiveAction] = []

        # Performance tracking
        self.performance_metrics: Dict[str, List[float]] = {}

        # Monitoring tasks
        self.monitoring_task: Optional[asyncio.Task] = None
        self.reporting_task: Optional[asyncio.Task] = None

    async def _perform_health_check(self) -> None:
        """Perform health check."""
        # Check if all predictive components are available
        try:
            await predictive_engine._perform_health_check()
            await resource_optimizer._perform_health_check()
            await workflow_optimizer._perform_health_check()
        except Exception as e:
            raise Exception(f"Predictive service health check failed: {e}")

    async def start_predictive_monitoring(self) -> None:
        """Start the predictive monitoring system."""
        if self.monitoring_task and not self.monitoring_task.done():
            return

        self.monitoring_task = asyncio.create_task(self._monitoring_loop())
        self.reporting_task = asyncio.create_task(self._reporting_loop())

        self.logger.info("Predictive monitoring started")

    def stop_predictive_monitoring(self) -> None:
        """Stop the predictive monitoring system."""
        if self.monitoring_task:
            self.monitoring_task.cancel()
        if self.reporting_task:
            self.reporting_task.cancel()

        self.logger.info("Predictive monitoring stopped")

    async def _monitoring_loop(self) -> None:
        """Main monitoring loop."""
        while True:
            try:
                # Collect system metrics
                await self._collect_system_metrics()

                # Generate predictions
                predictions = await self._generate_predictions()

                # Check for alerts
                alerts = await self._check_alerts(predictions)

                # Generate recommendations
                recommendations = await self._generate_recommendations(predictions)

                # Execute automated actions if in automated mode
                if self.mode == PredictiveServiceMode.AUTOMATED:
                    await self._execute_automated_actions(recommendations)

                # Store health report
                health_report = await self._generate_health_report(predictions, alerts, recommendations)
                self.health_reports.append(health_report)

                # Keep only recent reports
                cutoff_time = datetime.now(timezone.utc) - timedelta(hours=24)
                self.health_reports = [
                    report for report in self.health_reports
                    if report.timestamp > cutoff_time
                ]

                await asyncio.sleep(self.monitoring_interval)

            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"Monitoring loop error: {e}")
                await asyncio.sleep(60)  # Wait before retrying

    async def _reporting_loop(self) -> None:
        """Periodic reporting loop."""
        while True:
            try:
                await asyncio.sleep(self.reporting_interval)

                # Generate and store comprehensive report
                report = await self._generate_comprehensive_report()
                await self._store_report(report)

                # Clean up old actions
                self._cleanup_old_actions()

            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"Reporting loop error: {e}")

    async def _collect_system_metrics(self) -> None:
        """Collect comprehensive system metrics."""
        try:
            # Record system resource usage
            resource_metrics = resource_optimizer.get_resource_metrics()
            for resource_type, metrics in resource_metrics.items():
                await predictive_engine.record_observation(
                    entity=f"system:{resource_type}",
                    value=metrics["current_usage"],
                    context={
                        "resource_type": resource_type,
                        "capacity": metrics["capacity"],
                        "utilization_trend": metrics.get("utilization_trend", 0)
                    }
                )

            # Record workflow performance metrics
            for workflow_id in workflow_optimizer.workflow_metrics.keys():
                metrics = workflow_optimizer.get_workflow_metrics(workflow_id)
                if metrics:
                    await predictive_engine.record_observation(
                        entity=f"workflow:{workflow_id}:performance",
                        value=metrics["average_execution_time"],
                        context={
                            "success_rate": metrics["success_rate"],
                            "total_executions": metrics["total_executions"]
                        }
                    )

        except Exception as e:
            self.logger.warning(f"Failed to collect system metrics: {e}")

    async def _generate_predictions(self) -> List[PredictionResult]:
        """Generate predictions across all monitored entities."""
        predictions = []

        try:
            # Generate failure predictions for critical components
            critical_entities = [
                "system:cpu", "system:memory", "system:disk",
                "database:main", "api:endpoint"
            ]

            for entity in critical_entities:
                prediction = await predictive_engine.predict_failure(entity)
                if prediction:
                    predictions.append(prediction)

            # Generate resource usage predictions
            resource_types = ["cpu", "memory", "disk"]
            for resource in resource_types:
                prediction = await predictive_engine.predict_performance(
                    entity=f"system:{resource}",
                    metric="usage_percentage"
                )
                if prediction:
                    predictions.append(prediction)

        except Exception as e:
            self.logger.error(f"Failed to generate predictions: {e}")

        return predictions

    async def _check_alerts(self, predictions: List[PredictionResult]) -> List[Dict[str, Any]]:
        """Check for alerts based on predictions and thresholds."""
        alerts = []

        for prediction in predictions:
            alert = await self._evaluate_prediction_for_alert(prediction)
            if alert:
                alerts.append(alert)

                # Store active alert
                alert_key = f"{prediction.prediction_type.value}:{prediction.target_entity}"
                self.active_alerts[alert_key] = {
                    "alert": alert,
                    "timestamp": datetime.now(timezone.utc),
                    "prediction": prediction.to_dict()
                }

        return alerts

    async def _evaluate_prediction_for_alert(self, prediction: PredictionResult) -> Optional[Dict[str, Any]]:
        """Evaluate a prediction to determine if it should trigger an alert."""
        # High confidence failure predictions
        if (prediction.prediction_type == PredictionType.FAILURE and
            prediction.confidence > 0.8 and
            prediction.risk_level.value in ["high", "critical"]):
            return {
                "type": "failure_prediction",
                "severity": prediction.risk_level.value,
                "entity": prediction.target_entity,
                "message": f"High confidence failure prediction for {prediction.target_entity}",
                "confidence": prediction.confidence,
                "recommendations": prediction.recommendations
            }

        # Resource usage alerts
        if prediction.prediction_type == PredictionType.RESOURCE_USAGE:
            predicted_usage = prediction.predicted_value
            if isinstance(predicted_usage, (int, float)):
                resource_type = prediction.target_entity.split(":")[-1]
                threshold = self.alert_thresholds.get(f"{resource_type}_usage", 90.0)

                if predicted_usage > threshold:
                    return {
                        "type": "resource_usage",
                        "severity": "warning" if predicted_usage < threshold * 1.2 else "critical",
                        "entity": prediction.target_entity,
                        "message": f"Predicted high {resource_type} usage: {predicted_usage:.1f}%",
                        "predicted_value": predicted_usage,
                        "threshold": threshold
                    }

        return None

    async def _generate_recommendations(self, predictions: List[PredictionResult]) -> List[Dict[str, Any]]:
        """Generate comprehensive recommendations based on predictions."""
        recommendations = []

        # Resource scaling recommendations
        resource_recs = resource_optimizer.get_scaling_recommendations()
        recommendations.extend(resource_recs)

        # Workflow optimization recommendations
        for workflow_id in workflow_optimizer.workflow_metrics.keys():
            optimization = await workflow_optimizer.optimize_workflow(workflow_id)
            if optimization:
                recommendations.append({
                    "type": "workflow_optimization",
                    "workflow_id": workflow_id,
                    "priority": optimization.priority,
                    "confidence": optimization.confidence,
                    "changes": len(optimization.proposed_changes),
                    "expected_improvements": optimization.expected_improvements
                })

        # Cost optimization recommendations
        cost_recs = resource_optimizer.get_cost_optimization_recommendations()
        recommendations.extend(cost_recs)

        return recommendations

    async def _execute_automated_actions(self, recommendations: List[Dict[str, Any]]) -> None:
        """Execute automated actions based on recommendations."""
        for recommendation in recommendations:
            try:
                if recommendation.get("confidence", 0) > 0.8:  # High confidence only
                    action = await self._create_automated_action(recommendation)
                    if action:
                        await self._execute_action(action)

            except Exception as e:
                self.logger.error(f"Failed to execute automated action: {e}")

    async def _create_automated_action(self, recommendation: Dict[str, Any]) -> Optional[PredictiveAction]:
        """Create an automated action from a recommendation."""
        rec_type = recommendation.get("type")

        if rec_type == "resource_scaling":
            return PredictiveAction(
                action_id=f"scale_{recommendation['resource_type']}_{int(datetime.now().timestamp())}",
                action_type="resource_scaling",
                target_entity=recommendation["resource_type"],
                description=f"Scale {recommendation['resource_type']} to {recommendation['recommended_capacity']}",
                confidence=recommendation["confidence"],
                expected_impact={"capacity_change": recommendation["recommended_capacity"] - recommendation["current_capacity"]},
                status="pending"
            )

        elif rec_type == "workflow_optimization":
            return PredictiveAction(
                action_id=f"optimize_{recommendation['workflow_id']}_{int(datetime.now().timestamp())}",
                action_type="workflow_optimization",
                target_entity=recommendation["workflow_id"],
                description=f"Apply {len(recommendation.get('changes', []))} optimizations to workflow",
                confidence=recommendation["confidence"],
                expected_impact=recommendation.get("expected_improvements", {}),
                status="pending"
            )

        return None

    async def _execute_action(self, action: PredictiveAction) -> None:
        """Execute a predictive action."""
        action.status = "executing"
        self.pending_actions[action.action_id] = action

        try:
            if action.action_type == "resource_scaling":
                # Execute resource scaling
                await self._execute_resource_scaling(action)

            elif action.action_type == "workflow_optimization":
                # Execute workflow optimization
                await self._execute_workflow_optimization(action)

            action.status = "completed"
            action.completion_time = datetime.now(timezone.utc)
            action.result = {"success": True}

        except Exception as e:
            action.status = "failed"
            action.completion_time = datetime.now(timezone.utc)
            action.result = {"success": False, "error": str(e)}
            self.logger.error(f"Action execution failed: {e}")

        # Move to completed actions
        self.completed_actions.append(action)
        del self.pending_actions[action.action_id]

    async def _execute_resource_scaling(self, action: PredictiveAction) -> None:
        """Execute resource scaling action."""
        # This would integrate with actual scaling mechanisms
        # For now, just log the action
        self.logger.info(f"Executing resource scaling: {action.description}")

        # In a real implementation, this would:
        # - Call cloud provider APIs (AWS ECS, Kubernetes, etc.)
        # - Adjust container resource limits
        # - Update orchestration configurations

    async def _execute_workflow_optimization(self, action: PredictiveAction) -> None:
        """Execute workflow optimization action."""
        workflow_id = action.target_entity

        # Get the latest optimization
        optimizations = workflow_optimizer.get_workflow_optimizations(workflow_id, limit=1)
        if optimizations:
            optimization_data = optimizations[0]
            # Convert back to WorkflowOptimization object (simplified)
            # In practice, you'd store the full object

            self.logger.info(f"Applying workflow optimization to {workflow_id}")

            # Apply the optimization (placeholder)
            await workflow_optimizer.apply_optimization(workflow_id, None)  # Would pass actual optimization object

    async def _generate_health_report(
        self,
        predictions: List[PredictionResult],
        alerts: List[Dict[str, Any]],
        recommendations: List[Dict[str, Any]]
    ) -> SystemHealthReport:
        """Generate a comprehensive system health report."""
        # Calculate component health scores
        component_health = await self._calculate_component_health()

        # Calculate overall health score
        overall_health = self._calculate_overall_health_score(component_health, predictions, alerts)

        # Extract optimization opportunities
        optimization_opportunities = [
            rec for rec in recommendations
            if rec.get("type") in ["workflow_optimization", "resource_scaling"]
        ]

        return SystemHealthReport(
            timestamp=datetime.now(timezone.utc),
            overall_health_score=overall_health,
            component_health=component_health,
            active_alerts=alerts,
            predictions=predictions,
            recommendations=recommendations,
            optimization_opportunities=optimization_opportunities
        )

    async def _calculate_component_health(self) -> Dict[str, float]:
        """Calculate health scores for individual components."""
        health_scores = {}

        # Resource health
        resource_metrics = resource_optimizer.get_resource_metrics()
        for resource_type, metrics in resource_metrics.items():
            usage = metrics["current_usage"]
            # Health score based on usage (lower usage = higher health)
            health_scores[f"resource:{resource_type}"] = max(0, 100 - usage)

        # Workflow health
        for workflow_id, metrics in workflow_optimizer.workflow_metrics.items():
            success_rate = metrics.success_rate * 100
            health_scores[f"workflow:{workflow_id}"] = success_rate

        # Prediction engine health (based on data availability)
        total_predictions = len(predictive_engine.active_predictions)
        health_scores["predictive_engine"] = min(100, total_predictions * 10)  # Arbitrary scaling

        return health_scores

    def _calculate_overall_health_score(
        self,
        component_health: Dict[str, float],
        predictions: List[PredictionResult],
        alerts: List[Dict[str, Any]]
    ) -> float:
        """Calculate overall system health score."""
        if not component_health:
            return 50.0  # Default neutral score

        # Base score from component health
        avg_component_health = sum(component_health.values()) / len(component_health)

        # Penalty for alerts
        alert_penalty = len(alerts) * 10  # 10 points per alert

        # Penalty for critical predictions
        critical_predictions = [
            p for p in predictions
            if p.risk_level.value == "critical"
        ]
        prediction_penalty = len(critical_predictions) * 15  # 15 points per critical prediction

        overall_score = avg_component_health - alert_penalty - prediction_penalty
        return max(0, min(100, overall_score))

    async def _generate_comprehensive_report(self) -> Dict[str, Any]:
        """Generate a comprehensive predictive analytics report."""
        latest_report = self.health_reports[-1] if self.health_reports else None

        report = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "period": {
                "start": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
                "end": datetime.now(timezone.utc).isoformat()
            },
            "summary": {
                "total_predictions": len(predictive_engine.active_predictions),
                "active_alerts": len(self.active_alerts),
                "completed_actions": len(self.completed_actions),
                "pending_actions": len(self.pending_actions)
            },
            "performance_metrics": self.performance_metrics.copy(),
            "optimization_effectiveness": workflow_optimizer.get_optimization_effectiveness(),
            "resource_efficiency": resource_optimizer.get_resource_efficiency_score()
        }

        if latest_report:
            report["latest_health_report"] = latest_report.to_dict()

        return report

    async def _store_report(self, report: Dict[str, Any]) -> None:
        """Store a comprehensive report."""
        try:
            await memory_store.store_memory(
                content=f"Comprehensive predictive report: Health score {report.get('latest_health_report', {}).get('overall_health_score', 'N/A')}",
                memory_type=MemoryType.SUCCESS,
                context=report,
                source="predictive_service"
            )
        except Exception as e:
            self.logger.warning(f"Failed to store report: {e}")

    def _cleanup_old_actions(self) -> None:
        """Clean up old completed actions."""
        cutoff_time = datetime.now(timezone.utc) - timedelta(days=7)
        self.completed_actions = [
            action for action in self.completed_actions
            if action.timestamp > cutoff_time
        ]

    # Public API methods
    def set_mode(self, mode: PredictiveServiceMode) -> None:
        """Set the operating mode of the predictive service."""
        self.mode = mode
        self.logger.info(f"Predictive service mode set to: {mode.value}")

    def get_current_health_report(self) -> Optional[Dict[str, Any]]:
        """Get the latest health report."""
        if self.health_reports:
            return self.health_reports[-1].to_dict()
        return None

    def get_active_alerts(self) -> Dict[str, Dict[str, Any]]:
        """Get all active alerts."""
        return self.active_alerts.copy()

    def get_pending_actions(self) -> List[Dict[str, Any]]:
        """Get all pending actions."""
        return [action.to_dict() for action in self.pending_actions.values()]

    def get_completed_actions(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get recent completed actions."""
        return [action.to_dict() for action in self.completed_actions[-limit:]]

    async def request_manual_optimization(self, target: str, optimization_type: str) -> Optional[Dict[str, Any]]:
        """Request manual optimization for a specific target."""
        try:
            if target.startswith("workflow:"):
                workflow_id = target.split(":", 1)[1]
                optimization = await workflow_optimizer.optimize_workflow(workflow_id)
                return optimization.to_dict() if optimization else None

            elif target.startswith("resource:"):
                # Trigger resource analysis
                recommendations = resource_optimizer.get_scaling_recommendations()
                resource_type = target.split(":", 1)[1]
                relevant_recs = [r for r in recommendations if r.get("resource_type") == resource_type]
                return relevant_recs[0] if relevant_recs else None

        except Exception as e:
            self.logger.error(f"Manual optimization request failed: {e}")
            return None

    async def clear_alert(self, alert_key: str) -> bool:
        """Clear a specific alert."""
        if alert_key in self.active_alerts:
            del self.active_alerts[alert_key]
            self.logger.info(f"Cleared alert: {alert_key}")
            return True
        return False

    async def initialize(self) -> None:
        """Initialize the predictive service."""
        self.logger.info("Predictive service initialized")

    async def shutdown(self) -> None:
        """Shutdown the predictive service."""
        self.stop_predictive_monitoring()
        self.logger.info("Predictive service shutdown")


# Global predictive service instance
predictive_service = PredictiveService(
    ServiceConfig(name="predictive_service", enabled=True)
)